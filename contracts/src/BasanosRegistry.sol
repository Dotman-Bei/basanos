// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IMarginBank} from "./interfaces/IMarginBank.sol";
import {IPerpPool} from "./interfaces/IPerpPool.sol";
import {IPriceOracleAgent, ISomniaAgents, Request, Response, ResponseStatus} from "./interfaces/ISomniaAgents.sol";
import {Base64} from "./Base64.sol";

/// @title Basanos verdict registry and soulbound certificate
/// @notice Every certificate is chain-checked at mint; every verdict is replayable.
contract BasanosRegistry {
    enum Status {
        None,
        Active,
        Passed,
        Failed,
        Voided
    }

    enum Rule {
        None,
        DailyLoss,
        TrailingDrawdown,
        MaxExposure,
        TimeLimit,
        Liquidated
    }

    enum VoidReason {
        None,
        Flow,
        ForeignMarket,
        GrantRevoked
    }

    /// Each field is the return value of a fixed call at blockNumber (spec §2): MarginBank.tryGetAccountEquity,
    /// MarginBank.getAccountState().lockedCollateral, MarginBank.getPosition(account, pool).size, PerpPool.tryGetMarkPrice.
    struct Read {
        uint64 blockNumber;
        bool equityOk;
        int256 equity;
        uint256 lockedCollateral;
        int128 positionSize;
        bool markOk;
        uint256 markPrice;
    }

    struct RulebookParams {
        address pool;
        uint32 profitTargetBps;
        uint32 minDurationSec;
        uint32 timeLimitSec;
        string oracleSymbol;
        bool exists;
    }

    struct Run {
        address account;
        bytes32 rulebookId;
        Status status;
        Rule rule;
        VoidReason voidReason;
        uint64 startTime;
        uint64 endTime;
        Read start;
        Read breach;
        Read end;
        bytes32 evidenceHash;
        bytes32 voidTxHash;
        uint256 oracleRequestId;
        uint256 oraclePrice;
        uint8 oracleSources;
        uint64 oracleUpdatedAt;
        bool oracleDone;
    }

    bytes4 public constant PLACE_ORDER_FOR = 0x80054449;
    bytes4 public constant CANCEL_ORDER_FOR = 0xe37b444b;
    uint256 public constant ORACLE_AGENT_ID = 9911223344556677889;
    uint8 public constant ORACLE_DECIMALS = 18;
    string public constant name = "Basanos Certificate";
    string public constant symbol = "BSNC";

    address public immutable owner;
    address public immutable referee;
    address public immutable marginBank;
    address public immutable somniaAgents;
    string public baseUrl;
    uint256 public oracleDeposit = 0.0309 ether;
    uint256 public runCount;
    mapping(address => uint256) public activeRunOf;
    mapping(address => uint256) public balanceOf;

    mapping(bytes32 => RulebookParams) internal _rulebooks;
    mapping(uint256 => Run) internal _runs;
    mapping(uint256 => bytes32[]) internal _closeTxs;
    uint256[] internal _activeRunIds;
    mapping(uint256 => uint256) internal _activeIndex;
    mapping(uint256 => uint256) internal _oracleRun;
    mapping(uint256 => address) internal _owners;

    event RulebookRegistered(
        bytes32 indexed id, address pool, uint32 profitTargetBps, uint32 minDurationSec, uint32 timeLimitSec, string oracleSymbol
    );
    event RunStarted(uint256 indexed runId, address indexed account, bytes32 indexed rulebookId, uint64 blockNumber, int256 startEquity);
    event RunPassed(uint256 indexed runId, address indexed account, uint64 blockNumber, int256 endEquity);
    event RunFailed(uint256 indexed runId, address indexed account, Rule rule, uint64 breachBlock, uint64 endBlock);
    event RunVoided(uint256 indexed runId, address indexed account, VoidReason reason, bytes32 txHash);
    event OracleRequested(uint256 indexed runId, uint256 requestId);
    event OracleRequestFailed(uint256 indexed runId);
    event OracleRecorded(uint256 indexed runId, uint256 price, uint8 sources, uint64 updatedAt);
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Locked(uint256 tokenId);

    error NotOwner();
    error NotReferee();
    error NotAgents();
    error UnknownRulebook();
    error RulebookExists();
    error NotAccountOrReferee();
    error RunExists(uint256 runId);
    error NotActive();
    error GrantMissing();
    error NotFlat();
    error Unpriceable();
    error NonPositiveEquity();
    error TooEarly();
    error TooLate();
    error TargetNotMet();
    error TimeLimitNotReached();
    error GrantStillHeld();
    error InvalidVoidReason();
    error InvalidRule();
    error Soulbound();
    error NonexistentToken();
    error UnknownRequest();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyReferee() {
        if (msg.sender != referee) revert NotReferee();
        _;
    }

    constructor(address marginBank_, address somniaAgents_, address referee_, string memory baseUrl_) {
        owner = msg.sender;
        marginBank = marginBank_;
        somniaAgents = somniaAgents_;
        referee = referee_;
        baseUrl = baseUrl_;
    }

    // ------------------------------------------------------------------ rulebooks

    function registerRulebook(
        bytes32 id,
        address pool,
        uint32 profitTargetBps,
        uint32 minDurationSec,
        uint32 timeLimitSec,
        string calldata oracleSymbol
    ) external onlyOwner {
        if (_rulebooks[id].exists) revert RulebookExists();
        _rulebooks[id] = RulebookParams(pool, profitTargetBps, minDurationSec, timeLimitSec, oracleSymbol, true);
        emit RulebookRegistered(id, pool, profitTargetBps, minDurationSec, timeLimitSec, oracleSymbol);
    }

    function getRulebook(bytes32 id) external view returns (RulebookParams memory) {
        return _rulebooks[id];
    }

    function setBaseUrl(string calldata url) external onlyOwner {
        baseUrl = url;
    }

    // ------------------------------------------------------------------ start (chain-checked)

    /// @return code 0 ok, 1 unknown rulebook, 2 active run exists, 3 grant missing, 4 not flat, 5 unpriceable, 6 non-positive equity
    function previewStart(address account, bytes32 rulebookId) external view returns (uint8 code, Read memory read) {
        return _preview(account, rulebookId);
    }

    function startRun(address account, bytes32 rulebookId) external returns (uint256 runId) {
        if (msg.sender != account && msg.sender != referee) revert NotAccountOrReferee();
        (uint8 code, Read memory read) = _preview(account, rulebookId);
        if (code == 1) revert UnknownRulebook();
        if (code == 2) revert RunExists(activeRunOf[account]);
        if (code == 3) revert GrantMissing();
        if (code == 4) revert NotFlat();
        if (code == 5) revert Unpriceable();
        if (code == 6) revert NonPositiveEquity();
        runId = ++runCount;
        Run storage run = _runs[runId];
        run.account = account;
        run.rulebookId = rulebookId;
        run.status = Status.Active;
        run.startTime = uint64(block.timestamp);
        run.start = read;
        activeRunOf[account] = runId;
        _activeRunIds.push(runId);
        _activeIndex[runId] = _activeRunIds.length;
        emit RunStarted(runId, account, rulebookId, read.blockNumber, read.equity);
    }

    // ------------------------------------------------------------------ views

    function getRun(uint256 runId) external view returns (Run memory) {
        return _runs[runId];
    }

    function getCloseTxs(uint256 runId) external view returns (bytes32[] memory) {
        return _closeTxs[runId];
    }

    function getActiveRunIds() external view returns (uint256[] memory) {
        return _activeRunIds;
    }

    // ------------------------------------------------------------------ Price Oracle (Somnia Agents)

    function setOracleDeposit(uint256 wei_) external onlyOwner {
        oracleDeposit = wei_;
    }

    function withdraw(address payable to) external onlyOwner {
        (bool ok,) = to.call{value: address(this).balance}("");
        if (!ok) revert TransferFailed();
    }

    /// SomniaAgents rebates the unused part of each deposit here.
    receive() external payable {}

    /// Asks the Price Oracle for the rulebook's symbol with msg.value. Never reverts the verdict that calls it.
    function _requestOracle(uint256 runId) internal {
        if (msg.value == 0) return;
        if (msg.value < oracleDeposit || somniaAgents == address(0)) {
            emit OracleRequestFailed(runId);
            return;
        }
        string[] memory symbols = new string[](1);
        symbols[0] = _rulebooks[_runs[runId].rulebookId].oracleSymbol;
        bytes memory payload = abi.encodeCall(IPriceOracleAgent.getPrices, (symbols, ORACLE_DECIMALS));
        try ISomniaAgents(somniaAgents).createRequest{value: msg.value}(
            ORACLE_AGENT_ID, address(this), this.handleOracle.selector, payload
        ) returns (uint256 requestId) {
            _runs[runId].oracleRequestId = requestId;
            _oracleRun[requestId] = runId;
            emit OracleRequested(runId, requestId);
        } catch {
            emit OracleRequestFailed(runId);
        }
    }

    function handleOracle(
        uint256 requestId,
        Response[] calldata responses,
        ResponseStatus status,
        Request calldata details
    ) external {
        if (msg.sender != somniaAgents) revert NotAgents();
        uint256 runId = _oracleRun[requestId];
        if (runId == 0) revert UnknownRequest();
        delete _oracleRun[requestId];
        Run storage run = _runs[runId];
        run.oracleDone = true;
        if (status != ResponseStatus.Success) return;
        bytes memory result = _consensus(responses, details.threshold);
        if (result.length == 0) return;
        (uint256[] memory prices, uint8[] memory sources, uint64[] memory updated) =
            abi.decode(result, (uint256[], uint8[], uint64[]));
        if (prices.length == 0) return;
        run.oraclePrice = prices[0];
        run.oracleSources = sources[0];
        run.oracleUpdatedAt = updated[0];
        emit OracleRecorded(runId, prices[0], sources[0], updated[0]);
    }

    /// The result that at least `threshold` successful responses share (the Somnia docs' pattern).
    function _consensus(Response[] calldata responses, uint256 threshold) internal pure returns (bytes memory) {
        for (uint256 i = 0; i < responses.length; i++) {
            if (responses[i].status != ResponseStatus.Success) continue;
            uint256 matches;
            bytes32 h = keccak256(responses[i].result);
            for (uint256 j = 0; j < responses.length; j++) {
                if (responses[j].status == ResponseStatus.Success && keccak256(responses[j].result) == h) matches++;
            }
            if (matches >= threshold) return responses[i].result;
        }
        return "";
    }

    // ------------------------------------------------------------------ PASS (chain-checked) + certificate

    function recordPass(uint256 runId) external payable onlyReferee {
        Run storage run = _runs[runId];
        if (run.status != Status.Active) revert NotActive();
        RulebookParams storage rb = _rulebooks[run.rulebookId];
        if (block.timestamp < uint256(run.startTime) + rb.minDurationSec) revert TooEarly();
        if (block.timestamp > uint256(run.startTime) + rb.timeLimitSec) revert TooLate();
        (Read memory r, uint256 pools) = _readFull(run.account, rb.pool);
        if (pools != 0 || r.lockedCollateral != 0) revert NotFlat();
        if (!_granted(run.account, rb.pool)) revert GrantMissing();
        if (!r.equityOk) revert Unpriceable();
        int256 startTotal = run.start.equity + int256(run.start.lockedCollateral);
        int256 endTotal = r.equity + int256(r.lockedCollateral);
        if (endTotal * 10_000 < startTotal * int256(10_000 + uint256(rb.profitTargetBps))) revert TargetNotMet();
        run.end = r;
        run.status = Status.Passed;
        address account = run.account;
        _finish(runId, account);
        _mint(account, runId);
        emit RunPassed(runId, account, r.blockNumber, endTotal);
        _requestOracle(runId);
    }

    function ownerOf(uint256 tokenId) external view returns (address holder) {
        holder = _owners[tokenId];
        if (holder == address(0)) revert NonexistentToken();
    }

    function locked(uint256 tokenId) external view returns (bool) {
        if (_owners[tokenId] == address(0)) revert NonexistentToken();
        return true;
    }

    function getApproved(uint256) external pure returns (address) {
        return address(0);
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    function approve(address, uint256) external pure {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) external pure {
        revert Soulbound();
    }

    function transferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256, bytes calldata) external pure {
        revert Soulbound();
    }

    function _mint(address to, uint256 tokenId) internal {
        _owners[tokenId] = to;
        balanceOf[to] += 1;
        emit Transfer(address(0), to, tokenId);
        emit Locked(tokenId);
    }

    // ------------------------------------------------------------------ FAIL / VOID (referee-recorded, replayable)

    function recordFail(
        uint256 runId,
        Rule rule,
        Read calldata breach,
        bytes32 evidenceHash,
        bytes32[] calldata closeTxs
    ) external payable onlyReferee {
        Run storage run = _runs[runId];
        if (run.status != Status.Active) revert NotActive();
        if (rule == Rule.None) revert InvalidRule();
        RulebookParams storage rb = _rulebooks[run.rulebookId];
        if (rule == Rule.TimeLimit && block.timestamp <= uint256(run.startTime) + rb.timeLimitSec) {
            revert TimeLimitNotReached();
        }
        (Read memory r,) = _readFull(run.account, rb.pool);
        Read memory attested = breach;
        run.rule = rule;
        run.breach = attested;
        run.end = r;
        run.evidenceHash = evidenceHash;
        run.status = Status.Failed;
        for (uint256 i = 0; i < closeTxs.length; i++) {
            _closeTxs[runId].push(closeTxs[i]);
        }
        address account = run.account;
        _finish(runId, account);
        emit RunFailed(runId, account, rule, breach.blockNumber, r.blockNumber);
        _requestOracle(runId);
    }

    /// Flow and ForeignMarket only: GrantRevoked is set solely by voidRevoked after its on-chain check.
    function recordVoid(uint256 runId, VoidReason reason, bytes32 txHash, bytes32 evidenceHash) external onlyReferee {
        if (reason != VoidReason.Flow && reason != VoidReason.ForeignMarket) revert InvalidVoidReason();
        _void(runId, reason, txHash, evidenceHash);
    }

    function voidRevoked(uint256 runId) external {
        Run storage run = _runs[runId];
        if (run.status != Status.Active) revert NotActive();
        if (_granted(run.account, _rulebooks[run.rulebookId].pool)) revert GrantStillHeld();
        _void(runId, VoidReason.GrantRevoked, bytes32(0), bytes32(0));
    }

    function _void(uint256 runId, VoidReason reason, bytes32 txHash, bytes32 evidenceHash) internal {
        Run storage run = _runs[runId];
        if (run.status != Status.Active) revert NotActive();
        (Read memory r,) = _readFull(run.account, _rulebooks[run.rulebookId].pool);
        run.end = r;
        run.voidReason = reason;
        run.voidTxHash = txHash;
        run.evidenceHash = evidenceHash;
        run.status = Status.Voided;
        address account = run.account;
        _finish(runId, account);
        emit RunVoided(runId, account, reason, txHash);
    }

    // ------------------------------------------------------------------ certificate metadata

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0x80ac58cd || id == 0x5b5e139f || id == 0xb45a3c0e;
    }

    /// base64, because the external_url holds a '#' that would end a plain data: URI.
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (_owners[tokenId] == address(0)) revert NonexistentToken();
        Run storage run = _runs[tokenId];
        string memory head = string.concat(
            '{"name":"Basanos Certificate #',
            _u(tokenId),
            '","description":"Every certificate is chain-checked at mint; every verdict is replayable.","external_url":"',
            baseUrl,
            _u(tokenId),
            '","attributes":['
        );
        string memory body = string.concat(
            '{"trait_type":"rulebook","value":"',
            _hex32(run.rulebookId),
            '"},{"trait_type":"startBlock","value":',
            _u(run.start.blockNumber),
            '},{"trait_type":"endBlock","value":',
            _u(run.end.blockNumber),
            "},"
        );
        string memory tail = string.concat(
            '{"trait_type":"startEquity","value":"',
            _i(run.start.equity + int256(run.start.lockedCollateral)),
            '"},{"trait_type":"endEquity","value":"',
            _i(run.end.equity + int256(run.end.lockedCollateral)),
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(string.concat(head, body, tail))));
    }

    function _u(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 len;
        for (uint256 t = v; t != 0; t /= 10) len++;
        bytes memory b = new bytes(len);
        while (v != 0) {
            len--;
            b[len] = bytes1(uint8(48 + (v % 10)));
            v /= 10;
        }
        return string(b);
    }

    function _i(int256 v) internal pure returns (string memory) {
        return v < 0 ? string.concat("-", _u(uint256(-v))) : _u(uint256(v));
    }

    function _hex32(bytes32 v) internal pure returns (string memory) {
        bytes16 digits = "0123456789abcdef";
        bytes memory b = new bytes(66);
        b[0] = "0";
        b[1] = "x";
        for (uint256 i = 0; i < 32; i++) {
            b[2 + i * 2] = digits[uint8(v[i]) >> 4];
            b[3 + i * 2] = digits[uint8(v[i]) & 0x0f];
        }
        return string(b);
    }

    // ------------------------------------------------------------------ internals

    function _preview(address account, bytes32 rulebookId) internal view returns (uint8 code, Read memory read) {
        RulebookParams storage rb = _rulebooks[rulebookId];
        if (!rb.exists) return (1, read);
        if (activeRunOf[account] != 0) return (2, read);
        if (!_granted(account, rb.pool)) return (3, read);
        uint256 pools;
        (read, pools) = _readFull(account, rb.pool);
        if (pools != 0 || read.lockedCollateral != 0) return (4, read);
        if (!read.equityOk) return (5, read);
        if (read.equity <= 0) return (6, read);
        return (0, read);
    }

    function _readFull(address account, address pool) internal view returns (Read memory read, uint256 activePools) {
        read.blockNumber = uint64(block.number);
        (read.equityOk, read.equity) = IMarginBank(marginBank).tryGetAccountEquity(account);
        IMarginBank.AccountState memory st = IMarginBank(marginBank).getAccountState(account);
        read.lockedCollateral = st.lockedCollateral;
        activePools = st.activePerpPools.length;
        read.positionSize = IMarginBank(marginBank).getPosition(account, pool).size;
        (read.markOk, read.markPrice) = IPerpPool(pool).tryGetMarkPrice();
    }

    function _granted(address account, address pool) internal view returns (bool) {
        return IPerpPool(pool).isOperatorAuthorized(account, referee, PLACE_ORDER_FOR)
            && IPerpPool(pool).isOperatorAuthorized(account, referee, CANCEL_ORDER_FOR);
    }

    function _finish(uint256 runId, address account) internal {
        _runs[runId].endTime = uint64(block.timestamp);
        activeRunOf[account] = 0;
        uint256 idx = _activeIndex[runId];
        if (idx != 0) {
            uint256 last = _activeRunIds[_activeRunIds.length - 1];
            _activeRunIds[idx - 1] = last;
            _activeIndex[last] = idx;
            _activeRunIds.pop();
            delete _activeIndex[runId];
        }
    }
}
