import { parseAbi } from "viem";

export const marginBankAbi = parseAbi([
  "function getAccountState(address account) view returns ((int256 unlockedCollateralBalance, uint256 lockedCollateral, address[] activePerpPools))",
  "function getAccountEquity(address account) view returns (int256)",
  "function tryGetAccountEquity(address account) view returns (bool ok, int256 equity)",
  "function getPosition(address account, address perpPool) view returns ((int128 size, uint128 avgEntryPrice, int256 entryFundingIndex, uint64 lastUpdatedTimestampNs))",
]);

export const perpPoolAbi = parseAbi([
  "function placeOrderFor(address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k) payable returns (bool success, uint128 orderId)",
  "function cancelOrderFor(address owner, uint128 orderId)",
  "function isOperatorAuthorized(address owner, address operator, bytes4 selector) view returns (bool)",
  "function getOwnOpenOrders() view returns (uint128[])",
  "function tryGetMarkPrice() view returns (bool ok, uint256 price)",
  "function getMarkPrice() view returns (uint256)",
  "function getOrderBookParameters() view returns ((uint256 tickSize, uint256 minQuantity, uint256 lotSize))",
  "function getBookLevels(bool isBid, uint64 numLevels) view returns ((uint256 price, uint256 quantity)[])",
]);

export const operatorRegistryAbi = parseAbi([
  "function setOperatorApprovalForPool(address pool, address operator, bytes4[] selectors, bool approved)",
  "function isApprovedForPool(address pool, address owner, address operator, bytes4 selector) view returns (bool)",
]);

export const multicall3Abi = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
  "function getBlockNumber() view returns (uint256 blockNumber)",
  "function getCurrentBlockTimestamp() view returns (uint256 timestamp)",
]);

export const somniaAgentsAbi = parseAbi([
  "struct Response { address validator; bytes result; uint8 status; uint256 receipt; uint256 timestamp; uint256 executionCost; }",
  "struct Request { uint256 id; address requester; address callbackAddress; bytes4 callbackSelector; address[] subcommittee; Response[] responses; uint256 responseCount; uint256 failureCount; uint256 threshold; uint256 createdAt; uint256 deadline; uint8 status; uint8 consensusType; uint256 remainingBudget; uint256 perAgentBudget; }",
  "function createRequest(uint256 agentId, address callbackAddress, bytes4 callbackSelector, bytes payload) payable returns (uint256 requestId)",
  "function getRequest(uint256 requestId) view returns (Request)",
  "function getRequestDeposit() view returns (uint256)",
  "event RequestCreated(uint256 indexed requestId, uint256 indexed agentId, uint256 perAgentBudget, bytes payload, address[] subcommittee)",
  "event RequestFinalized(uint256 indexed requestId, uint8 status)",
]);

export const priceOracleAbi = parseAbi([
  "function getPrices(string[] symbols, uint8 decimals) returns (uint256[] prices, uint8[] numSources, uint64[] lastUpdated)",
]);

export const marginBankEventsAbi = parseAbi([
  "event PositionUpdated(address indexed account, address indexed perpPool, int128 newSize, uint128 avgEntryPrice, int256 realizedPnl, int256 entryFundingIndex)",
]);
