// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IACLManager.sol";


/// @title Staking Pool Interface
/// @notice An interface containing externally accessible functions of the StakingPool contract
/// @dev The automatically generated public view functions for the state variables and mappings are not included in the interface
interface IEthgasReward {

    /*//////////////////////////////////////////////////////////////
                            Errors
    //////////////////////////////////////////////////////////////*/

    error MerkleRootNotSet(); // Thrown when the claimReward function is called but not Merkle Root is stored in contract.
    error InvalidMerkleRoot(); // Thrown when if the merkle root to be updated is invalid
    error InvalidProof(); //Thrown if the token as already been enabled or disabled 
    error RewardAlreadyClaimed(); // Thrown if staker attempts to call deposit() with zero amount
    error RewardPoolOutOfFunds(); //Thrown if staker attempts to call withdraw() with zero amount
    error DailyWithdrawalCapReached(); // Thrown if the withdrawal hits the daily withdrawal cap for the particular token.
    error InvalidArrayLength();
    error InvalidDepositAmount(); //Thrown if user does not have sufficient balance to deposit
    error DepositNotAllowed(); //Thrown if user is not whitelisted for deposits. 
    
    
    /*//////////////////////////////////////////////////////////////
                            Staker Events
    //////////////////////////////////////////////////////////////*/

    ///@notice Emitted an reward is successfully claimed. 
    ///@param user The user that is conducting the claim. 
    ///@param token The token that the user is claiming
    ///@param amount The amount of the reward to be claimed. 
    event RewardClaimed(address user, address token, uint256 amount);
    
    
    ///@notice Emitted when the Merkle Root of this contract is updated. 
    ///@param newRoot The root to be updated to. 
    ///@param timestamp The time in which the root is updated. 
    event MerkleRootUpdated(bytes32 newRoot, uint256 timestamp);

    ///@notice Emitted when ACLManager has been changed
    ///@param aclManager The address of the new ACLManager
    event AclManagerChanged(address aclManager);


    ///@notice Emitted an address is whitelisted for deposit 
    ///@param depositor The address of the depositor
    ///@param status The status of the whitelist.
	event DepositWhitelistStatusChagned(
		address depositor, bool status
	);

    ///@notice Emitted when the daily withdrawal cap is set. 
    ///@param token The token address of the cap to be implemeneted on. 
    ///@param cap The amount that is capped. 
	event DailyWithdrawalCapChanged(
		address token, uint256 cap
	);

    ///@notice Emitted when some calls the deposits function to deposit funds to the rewards contract. 
	event Deposit(
		address token, address depositor, uint256 amount
	);

    ///@notice Emitted when some calls the withdraws function to withdraw funds to the rewards contract. 
	event Withdraw(
		address token, address receiver, uint256 amount
	);  

    /*//////////////////////////////////////////////////////////////
                            Admin Functions
    //////////////////////////////////////////////////////////////*/


    ///@notice Change the ACL Manager to update the ACL 
    ///@param _aclManager address of the ACL Manager
    function setAclManager(IACLManager _aclManager) external ;

    ///@notice Pause further staking through the deposit function.
    ///@dev Only callable by the owner. Withdrawals and migrations will still be possible when paused
    function pause() external;

    ///@notice Unpause staking allowing the deposit function to be used again
    ///@dev Only callable by the owner
    function unpause() external;

    ///@notice function to set the daily withdrawal cap 
    ///@param _tokenAddr The token address of the cap to be implemeneted on. 
    ///@param _cap The amount that is capped. 
    function setDailyWithdrawalCap(address _tokenAddr, uint256 _cap) external;

    ///@notice function to set depositor whitelist
    ///@param _depositorAddr The address of the depositor to be whitelisted.
    ///@param _status Enable or disaable whitelist.
    function setDepositorWhitelist(address[] calldata _depositorAddr, bool[] calldata _status) external;

    ///@notice function withdraw funds from the rewards contract to admin. 
    ///@param _tokenAddr, Token to withdraw 
    ///@param amount Amount to withdraw
    function adminWithdraw(address _tokenAddr, address _receiver, uint256 amount) external;

    /*//////////////////////////////////////////////////////////////
                            Reward Claim Functions
    //////////////////////////////////////////////////////////////*/

    ///@notice called to update the Merkle Root from the backend server
    ///@param _newMerkleRoot The Merkle Root to be updated. 
    ///@dev only callable by bookkeeper
    function updateMerkleRoot(bytes32 _newMerkleRoot) external;
    
    ///@notice After the Merkle Proof is retrived from the backend server, user can call this function to claim the rewards
    ///@param tokens The address of the tokens that can be claimed in this iteration
    ///@param cumulativeAmounts Total amount the rewards that can be claimed or alraedy claimed. 
    ///@param merkleProofs Merkle Proof retrieved from backend server to verify this transaction. 
    ///@dev cannot be called when the contract is paused. 
        function claimReward(
        address[] calldata tokens,
        uint256[] calldata cumulativeAmounts,
        bytes32[][] calldata merkleProofs
    ) external;

    /*//////////////////////////////////////////////////////////////
                            Other Functions
    //////////////////////////////////////////////////////////////*/
    ///@notice function to deposit native ETH to the rewards contract.
    function deposit() payable external; 


    ///@notice function to deposit funds to the rewards contract.
    ///@param _tokenAddr The token address of the deposit.
    ///@param _amount The amount to deposit.
    function deposit(address _tokenAddr, uint256 _amount) external; 

}