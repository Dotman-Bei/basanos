import { describe, expect, it } from "vitest";
import { pageProblems, pollSite, type Page } from "../src/site-check";

const D = "basanos.suitz.xyz";
const ok = (path: string): Page => ({ status: 200, finalUrl: `https://${D}${path}`, body: "<title>Basanos</title>" });

describe("a live page on its own domain (P9)", () => {
  it("passes only a 200 that stays on https://basanos.suitz.xyz and is the site", () => {
    expect(pageProblems(D, "/", ok("/"))).toEqual([]);
    expect(pageProblems(D, "/", { ...ok("/"), status: 401 })).toEqual(["/ returned 401 (a login wall: deployment protection covers the domain)"]);
    expect(pageProblems(D, "/app/", { status: 404, finalUrl: `https://${D}/app/`, body: "DEPLOYMENT_NOT_FOUND" })).toEqual(["/app/ returned 404 (nothing is served there yet)"]);
    // A login page reached by redirect can answer 200: the final host gives it away.
    expect(pageProblems(D, "/", { status: 200, finalUrl: "https://vercel.com/login?next=%2Fsso-api", body: "Log in to Vercel" })).toEqual([
      "/ ended at https://vercel.com/login?next=%2Fsso-api, not on https://basanos.suitz.xyz",
      "/ does not mention Basanos",
    ]);
    expect(pageProblems(D, "/", { ...ok("/"), finalUrl: `http://${D}/` })).toEqual([`/ ended at http://${D}/, not on https://${D}`]);
    expect(pageProblems(D, "/", { status: 0, finalUrl: "", body: "getaddrinfo ENOTFOUND" })).toEqual(["/ could not be fetched: getaddrinfo ENOTFOUND"]);
  });
});

describe("polling the site after the alias", () => {
  const clock = () => {
    let t = 0;
    return { now: () => t, sleep: async (ms: number) => void (t += ms), elapsed: () => t };
  };
  it("waits for a fresh alias to answer, then passes", async () => {
    const c = clock();
    let calls = 0;
    const get = async (url: string): Promise<Page> => {
      calls++;
      const path = new URL(url).pathname;
      return calls <= 4 ? { status: 404, finalUrl: url, body: "DEPLOYMENT_NOT_FOUND" } : ok(path);
    };
    const r = await pollSite(get, `https://${D}`, ["/", "/app/"], { timeoutMs: 120_000, intervalMs: 5_000, now: c.now, sleep: c.sleep });
    expect(r.problems).toEqual([]);
    expect(r.attempts).toBe(3);
    expect(c.elapsed()).toBe(10_000);
    expect(Object.keys(r.bodies)).toEqual([`https://${D}/`, `https://${D}/app/`]);
  });
  it("gives up after about 2 minutes and reports the last answer", async () => {
    const c = clock();
    const get = async (url: string): Promise<Page> => ({ status: 401, finalUrl: url, body: "Authentication Required" });
    const r = await pollSite(get, `https://${D}`, ["/", "/app/"], { timeoutMs: 120_000, intervalMs: 5_000, now: c.now, sleep: c.sleep });
    expect(r.attempts).toBe(25);
    expect(c.elapsed()).toBe(120_000);
    expect(r.problems).toEqual([
      "/ returned 401 (a login wall: deployment protection covers the domain)",
      "/app/ returned 401 (a login wall: deployment protection covers the domain)",
    ]);
  });
});
