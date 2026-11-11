# VoucherDistributor.claim() reverts for every address with custom error 0x3e31dcc2, while the SDK reports the voucher as claimable
Severity: critical
Area: contracts

## Steps to reproduce
1. On Somnia Tokyo testnet (Hideki, chain 50383), pick any address. It can be a funded burner that never claimed, or an address that has never transacted, such as `0x000000000000000000000000000000000000dEaD`.
2. With `@somnia-chain/markets-sdk@0.33.0`, read `client.getPerpVoucherEligibility(marginBank, account)`, `client.getPerpVoucher(marginBank, account)` and `client.getPerpVoucherCampaign(marginBank)`. The MarginBank is `0x478769E1177C0773c43A593DCCc4Ad15F15F1394`. All three report a claimable voucher.
3. Build the claim with `trader.buildClaimPerpVoucher({ marginBank })`. It returns `to` = VoucherDistributor `0x2ACD9EFdA721450906bfE1bef3edE269636E42C4` and `data` = `0x4e71d92d` (`claim()`).
4. Simulate it: `eth_call { from: <account>, to: 0x2ACD9EFdA721450906bfE1bef3edE269636E42C4, data: 0x4e71d92d }`. Or send it with `trader.claimPerpVoucher({ marginBank })`.

## Expected
`claim()` credits the 1,000 USDso voucher to an eligible account that has not claimed. That is what the SDK's reads say should happen: eligibility `true`, voucher not claimed, and a live campaign (`endsAt` 2026-12-28 with 70,779 claims left).

## Actual
- **Every simulation reverts.** `eth_call` of `claim()` reverts with the custom error `0x3e31dcc2` (no arguments). This held for all four addresses tried: two funded burners that never claimed, and two never-used addresses. It held on both public RPC hosts. `eth_estimateGas` fails the same way.
- **No paper USDso can be obtained** on Hideki through the voucher, so no new account can open a perps position on voucher margin.
- **Where it reverts:** `debug_traceCall` shows the revert in the distributor implementation's own frame (`0x9657f0fd53efc01cd108d93c835bb4b517732b43`, reached by `DELEGATECALL` from the proxy). There are no sub-calls, so the check that rejects the claim runs before any external call.
  - The error is in that implementation's bytecode as `7f3e31dcc2…` (`PUSH32 0x3e31dcc2…`), followed by the usual revert.
  - It is not among the 591 custom errors in the SDK 0.33.0 ABIs, so the SDK cannot name it.
- **The SDK's reads disagree with the contract** (eligible, not claimed, campaign active).
- **Through the SDK send path it fails without a clear error.** Our first claim attempt with `trader.claimPerpVoucher` surfaced as `TransactionOutcomeUnknownError` ("rpc eth_sendRawTransactionSync failed: transaction 0x8bcb9be8c6cb45bc57eb62d0245efe1b59bb2a82aacae10ab93da4e98a02f038 on chain 50383 may have been sent; its receipt was not observed"). Nothing was mined: `eth_getTransactionByHash` returned null on both hosts, the account's nonce stayed 0 and its STT balance did not change. A caller cannot tell from that error that the claim itself is rejected.
- **Last credit we can find:** the most recent voucher credit the Somnia Markets indexer shows is at block 45,279,822 (2026-11-08 23:53:02 UTC), in tx `0x5f2a76f8089baaf4efcb2c2d19c351dadfd52f47b42760dd70cb2a86b85c70f4`.
  - That transaction is not a user `claim()`. It is a batch call (selector `0x0677d0a3`) from `0x792182e6b2bd50deb22dc5436f7c518b34f9bd12` to the distributor, and it credited 9 accounts.
  - The indexer shows no voucher credit after it.

## Evidence
Read-only script (viem 2.57.12; `eth_call`, `eth_estimateGas`, `debug_traceCall`, `eth_getCode`, `eth_getStorageAt`, `eth_getLogs`; nothing was sent), output pasted as printed:

