// SPDX-License-Identifier: MIT
pragma solidity ^0.8.12;

import "../interfaces/IWETH.sol";
import "../interfaces/IEthgasPool.sol";
import "../dependencies/openzeppelin-v5.0.1/token/SafeERC20.sol";


library DepositHelper {
	using SafeERC20 for IERC20;

	event DepositsTriggered(
		address indexed sender,
		IEthgasPool.TokenTransfer[] transfers
	);

	error InvalidTokenValue();
	error NotEnoughBalance();
	error NotSupportedToken();

	function deposit (IEthgasPool.TokenTransfer[] memory tokenTransfers, IWETH weth, mapping(address => bool) storage supportedToken) external {
		if(msg.value == 0 && tokenTransfers.length == 0 ) {
			revert InvalidTokenValue();
		}

		IEthgasPool.TokenTransfer[] memory tt = new IEthgasPool.TokenTransfer[](tokenTransfers.length + (msg.value > 0 ? 1 : 0));
		for (uint i = 0; i < tokenTransfers.length; i++) {
			if (supportedToken[tokenTransfers[i].token] == false) {
				revert NotSupportedToken();
			}
			IERC20 token = IERC20(tokenTransfers[i].token);
			uint256 tokenAmount = tokenTransfers[i].amount;
			uint balance = token.balanceOf(address(msg.sender));
			if (balance < tokenAmount) {
				revert NotEnoughBalance();
			}
			token.safeTransferFrom( msg.sender, address(this), tokenAmount);
			tt[i] = tokenTransfers[i];
		}
		if (msg.value > 0) {
			if (supportedToken[address(weth)] == false) {
				revert NotSupportedToken();
			}
			tt[tokenTransfers.length] = IEthgasPool.TokenTransfer(address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE), msg.value);
		}

		emit DepositsTriggered(
			msg.sender, tt
		);
	}

}