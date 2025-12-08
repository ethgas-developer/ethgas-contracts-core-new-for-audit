// contracts/BatchTransfer.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "../dependencies/openzeppelin-v5.0.1/token/IERC20.sol";

contract BatchTransfer {
    address public immutable owner;
    
    constructor() {
        owner = msg.sender;
    }
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }
    
    function batchTransferToken(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyOwner {
        require(recipients.length == amounts.length, "Length mismatch");
        
        IERC20 tokenContract = IERC20(token);
        
        for (uint256 i = 0; i < recipients.length; i++) {
            require(tokenContract.transferFrom(msg.sender, recipients[i], amounts[i]), "Transfer failed");
        }
    }
}