```
$ eth_call claim() on api.hideki.infra.testnet.somnia.network (head 47415492, 2026-11-11T11:14:42.000Z)
  from account A 0x917Fa4Fd95d80d0dbf2823bFa1F07496Aca4AEc1: revert data 0x3e31dcc2
  from account B 0x1609F6ABE3aD29B45D1F2fdd15a15d17AbB326aD: revert data 0x3e31dcc2
  from never-used 0x…dEaD 0x000000000000000000000000000000000000dEaD: revert data 0x3e31dcc2
  from never-used 0x1111…1111 0x1111111111111111111111111111111111111111: revert data 0x3e31dcc2
  eth_estimateGas from account A: Execution reverted for an unknown reason.

$ eth_call claim() on api.hideki2.infra.testnet.somnia.network (head 47415528, 2026-11-11T11:14:45.000Z)
  from account A 0x917Fa4Fd95d80d0dbf2823bFa1F07496Aca4AEc1: revert data 0x3e31dcc2
  from account B 0x1609F6ABE3aD29B45D1F2fdd15a15d17AbB326aD: revert data 0x3e31dcc2
  from never-used 0x…dEaD 0x000000000000000000000000000000000000dEaD: revert data 0x3e31dcc2
  from never-used 0x1111…1111 0x1111111111111111111111111111111111111111: revert data 0x3e31dcc2
  eth_estimateGas from account A: Execution reverted for an unknown reason.

$ debug_traceCall { from: account A, to: VoucherDistributor, data: 0x4e71d92d } (callTracer), both hosts
CALL 0x917fa4fd -> 0x2acd9efda721450906bfe1bef3ede269636e42c4 0x4e71d92d ERROR EXECUTION_REVERTED 0x3e31dcc2
  DELEGATECALL 0x917fa4fd -> 0x9657f0fd53efc01cd108d93c835bb4b517732b43 0x4e71d92d ERROR EXECUTION_REVERTED 0x3e31dcc2

$ EIP-1967 implementation slots
  VoucherDistributor 0x2ACD9EFdA721450906bfE1bef3edE269636E42C4 -> 0x9657f0fd53efc01cd108d93c835bb4b517732b43
  MarginBank 0x478769E1177C0773c43A593DCCc4Ad15F15F1394 -> 0x78c989c9c5cd2ed68b4486373c0e4b118c8f1d5c

$ eth_getCode of the implementations
distributor impl 0x9657f0fd53efc01cd108d93c835bb4b517732b43: 12785 bytes; contains 3e31dcc2: true; PUSH4 claim() 4e71d92d: true
MarginBank impl 0x78c989c9c5cd2ed68b4486373c0e4b118c8f1d5c: 58649 bytes; contains 3e31dcc2: false; PUSH4 claim() 4e71d92d: false
hex offset 7346 (byte 3673): prev byte 7f | context 86576040517f3e31dcc2000000000000

$ last voucher credit (block 45279822, the indexer's most recent)
  block 45279822 timestamp 1794181982 = 2026-11-08T23:53:02.000Z
$ eth_getTransaction + eth_getTransactionReceipt 0x5f2a76f8089baaf4efcb2c2d19c351dadfd52f47b42760dd70cb2a86b85c70f4
{
 "from": "0x792182e6b2bd50deb22dc5436f7c518b34f9bd12",
 "to": "0x2acd9efda721450906bfe1bef3ede269636e42c4",
 "selector": "0x0677d0a3",
 "inputBytes": 356,
 "status": "success",
 "gasUsed": "10141296",
 "logs": 27,
 "topics0": [
  "0xed7993:0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  "0x478769:0xbb4e4e24c267479b5516cddb733818a304e89c317fcc3bf1af08ff3d470ca577",
  "0x2acd9e:0x3158bdc173381687bb80644acbef84c1d636ce9483e75989afc728dbe0ff8dd8"
 ]
}
  logs: 27 (distributor 9, MarginBank 9, USDso 9); distinct distributor topic1 (credited accounts): 9

$ SDK 0.33.0 reads for account A (no key)
  getPerpVoucherEligibility -> {"eligible":true,"grantAmount":"1000000000000000000000"}
  getPerpVoucher -> {"claimed":false,"floor":"0","expiresAt":"0"}
  getPerpVoucherCampaign -> {"distributor":"0x2ACD9EFdA721450906bfE1bef3edE269636E42C4","collateralToken":"0xed7993A74dAe1e6656B704A424DcD8711aAf4F72","grantAmount":"1000000000000000000000","expiryDurationSec":"1209600","startsAt":"1790553600","endsAt":"1798477478","budgetRemaining":"70779000000000000000000000","claimsRemaining":"70779","leverageCapX":20}
```

The first claim attempt through the SDK (`trader.claimPerpVoucher({ marginBank })`, account A), as it surfaced:

```
TransactionOutcomeUnknownError: rpc eth_sendRawTransactionSync failed: transaction 0x8bcb9be8c6cb45bc57eb62d0245efe1b59bb2a82aacae10ab93da4e98a02f038 on chain 50383 may have been sent; its receipt was not observed
```

Afterwards, `eth_getTransactionByHash` and `eth_getTransactionReceipt` for that hash returned `null` on both hosts. Account A's nonce was `0x0` (latest and pending) and its STT balance was unchanged.

## Environment
- SDK version: `@somnia-chain/markets-sdk` 0.33.0 (exact pin), with viem 2.57.12 on Node 22.23.4.
- Network: Somnia Tokyo testnet (Hideki), chain 50383.
  - RPC hosts: `https://api.hideki.infra.testnet.somnia.network` and `https://api.hideki2.infra.testnet.somnia.network`.
  - The SDK's own send route is `send.hideki.infra.testnet.somnia.network`.
- Wallet addresses:
  - account A `0x917Fa4Fd95d80d0dbf2823bFa1F07496Aca4AEc1`;
  - account B `0x1609F6ABE3aD29B45D1F2fdd15a15d17AbB326aD`;
  - never-used `0x000000000000000000000000000000000000dEaD` and `0x1111111111111111111111111111111111111111`.
- Contracts:
  - VoucherDistributor `0x2ACD9EFdA721450906bfE1bef3edE269636E42C4` (implementation `0x9657f0fd53efc01cd108d93c835bb4b517732b43`);
  - MarginBank `0x478769E1177C0773c43A593DCCc4Ad15F15F1394` (implementation `0x78c989c9c5cd2ed68b4486373c0e4b118c8f1d5c`);
  - USDso `0xed7993A74dAe1e6656B704A424DcD8711aAf4F72`.
- Observed: first on 2026-11-11 before 01:59 UTC, and still failing when re-checked at 2026-11-11 11:14 UTC.
