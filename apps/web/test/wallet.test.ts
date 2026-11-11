import { describe, expect, it } from "vitest";
import { WALLET_KEY, addressOf, createKey, forgetKey, importKey, loadKey, type KeyStore } from "../src/wallet/challengeWallet";

function memory(): KeyStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}
const KEY = `0x${"11".repeat(32)}` as const;

describe("challenge wallet", () => {
  it("creates, loads and forgets a key in the given store only", () => {
    const s = memory();
    expect(loadKey(s)).toBeNull();
    const k = createKey(s, () => KEY);
    expect(k).toBe(KEY);
    expect(s.data.get(WALLET_KEY)).toBe(KEY);
    expect(loadKey(s)).toBe(KEY);
    forgetKey(s);
    expect(loadKey(s)).toBeNull();
  });
  it("imports a pasted key and rejects anything else", () => {
    const s = memory();
    expect(importKey(s, `  ${KEY}\n`)).toBe(KEY);
    expect(() => importKey(s, "0x1234")).toThrow(/32-byte/);
  });
  it("ignores a corrupted stored value and derives the address", () => {
    const s = memory();
    s.setItem(WALLET_KEY, "garbage");
    expect(loadKey(s)).toBeNull();
    expect(addressOf(KEY)).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
