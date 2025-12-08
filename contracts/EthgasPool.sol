// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;


import "./interfaces/IEthgasPool.sol";
import "./interfaces/IWETH.sol";
import "./interfaces/IACLManager.sol";
import "./libraries/DepositHelper.sol";
import "./libraries/TransferFundHelper.sol";
import "./libraries/InputValidator.sol";
import "./dependencies/openzeppelin-v5.0.1/utils/Pausable.sol";
import "./dependencies/openzeppelin-v5.0.1/utils/Context.sol";
import "./dependencies/openzeppelin-v5.0.1/utils/ReentrancyGuard.sol";


contract EthgasPool is IEthgasPool, Context, ReentrancyGuard, Pausable {

	mapping(address => bool) public supportedToken;
	// for serverTransferFund & serverTransferFundSingle
	mapping(address => uint256) public dailyWithdrawalCap;
	mapping(address => uint256) public currentDailyWithdrawalAmount;
	mapping(address => uint256) public lastWithdrawalTime;
	// for serverPayout
	mapping(address => uint256) public dailyPayoutCap;
	mapping(address => uint256) public currentDailyPayoutAmount;
	mapping(address => uint256) public lastPayoutTime;
	

	IACLManager public aclManager;
	IWETH public immutable weth;

	modifier onlyAdminRole() {
		aclManager.checkAdminRole(msg.sender);
		_;
	}

	modifier onlyTreasurerRole() {
		aclManager.checkTreasurerRole(msg.sender);
		_;
	}


	modifier onlyTimelockRole() {
		aclManager.checkTimelockRole(msg.sender);
		_;
	}

	modifier onlyPauserRole() {
		aclManager.checkPauserRole(msg.sender);
		_;
	}

	modifier onlyBookKeeperRole() {
		aclManager.checkBookKeeperRole(msg.sender);
		_;
	}

	modifier onlyPayouterRole() {
		aclManager.checkPayouterRole(msg.sender);
		_;
	}

	constructor(IACLManager _aclManager, IWETH _weth, address[] memory _token, uint256[] memory _withdrawalCap, uint256[] memory _payoutCap) {
		InputValidator.validateAddr(address(_aclManager));
		InputValidator.validateAddr(address(_weth));
		aclManager = _aclManager;
		weth = _weth;
		if ((_token.length != _withdrawalCap.length) || (_token.length != _payoutCap.length) || _token.length == 0) {
			revert InvalidParamLength();
		}
		for (uint256 i; i < _token.length; i++) {
			InputValidator.validateAddr(address(_token[i]));
			dailyWithdrawalCap[_token[i]] = _withdrawalCap[i];
			emit DailyWithdrawalCapChanged(_token[i], _withdrawalCap[i]);

			dailyPayoutCap[_token[i]] = _payoutCap[i];
			emit DailyPayoutCapChanged(_token[i], _payoutCap[i]);

			supportedToken[_token[i]] = true;
			emit SupportedTokenChanged(_token[i], true);
		}
	}


	function pause() external onlyPauserRole {
		super._pause();
    }

	function unpause() external onlyAdminRole {
		super._unpause();
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

	function setDailyPayoutCap(address _token, uint256 _cap) external onlyAdminRole whenNotPaused {
	    InputValidator.validateAddr(_token);	
		dailyPayoutCap[_token] = _cap;
		emit DailyPayoutCapChanged(_token, _cap);
	}

	function setSupportedToken(address _token, bool _isSupport) external onlyBookKeeperRole whenNotPaused {
		InputValidator.validateAddr(_token);
		supportedToken[_token] = _isSupport;
		emit SupportedTokenChanged(_token, _isSupport);
	}
	
	function deposit(TokenTransfer[] memory tokenTransfers) external whenNotPaused payable {
		DepositHelper.deposit(tokenTransfers, weth, supportedToken);
	}

	function serverPayout(address clientAddress, TokenTransfer[] calldata tokenTransfers, uint256 targetBlockNumber) onlyPayouterRole nonReentrant whenNotPaused external {
		if (block.number > targetBlockNumber) {
			revert InvalidBlockNumber();
		}
		TransferFundHelper.serverTransferFund(
			address(weth), false, clientAddress, tokenTransfers, dailyPayoutCap, lastPayoutTime, currentDailyPayoutAmount
		);
	}

	function serverTransferFundSingle(address clientAddress, TokenTransfer[] calldata tokenTransfers) onlyTreasurerRole nonReentrant whenNotPaused external {
		TransferFundHelper.serverTransferFund(
			address(weth), false, clientAddress, tokenTransfers, dailyWithdrawalCap, lastWithdrawalTime, currentDailyWithdrawalAmount
		);
	}

	function serverTransferFund(address[] calldata clientAddresses, TokenTransfer[][] calldata tokenTransferss) onlyTreasurerRole nonReentrant whenNotPaused external {
		if ((clientAddresses.length != tokenTransferss.length) || clientAddresses.length == 0) {
			revert InvalidParamLength();
		}
		for(uint i = 0; i < clientAddresses.length; i++) {
			TransferFundHelper.serverTransferFund(
				address(weth), false, clientAddresses[i], tokenTransferss[i], dailyWithdrawalCap, lastWithdrawalTime, currentDailyWithdrawalAmount
			);
		} 

	}

	/**
	 * @dev can transfer any amount out
	 */
	function serverTransferAnyFund(address[] calldata clientAddresses, TokenTransfer[][] calldata tokenTransferss) onlyTimelockRole nonReentrant whenNotPaused external {
		if ((clientAddresses.length != tokenTransferss.length) || clientAddresses.length == 0) {
			revert InvalidParamLength();
		}
		for(uint i = 0; i < clientAddresses.length; i++) {
			TransferFundHelper.serverTransferFund(
				address(weth), true, clientAddresses[i], tokenTransferss[i], dailyWithdrawalCap, lastWithdrawalTime, currentDailyWithdrawalAmount
			);
		} 
	}

	function wrapEth(uint256 amount) onlyTreasurerRole nonReentrant whenNotPaused external {
		weth.deposit{value: amount}();
	}

	function unwrapWeth(uint256 amount) onlyTreasurerRole nonReentrant whenNotPaused external {
		weth.withdraw(amount);
	}

	receive() external payable {}

}
