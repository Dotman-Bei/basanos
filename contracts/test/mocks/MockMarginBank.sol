// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IMarginBank} from "../../src/interfaces/IMarginBank.sol";

contract MockMarginBank {
    mapping(address => bool) public eqOk;
    mapping(address => int256) public eq;
    mapping(address => uint256) public locked;
    mapping(address => int128) public size;
    mapping(address => address[]) internal pools;

    function setEquity(address a, bool ok, int256 equity) external {
        eqOk[a] = ok;
        eq[a] = equity;
    }

    function setLocked(address a, uint256 lockedCollateral) external {
        locked[a] = lockedCollateral;
    }

    function setPools(address a, address[] calldata activePools) external {
        pools[a] = activePools;
    }

    function setSize(address a, int128 positionSize) external {
        size[a] = positionSize;
    }

    function tryGetAccountEquity(address a) external view returns (bool ok, int256 equity) {
        return (eqOk[a], eq[a]);
    }

    function getAccountState(address a) external view returns (IMarginBank.AccountState memory s) {
        s.unlockedCollateralBalance = eq[a];
        s.lockedCollateral = locked[a];
        s.activePerpPools = pools[a];
    }

    function getPosition(address a, address) external view returns (IMarginBank.Position memory p) {
        p.size = size[a];
    }
}
