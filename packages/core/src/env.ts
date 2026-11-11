import { existsSync } from "node:fs";
import { isAddress, type Address, type Hex } from "viem";
import { RPC_HTTP_DEFAULT, RPC_WSS_DEFAULT } from "./config";

export type SecretName = "REFEREE_PK" | "ACCOUNT_A_PK" | "ACCOUNT_B_PK";
export type AddressName = "REFEREE_ADDRESS" | "ACCOUNT_A_ADDRESS" | "ACCOUNT_B_ADDRESS" | "REGISTRY_ADDRESS";

/** Loads KEY=VALUE pairs from the git-ignored .env into process.env (existing values win). */
export function loadDotEnv(path = ".env"): boolean {
  if (!existsSync(path)) return false;
  process.loadEnvFile(path);
  return true;
}

/** Never includes the value in an error: keys must not reach logs. */
export function requirePrivateKey(name: SecretName, env: NodeJS.ProcessEnv = process.env): Hex {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} is not a 0x-prefixed 32-byte hex key`);
  return value as Hex;
}

export function requireAddress(name: AddressName, env: NodeJS.ProcessEnv = process.env): Address {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  if (!isAddress(value, { strict: false })) throw new Error(`${name} is not an address`);
  return value as Address;
}

export function rpcHttp(env: NodeJS.ProcessEnv = process.env): string {
  return env.HIDEKI_RPC_HTTP && env.HIDEKI_RPC_HTTP.length > 0 ? env.HIDEKI_RPC_HTTP : RPC_HTTP_DEFAULT;
}

export function rpcWss(env: NodeJS.ProcessEnv = process.env): string {
  return env.HIDEKI_RPC_WSS && env.HIDEKI_RPC_WSS.length > 0 ? env.HIDEKI_RPC_WSS : RPC_WSS_DEFAULT;
}

export function flag(name: "ORACLE_ENABLED", env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[name] ?? "").toLowerCase() === "true";
}
