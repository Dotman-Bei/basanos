// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Types verbatim from the Somnia docs (agents/somnia-agents/invoking-agents/from-solidity).
enum ConsensusType {
    Majority,
    Threshold,
    FirstQuorum
}

enum ResponseStatus {
    None,
    Pending,
    Success,
    Failed,
    TimedOut
}

struct Response {
    address validator;
    bytes result;
    ResponseStatus status;
    uint256 receipt;
    uint256 timestamp;
    uint256 executionCost;
}

struct Request {
    uint256 id;
    address requester;
    address callbackAddress;
    bytes4 callbackSelector;
    address[] subcommittee;
    Response[] responses;
    uint256 responseCount;
    uint256 failureCount;
    uint256 threshold;
    uint256 createdAt;
    uint256 deadline;
    ResponseStatus status;
    ConsensusType consensusType;
    uint256 remainingBudget;
    uint256 perAgentBudget;
}

interface ISomniaAgents {
    function createRequest(uint256 agentId, address callbackAddress, bytes4 callbackSelector, bytes calldata payload)
        external
        payable
        returns (uint256 requestId);
}

interface IPriceOracleAgent {
    function getPrices(string[] calldata symbols, uint8 decimals)
        external
        returns (uint256[] memory prices, uint8[] memory numSources, uint64[] memory lastUpdated);
}
