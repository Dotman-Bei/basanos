import type { Address, Hex } from "viem";

export interface WatchFilter {
  address: Address | readonly Address[];
  topics?: readonly (Hex | readonly Hex[] | null)[];
  ethCalls: readonly { to: Address; data: Hex }[];
  pushChangesOnly?: boolean;
}

export interface WatchPush {
  address: Address;
  topics: Hex[];
  data: Hex;
  simulationResults: Hex[];
}

export interface WatchHandlers {
  onPush: (push: WatchPush) => void;
  onConnected?: (info: { subscriptionId: string; reconnects: number }) => void;
  onGap?: (info: { atMs: number; reason: string }) => void;
}

export interface WatchOptions {
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  WebSocketImpl?: typeof WebSocket;
}

export interface WatchHandle {
  close: () => void;
  readonly connected: boolean;
}

/** The somnia_watch request object (eth_getLogs-style filter plus eth_calls). */
export function watchParams(filter: WatchFilter): Record<string, unknown> {
  return {
    address: filter.address,
    ...(filter.topics ? { topics: filter.topics } : {}),
    eth_calls: filter.ethCalls,
    ...(filter.pushChangesOnly ? { push_changes_only: true } : {}),
  };
}

interface RpcMessage {
  id?: number;
  result?: unknown;
  error?: { message?: string };
  method?: string;
  params?: { result?: WatchPush };
}

/**
 * Subscribes with somnia_watch and keeps the subscription alive. The node does not buffer events across
 * a disconnect, so every outage is reported once through onGap; the caller must re-read state at head
 * before trusting pushes again (spec §8, R3). Reconnects back off from initialBackoffMs, doubling to
 * maxBackoffMs, and the backoff resets after a successful subscribe.
 */
export function startWatch(url: string, filter: WatchFilter, handlers: WatchHandlers, opts: WatchOptions = {}): WatchHandle {
  const Impl = opts.WebSocketImpl ?? globalThis.WebSocket;
  const initial = opts.initialBackoffMs ?? 500;
  const max = opts.maxBackoffMs ?? 30_000;
  let socket: WebSocket | null = null;
  let closedByUser = false;
  let connected = false;
  let reconnects = 0;
  let backoff = initial;
  let gapReported = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const detach = (): void => {
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try {
      socket.close();
    } catch {
      // the socket is already closed
    }
    socket = null;
  };

  const fail = (reason: string): void => {
    if (closedByUser) return;
    connected = false;
    if (!gapReported) {
      gapReported = true;
      handlers.onGap?.({ atMs: Date.now(), reason });
    }
    detach();
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      reconnects += 1;
      connect();
    }, backoff);
    backoff = Math.min(backoff * 2, max);
  };

  const connect = (): void => {
    const sock = new Impl(url);
    socket = sock;
    sock.onopen = () => {
      sock.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["somnia_watch", watchParams(filter)] }));
    };
    sock.onmessage = (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as RpcMessage;
      if (msg.id === 1) {
        if (typeof msg.result === "string") {
          connected = true;
          gapReported = false;
          backoff = initial;
          handlers.onConnected?.({ subscriptionId: msg.result, reconnects });
        } else {
          fail(`subscribe rejected: ${msg.error?.message ?? "no result"}`);
        }
        return;
      }
      if (msg.method === "eth_subscription" && msg.params?.result) handlers.onPush(msg.params.result);
    };
    sock.onclose = () => fail("socket closed");
    sock.onerror = () => fail("socket error");
  };

  connect();

  return {
    close: () => {
      closedByUser = true;
      connected = false;
      if (timer) clearTimeout(timer);
      timer = null;
      detach();
    },
    get connected() {
      return connected;
    },
  };
}
