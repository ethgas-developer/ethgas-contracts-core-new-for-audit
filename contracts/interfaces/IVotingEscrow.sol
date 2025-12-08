// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IVotingEscrow {

    struct LockedBalance {
        int128 amount;
        uint256 end;
    }

    function create_lock(uint256 _value, uint256 _unlock_time) external;
    function increase_amount(uint256 _value) external;
    function create_lock_for(address _addr, uint256 _value, uint256 _unlock_time) external;
    function increase_amount_for(address _addr, uint256 _value) external;
    function withdraw() external;
    function whitelist_contracts(address[30] memory contracts, bool[30] memory is_whitelists) external;

    // view
    function locked(address user) external view returns (LockedBalance memory);
    function balanceOf(address addr) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function admin() external view returns (address);
}
