import type { Address, Hex } from "viem";
import { formatGain, formatUsdso } from "../lib/format";
import { rulebookById } from "../lib/rulebooks";
import { routeHref } from "../routes";

export function decodeTokenUri(uri: string): {
  name: string;
  description: string;
  external_url: string;
  attributes: { trait_type: string; value: string | number }[];
} | null {
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) return null;
  try {
    return JSON.parse(atob(uri.slice(prefix.length)));
  } catch {
    return null;
  }
}

/** One row of the certificate, in plain words (docs/design/frontend.md: plain copy; the kit's kv list). */
export interface CertificateRow {
  label: string;
  value: string;
  mono: boolean;
}

type CertificateMeta = NonNullable<ReturnType<typeof decodeTokenUri>>;

const attr = (meta: CertificateMeta, name: string) => meta.attributes.find((a) => a.trait_type === name)?.value;

/** An equity attribute: the registry writes it as a decimal string of USDso wei. */
function wei(v: string | number | undefined): bigint | null {
  return v !== undefined && /^-?\d+$/.test(String(v)) ? BigInt(String(v)) : null;
}

/** The tokenURI attributes as the page shows them: money in USDso, the gain, plain labels, the rulebook by name. */
export function certificateRows(meta: CertificateMeta): CertificateRow[] {
  const start = wei(attr(meta, "startEquity"));
  const end = wei(attr(meta, "endEquity"));
  const startBlock = attr(meta, "startBlock");
  const endBlock = attr(meta, "endBlock");
  const id = attr(meta, "rulebook");
  const rows: CertificateRow[] = [];
  if (start !== null) rows.push({ label: "Start equity", value: `${formatUsdso(start)} USDso`, mono: true });
  if (end !== null) rows.push({ label: "End equity", value: `${formatUsdso(end)} USDso`, mono: true });
  if (start !== null && end !== null) rows.push({ label: "Gain", value: formatGain(start, end), mono: true });
  if (startBlock !== undefined) rows.push({ label: "Start block", value: String(startBlock), mono: true });
  if (endBlock !== undefined) rows.push({ label: "End block", value: String(endBlock), mono: true });
  if (id !== undefined) {
    rows.push({ label: "Rulebook", value: rulebookById(String(id) as Hex)?.label ?? "Unpublished rulebook", mono: false });
    rows.push({ label: "Rulebook id", value: String(id), mono: true });
  }
  return rows;
}

export function CertificateView(props: { runId: bigint; holder: Address; uri: string }) {
  const meta = decodeTokenUri(props.uri);
  if (!meta) return <p className="error">This certificate's metadata could not be read.</p>;
  return (
    <div className="wrap">
      <p className="label">Soulbound certificate (ERC-721 + ERC-5192), held by</p>
      <p className="mono">{props.holder}</p>
      <h1 className="figure">{meta.name}</h1>
      <p>{meta.description}</p>
      <dl className="kv panel">
        {certificateRows(meta).map((r) => (
          <div key={r.label} style={{ display: "contents" }}>
            <dt>{r.label}</dt>
            <dd className={r.mono ? "mono" : undefined}>{r.value}</dd>
          </div>
        ))}
      </dl>
      <p>
        <a className="link" href={routeHref({ name: "run", runId: props.runId })}>
          See the verdict and replay it
        </a>
      </p>
    </div>
  );
}
