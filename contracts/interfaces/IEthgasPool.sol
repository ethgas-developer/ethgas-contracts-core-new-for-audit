// SPDX-License-Identifier: MIT
pragma solidity ^0.8.12;


interface IEthgasPool {


	struct TokenTransfer {
		address token;
		uint256 amount;
	}

	error InvalidParamLength();
	error InvalidBlockNumber();
	error CannotSendEthDirectly();
	
	event DepositsTriggered(
		address indexed sender,
		TokenTransfer[] transfers
	);

	event Withdrawal(
		address indexed clientAddress,
		IEthgasPool.TokenTransfer tokenTranfer
	);

	event AclManagerChanged(address aclManager);

	event DailyWithdrawalCapChanged(
		address token, uint256 cap
	);

	event DailyPayoutCapChanged(
		address token, uint256 cap
	);

	event SupportedTokenChanged(
		address token, bool isSupport
	);

}
