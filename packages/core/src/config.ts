import type { Address, Hex } from "viem";
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";

export const CHAIN = hidekiTestnet;
export const CHAIN_ID = 50383;

export const RPC_HTTP_DEFAULT = "https://api.hideki.infra.testnet.somnia.network";
export const RPC_WSS_DEFAULT = "wss://api.hideki.infra.testnet.somnia.network/ws";
export const RPC_HTTP_FALLBACK = "https://api.hideki2.infra.testnet.somnia.network";
export const RPC_WSS_FALLBACK = "wss://api.hideki2.infra.testnet.somnia.network/ws";
export const INDEXER_URL = "https://hideki-dev.smk.somnia.host/v1/graphql";
export const EXPLORER_URL = "https://explorer.testnet.somnia.network/tokyo";

export const MARGIN_BANK: Address = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394";
export const USDSO: Address = "0xed7993A74dAe1e6656B704A424DcD8711aAf4F72";
export const OPERATOR_REGISTRY: Address = "0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a";
export const VOUCHER_DISTRIBUTOR: Address = "0x2ACD9EFdA721450906bfE1bef3edE269636E42C4";
export const SOMNIA_AGENTS: Address = "0x7407cb35a17D511D1Bd32dD726ADb8D5344ECbE3";
export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";
export const PRICE_FEED_SCHEDULER: Address = "0x1998C88D54a240b8C671493f27f58eC416b81D7F";
export const BTC_POOL: Address = "0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0"; // getAddress() checksum form: viem decodes addresses in this case
export const BTC_BASE_DECIMALS = 8;
export const QUOTE_DECIMALS = 18;

/** The SDK's Hideki constants omit the perps OperatorPermissionsRegistry; Basanos adds it. */
export const HIDEKI_ADDRESSES = {
  ...SOMNIA_HIDEKI_TESTNET_ADDRESSES,
  operatorPermissionsRegistry: OPERATOR_REGISTRY,
};

export const PLACE_ORDER_FOR_SELECTOR: Hex = "0x80054449";
export const CANCEL_ORDER_FOR_SELECTOR: Hex = "0xe37b444b";
export const REDUCE_ORDER_FOR_SELECTOR: Hex = "0x364c2587";

export const ORDER_GAS = 10_000_000n;
export const ORDER_TYPE_LIMIT = 0;
export const ORDER_TYPE_IOC = 2;

export const ORACLE_AGENT_ID = 9911223344556677889n;
export const ORACLE_DEPOSIT = 30_900_000_000_000_000n;
export const STT_WRITE_HEADROOM = 600_000_000_000_000_000n;

/** Order expiry fifty years out, in nanoseconds (the bot kit's GTC convention). */
export function farFutureNs(nowMs: number = Date.now()): bigint {
  return (BigInt(Math.floor(nowMs / 1000)) + 50n * 365n * 86_400n) * 1_000_000_000n;
}

export function explorerTx(hash: Hex): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function explorerAddress(address: Address): string {
  return `${EXPLORER_URL}/address/${address}`;
}
