// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;


/// @title Staking Pool Interface
/// @notice An interface containing externally accessible functions of the StakingPool contract
/// @dev The automatically generated public view functions for the state variables and mappings are not included in the interface
interface IEthgasStaking {

    /*//////////////////////////////////////////////////////////////
                            Errors
    //////////////////////////////////////////////////////////////*/

    error TokenAlreadyConfiguredWithState(); //Thrown if the token as already been enabled or disabled 
    error DepositAmountCannotBeZero(); // Thrown if staker attempts to call deposit() with zero amount
    error WithdrawAmountCannotBeZero(); //Thrown if staker attempts to call withdraw() with zero amount
    error TokenNotAllowedForStaking(); // Thrown if staker attempts to stake unsupported token (or token disabled for staking)
    error UserDoesNotHaveStake(); //Thrown if the staker is attempting to migrate with no stake
    error CannotDepositForZeroAddress(); //Thrown if caller tries to deposit on behalf of the zero address
    error CannotRenounceOwnership(); //Thrown if the renounceOwnership() function is called
    error DuplicateToken(); //Thrown when there is a duplicate in the provided token address array
    error TokenArrayCannotBeEmpty(); //Thrown when the provided token address array is empty
    error InvalidMinLockPeriod(); //Thrown when minimum lock period is set to be negative or the value to be changed is same as the existing period. 
    error InvalidMinDepositAmount(); //Thrown when minimum deposit amount is set to be negative or the value to be changed is same as the existing amount.
    error AssetStillLocked(); //Thrown when user is trying to withdraw and asset that is still locked. 
    error TokenStillLocked(); //Thrown when user tries to withdraw asset when the asset is still in the locking period
    error InvalidLockingPeriod(); //Thrown when user tries to enter negative locking period.
    error MinimalStakingAmountNotMet(); // Thrown if staking amount is less than the set minimal 
    

    /*//////////////////////////////////////////////////////////////
                            Staker Events
    //////////////////////////////////////////////////////////////*/

    ///@notice Emitted when a staker deposits/stakes a supported token into the Staking Pool
    ///@param eventId The unique event Id associated with the Deposit event
    ///@param depositor The address of the depositer/staker transfering funds to the Staking Pool
    ///@param token The address of the token deposited/staked into the pool
    ///@param amount The amount of token deposited/staked into the pool
    event Deposit(
        uint256 indexed eventId, 
        address indexed depositor, 
        address indexed token, 
        uint256 amount,
        uint256 _lockPeriod
    );

    ///@notice Emitted when a staker withdraws a previously staked tokens from the Staking Pool
    ///@param eventId The unique event Id associated with the Withdraw event
    ///@param withdrawer The address of the staker withdrawing funds from the Staking Pool
    ///@param token The address of the token being withdrawn from the pool
    ///@param amount The amount of tokens withdrawn the pool
    event Withdraw(uint256 indexed eventId, address indexed withdrawer, address indexed token, uint256 amount);



    /*//////////////////////////////////////////////////////////////
                            Admin Events
    //////////////////////////////////////////////////////////////*/



    ///@notice Emitted when a token has been enabled or disabled for staking
    ///@param token The address of the token which has been enabled/disabled for staking
    ///@param enabled Is true if the token is being enabled and false if the token is being disabled
    event TokenStakabilityChanged(address token, bool enabled);

    ///@notice Emitted when a token's minimal locking period have been changed
    ///@param token The address of the token's minimal locking period has been changed. 
    ///@param minLockingPeriod Is true if the token is being enabled and false if the token is being disabled
    event TokenMinimalLockPeriod(address token, uint256 minLockingPeriod);

    ///@notice Emitted when ACLManager has been changed
    ///@param aclManager The address of the new ACLManager
    event AclManagerChanged(address aclManager);

    ///@notice Emitted when DisableLock has been updated
    ///@param disableLock is true if disableLock is true. 
    event DisableLockChanged(bool disableLock);

        ///@notice Emitted when a token's minimal deposit amount have been changed
    ///@param token The address of the token's minimal deposit amount has been changed. 
    ///@param minDepositAmount Is true if the token is being enabled and false if the token is being disabled
    event TokenMinimalDepositAmount(address token, uint256 minDepositAmount);

    
    /*//////////////////////////////////////////////////////////////
                            Staker Functions
    //////////////////////////////////////////////////////////////*/

    ///@notice Stake a specified amount of a particular supported token into the Staking Pool
    ///@param _token The token to deposit/stake in the Staking Pool
    ///@param _for The user to deposit/stake on behalf of
    ///@param _amount The amount of token to deposit/stake into the Staking Pool
    ///@param _lockPeriod set how long the deposited asset be locked at
    function depositFor(address _token, address _for, uint256 _amount, uint256 _lockPeriod) external;

    ///@notice Stake a specified amount of ether into the Staking Pool
    ///@param _for The user to deposit/stake on behalf of
    ///@param _lockPeriod set how long the deposited asset be locked at
    ///@dev the amount deposited is specified by msg.value
    function depositETHFor(address _for,uint256 _lockPeriod) payable external;

    ///@notice Withdraw a specified amount of a particular supported token previously staked into the Staking Pool
    ///@param _token The token to withdraw from the Staking Pool
    ///@param _amount The amount of token to withdraw from the Staking Pool
    function withdraw(address _token, uint256 _amount) external;

    

    /*//////////////////////////////////////////////////////////////
                            Admin Functions
    //////////////////////////////////////////////////////////////*/


    ///@notice Enable or disable the specified token for staking
    ///@param _token The token to enable or disable for staking
    ///@param _canStake If true, then staking is to be enabled. If false, then staking will be disabled.
    ///@dev Only callable by the owner
    function setStakable(address _token, bool _canStake) external;

    ///@notice Pause further staking through the deposit function.
    ///@dev Only callable by the owner. Withdrawals and migrations will still be possible when paused
    function pause() external;

    ///@notice Unpause staking allowing the deposit function to be used again
    ///@dev Only callable by the owner
    function unpause() external;

    ///@notice 
    ///@param _tokenAddr The token adresss to enable or disable for locking
    ///@param _minLockPeriod set the minimal period in which the token needs to be locked. 
    ///@dev address(0) will be treated as native ETH.  
    function setMinLockPeriod(address _tokenAddr, uint256 _minLockPeriod) external;

    ///@notice 
    ///@param _tokenAddr The token adresss to enable or disable for locking
    ///@param _minDepositAmt set the minimal period in which the token needs to be locked. 
    ///@dev address(0) will be treated as native ETH.  
    function setMinDepositAmount(address _tokenAddr, uint256 _minDepositAmt) external;
    
    ///@notice Set the minimal locking period required for locking 
    ///@param _disableLock set the global flag to disable the locking feature in the Staking Pool.
    ///@dev only callable by owner 
    function setDisableLock(bool _disableLock) external;

}