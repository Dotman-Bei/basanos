// The certificates' base URL: the live site's certificate route. deployments/hideki.json starts with the
// constructor's placeholder; ship:6 sets the real one with setBaseUrl and reads baseUrl() back.
export const PLACEHOLDER_BASE_URL = "https://basanos.vercel.app/app/#/cert/";

/** The certificate route on the deployed site (https only; any path on the site URL is dropped). */
export function certBaseUrl(siteUrl: string): string {
  const u = new URL(siteUrl);
  if (u.protocol !== "https:") throw new Error(`the site URL must be https: ${siteUrl}`);
  return `${u.origin}/app/#/cert/`;
}

/** null when the registry's baseUrl() equals the deployed route; otherwise what is wrong. */
export function baseUrlProblem(expected: string, onChain: string): string | null {
  if (onChain === expected) return null;
  const why = onChain === PLACEHOLDER_BASE_URL ? " (still the constructor's placeholder)" : "";
  return `registry baseUrl() is ${onChain}${why}; expected ${expected}`;
}
