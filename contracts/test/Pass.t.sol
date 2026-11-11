// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BasanosRegistry} from "../src/BasanosRegistry.sol";
import {Fixture} from "./Fixture.sol";

contract PassTest is Fixture {
    event RunPassed(uint256 indexed runId, address indexed account, uint64 blockNumber, int256 endEquity);
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Locked(uint256 tokenId);

    uint256 internal runId;

    function setUp() public override {
        super.setUp();
        runId = _start();
        bank.setEquity(trader, true, 1_005e18);
        vm.warp(block.timestamp + 60);
    }

    function test_MintsAfterTheChainChecksTheEndState() public {
        vm.roll(block.number + 10);
        vm.expectEmit(true, true, true, true, address(registry));
        emit Transfer(address(0), trader, runId);
        vm.expectEmit(false, false, false, true, address(registry));
        emit Locked(runId);
        vm.expectEmit(true, true, false, true, address(registry));
        emit RunPassed(runId, trader, uint64(block.number), 1_005e18);
        vm.prank(referee);
        registry.recordPass(runId);
        BasanosRegistry.Run memory run = registry.getRun(runId);
        assertEq(uint8(run.status), uint8(BasanosRegistry.Status.Passed));
        assertEq(run.end.equity, 1_005e18);
        assertEq(run.end.blockNumber, uint64(block.number));
        assertEq(registry.ownerOf(runId), trader);
        assertEq(registry.balanceOf(trader), 1);
        assertTrue(registry.locked(runId));
        assertEq(registry.activeRunOf(trader), 0);
        assertEq(registry.getActiveRunIds().length, 0);
    }

    function test_RequestsTheOracleWhenPaid() public {
        vm.prank(referee);
        registry.recordPass{value: 0.0309 ether}(runId);
        assertEq(agents.pendingValue(1), 0.0309 ether);
        assertEq(registry.getRun(runId).oracleRequestId, 1);
    }

    function test_RevertsBeforeTheMinimumTimeAndAfterTheLimit() public {
        vm.warp(block.timestamp - 1);
        vm.prank(referee);
        vm.expectRevert(BasanosRegistry.TooEarly.selector);
        registry.recordPass(runId);
        vm.warp(block.timestamp + 900);
        vm.prank(referee);
        vm.expectRevert(BasanosRegistry.TooLate.selector);
        registry.recordPass(runId);
    }

    function test_RevertsWhenNotFlat() public {
        address[] memory pools = new address[](1);
        pools[0] = address(pool);
        bank.setPools(trader, pools);
        vm.prank(referee);
        vm.expectRevert(BasanosRegistry.NotFlat.selector);
        registry.recordPass(runId);
        bank.setPools(trader, new address[](0));
        bank.setLocked(trader, 1);
        vm.prank(referee);
        vm.expectRevert(BasanosRegistry.NotFlat.selector);
        registry.recordPass(runId);
    }

    function test_RevertsBelowTheTarget() public {
        bank.setEquity(trader, true, 1_004e18);
        vm.prank(referee);
        vm.expectRevert(BasanosRegistry.TargetNotMet.selector);
        registry.recordPass(runId);
    }

    function test_RevertsWithoutTheGrantOrAPrice() public {
        _grant(trader, false);
        vm.prank(referee);
        vm.expectRevert(BasanosRegistry.GrantMissing.selector);
        registry.recordPass(runId);
        _grant(trader, true);
        bank.setEquity(trader, false, 1_005e18);
        vm.prank(referee);
        vm.expectRevert(BasanosRegistry.Unpriceable.selector);
        registry.recordPass(runId);
    }

    function test_OnlyTheRefereeRecordsAndOnlyOnce() public {
        vm.prank(stranger);
        vm.expectRevert(BasanosRegistry.NotReferee.selector);
        registry.recordPass(runId);
        vm.prank(referee);
        registry.recordPass(runId);
        vm.prank(referee);
        vm.expectRevert(BasanosRegistry.NotActive.selector);
        registry.recordPass(runId);
    }

    function test_TheCertificateIsSoulbound() public {
        vm.prank(referee);
        registry.recordPass(runId);
        vm.startPrank(trader);
        vm.expectRevert(BasanosRegistry.Soulbound.selector);
        registry.transferFrom(trader, stranger, runId);
        vm.expectRevert(BasanosRegistry.Soulbound.selector);
        registry.safeTransferFrom(trader, stranger, runId);
        vm.expectRevert(BasanosRegistry.Soulbound.selector);
        registry.safeTransferFrom(trader, stranger, runId, "");
        vm.expectRevert(BasanosRegistry.Soulbound.selector);
        registry.approve(stranger, runId);
        vm.expectRevert(BasanosRegistry.Soulbound.selector);
        registry.setApprovalForAll(stranger, true);
        vm.stopPrank();
        assertEq(registry.getApproved(runId), address(0));
        assertFalse(registry.isApprovedForAll(trader, stranger));
        vm.expectRevert(BasanosRegistry.NonexistentToken.selector);
        registry.ownerOf(99);
    }
}
