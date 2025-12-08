// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IFeeDistributor {
    function claim(address _addr) external;
    function claim_many(address[20] memory _receivers) external;
    function toggle_allow_checkpoint_token() external;
    function checkpoint_token() external;
    function checkpoint_total_supply() external;

    function start_time() external view returns(uint256);
    function time_cursor() external view returns(uint256);
}
