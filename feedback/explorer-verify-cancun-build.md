# The Tokyo explorer cannot verify a cancun build: forge verify-contract fails with "Not available: the explorer cannot answer this request right now"
Severity: normal
Area: app

## Steps to reproduce
1. Deploy a contract compiled with `evm_version = "cancun"` (solc 0.8.28, optimizer 200 runs, via_ir) to Hideki. Ours is `0xf5D8099239200DF961E0910A42C105214D1E9370`; its runtime bytecode matches the local artifact once the 17 immutable slots are masked.
2. Run the same command that `contracts/script/verify-bytecode.ts --explorer` runs:
   `forge verify-contract 0xf5D8099239200DF961E0910A42C105214D1E9370 src/BasanosRegistry.sol:BasanosRegistry --root contracts --chain-id 50383 --verifier blockscout --verifier-url https://explorer.testnet.somnia.network/tokyo/api/ --rpc-url https://api.hideki.infra.testnet.somnia.network --guess-constructor-args`

## Expected
The explorer verifies the contract, or says why it cannot. A cancun build is a target bot-kit #36 reports as verifying (on the other chain's explorer), and this is not the osaka case in that issue.

## Actual
`forge` identifies the constructor arguments, then fails with "Failed to obtain contract ABI". The explorer's contract API answers HTTP 200 with `status 0` and "Not available: the explorer cannot answer this request right now". The same answer comes back from `getabi` and `getsourcecode` for other deployed addresses (the MarginBank `0x478769E1177C0773c43A593DCCc4Ad15F15F1394` and USDso `0xed7993A74dAe1e6656B704A424DcD8711aAf4F72`), while `module=block&action=eth_block_number` and `module=account&action=balance` on the same API answer normally. So no verified-source page is possible on the Tokyo explorer, and the message reads as a transient outage.

## Evidence
`explorer.output` from `docs/evidence/verify.json` (written 2026-11-11T13:45:06Z; `explorer.attempted: true`, `explorer.status: 1`; the same file records `"runtimeBytes": 15197, "immutableSlots": 17, "match": true`):

```
Start verifying contract `0xf5D8099239200DF961E0910A42C105214D1E9370` deployed on 50383
Identified constructor arguments: 000000000000000000000000478769e1177c0773c43a593dccc4ad15f15f13940000000000000000000000007407cb35a17d511d1bd32dd726adb8d5344ecbe3000000000000000000000000e358d82209ea9360f411a041c0200adc385877eb0000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000002668747470733a2f2f626173616e6f732e76657263656c2e6170702f6170702f232f636572742f0000000000000000000000000000000000000000000000000000
Error: Failed to obtain contract ABI for 0xf5D8099239200DF961E0910A42C105214D1E9370

Context:
- Response result is unexpectedly empty: status=0, message=Not available: the explorer cannot answer this request right now
```

Read-only re-check of the explorer API on 2026-11-11 at about 13:57 UTC (`...` is `https://explorer.testnet.somnia.network/tokyo`):

```
$ curl -s -w ' [HTTP %{http_code}]' '.../api/?module=contract&action=getabi&address=0xf5D8099239200DF961E0910A42C105214D1E9370'
{"message":"Not available: the explorer cannot answer this request right now","result":null,"status":"0"} [HTTP 200]
$ curl -s '.../api/?module=contract&action=getabi&address=0x478769E1177C0773c43A593DCCc4Ad15F15F1394'
{"message":"Not available: the explorer cannot answer this request right now","result":null,"status":"0"}
$ curl -s '.../api/?module=block&action=eth_block_number'
{"jsonrpc":"2.0","result":"0x2d4fdd4","id":1}
```

## Environment
SDK version 0.33.0, network Somnia Tokyo testnet (Hideki, chain 50383), wallet address: read-only (no wallet needed)
