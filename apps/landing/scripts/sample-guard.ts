// A labelled test fixture must never become the landing page. The fixture (apps/landing/test/fixtures/
// featured-sample.json) is marked "sample": true and carries SAMPLE_MARKER in its visible text. The only real
// snapshot is apps/landing/src/featured-verdict.json, which landing:2 writes from a real verdict run.
export const SAMPLE_MARKER = "BASANOS-SAMPLE-FIXTURE";

/** Why a snapshot, and optionally the HTML rendered from it, must not be built or shipped; [] when it is real. */
export function sampleProblems(snapshot: unknown, html?: string): string[] {
  const p: string[] = [];
  const s = (snapshot !== null && typeof snapshot === "object" ? snapshot : {}) as Record<string, unknown>;
  if (s.sample === true) p.push('the featured snapshot is marked "sample": true (a test fixture, not a real verdict)');
  if (JSON.stringify(snapshot ?? null).includes(SAMPLE_MARKER)) p.push(`the featured snapshot carries the sample marker ${SAMPLE_MARKER}`);
  if (html !== undefined && html.includes(SAMPLE_MARKER)) p.push(`the built page carries the sample marker ${SAMPLE_MARKER}`);
  return p;
}
