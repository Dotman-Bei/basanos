# Basanos Registry (Contracts) Implementation Plan

**Goal:** Build, test, deploy and verify `BasanosRegistry` on Hideki, the on-chain verdict registry with its soulbound certificate. Every certificate is chain-checked at mint; every verdict is replayable.
**Architecture:** One Solidity contract reads MarginBank and the PerpPool itself. In `startRun` it records the start equity and checks flatness and the referee grant; in `recordPass` it checks the end state and mints. FAIL and VOID verdicts are recorded from the referee with raw reads. Every verdict call can ask the Somnia Price Oracle inside a `try`, and the answer arrives by callback. Unit tests run against mocks, because the Hideki RPC rejects EIP-1898 block objects, so Foundry cannot fork it. One live read-only gate (R5) runs `previewStart` against the real MarginBank after deploy.
**Tech Stack:** Foundry forge 1.7.1, solc 0.8.28, `evm_version = cancun` (never osaka: bot-kit #36), `via_ir = true`, forge-std v1.16.2 (installed on demand by `contracts/script/forge.mjs`), TypeScript scripts on Node 22 + tsx 4.23.15 + viem 2.57.12 + `@somnia-chain/markets-sdk` 0.33.0, vitest 4.1.12 for the TS side.
**Source spec:** docs/superpowers/specs/2026-11-10-basanos-design.md

**Boot notes for the orchestrator:**
- Every forge command goes through `node contracts/script/forge.mjs <forge args>`. The wrapper installs forge-std into the git-ignored `contracts/lib/` on first use and passes `--root contracts`, so no shell `&&` and no path quoting is needed (the repo path contains spaces).
- `contracts/src/BasanosRegistry.sol` is built incrementally. Task 3 creates it with four anchor lines (`    // [[oracle]]`, `    // [[pass]]`, `    // [[fail-void]]`, `    // [[metadata]]`). Tasks 4–7 each replace exactly one anchor line with the code shown. Never reorder or delete other anchors.
- Task 10 (deploy) is human-gated and spends STT from the referee burner (`REFEREE_PK`). Task 11 reads only. No task here claims a voucher or touches a challenge account's funds.

---

### Task 1: Foundry scaffold, external interfaces, forge wrapper

**Files:**
- Create: `contracts/foundry.toml`
- Create: `contracts/remappings.txt`
- Create: `contracts/script/forge.mjs`
- Create: `contracts/src/interfaces/IMarginBank.sol`
- Create: `contracts/src/interfaces/IPerpPool.sol`
- Create: `contracts/src/interfaces/ISomniaAgents.sol`
- Test: `contracts/test/Interfaces.t.sol`

**Depends on:** spike:Task 1
**Effort:** low
**Model tier:** fast
**Provides:** `CLI: node contracts/script/forge.mjs <forge args> (installs forge-std v1.16.2 on demand, adds --root contracts)`, `interface IMarginBank { struct AccountState { int256 unlockedCollateralBalance; uint256 lockedCollateral; address[] activePerpPools; } struct Position { int128 size; uint128 avgEntryPrice; int256 entryFundingIndex; uint64 lastUpdatedTimestampNs; } getAccountState(address) returns (AccountState); tryGetAccountEquity(address) returns (bool ok, int256 equity); getPosition(address account, address perpPool) returns (Position) }`, `interface IPerpPool { isOperatorAuthorized(address owner, address operator, bytes4 selector) returns (bool); tryGetMarkPrice() returns (bool ok, uint256 price) }`, `enum ConsensusType { Majority, Threshold, FirstQuorum }`, `enum ResponseStatus { None, Pending, Success, Failed, TimedOut }`, `struct Response { address validator; bytes result; ResponseStatus status; uint256 receipt; uint256 timestamp; uint256 executionCost; }`, `struct Request { uint256 id; address requester; address callbackAddress; bytes4 callbackSelector; address[] subcommittee; Response[] responses; uint256 responseCount; uint256 failureCount; uint256 threshold; uint256 createdAt; uint256 deadline; ResponseStatus status; ConsensusType consensusType; uint256 remainingBudget; uint256 perAgentBudget; }`, `interface ISomniaAgents { createRequest(uint256 agentId, address callbackAddress, bytes4 callbackSelector, bytes payload) payable returns (uint256 requestId) }`, `interface IPriceOracleAgent { getPrices(string[] symbols, uint8 decimals) returns (uint256[] prices, uint8[] numSources, uint64[] lastUpdated) }`
**Requires:** `npm workspaces root (packages/*, apps/*)`

- [ ] **Step 1: Write the config and the wrapper**

`contracts/foundry.toml`:
```toml
[profile.default]
src = "src"
test = "test"
script = "script"
out = "out"
libs = ["lib"]
solc_version = "0.8.28"
evm_version = "cancun"
optimizer = true
optimizer_runs = 200
via_ir = true
```

`contracts/remappings.txt`:
```text
forge-std/=lib/forge-std/src/
```

`contracts/script/forge.mjs`:
```js
// Runs forge with --root contracts; installs forge-std v1.16.2 into contracts/lib on first use.
// Usage: node contracts/script/forge.mjs <forge args...>
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const testSol = fileURLToPath(new URL("../lib/forge-std/src/Test.sol", import.meta.url));
if (!existsSync(testSol)) {
  const install = spawnSync("forge", ["install", "foundry-rs/forge-std@v1.16.2", "--no-git", "--root", root], { stdio: "inherit" });
  if (install.status !== 0) process.exit(install.status ?? 1);
}
const run = spawnSync("forge", [...process.argv.slice(2), "--root", root], { stdio: "inherit" });
process.exit(run.status ?? 1);
```

- [ ] **Step 2: Write the interfaces**

`contracts/src/interfaces/IMarginBank.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The dreamDEX MarginBank views Basanos reads (signatures from @somnia-chain/markets-sdk 0.33.0 readsAbi).
interface IMarginBank {
    struct AccountState {
        int256 unlockedCollateralBalance;
        uint256 lockedCollateral;
        address[] activePerpPools;
    }

    struct Position {
        int128 size;
        uint128 avgEntryPrice;
        int256 entryFundingIndex;
        uint64 lastUpdatedTimestampNs;
    }

    function getAccountState(address account) external view returns (AccountState memory);
    function tryGetAccountEquity(address account) external view returns (bool ok, int256 equity);
    function getPosition(address account, address perpPool) external view returns (Position memory);
}
```

`contracts/src/interfaces/IPerpPool.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The dreamDEX PerpPool views Basanos reads.
interface IPerpPool {
    function isOperatorAuthorized(address owner, address operator, bytes4 selector) external view returns (bool);
    function tryGetMarkPrice() external view returns (bool ok, uint256 price);
}
```

`contracts/src/interfaces/ISomniaAgents.sol`:
```solidity
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
```

- [ ] **Step 3: Write the interface test**

`contracts/test/Interfaces.t.sol`:
```solidity
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
```

- [ ] **Step 4: Run the gate**
Run: `node contracts/script/forge.mjs test --match-contract InterfacesTest`
Expected: PASS — `Suite result: ok. 1 passed; 0 failed`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `chore(contracts): foundry scaffold, dreamDEX and SomniaAgents interfaces`

---

### Task 2: Base64 library and test mocks

**Files:**
- Create: `contracts/src/Base64.sol`
- Create: `contracts/test/mocks/MockMarginBank.sol`
- Create: `contracts/test/mocks/MockPerpPool.sol`
- Create: `contracts/test/mocks/MockSomniaAgents.sol`
- Test: `contracts/test/Base64.t.sol`

**Depends on:** Task 1
**Effort:** low
**Provides:** `library Base64 { encode(bytes memory data) internal pure returns (string memory) }`, `contract MockMarginBank { setEquity(address a, bool ok, int256 equity); setLocked(address a, uint256 locked); setPools(address a, address[] pools); setSize(address a, int128 size) }`, `contract MockPerpPool { setAuthorized(address owner, address operator, bytes4 selector, bool on); setMark(bool ok, uint256 price) }`, `contract MockSomniaAgents { nextId; setShouldRevert(bool); pendingPayload(uint256) returns (bytes); pendingValue(uint256) returns (uint256); pendingAgentId(uint256) returns (uint256); pendingCallback(uint256) returns (address); fulfill(uint256 id, bytes result, ResponseStatus status) }`
**Requires:** `interface IMarginBank { struct AccountState { int256 unlockedCollateralBalance; uint256 lockedCollateral; address[] activePerpPools; } struct Position { int128 size; uint128 avgEntryPrice; int256 entryFundingIndex; uint64 lastUpdatedTimestampNs; } getAccountState(address) returns (AccountState); tryGetAccountEquity(address) returns (bool ok, int256 equity); getPosition(address account, address perpPool) returns (Position) }`, `enum ResponseStatus { None, Pending, Success, Failed, TimedOut }`, `struct Response { address validator; bytes result; ResponseStatus status; uint256 receipt; uint256 timestamp; uint256 executionCost; }`, `struct Request { uint256 id; address requester; address callbackAddress; bytes4 callbackSelector; address[] subcommittee; Response[] responses; uint256 responseCount; uint256 failureCount; uint256 threshold; uint256 createdAt; uint256 deadline; ResponseStatus status; ConsensusType consensusType; uint256 remainingBudget; uint256 perAgentBudget; }`, `CLI: node contracts/script/forge.mjs <forge args> (installs forge-std v1.16.2 on demand, adds --root contracts)`

- [ ] **Step 1: Write the failing test**

`contracts/test/Base64.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Base64} from "../src/Base64.sol";

contract Base64Test is Test {
    function test_EncodesRfc4648Vectors() public pure {
        assertEq(Base64.encode(""), "");
        assertEq(Base64.encode("M"), "TQ==");
        assertEq(Base64.encode("Ma"), "TWE=");
        assertEq(Base64.encode("Man"), "TWFu");
        assertEq(Base64.encode("foobar"), "Zm9vYmFy");
    }

    function test_MatchesForgeOnJson() public pure {
        bytes memory json = bytes('{"name":"Basanos Certificate #1","external_url":"https://x/app/#/cert/1"}');
        assertEq(Base64.encode(json), vm.toBase64(json));
    }
}
```

- [ ] **Step 2: Run to confirm it fails**
Run: `node contracts/script/forge.mjs test --match-contract Base64Test`
Expected: FAIL — compiler error `Source "src/Base64.sol" not found`.

- [ ] **Step 3: Write the library and the mocks**

`contracts/src/Base64.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice RFC 4648 base64 (with padding), for the certificate's data: URI.
library Base64 {
    bytes internal constant TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    function encode(bytes memory data) internal pure returns (string memory) {
        if (data.length == 0) return "";
        bytes memory table = TABLE;
        bytes memory result = new bytes(4 * ((data.length + 2) / 3));
        uint256 j;
        for (uint256 i = 0; i < data.length; i += 3) {
            uint256 a = uint8(data[i]);
            uint256 b = i + 1 < data.length ? uint8(data[i + 1]) : 0;
            uint256 c = i + 2 < data.length ? uint8(data[i + 2]) : 0;
            uint256 triple = (a << 16) | (b << 8) | c;
            result[j++] = table[(triple >> 18) & 63];
            result[j++] = table[(triple >> 12) & 63];
            result[j++] = i + 1 < data.length ? table[(triple >> 6) & 63] : bytes1("=");
            result[j++] = i + 2 < data.length ? table[triple & 63] : bytes1("=");
        }
        return string(result);
    }
}
```

`contracts/test/mocks/MockMarginBank.sol`:
```solidity
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
```

`contracts/test/mocks/MockPerpPool.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract MockPerpPool {
    mapping(bytes32 => bool) internal auth;
    bool public markOk;
    uint256 public markPrice;

    function setAuthorized(address owner, address operator, bytes4 selector, bool on) external {
        auth[keccak256(abi.encode(owner, operator, selector))] = on;
    }

    function setMark(bool ok, uint256 price) external {
        markOk = ok;
        markPrice = price;
    }

    function isOperatorAuthorized(address owner, address operator, bytes4 selector) external view returns (bool) {
        return auth[keccak256(abi.encode(owner, operator, selector))];
    }

    function tryGetMarkPrice() external view returns (bool ok, uint256 price) {
        return (markOk, markPrice);
    }
}
```

`contracts/test/mocks/MockSomniaAgents.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Request, Response, ResponseStatus} from "../../src/interfaces/ISomniaAgents.sol";

contract MockSomniaAgents {
    struct Pending {
        address callback;
        bytes4 selector;
        bytes payload;
        uint256 value;
        uint256 agentId;
    }

    uint256 public nextId = 1;
    bool public shouldRevert;
    mapping(uint256 => Pending) internal pending;

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    function createRequest(uint256 agentId, address callbackAddress, bytes4 callbackSelector, bytes calldata payload)
        external
        payable
        returns (uint256 id)
    {
        require(!shouldRevert, "mock: createRequest disabled");
        id = nextId++;
        pending[id] = Pending(callbackAddress, callbackSelector, payload, msg.value, agentId);
    }

    function pendingPayload(uint256 id) external view returns (bytes memory) {
        return pending[id].payload;
    }

    function pendingValue(uint256 id) external view returns (uint256) {
        return pending[id].value;
    }

    function pendingAgentId(uint256 id) external view returns (uint256) {
        return pending[id].agentId;
    }

    function pendingCallback(uint256 id) external view returns (address) {
        return pending[id].callback;
    }

    /// Calls the requester's callback exactly as the platform does: (requestId, responses, status, details).
    function fulfill(uint256 id, bytes calldata result, ResponseStatus status) external {
        Pending storage p = pending[id];
        Response[] memory responses = new Response[](1);
        responses[0] = Response({
            validator: address(this),
            result: result,
            status: status == ResponseStatus.Success ? ResponseStatus.Success : ResponseStatus.Failed,
            receipt: 0,
            timestamp: block.timestamp,
            executionCost: 0
        });
        Request memory details;
        details.id = id;
        details.threshold = 1;
        details.status = status;
        details.callbackAddress = p.callback;
        details.callbackSelector = p.selector;
        (bool ok, bytes memory ret) = p.callback.call(abi.encodeWithSelector(p.selector, id, responses, status, details));
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    receive() external payable {}
}
```

- [ ] **Step 4: Run to confirm it passes (the gate)**
Run: `node contracts/script/forge.mjs test --match-contract Base64Test`
Expected: PASS — `Suite result: ok. 2 passed; 0 failed`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `feat(contracts): base64 library and dreamDEX/SomniaAgents mocks`

---

### Task 3: Registry core — rulebooks, chain-checked start, views

**Files:**
- Create: `contracts/src/BasanosRegistry.sol`
- Create: `contracts/test/Fixture.sol`
- Test: `contracts/test/Start.t.sol`

**Depends on:** Task 1, Task 2
**Effort:** high
**Model tier:** top
**Provides:** `contract BasanosRegistry (with anchors // [[oracle]], // [[pass]], // [[fail-void]], // [[metadata]])`, `enum Status { None, Active, Passed, Failed, Voided }`, `enum Rule { None, DailyLoss, TrailingDrawdown, MaxExposure, TimeLimit, Liquidated }`, `enum VoidReason { None, Flow, ForeignMarket, GrantRevoked }`, `struct Read { uint64 blockNumber; bool equityOk; int256 equity; uint256 lockedCollateral; int128 positionSize; bool markOk; uint256 markPrice; }`, `struct RulebookParams { address pool; uint32 profitTargetBps; uint32 minDurationSec; uint32 timeLimitSec; string oracleSymbol; bool exists; }`, `struct Run { address account; bytes32 rulebookId; Status status; Rule rule; VoidReason voidReason; uint64 startTime; uint64 endTime; Read start; Read breach; Read end; bytes32 evidenceHash; bytes32 voidTxHash; uint256 oracleRequestId; uint256 oraclePrice; uint8 oracleSources; uint64 oracleUpdatedAt; bool oracleDone; }`, `constructor(address marginBank, address somniaAgents, address referee, string memory baseUrl)`, `registerRulebook(bytes32 id, address pool, uint32 profitTargetBps, uint32 minDurationSec, uint32 timeLimitSec, string calldata oracleSymbol)`, `getRulebook(bytes32 id) returns (RulebookParams memory)`, `setBaseUrl(string calldata url)`, `previewStart(address account, bytes32 rulebookId) returns (uint8 code, Read memory read)`, `startRun(address account, bytes32 rulebookId) returns (uint256 runId)`, `getRun(uint256 runId) returns (Run memory)`, `getCloseTxs(uint256 runId) returns (bytes32[] memory)`, `getActiveRunIds() returns (uint256[] memory)`, `activeRunOf(address) returns (uint256)`, `runCount() returns (uint256)`, `internal _readFull(address account, address pool) returns (Read memory read, uint256 activePools)`, `internal _granted(address account, address pool) returns (bool)`, `internal _finish(uint256 runId, address account)`, `abstract contract Fixture is Test (bank, pool, agents, registry, referee, trader, stranger, DEMO, START, _deploy(), _grant(address,bool), _start())`
**Requires:** `interface IMarginBank { struct AccountState { int256 unlockedCollateralBalance; uint256 lockedCollateral; address[] activePerpPools; } struct Position { int128 size; uint128 avgEntryPrice; int256 entryFundingIndex; uint64 lastUpdatedTimestampNs; } getAccountState(address) returns (AccountState); tryGetAccountEquity(address) returns (bool ok, int256 equity); getPosition(address account, address perpPool) returns (Position) }`, `interface IPerpPool { isOperatorAuthorized(address owner, address operator, bytes4 selector) returns (bool); tryGetMarkPrice() returns (bool ok, uint256 price) }`, `library Base64 { encode(bytes memory data) internal pure returns (string memory) }`, `contract MockMarginBank { setEquity(address a, bool ok, int256 equity); setLocked(address a, uint256 locked); setPools(address a, address[] pools); setSize(address a, int128 size) }`, `contract MockPerpPool { setAuthorized(address owner, address operator, bytes4 selector, bool on); setMark(bool ok, uint256 price) }`, `contract MockSomniaAgents { nextId; setShouldRevert(bool); pendingPayload(uint256) returns (bytes); pendingValue(uint256) returns (uint256); pendingAgentId(uint256) returns (uint256); pendingCallback(uint256) returns (address); fulfill(uint256 id, bytes result, ResponseStatus status) }`, `CLI: node contracts/script/forge.mjs <forge args> (installs forge-std v1.16.2 on demand, adds --root contracts)`

- [ ] **Step 1: Write the fixture and the failing test**

`contracts/test/Fixture.sol`:
```solidity
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
```

`contracts/test/Start.t.sol`:
```solidity
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
```

- [ ] **Step 2: Run to confirm it fails**
Run: `node contracts/script/forge.mjs test --match-contract StartTest`
Expected: FAIL — compiler error `Source "src/BasanosRegistry.sol" not found`.

- [ ] **Step 3: Write the contract**

`contracts/src/BasanosRegistry.sol`:
```solidity
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

    // [[oracle]]

    // [[pass]]

    // [[fail-void]]

    // [[metadata]]

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
```

- [ ] **Step 4: Run to confirm it passes (the gate)**
Run: `node contracts/script/forge.mjs test --match-contract StartTest`
Expected: PASS — `Suite result: ok. 8 passed; 0 failed`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `feat(contracts): registry core with chain-checked startRun`

---

### Task 4: Price Oracle request and callback (replaces `// [[oracle]]`)

**Files:**
- Modify: `contracts/src/BasanosRegistry.sol`
- Test: `contracts/test/Oracle.t.sol`

**Depends on:** Task 1, Task 2, Task 3
**Effort:** high
**Model tier:** top
**Provides:** `internal _requestOracle(uint256 runId) (uses msg.value; never reverts the caller)`, `handleOracle(uint256 requestId, Response[] calldata responses, ResponseStatus status, Request calldata details) (SomniaAgents only)`, `setOracleDeposit(uint256 wei_)`, `withdraw(address payable to)`, `receive() external payable`
**Requires:** `contract BasanosRegistry (with anchors // [[oracle]], // [[pass]], // [[fail-void]], // [[metadata]])`, `abstract contract Fixture is Test (bank, pool, agents, registry, referee, trader, stranger, DEMO, START, _deploy(), _grant(address,bool), _start())`, `contract MockSomniaAgents { nextId; setShouldRevert(bool); pendingPayload(uint256) returns (bytes); pendingValue(uint256) returns (uint256); pendingAgentId(uint256) returns (uint256); pendingCallback(uint256) returns (address); fulfill(uint256 id, bytes result, ResponseStatus status) }`, `interface IPriceOracleAgent { getPrices(string[] symbols, uint8 decimals) returns (uint256[] prices, uint8[] numSources, uint64[] lastUpdated) }`, `enum ResponseStatus { None, Pending, Success, Failed, TimedOut }`

Security notes: the callback accepts calls from `somniaAgents` only and only for a request this registry created. The deposit is forwarded inside `try`, so a failing platform never blocks a verdict. Rebates arrive through `receive()`. Only the owner can withdraw the balance.

- [ ] **Step 1: Write the failing test**

`contracts/test/Oracle.t.sol`:
```solidity
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
```

- [ ] **Step 2: Run to confirm it fails**
Run: `node contracts/script/forge.mjs test --match-contract OracleTest`
Expected: FAIL — compiler error `Undeclared identifier` for `_requestOracle` (and `handleOracle`).

- [ ] **Step 3: Replace the line `    // [[oracle]]` in `contracts/src/BasanosRegistry.sol` with:**
```solidity
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
```

- [ ] **Step 4: Run to confirm it passes (the gate)**
Run: `node contracts/script/forge.mjs test --match-contract OracleTest`
Expected: PASS — `Suite result: ok. 7 passed; 0 failed`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `feat(contracts): Price Oracle request and consensus callback`

---

### Task 5: Chain-checked PASS and the soulbound certificate (replaces `// [[pass]]`)

**Files:**
- Modify: `contracts/src/BasanosRegistry.sol`
- Test: `contracts/test/Pass.t.sol`

**Depends on:** Task 3, Task 4
**Effort:** high
**Model tier:** top
**Provides:** `recordPass(uint256 runId) payable (referee only; checks min time, time limit, flat, grant, priceable, equity >= target; mints tokenId = runId)`, `ownerOf(uint256 tokenId) returns (address)`, `locked(uint256 tokenId) returns (bool)`, `getApproved(uint256) returns (address)`, `isApprovedForAll(address, address) returns (bool)`, `approve / setApprovalForAll / transferFrom / safeTransferFrom revert Soulbound()`, `internal _mint(address to, uint256 tokenId)`
**Requires:** `contract BasanosRegistry (with anchors // [[oracle]], // [[pass]], // [[fail-void]], // [[metadata]])`, `internal _requestOracle(uint256 runId) (uses msg.value; never reverts the caller)`, `internal _readFull(address account, address pool) returns (Read memory read, uint256 activePools)`, `internal _granted(address account, address pool) returns (bool)`, `internal _finish(uint256 runId, address account)`, `abstract contract Fixture is Test (bank, pool, agents, registry, referee, trader, stranger, DEMO, START, _deploy(), _grant(address,bool), _start())`

Security notes: this is the only path that mints, and it is the trust model's promise ("every certificate is chain-checked at mint"). Every condition is read from MarginBank and the pool inside this transaction; nothing the referee passes in is trusted.

- [ ] **Step 1: Write the failing test**

`contracts/test/Pass.t.sol`:
```solidity
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
```

- [ ] **Step 2: Run to confirm it fails**
Run: `node contracts/script/forge.mjs test --match-contract PassTest`
Expected: FAIL — compiler error `Member "recordPass" not found`.

- [ ] **Step 3: Replace the line `    // [[pass]]` in `contracts/src/BasanosRegistry.sol` with:**
```solidity
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
```

- [ ] **Step 4: Run to confirm it passes (the gate)**
Run: `node contracts/script/forge.mjs test --match-contract PassTest`
Expected: PASS — `Suite result: ok. 8 passed; 0 failed`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `feat(contracts): chain-checked recordPass and soulbound certificate`

---

### Task 6: FAIL and VOID verdicts (replaces `// [[fail-void]]`)

**Files:**
- Modify: `contracts/src/BasanosRegistry.sol`
- Test: `contracts/test/FailVoid.t.sol`

**Depends on:** Task 3, Task 4, Task 5
**Effort:** medium
**Model tier:** top
**Provides:** `recordFail(uint256 runId, Rule rule, Read calldata breach, bytes32 evidenceHash, bytes32[] calldata closeTxs) payable (referee only; TimeLimit checked against block.timestamp)`, `recordVoid(uint256 runId, VoidReason reason, bytes32 txHash, bytes32 evidenceHash) (referee only; Flow or ForeignMarket only)`, `voidRevoked(uint256 runId) (anyone; requires the place or cancel grant to be gone)`
**Requires:** `contract BasanosRegistry (with anchors // [[oracle]], // [[pass]], // [[fail-void]], // [[metadata]])`, `internal _requestOracle(uint256 runId) (uses msg.value; never reverts the caller)`, `internal _readFull(address account, address pool) returns (Read memory read, uint256 activePools)`, `internal _granted(address account, address pool) returns (bool)`, `internal _finish(uint256 runId, address account)`, `ownerOf(uint256 tokenId) returns (address)`, `abstract contract Fixture is Test (bank, pool, agents, registry, referee, trader, stranger, DEMO, START, _deploy(), _grant(address,bool), _start())`

- [ ] **Step 1: Write the failing test**

`contracts/test/FailVoid.t.sol`:
```solidity
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
```

- [ ] **Step 2: Run to confirm it fails**
Run: `node contracts/script/forge.mjs test --match-contract FailVoidTest`
Expected: FAIL — compiler error `Member "recordFail" not found`.

- [ ] **Step 3: Replace the line `    // [[fail-void]]` in `contracts/src/BasanosRegistry.sol` with:**
```solidity
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
```

- [ ] **Step 4: Run to confirm it passes (the gate)**
Run: `node contracts/script/forge.mjs test --match-contract FailVoidTest`
Expected: PASS — `Suite result: ok. 6 passed; 0 failed`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `feat(contracts): referee-recorded FAIL and VOID verdicts with raw reads`

---

### Task 7: Certificate metadata and ERC-165 (replaces `// [[metadata]]`)

**Files:**
- Modify: `contracts/src/BasanosRegistry.sol`
- Test: `contracts/test/Metadata.t.sol`

**Depends on:** Task 2, Task 3, Task 5, Task 6
**Effort:** medium
**Provides:** `tokenURI(uint256 tokenId) returns (string) — data:application/json;base64, of {"name":"Basanos Certificate #<id>","description":"Every certificate is chain-checked at mint; every verdict is replayable.","external_url":"<baseUrl><id>","attributes":[rulebook, startBlock, endBlock, startEquity, endEquity]}`, `supportsInterface(bytes4 id) returns (bool) — 0x01ffc9a7, 0x80ac58cd, 0x5b5e139f, 0xb45a3c0e`
**Requires:** `contract BasanosRegistry (with anchors // [[oracle]], // [[pass]], // [[fail-void]], // [[metadata]])`, `library Base64 { encode(bytes memory data) internal pure returns (string memory) }`, `recordPass(uint256 runId) payable (referee only; checks min time, time limit, flat, grant, priceable, equity >= target; mints tokenId = runId)`, `abstract contract Fixture is Test (bank, pool, agents, registry, referee, trader, stranger, DEMO, START, _deploy(), _grant(address,bool), _start())`

- [ ] **Step 1: Write the failing test**

`contracts/test/Metadata.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BasanosRegistry} from "../src/BasanosRegistry.sol";
import {Fixture} from "./Fixture.sol";

contract MetadataTest is Fixture {
    function test_TokenUriIsBase64JsonFromTheChainCheckedReads() public {
        vm.roll(100);
        uint256 runId = _start();
        bank.setEquity(trader, true, 1_006e18);
        vm.warp(block.timestamp + 61);
        vm.roll(250);
        vm.prank(referee);
        registry.recordPass(runId);
        string memory json = string.concat(
            '{"name":"Basanos Certificate #1",',
            '"description":"Every certificate is chain-checked at mint; every verdict is replayable.",',
            '"external_url":"https://basanos.example/app/#/cert/1","attributes":[',
            '{"trait_type":"rulebook","value":"',
            vm.toString(DEMO),
            '"},{"trait_type":"startBlock","value":100},{"trait_type":"endBlock","value":250},',
            '{"trait_type":"startEquity","value":"1000000000000000000000"},',
            '{"trait_type":"endEquity","value":"1006000000000000000000"}]}'
        );
        assertEq(registry.tokenURI(runId), string.concat("data:application/json;base64,", vm.toBase64(bytes(json))));
    }

    function test_TokenUriRevertsForAnUnmintedId() public {
        vm.expectRevert(BasanosRegistry.NonexistentToken.selector);
        registry.tokenURI(1);
    }

    function test_SupportsErc165Erc721MetadataAndErc5192() public view {
        assertTrue(registry.supportsInterface(0x01ffc9a7));
        assertTrue(registry.supportsInterface(0x80ac58cd));
        assertTrue(registry.supportsInterface(0x5b5e139f));
        assertTrue(registry.supportsInterface(0xb45a3c0e));
        assertFalse(registry.supportsInterface(0xffffffff));
    }

    function test_NameAndSymbol() public view {
        assertEq(registry.name(), "Basanos Certificate");
        assertEq(registry.symbol(), "BSNC");
    }
}
```

- [ ] **Step 2: Run to confirm it fails**
Run: `node contracts/script/forge.mjs test --match-contract MetadataTest`
Expected: FAIL — compiler error `Member "tokenURI" not found`.

- [ ] **Step 3: Replace the line `    // [[metadata]]` in `contracts/src/BasanosRegistry.sol` with:**
```solidity
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
```

- [ ] **Step 4: Run the whole contract suite (the gate)**
Run: `node contracts/script/forge.mjs test`
Expected: PASS — `Ran 7 test suites` and every suite `ok` (36 tests passed, 0 failed).

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `feat(contracts): base64 certificate metadata and ERC-165`

---

### Task 8: Export the registry ABI and rulebook registration args into `@basanos/core`

**Files:**
- Create: `contracts/script/export-abi.mjs`
- Create: `packages/core/src/abi/basanosRegistry.ts`
- Create: `packages/core/src/registry.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/registry.test.ts`

**Depends on:** Task 1, Task 7, spike:Task 3, spike:Task 6
**Effort:** low
**Provides:** `basanosRegistryAbi (as const, generated from the forge artifact)`, `type RegisterArgs = readonly [Hex, Address, number, number, number, string]`, `registerArgs(rb: Rulebook): RegisterArgs`, `RUN_STATUS = ["None", "Active", "Passed", "Failed", "Voided"]`, `RULE_NAMES = ["None", "DailyLoss", "TrailingDrawdown", "MaxExposure", "TimeLimit", "Liquidated"]`, `VOID_REASONS = ["None", "Flow", "ForeignMarket", "GrantRevoked"]`, `PREVIEW_CODES = ["ok", "unknown rulebook", "active run exists", "grant missing", "not flat", "unpriceable", "non-positive equity"]`, `CLI: node contracts/script/export-abi.mjs (after forge build)`
**Requires:** `interface Rulebook`, `rulebookId(rb: Rulebook): Hex`, `loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook`, `CLI: node contracts/script/forge.mjs <forge args> (installs forge-std v1.16.2 on demand, adds --root contracts)`, `tokenURI(uint256 tokenId) returns (string) — data:application/json;base64, of {"name":"Basanos Certificate #<id>","description":"Every certificate is chain-checked at mint; every verdict is replayable.","external_url":"<baseUrl><id>","attributes":[rulebook, startBlock, endBlock, startEquity, endEquity]}`

The core `index.ts` must keep every earlier export (`config`, `abi`, `rulebook`, `snapshot`, `watch`, `close`) and add the two new modules.

- [ ] **Step 1: Write the export script**

`contracts/script/export-abi.mjs`:
```js
// Writes the BasanosRegistry ABI from the forge artifact into @basanos/core. Run after `forge build`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const artifactPath = fileURLToPath(new URL("../out/BasanosRegistry.sol/BasanosRegistry.json", import.meta.url));
const outPath = fileURLToPath(new URL("../../packages/core/src/abi/basanosRegistry.ts", import.meta.url));
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  `// Generated by contracts/script/export-abi.mjs from the forge artifact. Do not edit by hand.\n` +
    `export const basanosRegistryAbi = ${JSON.stringify(artifact.abi, null, 2)} as const;\n`,
);
console.log(`wrote ${outPath} (${artifact.abi.length} ABI entries)`);
```

- [ ] **Step 2: Build and export**
Run: `node contracts/script/forge.mjs build`
Expected: `Compiler run successful`.
Run: `node contracts/script/export-abi.mjs`
Expected: `wrote …packages/core/src/abi/basanosRegistry.ts (<N> ABI entries)`.

- [ ] **Step 3: Write the failing test**

`packages/core/test/registry.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { basanosRegistryAbi } from "../src/abi/basanosRegistry";
import { PREVIEW_CODES, RULE_NAMES, RUN_STATUS, VOID_REASONS, registerArgs } from "../src/registry";
import { rulebookId } from "../src/rulebook";
import { loadRulebook } from "../src/node";

