import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CertificateView, decodeTokenUri } from "../src/components/CertificateView";
import { TRUST_LINE, VerdictView, type VerdictData } from "../src/components/VerdictView";

const E18 = 10n ** 18n;
const read = (equity: bigint, block: bigint) => ({ blockNumber: block, equityOk: true, equity, lockedCollateral: 0n, positionSize: 0n, markOk: true, markPrice: 74_500n * E18 });
const data: VerdictData = {
  runId: 3n,
  account: "0x00000000000000000000000000000000000000a1",
  status: 3,
  rule: 1,
  voidReason: 0,
  rulebookLabel: "Tokyo Sprint · Demo",
  rulebookId: `0x${"11".repeat(32)}`,
  rulebookJson: null,
  start: read(1_000n * E18, 100n),
  breach: read(994n * E18, 160n),
  end: read(993n * E18, 165n),
  closeTxs: [`0x${"aa".repeat(32)}`],
  oraclePrice: 74_510n * E18,
  oracleSources: 3,
  oracleDone: true,
};

describe("VerdictView", () => {
  it("leads with the verdict and states the trust line verbatim", () => {
    render(<VerdictView data={data} replay={{ start: null, breach: null, end: null }} onReplay={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("FAILED — DailyLoss");
    expect(screen.getByText(TRUST_LINE)).toBeTruthy();
    expect(TRUST_LINE).toBe("Every certificate is chain-checked at mint; every verdict is replayable.");
    expect(screen.getByText("Tokyo Sprint · Demo")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /0xaaaa/ })).toHaveLength(1);
  });
  it("runs replay on demand and labels who read what", () => {
    const onReplay = vi.fn();
    render(
      <VerdictView
        data={data}
        replay={{
          start: [{ field: "equity", call: "MarginBank.tryGetAccountEquity(account)", stored: 1_000n * E18, chain: 1_000n * E18, match: "exact" }],
          breach: [{ field: "equity", call: "MarginBank.tryGetAccountEquity(account)", stored: 994n * E18, chain: null, match: "not-served" }],
          end: null,
        }}
        onReplay={onReplay}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Replay at the pinned blocks" }));
    expect(onReplay).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/read by the registry in the transaction/).length).toBe(2);
    expect(screen.getByText(/attested by the referee/)).toBeTruthy();
    expect(screen.getByText(/state no longer served by the public RPC/)).toBeTruthy();
  });
});

describe("certificate", () => {
  it("decodes the base64 tokenURI and shows the certificate", () => {
    const json = { name: "Basanos Certificate #4", description: "Every certificate is chain-checked at mint; every verdict is replayable.", external_url: "https://x/app/#/cert/4", attributes: [{ trait_type: "startBlock", value: 100 }] };
    const uri = `data:application/json;base64,${btoa(JSON.stringify(json))}`;
    expect(decodeTokenUri(uri)?.name).toBe("Basanos Certificate #4");
    expect(decodeTokenUri("data:text/plain,hi")).toBeNull();
    render(<CertificateView runId={4n} holder="0x00000000000000000000000000000000000000a1" uri={uri} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Basanos Certificate #4");
  });
});
