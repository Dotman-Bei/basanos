// check-deploy's view of the live site (P9). Each page is fetched unauthenticated over https and must answer 200 and
// still be on the domain after redirects. A login wall (Vercel deployment protection) shows as 401/403 or as a redirect
// off the domain; a domain with nothing attached answers 404. Polled, because a fresh alias can take a moment to answer.
export interface Page {
  status: number;
  finalUrl: string;
  body: string;
}

/** What is wrong with one fetched page; [] when it is the site on its own domain. */
export function pageProblems(domain: string, path: string, page: Page): string[] {
  if (page.status === 0) return [`${path} could not be fetched: ${page.body}`];
  const problems: string[] = [];
  if (page.status !== 200) {
    const why =
      page.status === 401 || page.status === 403
        ? " (a login wall: deployment protection covers the domain)"
        : page.status === 404
          ? " (nothing is served there yet)"
          : "";
    problems.push(`${path} returned ${page.status}${why}`);
  }
  let final: URL | null = null;
  try {
    final = new URL(page.finalUrl);
  } catch {
    final = null;
  }
  if (!final || final.protocol !== "https:" || final.host !== domain) problems.push(`${path} ended at ${page.finalUrl || "no URL"}, not on https://${domain}`);
  if (page.status === 200 && !page.body.includes("Basanos")) problems.push(`${path} does not mention Basanos`);
  return problems;
}

/** One GET with no cookies and no token; redirects are followed so the final URL is known. */
export async function fetchPage(url: string): Promise<Page> {
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "cache-control": "no-cache" } });
    return { status: res.status, finalUrl: res.url, body: await res.text() };
  } catch (e) {
    return { status: 0, finalUrl: "", body: (e as Error).message };
  }
}

export interface PollOptions {
  timeoutMs: number;
  intervalMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface PollResult {
  problems: string[];
  attempts: number;
  bodies: Record<string, string>;
}

/** Fetches every path until all pass or the time is up; the problems are those of the last attempt. */
export async function pollSite(get: (url: string) => Promise<Page>, siteUrl: string, paths: readonly string[], opts: PollOptions): Promise<PollResult> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const domain = new URL(siteUrl).host;
  const deadline = now() + opts.timeoutMs;
  for (let attempts = 1; ; attempts++) {
    const problems: string[] = [];
    const bodies: Record<string, string> = {};
    for (const path of paths) {
      const url = `${siteUrl}${path}`;
      const page = await get(url);
      bodies[url] = page.body;
      problems.push(...pageProblems(domain, path, page));
    }
    if (problems.length === 0 || now() + opts.intervalMs > deadline) return { problems, attempts, bodies };
    await sleep(opts.intervalMs);
  }
}
