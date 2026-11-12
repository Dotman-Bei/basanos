import { describe, expect, it } from "vitest";
import { DEMO_MIN_UNLOCKED, notReady, type Preflight } from "../src/actions";

const E18 = 10n ** 18n;
const ready: Preflight = {
  account: "0x917Fa4Fd95d80d0dbf2823bFa1F07496Aca4AEc1",
  stt: 1n * E18,
  sttOk: true,
  voucherClaimed: false,
  unlockedCollateral: 50n * E18,
  funded: true,
  flat: true,
  equity: 50n * E18,
};

describe("demo readiness (funded, not voucher-backed)", () => {
  it("accepts a funded, flat account with STT and no voucher", () => {
    expect(notReady(ready)).toEqual([]);
    expect(DEMO_MIN_UNLOCKED).toBe(5n * E18);
  });
  it("names each missing prerequisite and points an unfunded account at its deposit", () => {
    const unfunded = notReady({ ...ready, unlockedCollateral: 0n, funded: false });
    expect(unfunded).toHaveLength(1);
    expect(unfunded[0]).toMatch(/deposit the account's own wallet USDso first/);
    expect(unfunded[0]).not.toMatch(/claim/);
    expect(notReady({ ...ready, sttOk: false, stt: 0n, flat: false })).toHaveLength(2);
  });
});
