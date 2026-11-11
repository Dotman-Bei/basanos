// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BasanosRegistry} from "../src/BasanosRegistry.sol";
import {IPriceOracleAgent, Request, Response, ResponseStatus} from "../src/interfaces/ISomniaAgents.sol";
import {Fixture} from "./Fixture.sol";

contract RegistryHarness is BasanosRegistry {
    constructor(address bank, address agents, address referee_, string memory url) BasanosRegistry(bank, agents, referee_, url) {}

    function requestOracleForTest(uint256 runId) external payable {
        _requestOracle(runId);
    }
}

contract OracleTest is Fixture {
    event OracleRequested(uint256 indexed runId, uint256 requestId);
    event OracleRequestFailed(uint256 indexed runId);
    event OracleRecorded(uint256 indexed runId, uint256 price, uint8 sources, uint64 updatedAt);

    RegistryHarness internal harness;

    function _deploy() internal override returns (BasanosRegistry) {
        harness = new RegistryHarness(address(bank), address(agents), referee, BASE_URL);
        return harness;
    }

    function _prices(uint256 price, uint8 sources, uint64 updated) internal pure returns (bytes memory) {
        uint256[] memory p = new uint256[](1);
        uint8[] memory s = new uint8[](1);
        uint64[] memory u = new uint64[](1);
        p[0] = price;
        s[0] = sources;
        u[0] = updated;
        return abi.encode(p, s, u);
    }

    function test_RequestsThePerpCompositeWithTheDeposit() public {
        uint256 runId = _start();
        vm.expectEmit(true, false, false, true, address(registry));
        emit OracleRequested(runId, 1);
        harness.requestOracleForTest{value: 0.0309 ether}(runId);
        string[] memory symbols = new string[](1);
        symbols[0] = "BTC/USDC:PERP";
        assertEq(agents.pendingPayload(1), abi.encodeCall(IPriceOracleAgent.getPrices, (symbols, 18)));
        assertEq(agents.pendingValue(1), 0.0309 ether);
        assertEq(agents.pendingAgentId(1), 9911223344556677889);
        assertEq(agents.pendingCallback(1), address(registry));
        assertEq(registry.getRun(runId).oracleRequestId, 1);
    }

    function test_StoresTheConsensusPriceOnCallback() public {
        uint256 runId = _start();
        harness.requestOracleForTest{value: 0.0309 ether}(runId);
        vm.expectEmit(true, false, false, true, address(registry));
        emit OracleRecorded(runId, 74_510e18, 3, 1_794_326_598_000);
        agents.fulfill(1, _prices(74_510e18, 3, 1_794_326_598_000), ResponseStatus.Success);
        BasanosRegistry.Run memory run = registry.getRun(runId);
        assertTrue(run.oracleDone);
        assertEq(run.oraclePrice, 74_510e18);
        assertEq(run.oracleSources, 3);
        assertEq(run.oracleUpdatedAt, 1_794_326_598_000);
    }

    function test_AFailedRequestIsMarkedDoneWithoutAPrice() public {
        uint256 runId = _start();
        harness.requestOracleForTest{value: 0.0309 ether}(runId);
        agents.fulfill(1, "", ResponseStatus.TimedOut);
        BasanosRegistry.Run memory run = registry.getRun(runId);
        assertTrue(run.oracleDone);
        assertEq(run.oraclePrice, 0);
    }

    function test_RejectsCallbacksFromAnyoneButTheAgentsPlatform() public {
        uint256 runId = _start();
        harness.requestOracleForTest{value: 0.0309 ether}(runId);
        Response[] memory responses = new Response[](0);
        Request memory details;
        vm.prank(stranger);
        vm.expectRevert(BasanosRegistry.NotAgents.selector);
        registry.handleOracle(1, responses, ResponseStatus.Success, details);
    }

    function test_APlatformFailureNeverReverts() public {
        uint256 runId = _start();
        agents.setShouldRevert(true);
        vm.expectEmit(true, false, false, false, address(registry));
        emit OracleRequestFailed(runId);
        harness.requestOracleForTest{value: 0.0309 ether}(runId);
        assertEq(address(registry).balance, 0.0309 ether);
    }

    function test_UnderpaidRequestsAreSkippedAndZeroValueIsSilent() public {
        uint256 runId = _start();
        vm.expectEmit(true, false, false, false, address(registry));
        emit OracleRequestFailed(runId);
        harness.requestOracleForTest{value: 0.001 ether}(runId);
        harness.requestOracleForTest(runId);
        assertEq(agents.nextId(), 1);
    }

    function test_OwnerWithdrawsRebatesAndSetsTheDeposit() public {
        (bool ok,) = address(registry).call{value: 1 ether}("");
        assertTrue(ok);
        address payable sink = payable(makeAddr("sink"));
        registry.withdraw(sink);
        assertEq(sink.balance, 1 ether);
        registry.setOracleDeposit(0.05 ether);
        assertEq(registry.oracleDeposit(), 0.05 ether);
        vm.prank(stranger);
        vm.expectRevert(BasanosRegistry.NotOwner.selector);
        registry.withdraw(sink);
    }
}
