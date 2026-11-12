// The deploy must never carry a test fixture. landing:3's labelled sample (apps/landing/test/fixtures/
// featured-sample.json) shows this marker in its visible text, so any page built from it would contain it. The same
// literal is pinned in landing:3's sample-guard test.
export const SAMPLE_MARKER = "BASANOS-SAMPLE-FIXTURE";

/** One problem per built or served page that carries the sample marker; [] when none does. */
export function sampleInBuild(pages: Record<string, string>): string[] {
  return Object.entries(pages)
    .filter(([, body]) => body.includes(SAMPLE_MARKER))
    .map(([where]) => `${where} carries the sample marker ${SAMPLE_MARKER} (a test fixture, not a real verdict)`);
}