describe("basanosRegistryAbi", () => {
  it("carries the spec §6.2 surface", () => {
    const fns = new Set<string>(basanosRegistryAbi.filter((e) => e.type === "function").map((e) => ("name" in e ? e.name : "")));
    for (const name of [
      "registerRulebook",
      "getRulebook",
      "previewStart",
      "startRun",
      "recordPass",
      "recordFail",
      "recordVoid",
      "voidRevoked",
      "handleOracle",
      "getRun",
      "getCloseTxs",
      "getActiveRunIds",
      "activeRunOf",
      "runCount",
      "tokenURI",
      "ownerOf",
      "setBaseUrl",
      "withdraw",
    ]) {
      expect(fns.has(name), name).toBe(true);
    }
    const events = new Set<string>(basanosRegistryAbi.filter((e) => e.type === "event").map((e) => ("name" in e ? e.name : "")));
    expect(events.has("RunStarted")).toBe(true);
    expect(events.has("RunPassed")).toBe(true);
    expect(events.has("RunFailed")).toBe(true);
  });
});

describe("registerArgs", () => {
  it("maps a rulebook to registerRulebook arguments", () => {
    // Distinct pinned numbers keep the field order checkable when referee Task 10 raises the demo target;
    // the oracle symbol comes from the rulebook itself (the spike's oracle probe may change its format).
    const rb = { ...loadRulebook("tokyo-sprint-demo"), profitTargetBps: 51, minDurationSec: 61, timeLimitSec: 901 };
    expect(registerArgs(rb)).toEqual([rulebookId(rb), rb.market.pool, 51, 61, 901, rb.oracleSymbol]);
  });
  it("names enum values in contract order", () => {
    expect(RUN_STATUS[2]).toBe("Passed");
    expect(RULE_NAMES[1]).toBe("DailyLoss");
    expect(VOID_REASONS[3]).toBe("GrantRevoked");
    expect(PREVIEW_CODES[3]).toBe("grant missing");
  });
});
```

- [ ] **Step 4: Run to confirm it fails**
Run: `npm test -w @basanos/core -- test/registry.test.ts`
Expected: FAIL — `Failed to resolve import "../src/registry"`.

- [ ] **Step 5: Write the implementation**

`packages/core/src/registry.ts`:
```ts
import type { Address, Hex } from "viem";
import { rulebookId, type Rulebook } from "./rulebook";

