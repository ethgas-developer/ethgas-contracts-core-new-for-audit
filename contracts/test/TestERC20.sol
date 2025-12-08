// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "../dependencies/openzeppelin-v5.0.1/token/ERC20.sol";

contract TestERC20 is ERC20 {
    constructor(
        uint256 _totalMintedAmount
    ) ERC20("TestToken", "TEST") {
        _mint(msg.sender, _totalMintedAmount);
    }

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}