import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

/** sessionStorage key for the testnet challenge wallet (never the build, never the repo, never a log). */
export const WALLET_KEY = "basanos.challengeWallet";

export interface KeyStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const isKey = (v: string): v is Hex => /^0x[0-9a-fA-F]{64}$/.test(v);

export function loadKey(store: KeyStore): Hex | null {
  const v = store.getItem(WALLET_KEY);
  return v && isKey(v) ? v : null;
}

export function createKey(store: KeyStore, gen: () => Hex = generatePrivateKey): Hex {
  const k = gen();
  store.setItem(WALLET_KEY, k);
  return k;
}

export function importKey(store: KeyStore, raw: string): Hex {
  const k = raw.trim();
  if (!isKey(k)) throw new Error("not a 0x-prefixed 32-byte hex key");
  store.setItem(WALLET_KEY, k);
  return k;
}

export function forgetKey(store: KeyStore): void {
  store.removeItem(WALLET_KEY);
}

export function addressOf(key: Hex): Address {
  return privateKeyToAccount(key).address;
}
