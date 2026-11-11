import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASANOS } from "../src/index";
import { repoPath } from "../src/node";

describe("core scaffold", () => {
  it("exports the package marker", () => {
    expect(BASANOS).toBe("basanos");
  });
  it("resolves repo-relative paths to the repo root", () => {
    expect(existsSync(repoPath("package.json"))).toBe(true);
    expect(existsSync(repoPath("tsconfig.base.json"))).toBe(true);
  });
  it("keeps spaces in paths (the repo path itself contains one)", () => {
    expect(repoPath("dir with space/file.txt").endsWith(join("dir with space", "file.txt"))).toBe(true);
  });
});
