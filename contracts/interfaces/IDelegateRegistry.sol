// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IDelegateRegistry {

    function setDelegate(bytes32 id, address delegate) external;
    function clearDelegate(bytes32 id) external;

    // view
    function delegation(address delegate, bytes32 id) external view returns(address);
}
