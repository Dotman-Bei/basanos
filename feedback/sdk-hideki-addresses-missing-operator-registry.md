# SOMNIA_HIDEKI_TESTNET_ADDRESSES has no operatorPermissionsRegistry, so the SDK's perp operator grants fail on Hideki
Severity: normal
Area: SDK

## Steps to reproduce
1. Install `@somnia-chain/markets-sdk@0.33.0`.
2. Read `SOMNIA_HIDEKI_TESTNET_ADDRESSES.operatorPermissionsRegistry`.
3. Create a client with `addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES` and call `trader.setOperatorApprovalForPool({ pool, operator, selectors, approved: true })` without `operatorRegistry`.

## Expected
The Hideki address set names the perps OperatorPermissionsRegistry the dreamDEX docs list for Hideki (`0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a`), so grants and `isOperatorAuthorized`-style reads work with the shipped constants, as they do for Somnia Tokyo (`SOMNIA_TOKYO_ADDRESSES.operatorPermissionsRegistry`).

## Actual
The key is absent, so the grant throws `NotConfiguredError` unless the caller passes `operatorRegistry` by hand. The grant helper's comment also says "SPOT-ONLY", although perp stop orders write `setOperatorApprovalForPool` on the same registry.

## Evidence
Step 2, run on 2026-11-11 (about 13:58 UTC):

```
$ node --input-type=module -e "import { SOMNIA_HIDEKI_TESTNET_ADDRESSES as A } from '@somnia-chain/markets-sdk'; console.log(JSON.stringify({ operatorPermissionsRegistry: A.operatorPermissionsRegistry ?? null, marginBank: A.marginBank }))"
{"operatorPermissionsRegistry":null,"marginBank":"0x478769E1177C0773c43A593DCCc4Ad15F15F1394"}
```

Read-only checks of the same defect (a client built with `addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES`; `owner` `0x47537E3A3ea6e9391F3B26Ea45618db6828c8bfF`, `operator` `0x000000000000000000000000000000000000dEaD`, `selector` `0x80054449`). No write was sent (it would need a key); the write-path claim comes from the 0.33.0 source, where `resolveOperatorRegistry` in `dist/writer.js` and the perp stop-order preflight in `dist/perp/stops.js` throw the same `NotConfiguredError` when the address is missing:

```
isGloballyApproved threw NotConfiguredError: @somnia-chain/markets-sdk: an operator grant read — needs addresses.operatorPermissionsRegistry
getOperatorPermissionsRegistry(BTC pool 0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0) -> 0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a
```

`SOMNIA_TOKYO_ADDRESSES.operatorPermissionsRegistry` in the same package is `0xeC0066de3781BaC11E97490DD0E61AcbA9Fb3fD6`.

## Environment
SDK version 0.33.0, network Somnia Tokyo testnet (Hideki, chain 50383), wallet address: read-only (no wallet needed)
