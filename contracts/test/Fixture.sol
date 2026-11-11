// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {BasanosRegistry} from "../src/BasanosRegistry.sol";
import {MockMarginBank} from "./mocks/MockMarginBank.sol";
import {MockPerpPool} from "./mocks/MockPerpPool.sol";
import {MockSomniaAgents} from "./mocks/MockSomniaAgents.sol";

abstract contract Fixture is Test {
    MockMarginBank internal bank;
    MockPerpPool internal pool;
    MockSomniaAgents internal agents;
    BasanosRegistry internal registry;

    address internal referee = makeAddr("referee");
    address internal trader = makeAddr("trader");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant DEMO = keccak256("tokyo-sprint-demo");
    int256 internal constant START = 1_000e18;
    string internal constant BASE_URL = "https://basanos.example/app/#/cert/";

    function setUp() public virtual {
        bank = new MockMarginBank();
        pool = new MockPerpPool();
        agents = new MockSomniaAgents();
        registry = _deploy();
        registry.registerRulebook(DEMO, address(pool), 50, 60, 900, "BTC/USDC:PERP");
        pool.setMark(true, 74_500e18);
        bank.setEquity(trader, true, START);
        _grant(trader, true);
        vm.deal(referee, 10 ether);
    }

    function _deploy() internal virtual returns (BasanosRegistry) {
        return new BasanosRegistry(address(bank), address(agents), referee, BASE_URL);
    }

    function _grant(address account, bool on) internal {
        pool.setAuthorized(account, referee, bytes4(0x80054449), on);
        pool.setAuthorized(account, referee, bytes4(0xe37b444b), on);
    }

    function _start() internal returns (uint256 runId) {
        vm.prank(trader);
        runId = registry.startRun(trader, DEMO);
    }
}
