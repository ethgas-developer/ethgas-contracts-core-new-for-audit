// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "../dependencies/openzeppelin-v5.0.1/token/ERC20.sol";
import {ERC20Permit} from "../dependencies/openzeppelin-v5.0.1/token/ERC20Permit.sol";

contract EthgasToken is ERC20, ERC20Permit {
    constructor(
        string memory _name, 
        string memory _symbol,
        address _tokenReceiver,
        uint256 _totalMintedAmount
    ) ERC20(_name, _symbol) ERC20Permit(_name) {
        _mint(_tokenReceiver, _totalMintedAmount);
    }
}