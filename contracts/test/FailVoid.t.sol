// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BasanosRegistry} from "../src/BasanosRegistry.sol";
import {Fixture} from "./Fixture.sol";

contract FailVoidTest is Fixture {
    event RunFailed(uint256 indexed runId, address indexed account, BasanosRegistry.Rule rule, uint64 breachBlock, uint64 endBlock);
    event RunVoided(uint256 indexed runId, address indexed account, BasanosRegistry.VoidReason reason, bytes32 txHash);

    uint256 internal runId;

    function setUp() public override {
        super.setUp();
        runId = _start();
    }

    function _breach() internal view returns (BasanosRegistry.Read memory b) {
        b.blockNumber = uint64(block.number);
        b.equityOk = true;
        b.equity = 994e18;
        b.lockedCollateral = 0;
        b.positionSize = -16_107_000;
        b.markOk = true;
        b.markPrice = 74_900e18;
    }

    function test_RecordsTheAttestedBreachTheChainReadEndAndTheCloseTxs() public {
        BasanosRegistry.Read memory breach = _breach();
        vm.roll(block.number + 5);
        bank.setEquity(trader, true, 993e18);
        bytes32[] memory closes = new bytes32[](2);
        closes[0] = keccak256("cancel");
        closes[1] = keccak256("close");
        vm.expectEmit(true, true, false, true, address(registry));
        emit RunFailed(runId, trader, BasanosRegistry.Rule.DailyLoss, breach.blockNumber, uint64(block.number));
        vm.prank(referee);
        registry.recordFail(runId, BasanosRegistry.Rule.DailyLoss, breach, keccak256("evidence"), closes);
        BasanosRegistry.Run memory run = registry.getRun(runId);
        assertEq(uint8(run.status), uint8(BasanosRegistry.Status.Failed));
        assertEq(uint8(run.rule), uint8(BasanosRegistry.Rule.DailyLoss));
        assertEq(run.breach.equity, 994e18);
        assertEq(run.breach.positionSize, -16_107_000);
        assertEq(run.end.equity, 993e18);
        assertEq(run.evidenceHash, keccak256("evidence"));
        assertEq(registry.getCloseTxs(runId).length, 2);
        assertEq(registry.getCloseTxs(runId)[1], keccak256("close"));
        assertEq(registry.activeRunOf(trader), 0);
        vm.expectRevert(BasanosRegistry.NonexistentToken.selector);
        registry.ownerOf(runId);
    }

    function test_TimeLimitIsCheckedAgainstTheChainClock() public {
        BasanosRegistry.Read memory breach = _breach();
        vm.warp(block.timestamp + 900);
        vm.prank(referee);
        vm.expectRevert(BasanosRegistry.TimeLimitNotReached.selector);
        registry.recordFail(runId, BasanosRegistry.Rule.TimeLimit, breach, bytes32(0), new bytes32[](0));
        vm.warp(block.timestamp + 1);
        vm.prank(referee);
        registry.recordFail(runId, BasanosRegistry.Rule.TimeLimit, breach, bytes32(0), new bytes32[](0));
        assertEq(uint8(registry.getRun(runId).rule), uint8(BasanosRegistry.Rule.TimeLimit));
    }

    function test_RejectsRuleNoneStrangersAndFinishedRuns() public {
        BasanosRegistry.Read memory breach = _breach();
        vm.prank(referee);
        vm.expectRevert(BasanosRegistry.InvalidRule.selector);
        registry.recordFail(runId, BasanosRegistry.Rule.None, breach, bytes32(0), new bytes32[](0));
        vm.prank(stranger);
        vm.expectRevert(BasanosRegistry.NotReferee.selector);
        registry.recordFail(runId, BasanosRegistry.Rule.DailyLoss, breach, bytes32(0), new bytes32[](0));
        vm.prank(referee);
        registry.recordFail(runId, BasanosRegistry.Rule.DailyLoss, breach, bytes32(0), new bytes32[](0));
        vm.prank(referee);
        vm.expectRevert(BasanosRegistry.NotActive.selector);
        registry.recordFail(runId, BasanosRegistry.Rule.DailyLoss, breach, bytes32(0), new bytes32[](0));
    }

    function test_FailRequestsTheOracleWhenPaid() public {
        vm.prank(referee);
        registry.recordFail{value: 0.0309 ether}(runId, BasanosRegistry.Rule.MaxExposure, _breach(), bytes32(0), new bytes32[](0));
        assertEq(agents.pendingValue(1), 0.0309 ether);
    }

    function test_TheRefereeVoidsAFlowButCannotClaimARevoke() public {
        vm.prank(referee);
        vm.expectRevert(BasanosRegistry.InvalidVoidReason.selector);
        registry.recordVoid(runId, BasanosRegistry.VoidReason.GrantRevoked, bytes32(0), bytes32(0));
        vm.prank(referee);
        vm.expectRevert(BasanosRegistry.InvalidVoidReason.selector);
        registry.recordVoid(runId, BasanosRegistry.VoidReason.None, bytes32(0), bytes32(0));
        vm.expectEmit(true, true, false, true, address(registry));
        emit RunVoided(runId, trader, BasanosRegistry.VoidReason.Flow, keccak256("deposit-tx"));
        vm.prank(referee);
        registry.recordVoid(runId, BasanosRegistry.VoidReason.Flow, keccak256("deposit-tx"), keccak256("ev"));
        BasanosRegistry.Run memory run = registry.getRun(runId);
        assertEq(uint8(run.status), uint8(BasanosRegistry.Status.Voided));
        assertEq(run.voidTxHash, keccak256("deposit-tx"));
        assertEq(registry.activeRunOf(trader), 0);
    }

    function test_AnyoneVoidsARunWhoseGrantWasRevoked() public {
        vm.prank(stranger);
        vm.expectRevert(BasanosRegistry.GrantStillHeld.selector);
        registry.voidRevoked(runId);
        pool.setAuthorized(trader, referee, bytes4(0xe37b444b), false);
        vm.prank(stranger);
        registry.voidRevoked(runId);
        assertEq(uint8(registry.getRun(runId).voidReason), uint8(BasanosRegistry.VoidReason.GrantRevoked));
    }
}
