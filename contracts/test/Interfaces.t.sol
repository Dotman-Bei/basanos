// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IMarginBank} from "../src/interfaces/IMarginBank.sol";
import {IPerpPool} from "../src/interfaces/IPerpPool.sol";
import {IPriceOracleAgent, ISomniaAgents} from "../src/interfaces/ISomniaAgents.sol";

contract InterfacesTest is Test {
    function test_SelectorsMatchTheDreamDexAbi() public pure {
        assertEq(IMarginBank.tryGetAccountEquity.selector, bytes4(keccak256("tryGetAccountEquity(address)")));
        assertEq(IMarginBank.getAccountState.selector, bytes4(keccak256("getAccountState(address)")));
        assertEq(IMarginBank.getPosition.selector, bytes4(keccak256("getPosition(address,address)")));
        assertEq(IPerpPool.isOperatorAuthorized.selector, bytes4(keccak256("isOperatorAuthorized(address,address,bytes4)")));
        assertEq(IPerpPool.tryGetMarkPrice.selector, bytes4(keccak256("tryGetMarkPrice()")));
        assertEq(ISomniaAgents.createRequest.selector, bytes4(keccak256("createRequest(uint256,address,bytes4,bytes)")));
        assertEq(IPriceOracleAgent.getPrices.selector, bytes4(keccak256("getPrices(string[],uint8)")));
    }
}
