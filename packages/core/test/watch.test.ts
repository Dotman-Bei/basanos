import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { startWatch, watchParams, type WatchHandle, type WatchPush } from "../src/watch";

const FILTER = {
  address: "0x1998C88D54a240b8C671493f27f58eC416b81D7F" as const,
  ethCalls: [{ to: "0xcA11bde05977b3631167028862bE2a173976CA11" as const, data: "0x42cbb15c" as const }],
  pushChangesOnly: true,
};

let server: WebSocketServer | null = null;
let handle: WatchHandle | null = null;

afterEach(() => {
  handle?.close();
  handle = null;
  server?.close();
  server = null;
});

function serve(onSocket: (sock: ServerSocket, n: number, params: unknown) => void): Promise<string> {
  return new Promise((resolve) => {
    let n = 0;
    server = new WebSocketServer({ port: 0 }, () => {
      const { port } = server?.address() as AddressInfo;
      resolve(`ws://127.0.0.1:${port}`);
    });
    server.on("connection", (sock) => {
      n += 1;
      const mine = n;
      sock.on("message", (raw) => {
        const msg = JSON.parse(String(raw)) as { id: number; params: unknown[] };
        sock.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: `0xsub${mine}` }));
        onSocket(sock, mine, msg.params[1]);
      });
    });
  });
}

const PUSH: WatchPush = {
  address: "0x1998c88d54a240b8c671493f27f58ec416b81d7f",
  topics: ["0x01"],
  data: "0x",
  simulationResults: ["0xaa"],
};

describe("watchParams", () => {
  it("maps the filter to somnia_watch request fields", () => {
    expect(watchParams(FILTER)).toEqual({
      address: FILTER.address,
      eth_calls: FILTER.ethCalls,
      push_changes_only: true,
    });
  });
});

describe("startWatch", () => {
  it("subscribes with somnia_watch and delivers pushes", async () => {
    let seenParams: unknown = null;
    const url = await serve((sock, _n, params) => {
      seenParams = params;
      sock.send(JSON.stringify({ jsonrpc: "2.0", method: "eth_subscription", params: { subscription: "0xsub1", result: PUSH } }));
    });
    const push = await new Promise<WatchPush>((resolve) => {
      handle = startWatch(url, FILTER, { onPush: resolve });
    });
    expect(push.simulationResults).toEqual(["0xaa"]);
    expect(seenParams).toEqual(watchParams(FILTER));
  });

  it("reports one gap on disconnect, then resubscribes", async () => {
    const url = await serve((sock, n) => {
      if (n === 1) setTimeout(() => sock.terminate(), 20);
    });
    const events: string[] = [];
    await new Promise<void>((resolve) => {
      handle = startWatch(
        url,
        FILTER,
        {
          onPush: () => undefined,
          onConnected: ({ reconnects }) => {
            events.push(`connected:${reconnects}`);
            if (reconnects === 1) resolve();
          },
          onGap: () => events.push("gap"),
        },
        { initialBackoffMs: 20, maxBackoffMs: 100 },
      );
    });
    expect(events).toEqual(["connected:0", "gap", "connected:1"]);
    expect(handle?.connected).toBe(true);
  });
});
