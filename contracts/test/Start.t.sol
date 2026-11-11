// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BasanosRegistry} from "../src/BasanosRegistry.sol";
import {Fixture} from "./Fixture.sol";

contract StartTest is Fixture {
    event RunStarted(uint256 indexed runId, address indexed account, bytes32 indexed rulebookId, uint64 blockNumber, int256 startEquity);

    function test_StartRun_RecordsTheChainReadStart() public {
        vm.roll(1_234);
        vm.expectEmit(true, true, true, true, address(registry));
        emit RunStarted(1, trader, DEMO, 1_234, START);
        uint256 runId = _start();
        assertEq(runId, 1);
        BasanosRegistry.Run memory run = registry.getRun(runId);
        assertEq(run.account, trader);
        assertEq(uint8(run.status), uint8(BasanosRegistry.Status.Active));
        assertEq(run.start.blockNumber, 1_234);
        assertEq(run.start.equity, START);
        assertTrue(run.start.equityOk);
        assertEq(run.start.markPrice, 74_500e18);
        assertEq(run.startTime, uint64(block.timestamp));
        assertEq(registry.activeRunOf(trader), 1);
        assertEq(registry.getActiveRunIds().length, 1);
        assertEq(registry.runCount(), 1);
    }

    function test_PreviewStart_ReturnsEachCode() public {
        (uint8 code,) = registry.previewStart(trader, keccak256("nope"));
        assertEq(code, 1);
        (code,) = registry.previewStart(stranger, DEMO);
        assertEq(code, 3);
        bank.setLocked(trader, 1);
        (code,) = registry.previewStart(trader, DEMO);
        assertEq(code, 4);
        bank.setLocked(trader, 0);
        bank.setEquity(trader, false, 0);
        (code,) = registry.previewStart(trader, DEMO);
        assertEq(code, 5);
        bank.setEquity(trader, true, 0);
        (code,) = registry.previewStart(trader, DEMO);
        assertEq(code, 6);
        bank.setEquity(trader, true, START);
        (code,) = registry.previewStart(trader, DEMO);
        assertEq(code, 0);
        _start();
        (code,) = registry.previewStart(trader, DEMO);
        assertEq(code, 2);
    }

    function test_StartRun_RevertsForAStranger() public {
        vm.prank(stranger);
        vm.expectRevert(BasanosRegistry.NotAccountOrReferee.selector);
        registry.startRun(trader, DEMO);
    }

    function test_StartRun_TheRefereeCanEnrollAGrantedAccount() public {
        vm.prank(referee);
        assertEq(registry.startRun(trader, DEMO), 1);
    }

    function test_StartRun_RevertsWhenNotFlatOrUngranted() public {
        address[] memory pools = new address[](1);
        pools[0] = address(pool);
        bank.setPools(trader, pools);
        vm.prank(trader);
        vm.expectRevert(BasanosRegistry.NotFlat.selector);
        registry.startRun(trader, DEMO);
        bank.setPools(trader, new address[](0));
        _grant(trader, false);
        vm.prank(trader);
        vm.expectRevert(BasanosRegistry.GrantMissing.selector);
        registry.startRun(trader, DEMO);
    }

    function test_StartRun_RevertsWhileARunIsActive() public {
        _start();
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(BasanosRegistry.RunExists.selector, uint256(1)));
        registry.startRun(trader, DEMO);
    }

    function test_RegisterRulebook_IsOwnerOnlyAndOnce() public {
        vm.prank(stranger);
        vm.expectRevert(BasanosRegistry.NotOwner.selector);
        registry.registerRulebook(keccak256("x"), address(pool), 1, 1, 2, "BTC/USDC");
        vm.expectRevert(BasanosRegistry.RulebookExists.selector);
        registry.registerRulebook(DEMO, address(pool), 1, 1, 2, "BTC/USDC");
        BasanosRegistry.RulebookParams memory rb = registry.getRulebook(DEMO);
        assertEq(rb.pool, address(pool));
        assertEq(rb.profitTargetBps, 50);
        assertEq(rb.minDurationSec, 60);
        assertEq(rb.timeLimitSec, 900);
        assertEq(rb.oracleSymbol, "BTC/USDC:PERP");
        assertTrue(rb.exists);
    }

    function test_SetBaseUrl_IsOwnerOnly() public {
        registry.setBaseUrl("https://new/");
        assertEq(registry.baseUrl(), "https://new/");
        vm.prank(stranger);
        vm.expectRevert(BasanosRegistry.NotOwner.selector);
        registry.setBaseUrl("https://evil/");
    }
}
