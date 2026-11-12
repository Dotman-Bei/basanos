import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CertificateView, certificateRows, decodeTokenUri } from "../src/components/CertificateView";
import { TRUST_LINE } from "../src/components/VerdictView";
import { formatBtc, formatGain } from "../src/lib/format";

// Certificate #3 exactly as the registry's tokenURI(3) returns it on Hideki (run 3, the first live PASS; read 2026-11-12).
const URI =
  "data:application/json;base64,eyJuYW1lIjoiQmFzYW5vcyBDZXJ0aWZpY2F0ZSAjMyIsImRlc2NyaXB0aW9uIjoiRXZlcnkgY2VydGlmaWNhdGUgaXMgY2hhaW4tY2hlY2tlZCBhdCBtaW50OyBldmVyeSB2ZXJkaWN0IGlzIHJlcGxheWFibGUuIiwiZXh0ZXJuYWxfdXJsIjoiaHR0cHM6Ly9iYXNhbm9zLnZlcmNlbC5hcHAvYXBwLyMvY2VydC8zIiwiYXR0cmlidXRlcyI6W3sidHJhaXRfdHlwZSI6InJ1bGVib29rIiwidmFsdWUiOiIweDVhNWFmN2VlOTk3MWM0OTIxYzU2MTZiMWQ0NjJkNWRmNTBhZmM2ODcyYTEzMzYyMzM3ZTUyMDY5OTYwOGM0NDgifSx7InRyYWl0X3R5cGUiOiJzdGFydEJsb2NrIiwidmFsdWUiOjQ4NTM5OTc2fSx7InRyYWl0X3R5cGUiOiJlbmRCbG9jayIsInZhbHVlIjo0ODU0MTY5OH0seyJ0cmFpdF90eXBlIjoic3RhcnRFcXVpdHkiLCJ2YWx1ZSI6IjQ5NjcxNDI1MDAwMDAwMDAwMDAwIn0seyJ0cmFpdF90eXBlIjoiZW5kRXF1aXR5IiwidmFsdWUiOiI1MDA2MzM0NTAwMDAwMDAwMDAwMCJ9XX0=";
const HOLDER = "0x917Fa4Fd95d80d0dbf2823bFa1F07496Aca4AEc1";

describe("the certificate page in plain words and money (P8)", () => {
  it("formats the gain and a position size", () => {
    expect(formatGain(49_671_425_000_000_000_000n, 50_063_345_000_000_000_000n)).toBe("+0.79%");
    expect(formatGain(100n, 99n)).toBe("-1.00%");
    expect(formatGain(0n, 5n)).toBe("—");
    expect(formatBtc(0n)).toBe("Flat");
    expect(formatBtc(350_000n)).toBe("0.0035 BTC long");
    expect(formatBtc(-342_000n)).toBe("0.00342 BTC short");
  });
  it("turns certificate #3's attributes into labelled rows", () => {
    const meta = decodeTokenUri(URI);
    expect(meta).not.toBeNull();
    expect(certificateRows(meta!)).toEqual([
      { label: "Start equity", value: "49.67 USDso", mono: true },
      { label: "End equity", value: "50.06 USDso", mono: true },
      { label: "Gain", value: "+0.79%", mono: true },
      { label: "Start block", value: "48539976", mono: true },
      { label: "End block", value: "48541698", mono: true },
      { label: "Rulebook", value: "Tokyo Sprint · Demo", mono: false },
      { label: "Rulebook id", value: "0x5a5af7ee9971c4921c5616b1d462d5df50afc6872a13362337e520699608c448", mono: true },
    ]);
  });
  it("renders money and plain labels, never a raw wei amount or an attribute name", () => {
    const { container } = render(<CertificateView runId={3n} holder={HOLDER} uri={URI} />);
    for (const text of ["49.67 USDso", "50.06 USDso", "+0.79%", "Start equity", "End equity", "Start block", "End block", "Rulebook", "Tokyo Sprint · Demo"]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(container.textContent).not.toMatch(/\d{19}/);
    for (const raw of ["startEquity", "endEquity", "startBlock", "endBlock"]) expect(container.textContent).not.toContain(raw);
    // Unchanged: the trust line and the holder.
    expect(screen.getByText(TRUST_LINE)).toBeTruthy();
    expect(screen.getByText(HOLDER)).toBeTruthy();
  });
});
