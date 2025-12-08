// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.12;

import "../dependencies/openzeppelin/contracts/access/AccessControl.sol";
import "../libraries/InputValidator.sol";

contract ACLManager is AccessControl {
    // DEFAULT_ADMIN_ROLE refers to AccessControl
    bytes32 public constant TREASURER_ROLE = 0x0000000000000000000000000000000000000000000000000000000000000001;
    bytes32 public constant TIMELOCK_ROLE = 0x0000000000000000000000000000000000000000000000000000000000000002;
    bytes32 public constant PAUSER_ROLE = 0x0000000000000000000000000000000000000000000000000000000000000003;
    bytes32 public constant BOOKKEEPER_ROLE = 0x0000000000000000000000000000000000000000000000000000000000000004;
    bytes32 public constant PAYOUTER_ROLE = 0x0000000000000000000000000000000000000000000000000000000000000005;
    // for other unknown future roles
    bytes32 public constant OTHER_ROLE_1 = 0x0000000000000000000000000000000000000000000000000000000000000006;
    bytes32 public constant OTHER_ROLE_2 = 0x0000000000000000000000000000000000000000000000000000000000000007;
    bytes32 public constant OTHER_ROLE_3 = 0x0000000000000000000000000000000000000000000000000000000000000008;

    constructor(address _contractAdmin, address _treasurer, address _timelockContract, address[] memory _pausers, address _bookKeeper, address _payouter) {
        InputValidator.validateAddr(_contractAdmin);
        InputValidator.validateAddr(_treasurer);
        InputValidator.validateAddr(_timelockContract);
        InputValidator.validateAddr(_bookKeeper);
        InputValidator.validateAddr(_payouter);
		_grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(DEFAULT_ADMIN_ROLE, _contractAdmin);
        _grantRole(TREASURER_ROLE, _treasurer);
        _grantRole(TIMELOCK_ROLE, _timelockContract);
        for (uint256 i; i < _pausers.length; i++) {
            InputValidator.validateAddr(_pausers[i]);
            _grantRole(PAUSER_ROLE, _pausers[i]);
        }
        _grantRole(BOOKKEEPER_ROLE, _bookKeeper);
        _grantRole(PAYOUTER_ROLE, _payouter);
        _setRoleAdmin(TIMELOCK_ROLE, TIMELOCK_ROLE);

	}

    function checkAdminRole(address _account) external view {
        _checkRole(DEFAULT_ADMIN_ROLE, _account);
        
    }


    function checkTreasurerRole(address _account) external view {
        _checkRole(TREASURER_ROLE, _account);
    }

    function checkTimelockRole(address _account) external view {
        _checkRole(TIMELOCK_ROLE, _account);
    }

    function checkPauserRole(address _account) external view {
        _checkRole(PAUSER_ROLE, _account);
    }

    function checkBookKeeperRole(address _account) external view {
        _checkRole(BOOKKEEPER_ROLE, _account);
    }

    function checkPayouterRole(address _account) external view {
        _checkRole(PAYOUTER_ROLE, _account);
    }

    function checkOtherRole1(address _account) external view {
        _checkRole(OTHER_ROLE_1, _account);
    }

    function checkOtherRole2(address _account) external view {
        _checkRole(OTHER_ROLE_2, _account);
    }

    function checkOtherRole3(address _account) external view {
        _checkRole(OTHER_ROLE_3, _account);
    }

}