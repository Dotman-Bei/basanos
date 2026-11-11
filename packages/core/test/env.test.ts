import { describe, expect, it } from "vitest";
import { flag, requireAddress, requirePrivateKey, rpcHttp, rpcWss } from "../src/env";

const KEY = `0x${"11".repeat(32)}`;

describe("env", () => {
  it("returns a well-formed private key", () => {
    expect(requirePrivateKey("REFEREE_PK", { REFEREE_PK: KEY })).toBe(KEY);
  });
  it("names the variable but never echoes the value", () => {
    const bad = "0xdeadbeef";
    let message = "";
    try {
      requirePrivateKey("ACCOUNT_A_PK", { ACCOUNT_A_PK: bad });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("ACCOUNT_A_PK");
    expect(message).not.toContain(bad);
    expect(() => requirePrivateKey("ACCOUNT_B_PK", {})).toThrow(/ACCOUNT_B_PK is not set/);
  });
  it("validates addresses", () => {
    expect(requireAddress("REGISTRY_ADDRESS", { REGISTRY_ADDRESS: "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" })).toBe(
      "0x478769E1177C0773c43A593DCCc4Ad15F15F1394",
    );
    expect(() => requireAddress("REGISTRY_ADDRESS", { REGISTRY_ADDRESS: "nope" })).toThrow(/REGISTRY_ADDRESS/);
  });
  it("defaults the RPC endpoints and reads flags", () => {
    expect(rpcHttp({})).toBe("https://api.hideki.infra.testnet.somnia.network");
    expect(rpcWss({ HIDEKI_RPC_WSS: "wss://x/ws" })).toBe("wss://x/ws");
    expect(flag("ORACLE_ENABLED", { ORACLE_ENABLED: "TRUE" })).toBe(true);
    expect(flag("ORACLE_ENABLED", {})).toBe(false);
  });
});
