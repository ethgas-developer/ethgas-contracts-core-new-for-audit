// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import {IERC20} from "../dependencies/openzeppelin-v5.0.1/token/IERC20.sol";
import {SafeERC20} from "../dependencies/openzeppelin-v5.0.1/token/SafeERC20.sol";

import "../interfaces/IACLManager.sol";
import {Math} from "../dependencies/openzeppelin-v5.0.1/utils/Math.sol";
import "../interfaces/IEthgasTokenLock.sol";
import {IVotingEscrow} from "../interfaces/IVotingEscrow.sol";
import {IDelegateRegistry} from "../interfaces/IDelegateRegistry.sol";
import {IFeeDistributor} from "../interfaces/IFeeDistributor.sol";

contract EthgasTokenLock is IEthgasTokenLock {
    using SafeERC20 for IERC20;

    uint256 private constant MIN_PERIOD = 1;

    // -- State --

    IERC20 public immutable token;
    IVotingEscrow public immutable veToken;
    IFeeDistributor public immutable feeDistributor;
    address public beneficiary;

    // Configuration

    // Amount of tokens managed by the contract schedule
    uint256 public immutable managedAmount;

    // -- Unlock Schedule --
    uint256 public immutable unlockStartTime; // in unixtimestamp
    uint256 public immutable unlockEndTime;
    uint256 public immutable unlockPeriods;
    uint256 public immutable initialUnlockAmount;

    // -- Vesting Schedule --
    bool public immutable revocable; // Whether to use vesting for locked funds
    uint256 public immutable vestingCliffTime;
    uint256 public immutable vestingEndTime;
    uint256 public immutable vestingPeriods;
    uint256 public immutable vestingCliffAmount;

    // State

    bool public isRevoked;
    bool public isAccepted;
    uint256 public releasedAmount;
    uint256 public revokedAmount;

    // Access Control
    IACLManager public aclManager;
    
    // Snapshot Voting Delegation
    IDelegateRegistry public immutable delegateRegistry;

    uint256 public immutable earliestStakingTime;

    // -- Events --

    event TokensReleased(address indexed beneficiary, uint256 amount);
    event TokensWithdrawn(address indexed beneficiary, uint256 amount);
    event TokensRevoked(address indexed beneficiary, uint256 amount);
    event TokensStaked(address indexed beneficiary, uint256 amount, uint256 initUnlockTime);
    event TokensUnstaked();
    event SetAutoClaim(bool isAutoClaim);
    event RewardClaimed(address indexed receiver, uint256 amount);
    event SetDelegate(bytes32 indexed id, address indexed delegate);
    event ClearDelegate(bytes32 indexed id);
    event BeneficiaryChanged(address newBeneficiary);
    event LockAccepted();
    event LockCanceled();
    event AclManagerChanged(address aclManager);
    error CannotStakeForExpiredLock();

    /**
     * @dev Only allow calls from the beneficiary of the contract
     */
    modifier onlyBeneficiary() {
        require(msg.sender == beneficiary, "!auth");
        _;
    }

    modifier onlyAdminRole() {
		aclManager.checkAdminRole(msg.sender);
		_;
	}

    modifier onlyTimelockRole() {
		aclManager.checkTimelockRole(msg.sender);
		_;
	}

    /**
     * @notice Initializes the contract
     * @param _beneficiary Address of the beneficiary of locked tokens
     * @param _managedAmount Amount of tokens to be managed by the lock contract
     * @param _vestingEndTime End time of the release schedule
     * @param _vestingPeriods Number of vestingPeriods between start time and end time
     * @param _vestingCliffTime Override time for when the vesting start
     * @param _revocable Whether the contract is revocable
     */
    struct UnlockInfo {
        uint256 unlockPeriods;
        uint256 unlockStartTime;
        uint256 unlockEndTime;
        uint256 initialUnlockAmount;
    }
    struct VestingInfo {
        uint256 vestingPeriods;
        uint256 vestingCliffTime;
        uint256 vestingEndTime;
        uint256 vestingCliffAmount;
    }
    constructor(
        IACLManager _aclManager,
        address _beneficiary,
        IERC20 _token,
        uint256 _managedAmount,
        UnlockInfo memory _unlockInfo,
        bool _revocable,
        VestingInfo memory _vestingInfo,
        IVotingEscrow _veToken,
        IDelegateRegistry _delegateRegistry,
        IFeeDistributor _feeDistributor,
        uint256 _earliestStakingTime
    ) {
        require(address(_aclManager) != address(0), "ACLManager cannot be zero");
        require(_beneficiary != address(0), "Beneficiary cannot be zero");
        require(address(_token) != address(0), "Token cannot be zero");
        require(address(_veToken) != address(0), "veToken cannot be zero");
        require(address(_delegateRegistry) != address(0), "delegateRegistry cannot be zero");
        require(address(_feeDistributor) != address(0), "feeDistributor cannot be zero");
        require(_managedAmount > 0, "Managed tokens cannot be zero");
        require(_unlockInfo.unlockStartTime != 0, "Start time must be set");
        require(_unlockInfo.unlockStartTime < _unlockInfo.unlockEndTime, "Start time >= end time");
        require(_unlockInfo.unlockPeriods >= MIN_PERIOD, "Periods cannot be below minimum");
        require(_unlockInfo.initialUnlockAmount <= _managedAmount, "initialUnlockAmount cannot be larger than managedAmount");
        require(_vestingInfo.vestingCliffAmount <= _managedAmount, "vestingCliffAmount cannot be larger than managedAmount");

        aclManager = _aclManager;
        beneficiary = _beneficiary;
        token = _token;
        veToken = _veToken;
        feeDistributor = _feeDistributor;
        delegateRegistry = _delegateRegistry;

        managedAmount = _managedAmount;

        unlockPeriods = _unlockInfo.unlockPeriods;
        unlockStartTime = _unlockInfo.unlockStartTime;
        unlockEndTime = _unlockInfo.unlockEndTime;
        initialUnlockAmount = _unlockInfo.initialUnlockAmount;

        earliestStakingTime = _earliestStakingTime;

        if (_revocable) {
            require(_vestingInfo.vestingCliffTime != 0, "Vesting cliff time must be set");
            require(_vestingInfo.vestingCliffTime < _vestingInfo.vestingEndTime, "Vesting cliff time cannot be later than vesting end time");
            require(_vestingInfo.vestingCliffTime <= _unlockInfo.unlockStartTime, "Vesting cliff time cannot be later than lock start time");
            require(_vestingInfo.vestingEndTime <= _unlockInfo.unlockEndTime, "Vesting end time cannot be later than lock end time");
            require(_vestingInfo.vestingPeriods >= MIN_PERIOD, "Periods cannot be below minimum");
            
            vestingPeriods = _vestingInfo.vestingPeriods;
            vestingCliffTime = _vestingInfo.vestingCliffTime;
            vestingEndTime = _vestingInfo.vestingEndTime;
            vestingCliffAmount = _vestingInfo.vestingCliffAmount;
            revocable = _revocable;
        }
    }

    function setAclManager(IACLManager _aclManager) external onlyTimelockRole {
		require(address(_aclManager) != address(0), "Empty aclManager");
		aclManager = _aclManager;
		emit AclManagerChanged(address(_aclManager));
	}

    /**
     * @notice Change the beneficiary of funds managed by the contract
     * @dev Can only be called by the beneficiary
     * @param _newBeneficiary Address of the new beneficiary address
     */
    function changeBeneficiary(address _newBeneficiary) external onlyBeneficiary {
        require(_newBeneficiary != address(0), "Empty beneficiary");
        beneficiary = _newBeneficiary;
        emit BeneficiaryChanged(_newBeneficiary);
    }

    /**
     * @notice Beneficiary accepts the lock, the admin cannot retrieve back the tokens
     * @dev Can only be called by the beneficiary
     */
    function acceptLock() external onlyBeneficiary {
        isAccepted = true;
        emit LockAccepted();
    }

    /**
     * @notice Admin cancel the lock and return the balance in the contract
     * @dev Can only be called by the admin
     */
    function cancelLock() external onlyAdminRole {
        require(isAccepted == false, "Cannot cancel accepted contract");

        token.safeTransfer(msg.sender, currentBalance());

        emit LockCanceled();
    }

    // -- Balances --

    /**
     * @notice Returns the amount of tokens currently held by the contract
     * @return Tokens held in the contract
     */
    function currentBalance() public view override returns (uint256) {
        return token.balanceOf(address(this));
    }

    // -- Time & Periods --

    /**
     * @notice Returns the current block timestamp
     * @return Current block timestamp
     */
    function currentTime() public view override returns (uint256) {
        return block.timestamp;
    }

    /**
     * @notice Gets vestingDuration of contract from start to end in seconds
     * @return Amount of seconds from contract vestingCliffTime to vestingEndTime
     */
    function vestingDuration() public view override returns (uint256) {
        return vestingEndTime - vestingCliffTime;
    }

    /**
     * @notice Gets time elapsed since the start of the contract
     * @dev Returns zero if called before contract startTime
     * @return Seconds elapsed from contract vestingCliffTime
     */
    function sinceVestingCliffTime() public view override returns (uint256) {
        uint256 current = currentTime();
        if (current <= vestingCliffTime) {
            return 0;
        }
        return current - vestingCliffTime;
    }

    /**
     * @notice Returns amount available to be released after each period according to schedule
     * @return Amount of tokens available after each period
     */
    function vestingAmountPerPeriod() public view override returns (uint256) {
        if (revocable == false) {
            return 0;
        }
        return (managedAmount - vestingCliffAmount) / vestingPeriods;
    }

    /**
     * @notice Returns the vestingDuration of each period in seconds
     * @return Duration of each period in seconds
     */
    function vestingPeriodDuration() public view override returns (uint256) {
        if (revocable == false) {
            return 0;
        }
        return vestingDuration() / vestingPeriods;
    }

    /**
     * @notice Gets the current period based on the schedule
     * @return A number that represents the current period
     */
    function currentVestingPeriod() public view override returns (uint256) {
        if (revocable == false) {
            return 0;
        }
        return sinceVestingCliffTime() / vestingPeriodDuration() + MIN_PERIOD;
    }

    /**
     * @notice Gets the number of vestingPeriods that passed since the first period
     * @return A number of vestingPeriods that passed since the schedule started
     */
    function passedVestingPeriods() public view override returns (uint256) {
        if (revocable == false) {
            return 0;
        }
        return currentVestingPeriod() - MIN_PERIOD;
    }

    // -- Locking & Release Schedule --

    /**
     * @notice Gets the currently available token according to the schedule
     * @dev Implements the step-by-step schedule based on vestingPeriods for available tokens
     * @return Amount of tokens available according to the schedule
     */
    function vestedAmount() public view override returns (uint256) {
        uint256 current = currentTime();

        // Before contract start no funds are available
        if (current < vestingCliffTime) {
            return 0;
        }

        if (current > vestingEndTime || isRevoked) {
            return managedAmount - revokedAmount;
        }

        // Get available amount based on period
        return passedVestingPeriods() * vestingAmountPerPeriod() + vestingCliffAmount;
    }

    /**
     * @notice Gets unlockDuration of contract from start to end in seconds
     * @return Amount of seconds from contract unlockStartTime to unlockEndTime
     */
    function unlockDuration() public view override returns (uint256) {
        return unlockEndTime - unlockStartTime;
    }

    /**
     * @notice Gets time elapsed since the start of the contract
     * @dev Returns zero if called before conctract starTime
     * @return Seconds elapsed from contract unlockStartTime
     */
    function sinceUnlockStartTime() public view override returns (uint256) {
        uint256 current = currentTime();
        if (current <= unlockStartTime) {
            return 0;
        }
        return current - unlockStartTime;
    }

    /**
     * @notice Returns amount available to be released after each period according to schedule
     * @return Amount of tokens available after each period
     */
    function unlockAmountPerPeriod() public view override returns (uint256) {
        return (managedAmount - initialUnlockAmount) / unlockPeriods;
    }

    /**
     * @notice Returns the unlockDuration of each period in seconds
     * @return Duration of each period in seconds
     */
    function unlockPeriodDuration() public view override returns (uint256) {
        return unlockDuration() / unlockPeriods;
    }

    /**
     * @notice Gets the current period based on the schedule
     * @return A number that represents the current period
     */
    function currentUnlockPeriod() public view override returns (uint256) {
        return sinceUnlockStartTime() / unlockPeriodDuration() + MIN_PERIOD;
    }

    /**
     * @notice Gets the number of unlockPeriods that passed since the first period
     * @return A number of unlockPeriods that passed since the schedule started
     */
    function passedUnlockPeriods() public view override returns (uint256) {
        return currentUnlockPeriod() - MIN_PERIOD;
    }

    /**
     * @notice Gets tokens currently available for release
     * @dev Considers the schedule and takes into account already released tokens
     * @return Amount of tokens ready to be released
     */
    function releasableAmount() public view override returns (uint256) {
        uint256 current = currentTime();

        // Before contract start no funds are available
        if (current < unlockStartTime) {
            return 0;
        }

        uint256 releasable;
        if (current > unlockEndTime) {
            releasable = Math.min(managedAmount, vestedAmount()) - releasedAmount;
        } else {
            releasable = Math.min(passedUnlockPeriods() * unlockAmountPerPeriod() + initialUnlockAmount, vestedAmount()) - releasedAmount;
        }        
        
        // A beneficiary can never have more releasable tokens than the contract balance
        return Math.min(currentBalance(), releasable);
    }

    /**
     * @notice Gets the outstanding amount yet to be released based on the whole contract lifetime
     * @dev Does not consider schedule but just global amounts tracked
     * @return Amount of outstanding tokens for the lifetime of the contract
     */
    function totalOutstandingAmount() public view override returns (uint256) {
        return managedAmount - releasedAmount - revokedAmount;
    }

    /**
     * @notice Gets surplus amount in the contract based on outstanding amount to release
     * @dev All funds over outstanding amount is considered surplus that can be withdrawn by beneficiary.
     * Note surplus fund cannot be withdrawn by any party after the contract is revoked
     * @return Amount of tokens considered as surplus
     */
    function surplusAmount() public view override returns (uint256) {
        uint256 balance = currentBalance();
        uint256 outstandingAmount = totalOutstandingAmount();
        if (balance > outstandingAmount) {
            return balance - outstandingAmount;
        }
        return 0;
    }

    // -- Value Transfer --

    /**
     * @notice Releases tokens based on the configured schedule
     * @dev All available releasable tokens are transferred to beneficiary
     * @param _initUnlockTime has no effect if _isStake is false or veToken locked amount already > 0
     */
    function release(bool _isStake, uint256 _initUnlockTime) external override onlyBeneficiary {
        uint256 amountToRelease = releasableAmount();
        require(amountToRelease > 0, "No available releasable amount");

        releasedAmount = releasedAmount + amountToRelease;

        if (_isStake) {
            IVotingEscrow.LockedBalance memory l = veToken.locked(msg.sender);
            token.approve(address(veToken), amountToRelease);
            if (l.end > block.timestamp) {
                veToken.increase_amount_for(msg.sender, amountToRelease);
                emit TokensStaked(beneficiary, amountToRelease, 0);
            } else if (l.amount == 0) {
                veToken.create_lock_for(msg.sender, amountToRelease, _initUnlockTime);
                emit TokensStaked(beneficiary, amountToRelease, _initUnlockTime);
            } else {
                revert CannotStakeForExpiredLock();
            }
        } else {
            token.safeTransfer(beneficiary, amountToRelease);
        }

        emit TokensReleased(beneficiary, amountToRelease);
    }

    /**
     * @notice cannot change lock time after initial lock
     */
    function stake(uint256 _amount, uint256 _initUnlockTime) external onlyBeneficiary {
        require(currentTime() >= earliestStakingTime, "cannot stake before the earliestStakingTime");
        require(_amount <= currentBalance(), "No available balance");
        require(managedAmount == vestedAmount() || isRevoked, "can only stake when fully vested or after revoked");
        require(isAccepted == true, "Cannot stake without accepting contract");
        IVotingEscrow.LockedBalance memory l = veToken.locked(address(this));
        token.approve(address(veToken), _amount);
        if (l.end > block.timestamp) {
            veToken.increase_amount(_amount);
            emit TokensStaked(address(this), _amount, 0);
        } else if (l.amount == 0) {
            veToken.create_lock(_amount, _initUnlockTime);
            emit TokensStaked(address(this), _amount, _initUnlockTime);
        } else {
            revert CannotStakeForExpiredLock();
        }
    }

    function getStakingInfo() external view returns (IVotingEscrow.LockedBalance memory) {
        return veToken.locked(address(this));
    }

    /**
     * @notice anyone can call this function to help beneficiary to claim reward
     */
    function claimStakingReward() external {
        require(currentTime() >= unlockStartTime, "cannot claim before unlockStartTime");
        uint256 initBalance = currentBalance();
        feeDistributor.claim(address(this));
        uint256 endBalance = currentBalance();
        uint256 rewardToRelease = endBalance - initBalance;
        if (rewardToRelease == 0) {
            return;
        }
        token.safeTransfer(beneficiary, rewardToRelease);
        emit RewardClaimed(beneficiary, rewardToRelease);

    }

    function setAutoClaim(bool _isAutoClaim) external onlyBeneficiary {
        feeDistributor.set_auto_claim(_isAutoClaim);
        emit SetAutoClaim(_isAutoClaim);
    }

    /**
     * @notice anyone can unstake as long as the ve lock has expired
     */
    function unstake() external {
        veToken.withdraw();
        emit TokensUnstaked();
    }

    /**
     * @notice delegate staked and unvested token from vesting contract address to an EOA to perform voting on Snapshot
     */
    function setSnapshotDelegate(bytes32 _id, address _delegate) external onlyBeneficiary {
        delegateRegistry.setDelegate(_id, _delegate);
        emit SetDelegate(_id, _delegate);
    }

    function clearSnapshotDelegate(bytes32 _id) external onlyBeneficiary {
        if (delegateRegistry.delegation(address(this), _id) != address(0)) {
            delegateRegistry.clearDelegate(_id);
            emit ClearDelegate(_id);
        }
    }

    /**
     * @notice Withdraws surplus, unmanaged tokens from the contract
     * @dev Tokens in the contract over outstanding amount are considered as surplus
     * @param _amount Amount of tokens to withdraw
     */
    function withdrawSurplus(uint256 _amount) external override onlyBeneficiary {
        require(_amount > 0, "Amount cannot be zero");
        require(surplusAmount() >= _amount, "Amount requested > surplus available");

        token.safeTransfer(beneficiary, _amount);

        emit TokensWithdrawn(beneficiary, _amount);
    }

    /**
     * @notice Revokes a vesting schedule and return the unvested tokens to the admin
     * @dev Vesting schedule is always calculated based on managed tokens
     */
    function revoke() external override onlyAdminRole {
        require(revocable, "Contract is non-revocable");
        require(isRevoked == false, "Already revoked");

        uint256 unvestedAmount = managedAmount - vestedAmount();
        require(unvestedAmount > 0, "No available unvested amount");

        revokedAmount = unvestedAmount;
        isRevoked = true;
        token.safeTransfer(msg.sender, revokedAmount);
        emit TokensRevoked(beneficiary, unvestedAmount);
    }
}