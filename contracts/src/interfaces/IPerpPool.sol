// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The dreamDEX PerpPool views Basanos reads.
interface IPerpPool {
    function isOperatorAuthorized(address owner, address operator, bytes4 selector) external view returns (bool);
    function tryGetMarkPrice() external view returns (bool ok, uint256 price);
}
