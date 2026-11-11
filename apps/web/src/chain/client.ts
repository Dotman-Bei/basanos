import { createPublicClient, createWalletClient, http, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, RPC_HTTP_DEFAULT } from "@basanos/core";
import type { ContractCall } from "./calls";

let shared: PublicClient | null = null;

export function browserClient(): PublicClient {
  shared ??= createPublicClient({ chain: CHAIN, transport: http(RPC_HTTP_DEFAULT) }) as unknown as PublicClient;
  return shared;
}

/** Signs locally with the challenge wallet and waits for the receipt. */
export async function sendCall(key: Hex, call: ContractCall): Promise<{ hash: Hex; status: "success" | "reverted" }> {
  const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: CHAIN, transport: http(RPC_HTTP_DEFAULT) });
  const hash = await wallet.writeContract({
    address: call.address,
    abi: call.abi,
    functionName: call.functionName,
    args: call.args,
    ...(call.gas ? { gas: call.gas } : {}),
  });
  const receipt = await browserClient().waitForTransactionReceipt({ hash });
  return { hash, status: receipt.status };
}
