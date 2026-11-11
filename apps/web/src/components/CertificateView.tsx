import type { Address } from "viem";
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
        {meta.attributes.map((a) => (
          <div key={a.trait_type} style={{ display: "contents" }}>
            <dt>{a.trait_type}</dt>
            <dd className="mono">{String(a.value)}</dd>
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
