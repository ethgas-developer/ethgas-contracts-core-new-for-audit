// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;


/// @title Staking Gateway Interface
/// @notice An interface containing externally accessible functions of the Staking Gateway contract. The gateway will direct the ETH deposited onto the staking deposit gateway.
/// @dev The automatically generated public view functions for the state variables and mappings are not included in the interface
interface IEthgasGateway {

    /*//////////////////////////////////////////////////////////////
                            Errors
    //////////////////////////////////////////////////////////////*/

    error InvalidPublicKeyLength(); // Thrown when public key length is not valid
    error InvalidWithdrawalCredentialLength(); // Thrown when withdrawal credential length is not valid
    error InvalidSignatureLength(); //Thrown if the signature length is not valid. 
    error DepositValueTooLow(); // Thrown if deposit value is less than 0
    error DepositValueNotMultipleOfGwei(); // Thrown if deposit value is not multipe of gwei.
    error DepositValueTooHigh(); // Thrown if depsoit value is larger than uint64 max.
    error ReconstructedDepositDataNotMatch(); //Thrown if the staker is attempting to migrate with no stake
    error MerkleTreeFull(); //Thrown if caller tries to deposit on behalf of the zero address
    error InvalidDepositContractAddress();  //Thrown
    
    


    /*//////////////////////////////////////////////////////////////
                            Staker Events
    //////////////////////////////////////////////////////////////*/

    ///@notice Emitted when a staker deposits/stakes ETH into the Staking Gateway
    ///@param eventId The unique event Id associated with the Deposit through Ethgas Gateway
    ///@param depositNodePubKey deposit ETH to the mentioned Public Key address. 
    ///@param withdrawalCredentials withdrawal credentials generated from staking deposit CLI (00 and 01 type.)
    ///@param amount The amount of token deposited/staked into the pool
    ///@param signature the signature of the deposit instruction generated from staking deposit cli.
    event Deposit(
        uint256 indexed eventId,
        address indexed from,
        bytes depositNodePubKey,
        bytes withdrawalCredentials,
        uint256 amount,
        bytes signature
    );

    ///@notice Emitted when ACLManager has been changed
    ///@param aclManager The address of the new ACLManager
    event AclManagerChanged(address aclManager);

    
    /*//////////////////////////////////////////////////////////////
                            Staker Functions
    //////////////////////////////////////////////////////////////*/

    /// @notice Submit a Phase 0 DepositData object.
    /// @param pubkey A BLS12-381 public key.
    /// @param withdrawal_credentials Commitment to a public key for withdrawals.
    /// @param signature A BLS12-381 signature.
    /// @param deposit_data_root The SHA-256 hash of the SSZ-encoded DepositData object.
    /// Used as a protection against malformed input.
    function deposit(
        bytes calldata pubkey,
        bytes calldata withdrawal_credentials,
        bytes calldata signature,
        bytes32 deposit_data_root
    ) external payable;


    /*//////////////////////////////////////////////////////////////
                            Admin Functions
    //////////////////////////////////////////////////////////////*/

  

    ///@notice Pause further staking through the deposit function.
    ///@dev Only callable by the owner. Withdrawals and migrations will still be possible when paused
    function pause() external;

    ///@notice Unpause staking allowing the deposit function to be used again
    ///@dev Only callable by the owner
    function unpause() external;

}