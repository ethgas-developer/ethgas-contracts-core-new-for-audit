// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "./dependencies/openzeppelin-v5.0.1/token/IERC20.sol";
import {SafeERC20} from "./dependencies/openzeppelin-v5.0.1/token/SafeERC20.sol";
import {MerkleProof} from "./dependencies/openzeppelin-v5.0.1/utils/MerkleProof.sol";
import "./dependencies/openzeppelin-v5.0.1/utils/Pausable.sol";
import "./interfaces/IACLManager.sol";
import  "./interfaces/IEthgasRebate.sol";
import {IVotingEscrow} from "./interfaces/IVotingEscrow.sol";
import "./libraries/InputValidator.sol";
import "./dependencies/openzeppelin-v5.0.1/utils/ReentrancyGuard.sol";

contract EthgasRebate is Pausable, IEthgasRebate, ReentrancyGuard {

    using SafeERC20 for IERC20;

    IACLManager public aclManager;
    IWETH public immutable weth;
    IERC20 public immutable ethgasToken;
    IVotingEscrow public immutable veToken;

    struct MerkleRootInfo {
        bool isStake;
        uint248 minUnlockDuration;
    }
    // category --> MerkleRootInfo
    mapping(bytes32 => MerkleRootInfo) public merkleRootInfo;
    // category --> merkleRoot
    mapping(bytes32 => bytes32) public merkleRoot;
    bool public isRestrictedMode;
    
    // user address --> category --> merkleRoot --> isClaimed
    mapping(address => mapping(bytes32 => mapping(bytes32 => bool))) public rewardClaimed;
    mapping(address => uint256) public dailyWithdrawalCap;
	mapping(address => uint256) public currentDailyWithdrawalAmount;
	mapping(address => uint256) public lastWithdrawalTime;
    mapping(address => bool) public depositWhitelist;
    
    constructor(IACLManager _aclManager, address[] memory _token, uint256[] memory _cap, IWETH _weth, IERC20 _ethgasToken, IVotingEscrow _veToken) {
        InputValidator.validateAddr(address(_aclManager));
        if (_token.length != _cap.length) {
            revert InvalidArrayLength();
        }
        aclManager = _aclManager;
        uint256 length = _token.length;
        weth = _weth;
        ethgasToken = _ethgasToken;
        veToken = _veToken;
        for (uint256 i = 0; i < length; i++) {
            InputValidator.validateAddr(_token[i]);
            dailyWithdrawalCap[_token[i]] = _cap[i];
            emit DailyWithdrawalCapChanged(_token[i], _cap[i]);
        }
    }

    modifier onlyPauserRole() {
		aclManager.checkPauserRole(msg.sender);
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

    modifier onlyBookKeeperRole() {
		aclManager.checkBookKeeperRole(msg.sender);
		_;
	}

    modifier onlyDepositor() {
		if (depositWhitelist[msg.sender] == false) {
            revert DepositNotAllowed();
        }
		_;
	}
    
    function pause() external onlyPauserRole {
        _pause();
    }

    function unpause() external onlyAdminRole {
        _unpause();
    }
    

    function setAclManager(IACLManager _aclManager) external onlyTimelockRole whenNotPaused {
		InputValidator.validateAddr(address(_aclManager));
        aclManager = _aclManager;
        emit AclManagerChanged(address(_aclManager));
	}



    function setDailyWithdrawalCap(address _token, uint256 _cap) external onlyAdminRole whenNotPaused {
        InputValidator.validateAddr(_token);
		dailyWithdrawalCap[_token] = _cap;
		emit DailyWithdrawalCapChanged(_token, _cap);
	}

    function startRestrictedMode() external onlyBookKeeperRole whenNotPaused {
        isRestrictedMode = true;
        emit RestrictedModeUpdated(true);
    }

    function endRestrictedMode() external onlyBookKeeperRole whenNotPaused {
        isRestrictedMode = false;
        emit RestrictedModeUpdated(false);
    }

    function setDepositorWhitelist(address[] calldata _depositorAddr, bool[] calldata _status) external onlyBookKeeperRole whenNotPaused {
        if (_depositorAddr.length != _status.length) {
            revert InvalidArrayLength();
        }
        for (uint i; i < _depositorAddr.length; i++) {
            InputValidator.validateAddr(_depositorAddr[i]);
            depositWhitelist[_depositorAddr[i]] = _status[i];
            emit DepositWhitelistStatusChanged(_depositorAddr[i], _status[i]);
        }
	}

    function updateMerkleRoot(bytes32 _newMerkleRoot, bytes32 _category) external onlyBookKeeperRole whenNotPaused {
        // can only update when restricted mode is on
        if (!isRestrictedMode) {
            revert RestrictedModeOff();
        }
        if (_newMerkleRoot == 0) {
            revert InvalidMerkleRoot();
        }
        merkleRoot[_category] = _newMerkleRoot;
        emit MerkleRootUpdated(_newMerkleRoot, _category);
    }

    function updateMerkleRootInfo(bool _isStake, uint248 _minUnlockDuration, bytes32 _category) external onlyBookKeeperRole whenNotPaused {
        // can only update when restricted mode is on
        if (!isRestrictedMode) {
            revert RestrictedModeOff();
        }
        merkleRootInfo[_category] = MerkleRootInfo(_isStake, _minUnlockDuration);
        emit MerkleRootInfoUpdated(_isStake, _minUnlockDuration, _category);
    }

    // users have to claim all token and all primary & sub wallets at once otherwise the root is marked as claimed
    function claimReward(
        ClaimEntry[] calldata _entries,
        address[] calldata _tokens,
        bytes32[] calldata _merkleProof,
        bytes32 _category,
        bool _isStake,
        uint256 _initUnlockTime // only useful for users without any lock before
    ) external nonReentrant whenNotPaused {
        // can only claim when restricted mode is off
        if (isRestrictedMode) {
            revert RestrictedModeOn();
        }
        if(rewardClaimed[msg.sender][_category][merkleRoot[_category]]) {
            revert RewardAlreadyClaimed();
        }
        rewardClaimed[msg.sender][_category][merkleRoot[_category]] = true;
        if (_entries.length == 0) {
            revert InvalidArrayLength();
        }
        if (_entries[0].user != msg.sender) { // primary wallet address
            revert UnauthorizedClaim();
        }
        TokenClaim[] memory tokenClaims = new TokenClaim[](_tokens.length);
        for (uint256 i = 0; i < _tokens.length; i++) {
            tokenClaims[i].token = _tokens[i];
        }

        bytes memory packed;
        for (uint256 i = 0; i < _entries.length; i++) {
            packed = bytes.concat(packed, abi.encodePacked(_entries[i].user, _entries[i].token, _entries[i].claimAmount));
            for (uint256 j = 0; j < _tokens.length; j++) {
                if (tokenClaims[j].token == _entries[i].token) {
                    tokenClaims[j].totalClaimAmount += _entries[i].claimAmount;
                    break;
                }
            }
        }

        // Create leaf node
        bytes32 leaf = keccak256(abi.encodePacked(packed));
        // Verify the proof
        if(!MerkleProof.verify(_merkleProof, merkleRoot[_category], leaf)) {
            revert InvalidProof();
        }
        
        for (uint256 i = 0; i < _tokens.length; i++) {
            address token = _tokens[i];
            uint256 totalClaimAmount = tokenClaims[i].totalClaimAmount;
            if (totalClaimAmount == 0) {
                continue;
            }

            // reset limit after a day
            if (block.timestamp - lastWithdrawalTime[token] > 1 days) {
                lastWithdrawalTime[token] = block.timestamp;
                currentDailyWithdrawalAmount[token] = 0;
            }

            if (currentDailyWithdrawalAmount[token] + totalClaimAmount <= dailyWithdrawalCap[token]) {
                currentDailyWithdrawalAmount[token] += totalClaimAmount;
                if(IERC20(token).balanceOf(address(this)) < totalClaimAmount) {
                    revert RewardPoolOutOfFunds();
                }
                if (merkleRootInfo[_category].isStake && !_isStake) {
                    revert StakeRequired();
                }
                if (_isStake && token == address(ethgasToken)) {
                    IVotingEscrow.LockedBalance memory l = veToken.locked(msg.sender);
                    ethgasToken.approve(address(veToken), totalClaimAmount);
                    if (l.amount > 0) {
                        veToken.increase_amount_for(msg.sender, totalClaimAmount);
                        emit RewardStaked(msg.sender, totalClaimAmount, 0);
                    } else {
                        if (_initUnlockTime <= block.timestamp) { 
                            revert InvalidUnlockTime();
                        }
                        if (_initUnlockTime - block.timestamp < uint256(merkleRootInfo[_category].minUnlockDuration)) {
                            revert InvalidUnlockTime();
                        }
                        veToken.create_lock_for(msg.sender, totalClaimAmount, _initUnlockTime);
                        emit RewardStaked(msg.sender, totalClaimAmount, _initUnlockTime);
                    }

                } else {
                    IERC20(token).safeTransfer(msg.sender, totalClaimAmount);
                }
                emit RewardClaimed(msg.sender, token, totalClaimAmount);
            } else {
                revert DailyWithdrawalCapReached();
            }
        }
    }

    function adminWithdraw(address _tokenAddr, address _receiver, uint256 _amount) external onlyTimelockRole whenNotPaused {
        IERC20(_tokenAddr).safeTransfer(_receiver, _amount);
        emit Withdrawal(_tokenAddr, _receiver, _amount);
    }

    function deposit() payable external onlyDepositor nonReentrant whenNotPaused {
        if(msg.value > 0) {
            IWETH(weth).deposit{value: msg.value}(); 
            emit Deposit(address(weth), msg.sender, msg.value);
        } else {
            revert InvalidDepositAmount();
        }
    }

    function deposit(address[] calldata _tokenAddr, uint256[] calldata _amount) external onlyDepositor nonReentrant whenNotPaused {
        if (_tokenAddr.length != _amount.length) {
            revert InvalidArrayLength();
        }
        for (uint256 i; i < _tokenAddr.length; i++) {
            IERC20(_tokenAddr[i]).safeTransferFrom(msg.sender, address(this), _amount[i]);
            emit Deposit(_tokenAddr[i], msg.sender, _amount[i]);
        }
    }

    
}
