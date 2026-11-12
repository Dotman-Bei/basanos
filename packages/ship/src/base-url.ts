// The live site and the certificates' base URL. The site is the user's own domain on their own Vercel account (P9):
// the landing at /, the app at /app/. deployments/hideki.json starts with the constructor's placeholder; ship:6 sets
// the real route with setBaseUrl and reads baseUrl() back.
export const SITE_DOMAIN = "basanos.suitz.xyz";
export const SITE_URL = `https://${SITE_DOMAIN}`;

/** The constructor's placeholder, kept only to detect "not set yet" (basanos.vercel.app is someone else's site). */
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
