import { useEffect, useState } from "react";

export type Route = { name: "home" } | { name: "challenge" } | { name: "run"; runId: bigint } | { name: "cert"; runId: bigint };

export function parseRoute(hash: string): Route {
  const [first, second] = hash.replace(/^#\/?/, "").split("/");
  if (first === "challenge") return { name: "challenge" };
  if ((first === "run" || first === "cert") && second && /^\d+$/.test(second)) return { name: first, runId: BigInt(second) };
  return { name: "home" };
}

export function routeHref(r: Route): string {
  if (r.name === "home") return "#/";
  if (r.name === "challenge") return "#/challenge";
  return `#/${r.name}/${r.runId}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
