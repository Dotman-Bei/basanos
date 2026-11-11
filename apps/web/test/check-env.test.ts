import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain JS module without types
import { findSecretVars } from "../scripts/check-env.mjs";

describe("findSecretVars", () => {
  it("flags VITE_*_PK names from the environment and from .env text", () => {
    expect(findSecretVars({ VITE_REFEREE_PK: "x", VITE_REGISTRY_ADDRESS: "0x1", REFEREE_PK: "y" }, "VITE_ACCOUNT_A_PK=0xabc\nVITE_OK=1")).toEqual([
      "VITE_ACCOUNT_A_PK",
      "VITE_REFEREE_PK",
    ]);
    expect(findSecretVars({ VITE_REGISTRY_ADDRESS: "0x1" }, "")).toEqual([]);
  });
});
