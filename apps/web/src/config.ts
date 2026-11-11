import { isAddress, type Address } from "viem";

const addr = (v: string | undefined): Address | null => (v && isAddress(v, { strict: false }) ? (v as Address) : null);

/** Public build values (never secrets): set VITE_REGISTRY_ADDRESS and VITE_REFEREE_ADDRESS at build time. */
export const REGISTRY: Address | null = addr(import.meta.env.VITE_REGISTRY_ADDRESS);
export const REFEREE: Address | null = addr(import.meta.env.VITE_REFEREE_ADDRESS);
