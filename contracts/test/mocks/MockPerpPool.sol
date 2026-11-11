// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract MockPerpPool {
    mapping(bytes32 => bool) internal auth;
    bool public markOk;
    uint256 public markPrice;

    function setAuthorized(address owner, address operator, bytes4 selector, bool on) external {
        auth[keccak256(abi.encode(owner, operator, selector))] = on;
    }

    function setMark(bool ok, uint256 price) external {
        markOk = ok;
        markPrice = price;
    }

    function isOperatorAuthorized(address owner, address operator, bytes4 selector) external view returns (bool) {
        return auth[keccak256(abi.encode(owner, operator, selector))];
    }

    function tryGetMarkPrice() external view returns (bool ok, uint256 price) {
        return (markOk, markPrice);
    }
}
