// SPDX-License-Identifier: MIT
pragma solidity ^0.8.12;

import "../interfaces/IEthgasPool.sol";
import "../dependencies/openzeppelin-v5.0.1/token/SafeERC20.sol";

library TransferFundHelper {

	using SafeERC20 for IERC20;

	error ZeroParamLength();
	error ExceedDailyTransferCap();
	error FailedToSendEth();

	function serverTransferFund(
		address weth, bool isAdmin, address clientAddress, IEthgasPool.TokenTransfer[] calldata tokenTransfers, 
		mapping(address => uint256) storage dailyTransferCap, mapping(address => uint256) storage lastTransferTime, mapping(address => uint256) storage currentDailyTransferAmount
	) internal {
		if (tokenTransfers.length == 0) {
			revert ZeroParamLength();
		}
		bool isNativeEth;
		IERC20 token;
		for (uint i = 0; i < tokenTransfers.length; i++) {
			IEthgasPool.TokenTransfer memory tt = tokenTransfers[i];
			if (tt.token == address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE)) {
				isNativeEth = true;
				tt.token = weth;
			} else {
				token = IERC20(tt.token);
			}
			
			// reset limit after a day
			if (block.timestamp - lastTransferTime[tt.token] > 1 days) {
				lastTransferTime[tt.token] = block.timestamp;
				currentDailyTransferAmount[tt.token] = 0;
			}

			if (isAdmin) {
				transfer(isNativeEth, clientAddress, tt, token);
			} else if (currentDailyTransferAmount[tt.token] + tt.amount <= dailyTransferCap[tt.token]) {
				currentDailyTransferAmount[tt.token] += tt.amount;
				transfer(isNativeEth, clientAddress, tt, token);
			} else {
				revert ExceedDailyTransferCap();
			}
		}

	}

	function transfer(bool isNativeEth, address clientAddress, IEthgasPool.TokenTransfer memory tokenTransfer, IERC20 token) internal {
		if (isNativeEth) {
			(bool success, ) = clientAddress.call{value: tokenTransfer.amount}("");
			if (success == false) revert FailedToSendEth();
		} else {
			token.safeTransfer(clientAddress, tokenTransfer.amount);
		}
		emit IEthgasPool.Withdrawal(clientAddress, tokenTransfer);
	}

}