# Tokyo testnet explorer: every contract API call answers "Not available", and the v2 smart-contract endpoints return 404
Severity: normal
Area: API

## Steps to reproduce
1. Use the Tokyo testnet explorer API that the Somnia docs give for verification ("Verifying via explorer": `https://explorer.testnet.somnia.network/tokyo/api`, Etherscan-compatible).
2. Call the contract module for any contract, e.g. `GET …/tokyo/api?module=contract&action=getabi&address=0x478769E1177C0773c43A593DCCc4Ad15F15F1394` (the dreamDEX MarginBank) or `action=getsourcecode`.
3. For comparison, call another module on the same API, e.g. `module=account&action=balance` or `module=transaction&action=gettxreceiptstatus`.
4. Call the Blockscout v2 endpoints `…/tokyo/api/v2/smart-contracts/verification/config` and `…/tokyo/api/v2/smart-contracts/<address>`.
5. Run `forge verify-contract` against the same API for a freshly deployed contract.

## Expected
- `getabi` and `getsourcecode` return the ABI and source for a verified contract. For an unverified one they return the standard "Contract source code not verified" answer, which verification tools understand.
- The v2 verification config lists the supported methods.
- A verification run can reach the submission step.

## Actual
- **The contract module is down:** every `getabi` and `getsourcecode` call answers `{"message":"Not available: the explorer cannot answer this request right now","result":null,"status":"0"}`. This held for four addresses: our new BasanosRegistry and three existing contracts, the dreamDEX MarginBank, USDso and SomniaAgents.
- **The rest of the API works:** on the same API, `account/balance` and `transaction/gettxreceiptstatus` answer normally, and v2 `stats` and `addresses/<address>` answer (the registry shows `is_verified: false`).
- **The v2 smart-contract endpoints return 404:** `/api/v2/smart-contracts/verification/config` and `/api/v2/smart-contracts/<address>` both return HTTP 404 `{"message":"Not found"}`, for the registry, the MarginBank and the VoucherDistributor implementation alike.
- **The verifier stops early:** `forge verify-contract` (Foundry 1.7.1, `--verifier blockscout`, `--verifier-url https://explorer.testnet.somnia.network/tokyo/api/`) identified the constructor arguments, then stopped with `Failed to obtain contract ABI … message=Not available: the explorer cannot answer this request right now` before submitting anything.
- **It is persistent, not a blip:** we saw the same answer at about 03:22 UTC (a read during another investigation), at 13:45 UTC (the forge run) and at 14:08 UTC (the calls below).
- **Not the same as bot-kit #36:** that issue is about the verifier advertising `osaka`. This build is `cancun`, and the failure happens before any compiler choice.
- **Not tried:** the documented `--verifier etherscan` flow, and posting to Sourcify directly. Both submit source, and we did not submit; so this item does not claim that verification is impossible, only that the contract API does not answer.

## Evidence
`curl` output, 2026-11-11 14:08 UTC:

```
$ GET https://explorer.testnet.somnia.network/tokyo/api?module=contract&action=getabi&address=<A>
0xf5D8099239200DF961E0910A42C105214D1E9370 getabi -> {"message":"Not available: the explorer cannot answer this request right now","result":null,"status":"0"}
0xf5D8099239200DF961E0910A42C105214D1E9370 getsourcecode -> {"message":"Not available: the explorer cannot answer this request right now","result":null,"status":"0"}
0x478769E1177C0773c43A593DCCc4Ad15F15F1394 getabi -> {"message":"Not available: the explorer cannot answer this request right now","result":null,"status":"0"}
0x478769E1177C0773c43A593DCCc4Ad15F15F1394 getsourcecode -> {"message":"Not available: the explorer cannot answer this request right now","result":null,"status":"0"}
0xed7993A74dAe1e6656B704A424DcD8711aAf4F72 getabi -> {"message":"Not available: the explorer cannot answer this request right now","result":null,"status":"0"}
0xed7993A74dAe1e6656B704A424DcD8711aAf4F72 getsourcecode -> {"message":"Not available: the explorer cannot answer this request right now","result":null,"status":"0"}
0x7407cb35a17D511D1Bd32dD726ADb8D5344ECbE3 getabi -> {"message":"Not available: the explorer cannot answer this request right now","result":null,"status":"0"}
0x7407cb35a17D511D1Bd32dD726ADb8D5344ECbE3 getsourcecode -> {"message":"Not available: the explorer cannot answer this request right now","result":null,"status":"0"}

$ the same API, other modules
module=account&action=balance&address=0xE358D82209ea9360F411A041C0200adc385877eb -> {"message":"OK","result":"1677814316598200000","status":"1"}
module=transaction&action=gettxreceiptstatus&txhash=0x0046bcd478e0bb69db882a2b0da3ca15d34f73f2abbd1ed6bfbbf5c63d513190 -> {"message":"OK","result":{"status":"1"},"status":"1"}

$ Blockscout v2
v2/stats -> HTTP 200 {"total_blocks":"47519994","total_transactions":"299597962",…}
v2/smart-contracts/verification/config -> HTTP 404 {"message":"Not found"}
v2/addresses/0xf5D8099239200DF961E0910A42C105214D1E9370 -> HTTP 200 {"hash":"0xf5D8099239200DF961E0910A42C105214D1E9370","name":null,"is_contract":true,"is_verified":false,…}
v2/smart-contracts/0xf5D8099239200DF961E0910A42C105214D1E9370 -> HTTP 404 {"message":"Not found"}
v2/smart-contracts/0x9657f0fd53efc01cd108d93c835bb4b517732b43 -> HTTP 404 {"message":"Not found"}
v2/smart-contracts/0x478769E1177C0773c43A593DCCc4Ad15F15F1394 -> HTTP 404 {"message":"Not found"}
```

`forge verify-contract` output, 2026-11-11 13:45 UTC (recorded in `docs/evidence/verify.json`):

```
Start verifying contract `0xf5D8099239200DF961E0910A42C105214D1E9370` deployed on 50383
Identified constructor arguments: 000000000000000000000000478769e1177c0773c43a593dccc4ad15f15f1394…
Error: Failed to obtain contract ABI for 0xf5D8099239200DF961E0910A42C105214D1E9370

Context:
- Response result is unexpectedly empty: status=0, message=Not available: the explorer cannot answer this request right now
```

## Environment
- SDK version: not involved, since these are explorer API calls. The repo pins `@somnia-chain/markets-sdk` 0.33.0; the verifier was Foundry 1.7.1 `forge`.
- Network: Somnia Tokyo testnet (Hideki, chain 50383).
  - Explorer `https://explorer.testnet.somnia.network/tokyo`.
  - API `https://explorer.testnet.somnia.network/tokyo/api`.
- Contracts:
  - BasanosRegistry `0xf5D8099239200DF961E0910A42C105214D1E9370` (deployed 2026-11-11, solc 0.8.28, `evm_version = cancun`, `via_ir`);
  - dreamDEX MarginBank `0x478769E1177C0773c43A593DCCc4Ad15F15F1394`;
  - USDso `0xed7993A74dAe1e6656B704A424DcD8711aAf4F72`;
  - SomniaAgents `0x7407cb35a17D511D1Bd32dD726ADb8D5344ECbE3`.
- Wallet address: the deployer and referee burner, `0xE358D82209ea9360F411A041C0200adc385877eb`.
