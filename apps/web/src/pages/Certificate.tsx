import { useEffect, useState } from "react";
import type { Address } from "viem";
import { basanosRegistryAbi } from "@basanos/core";
import { browserClient } from "../chain/client";
import { CertificateView } from "../components/CertificateView";
import { REGISTRY } from "../config";

export function CertificatePage(props: { runId: bigint }) {
  const [state, setState] = useState<{ holder: Address; uri: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!REGISTRY) {
      setError("This build has no registry address set.");
      return;
    }
    const registry = REGISTRY;
    const c = browserClient();
    void (async () => {
      try {
        const [holder, uri] = await Promise.all([
          c.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "ownerOf", args: [props.runId] }),
          c.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "tokenURI", args: [props.runId] }),
        ]);
        setState({ holder, uri });
      } catch {
        setError(`Run ${props.runId.toString()} has no certificate: only a PASS mints one.`);
      }
    })();
  }, [props.runId]);
  if (error) return <p className="wrap error">{error}</p>;
  if (!state) return <p className="wrap label">Reading the certificate…</p>;
  return <CertificateView runId={props.runId} holder={state.holder} uri={state.uri} />;
}
