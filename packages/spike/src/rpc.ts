import { createPublicClient, createWalletClient, http, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { CHAIN, HIDEKI_ADDRESSES, INDEXER_URL } from "@basanos/core";
import { rpcHttp } from "@basanos/core/node";

export function publicClient(): PublicClient {
  return createPublicClient({ chain: CHAIN, transport: http(rpcHttp()) }) as unknown as PublicClient;
}

/** Inferred return type: the wallet is bound to CHAIN and the key's account, so writes need neither. */
export function walletFor(pk: Hex) {
  return createWalletClient({ account: privateKeyToAccount(pk), chain: CHAIN, transport: http(rpcHttp()) });
}

/** Read-only without a key; a trader-capable instance with one. */
export function marketsFor(pk?: Hex): SomniaMarkets {
  return new SomniaMarkets({
    chain: CHAIN,
    indexerUrl: INDEXER_URL,
    addresses: HIDEKI_ADDRESSES,
    ...(pk ? { privateKey: pk } : {}),
  });
}