export type RegisterArgs = readonly [Hex, Address, number, number, number, string];

export function registerArgs(rb: Rulebook): RegisterArgs {
  return [rulebookId(rb), rb.market.pool, rb.profitTargetBps, rb.minDurationSec, rb.timeLimitSec, rb.oracleSymbol] as const;
}

export const RUN_STATUS = ["None", "Active", "Passed", "Failed", "Voided"] as const;
export const RULE_NAMES = ["None", "DailyLoss", "TrailingDrawdown", "MaxExposure", "TimeLimit", "Liquidated"] as const;
export const VOID_REASONS = ["None", "Flow", "ForeignMarket", "GrantRevoked"] as const;
export const PREVIEW_CODES = [
  "ok",
  "unknown rulebook",
  "active run exists",
  "grant missing",
  "not flat",
  "unpriceable",
  "non-positive equity",
] as const;
```

Replace `packages/core/src/index.ts` with:
```ts
export const BASANOS = "basanos" as const;
export * from "./config";
export * from "./abi";
export * from "./rulebook";
export * from "./snapshot";
export * from "./watch";
export * from "./close";
export * from "./registry";
export * from "./abi/basanosRegistry";
```

- [ ] **Step 6: Run to confirm it passes (the gate)**
Run: `npm test -w @basanos/core -- test/registry.test.ts`
Expected: PASS — `3 passed`.

- [ ] **Step 7: Commit (kernel-performed — no agent runs this)**
Message: `feat(core): registry ABI export and rulebook registration args`

---

### Task 9: Deploy, deployment-check, live-preview and bytecode-verify scripts

**Files:**
- Create: `contracts/script/tsconfig.json`
- Create: `contracts/script/deploy.ts`
- Create: `contracts/script/check-deployment.ts`
- Create: `contracts/script/preview-live.ts`
- Create: `contracts/script/verify-bytecode.ts`

**Depends on:** Task 1, Task 8, spike:Task 1, spike:Task 2, spike:Task 3, spike:Task 7
**Effort:** high
**Model tier:** top
**Provides:** `CLI: npx tsx contracts/script/deploy.ts [--dry-run] (REFEREE_PK deploys and owns; registers tokyo-sprint and tokyo-sprint-demo; writes deployments/hideki.json)`, `deployments/hideki.json shape: { chainId, registry, deployTx, deployBlock, owner, referee, marginBank, somniaAgents, baseUrl, solc, evmVersion, viaIr, deployGasUsed, deployCostWei, rulebooks: [{ name, id, tx, status, gasUsed }] }`, `CLI: npx tsx contracts/script/check-deployment.ts -> PASS deployment`, `CLI: npx tsx contracts/script/preview-live.ts -> writes docs/evidence/r5-preview.json, prints PASS r5-preview`, `CLI: npx tsx contracts/script/verify-bytecode.ts [--explorer] -> writes docs/evidence/verify.json, prints PASS verify`
**Requires:** `basanosRegistryAbi (as const, generated from the forge artifact)`, `registerArgs(rb: Rulebook): RegisterArgs`, `PREVIEW_CODES = ["ok", "unknown rulebook", "active run exists", "grant missing", "not flat", "unpriceable", "non-positive equity"]`, `CHAIN (hidekiTestnet, id 50383)`, `MARGIN_BANK`, `SOMNIA_AGENTS`, `explorerTx(hash: Hex): string`, `loadDotEnv(path?: string): boolean`, `requirePrivateKey(name: SecretName, env?: NodeJS.ProcessEnv): Hex`, `requireAddress(name: AddressName, env?: NodeJS.ProcessEnv): Address`, `rpcHttp(env?: NodeJS.ProcessEnv): string`, `repoPath(rel: string): string`, `loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook`, `marketsFor(pk?: Hex): SomniaMarkets`, `CLI: node contracts/script/forge.mjs <forge args> (installs forge-std v1.16.2 on demand, adds --root contracts)`

Key safety: `deploy.ts` reads `REFEREE_PK` only through `requirePrivateKey` and never prints it. The other three scripts need no key. This task only writes code and type-checks it; task 10 deploys under a human gate.

- [ ] **Step 1: Write the script tsconfig**

`contracts/script/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["*.ts"]
}
```

- [ ] **Step 2: Write `deploy.ts`**

`contracts/script/deploy.ts`:
```ts
// Deploys BasanosRegistry with the referee burner as owner and referee, then registers both Tokyo Sprint
// variants. --dry-run prints the plan and sends nothing. Run `node contracts/script/forge.mjs build` first.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, MARGIN_BANK, SOMNIA_AGENTS, basanosRegistryAbi, explorerTx, registerArgs } from "@basanos/core";
import { loadDotEnv, loadRulebook, repoPath, requirePrivateKey, rpcHttp } from "@basanos/core/node";

