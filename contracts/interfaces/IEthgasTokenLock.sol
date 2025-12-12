// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;
pragma experimental ABIEncoderV2;

import {IERC20} from "../dependencies/openzeppelin-v5.0.1/token/IERC20.sol";

interface IEthgasTokenLock {
    // -- Balances --

    function currentBalance() external view returns (uint256);

    // -- Time & Periods --

    function currentTime() external view returns (uint256);

    // -- Vesting Schedule --
    function vestingDuration() external view returns (uint256);

    function sinceVestingCliffTime() external view returns (uint256);

    function vestingAmountPerPeriod() external view returns (uint256);

    function vestingPeriodDuration() external view returns (uint256);

    function currentVestingPeriod() external view returns (uint256);

    function passedVestingPeriods() external view returns (uint256);

    function vestedAmount() external view returns (uint256);

    // -- Unlock Schedule --
    function unlockDuration() external view returns (uint256);

    function sinceUnlockStartTime() external view returns (uint256);

    function unlockAmountPerPeriod() external view returns (uint256);

    function unlockPeriodDuration() external view returns (uint256);

    function currentUnlockPeriod() external view returns (uint256);

    function passedUnlockPeriods() external view returns (uint256);

    function releasableAmount() external view returns (uint256);

    function totalOutstandingAmount() external view returns (uint256);

    function surplusAmount() external view returns (uint256);

    // -- Value Transfer --

    function release(bool _isStake, uint256 _initUnlockTime) external;

    function withdrawSurplus(uint256 _amount) external;

    function revoke() external;
}