loadDotEnv(repoPath(".env"));
const dryRun = process.argv.includes("--dry-run");
const CERT_BASE_URL = "https://basanos.vercel.app/app/#/cert/";
const artifact = JSON.parse(readFileSync(repoPath("contracts/out/BasanosRegistry.sol/BasanosRegistry.json"), "utf8")) as {
  bytecode: { object: Hex };
};
const account = privateKeyToAccount(requirePrivateKey("REFEREE_PK"));
const client = createPublicClient({ chain: CHAIN, transport: http(rpcHttp()) });
const wallet = createWalletClient({ account, chain: CHAIN, transport: http(rpcHttp()) });
const books = (["tokyo-sprint", "tokyo-sprint-demo"] as const).map((name) => ({ name, args: registerArgs(loadRulebook(name)) }));

console.log(`deployer = owner = referee: ${account.address}; balance ${await client.getBalance({ address: account.address })} wei`);
for (const b of books) {
  console.log(`rulebook ${b.name}: id ${b.args[0]} pool ${b.args[1]} target ${b.args[2]}bps min ${b.args[3]}s limit ${b.args[4]}s oracle ${b.args[5]}`);
}
if (dryRun) {
  console.log("dry-run: no transaction sent");
  process.exit(0);
}

const deployTx = await wallet.deployContract({
  abi: basanosRegistryAbi,
  bytecode: artifact.bytecode.object,
  args: [MARGIN_BANK, SOMNIA_AGENTS, account.address, CERT_BASE_URL],
});
const deployReceipt = await client.waitForTransactionReceipt({ hash: deployTx });
if (deployReceipt.status !== "success" || !deployReceipt.contractAddress) {
  console.error(`deploy failed: ${explorerTx(deployTx)} (if the chain rejected cancun bytecode, set evm_version = "paris" and rebuild)`);
  process.exit(1);
}
const registry = deployReceipt.contractAddress;
const rulebooks: { name: string; id: Hex; tx: Hex; status: string; gasUsed: string }[] = [];
for (const b of books) {
  const tx = await wallet.writeContract({ address: registry, abi: basanosRegistryAbi, functionName: "registerRulebook", args: [...b.args] });
  const r = await client.waitForTransactionReceipt({ hash: tx });
  rulebooks.push({ name: b.name, id: b.args[0], tx, status: r.status, gasUsed: r.gasUsed.toString() });
}
const out = {
  chainId: CHAIN.id,
  registry,
  deployTx,
  deployBlock: deployReceipt.blockNumber.toString(),
  owner: account.address,
  referee: account.address,
  marginBank: MARGIN_BANK,
  somniaAgents: SOMNIA_AGENTS,
  baseUrl: CERT_BASE_URL,
  solc: "0.8.28",
  evmVersion: "cancun",
  viaIr: true,
  deployGasUsed: deployReceipt.gasUsed.toString(),
  deployCostWei: (deployReceipt.gasUsed * deployReceipt.effectiveGasPrice).toString(),
  rulebooks,
};
mkdirSync(dirname(repoPath("deployments/hideki.json")), { recursive: true });
writeFileSync(repoPath("deployments/hideki.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(`registry ${registry} — ${explorerTx(deployTx)}`);
console.log("next: put REGISTRY_ADDRESS=<registry> into .env");
process.exit(0);
```

- [ ] **Step 3: Write `check-deployment.ts`**

`contracts/script/check-deployment.ts`:
```ts
import { readFileSync } from "node:fs";
import { createPublicClient, getAddress, http, type Address, type Hex } from "viem";
import { CHAIN, basanosRegistryAbi } from "@basanos/core";
import { repoPath, rpcHttp } from "@basanos/core/node";

interface Deployment {
  registry: Address;
  referee: Address;
  rulebooks: { name: string; id: Hex; status: string }[];
}
const dep = JSON.parse(readFileSync(repoPath("deployments/hideki.json"), "utf8")) as Deployment;
const client = createPublicClient({ chain: CHAIN, transport: http(rpcHttp()) });
const problems: string[] = [];
const code = await client.getCode({ address: dep.registry });
if (!code || code === "0x") problems.push("no code at the registry address");
const referee = await client.readContract({ address: dep.registry, abi: basanosRegistryAbi, functionName: "referee" });
if (getAddress(referee) !== getAddress(dep.referee)) problems.push(`referee() is ${referee}, expected ${dep.referee}`);
if (dep.rulebooks.length !== 2) problems.push("expected two registered rulebooks");
for (const rb of dep.rulebooks) {
  const params = await client.readContract({ address: dep.registry, abi: basanosRegistryAbi, functionName: "getRulebook", args: [rb.id] });
  if (!params.exists) problems.push(`rulebook ${rb.name} (${rb.id}) is not registered`);
}
for (const p of problems) console.log(`FAIL ${p}`);
console.log(problems.length === 0 ? "PASS deployment" : "FAIL deployment");
process.exit(problems.length === 0 ? 0 : 1);
```

- [ ] **Step 4: Write `preview-live.ts` (R5: one live gate against the real MarginBank, zero STT)**

`contracts/script/preview-live.ts`:
```ts
// R5: calls the deployed registry's previewStart for account A at a pinned block and compares its in-contract
// MarginBank reads with the SDK's getAccountEquity at the same block. Read-only; needs ACCOUNT_A_ADDRESS.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { CHAIN, MARGIN_BANK, PREVIEW_CODES, basanosRegistryAbi } from "@basanos/core";
import { loadDotEnv, repoPath, requireAddress, rpcHttp } from "@basanos/core/node";
import { marketsFor } from "../../packages/spike/src/rpc";

loadDotEnv(repoPath(".env"));
const dep = JSON.parse(readFileSync(repoPath("deployments/hideki.json"), "utf8")) as {
  registry: Address;
  rulebooks: { name: string; id: Hex }[];
};
const demo = dep.rulebooks.find((r) => r.name === "tokyo-sprint-demo");
if (!demo) throw new Error("deployments/hideki.json has no tokyo-sprint-demo");
const account = requireAddress("ACCOUNT_A_ADDRESS");
const client = createPublicClient({ chain: CHAIN, transport: http(rpcHttp()) });
const block = (await client.getBlockNumber()) - 2n;
const [code, read] = await client.readContract({
  address: dep.registry,
  abi: basanosRegistryAbi,
  functionName: "previewStart",
  args: [account, demo.id],
  blockNumber: block,
});
const sdk = await marketsFor().client.getAccountEquity(account, { scope: "perps", marginBank: MARGIN_BANK, blockNumber: block });
const match = code === 0 && read.equity === sdk.equity && read.lockedCollateral === sdk.lockedCollateral;
const evidence = {
  evidence: "r5-preview",
  writtenAt: new Date().toISOString(),
  registry: dep.registry,
  account,
  block: block.toString(),
  code,
  codeName: PREVIEW_CODES[code] ?? `code ${code}`,
  read: {
    blockNumber: read.blockNumber.toString(),
    equityOk: read.equityOk,
    equity: read.equity.toString(),
    lockedCollateral: read.lockedCollateral.toString(),
    positionSize: read.positionSize.toString(),
    markOk: read.markOk,
    markPrice: read.markPrice.toString(),
  },
  sdk: { equity: sdk.equity.toString(), lockedCollateral: sdk.lockedCollateral.toString(), asOfBlock: sdk.asOfBlock.toString() },
  match,
};
mkdirSync(dirname(repoPath("docs/evidence/r5-preview.json")), { recursive: true });
writeFileSync(repoPath("docs/evidence/r5-preview.json"), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(match ? "PASS r5-preview" : `FAIL r5-preview (code ${code} ${PREVIEW_CODES[code] ?? ""}; registry ${read.equity} vs sdk ${sdk.equity})`);
process.exit(match ? 0 : 1);
```

- [ ] **Step 5: Write `verify-bytecode.ts`**

`contracts/script/verify-bytecode.ts`:
```ts
// Matches the on-chain runtime code against the forge artifact with immutable slots masked (independent of
// the explorer). --explorer additionally tries `forge verify-contract` against the Tokyo explorer and records
// its output; that attempt never decides the result.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { CHAIN } from "@basanos/core";
import { repoPath, rpcHttp } from "@basanos/core/node";

interface Artifact {
  deployedBytecode: { object: Hex; immutableReferences?: Record<string, { start: number; length: number }[]> };
}
const dep = JSON.parse(readFileSync(repoPath("deployments/hideki.json"), "utf8")) as { registry: Address };
const artifact = JSON.parse(readFileSync(repoPath("contracts/out/BasanosRegistry.sol/BasanosRegistry.json"), "utf8")) as Artifact;
const client = createPublicClient({ chain: CHAIN, transport: http(rpcHttp()) });
const onchain = (await client.getCode({ address: dep.registry })) ?? "0x";
const local = artifact.deployedBytecode.object;
const refs = Object.values(artifact.deployedBytecode.immutableReferences ?? {}).flat();
let masked = onchain.slice(2);
for (const r of refs) {
  masked = masked.slice(0, r.start * 2) + "0".repeat(r.length * 2) + masked.slice((r.start + r.length) * 2);
}
const match = masked.toLowerCase() === local.slice(2).toLowerCase();
let explorer: { attempted: boolean; status: number | null; output: string } = { attempted: false, status: null, output: "" };
if (process.argv.includes("--explorer")) {
  const res = spawnSync(
    "forge",
    [
      "verify-contract",
      dep.registry,
      "src/BasanosRegistry.sol:BasanosRegistry",
      "--root",
      repoPath("contracts"),
      "--chain-id",
      "50383",
      "--verifier",
      "blockscout",
      "--verifier-url",
      "https://explorer.testnet.somnia.network/tokyo/api/",
      "--rpc-url",
      rpcHttp(),
      "--guess-constructor-args",
    ],
    { encoding: "utf8" },
  );
  explorer = { attempted: true, status: res.status, output: `${res.stdout ?? ""}${res.stderr ?? ""}`.slice(0, 4000) };
}
const evidence = {
  evidence: "verify",
  writtenAt: new Date().toISOString(),
  registry: dep.registry,
  runtimeBytes: (onchain.length - 2) / 2,
  immutableSlots: refs.length,
  match,
  explorer,
};
mkdirSync(dirname(repoPath("docs/evidence/verify.json")), { recursive: true });
writeFileSync(repoPath("docs/evidence/verify.json"), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(match ? "PASS verify" : "FAIL verify (runtime bytecode differs from the artifact)");
process.exit(match ? 0 : 1);
```

- [ ] **Step 6: Type-check the scripts (the gate)**
Run: `npx tsc -p contracts/script/tsconfig.json`
Expected: PASS — exits 0 with no output.

- [ ] **Step 7: Commit (kernel-performed — no agent runs this)**
Message: `feat(contracts): deploy, deployment check, live preview and bytecode verify scripts`

---

### Task 10: LIVE — deploy the registry on Hideki and register Tokyo Sprint

**Files:**
- Create: `deployments/hideki.json`
- Modify: `rulebooks/tokyo-sprint.json`
- Modify: `rulebooks/tokyo-sprint-demo.json`
- Modify: `contracts/foundry.toml`

**Depends on:** Task 1, Task 9, spike:Task 12
**Effort:** medium
**Model tier:** top
**Provides:** `deployments/hideki.json (registry address, deploy block, rulebook ids)`, `REGISTRY_ADDRESS in .env (set by the human)`
**Requires:** `CLI: npx tsx contracts/script/deploy.ts [--dry-run] (REFEREE_PK deploys and owns; registers tokyo-sprint and tokyo-sprint-demo; writes deployments/hideki.json)`, `CLI: npx tsx contracts/script/check-deployment.ts -> PASS deployment`, `CLI: node contracts/script/forge.mjs <forge args> (installs forge-std v1.16.2 on demand, adds --root contracts)`

**Human-gated (deploy).** Spends STT from the referee burner (`REFEREE_PK`); top it up to about 1 STT first. The two rulebook files and `foundry.toml` are declared because two fallbacks may edit them; if neither applies, they stay unchanged.

**Hold for the oracle probe (guide, 2026-11-11): do not deploy until the guide gives the deploy GO.**
- That GO waits for the result of oracle probe P1 (spike:16's `oracle-probe.ts --symbols BTC/USDC:PERP`, run by the gate-concierge on the user's GO).
- If P1 fails and the guide approves it, the GO also waits for P2 (`--advanced`). A P2 result can change the registry's oracle call (`createAdvancedRequest`, Threshold) before deploy.
- This is an ordering rule the guide holds, not a manifest dependency on a human result.

- [ ] **Step 1: Apply the oracle-symbol fallback if the spike calls for it**
Open `docs/evidence/g1d-oracle.json`. If `BTC/USDC:PERP` has `numSources: 0` and `BTC/USDC` has `numSources > 0`, set `"oracleSymbol": "BTC/USDC"` in both `rulebooks/tokyo-sprint.json` and `rulebooks/tokyo-sprint-demo.json`. Otherwise leave both files unchanged.

- [ ] **Step 2: Build and dry-run**
Run: `node contracts/script/forge.mjs build`
Expected: `Compiler run successful`.
Run: `npx tsx contracts/script/deploy.ts --dry-run`
Expected: one `deployer = owner = referee: 0x…` line, two `rulebook …` lines, then `dry-run: no transaction sent`.

- [ ] **Step 3: Deploy**
Run: `npx tsx contracts/script/deploy.ts`
Expected: `registry 0x… — https://explorer.testnet.somnia.network/tokyo/tx/0x…`. If it prints `deploy failed` and the receipt reverted at creation, set `evm_version = "paris"` in `contracts/foundry.toml`, rebuild, and run Step 2 and Step 3 again (record the change in the deployment's notes for the README). Then put `REGISTRY_ADDRESS=<registry>` into `.env`.

- [ ] **Step 4: Check the deployment (the gate)**
Run: `npx tsx contracts/script/check-deployment.ts`
Expected: PASS — `PASS deployment`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `chore(deploy): BasanosRegistry on Hideki with Tokyo Sprint rulebooks`

---

### Task 11: LIVE read-only — R5 previewStart against the real MarginBank

**Files:**
- Create: `docs/evidence/r5-preview.json`

**Depends on:** Task 9, Task 10
**Effort:** low
**Provides:** `docs/evidence/r5-preview.json (code 0 for account A, registry reads == SDK getAccountEquity at the same block)`
**Requires:** `CLI: npx tsx contracts/script/preview-live.ts -> writes docs/evidence/r5-preview.json, prints PASS r5-preview`, `deployments/hideki.json (registry address, deploy block, rulebook ids)`

Read-only: no key, no STT. It needs `ACCOUNT_A_ADDRESS` in `.env`, and account A must be flat with the referee grant from spike task 11. Code `3` (grant missing) or `4` (not flat) means account A's state changed; fix the state, not the script.

- [ ] **Step 1: Run the live preview (the gate)**
Run: `npx tsx contracts/script/preview-live.ts`
Expected: PASS — `PASS r5-preview`.

- [ ] **Step 2: Commit (kernel-performed — no agent runs this)**
Message: `docs(evidence): R5 previewStart matches the SDK against the real MarginBank`

---

### Task 12: Verify the deployed bytecode (and try the explorer)

**Files:**
- Create: `docs/evidence/verify.json`

**Depends on:** Task 9, Task 10
**Effort:** low
**Provides:** `docs/evidence/verify.json (runtime bytecode match with immutables masked; explorer attempt output)`
**Requires:** `CLI: npx tsx contracts/script/verify-bytecode.ts [--explorer] -> writes docs/evidence/verify.json, prints PASS verify`, `deployments/hideki.json (registry address, deploy block, rulebook ids)`

No key is involved. The explorer attempt is advisory. If it fails for a reason other than bot-kit #36 (osaka), the failure is a feedback candidate for the ship plan.

- [ ] **Step 1: Build so the artifact matches the deployed compile**
Run: `node contracts/script/forge.mjs build`
Expected: `Compiler run successful` (or `No files changed, compilation skipped`).

- [ ] **Step 2: Verify (the gate)**
Run: `npx tsx contracts/script/verify-bytecode.ts --explorer`
Expected: PASS — `PASS verify`.

- [ ] **Step 3: Commit (kernel-performed — no agent runs this)**
Message: `docs(evidence): BasanosRegistry runtime bytecode matches the artifact`
