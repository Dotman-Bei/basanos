import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RailsChart } from "../src/components/RailsChart";
import { StartFlow } from "../src/components/StartFlow";
import { Ticket } from "../src/components/Ticket";
import { WalletPanel } from "../src/components/WalletPanel";
import type { KeyStore } from "../src/wallet/challengeWallet";

const E18 = 10n ** 18n;
function memory(): KeyStore {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe("WalletPanel", () => {
  it("labels the wallet as testnet and creates or imports a key", () => {
    const onChange = vi.fn();
    render(<WalletPanel store={memory()} onChange={onChange} />);
    expect(screen.getByText("Testnet challenge wallet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create wallet" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
  it("rejects a malformed pasted key", () => {
    render(<WalletPanel store={memory()} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Paste a burner key"), { target: { value: "0x12" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(screen.getByRole("alert").textContent).toMatch(/32-byte/);
  });
});

describe("StartFlow", () => {
  it("offers exactly one primary step at a time, and claims only on click", () => {
    const onClaim = vi.fn();
    const { rerender } = render(
      <StartFlow claimed={false} granted={false} running={false} busy={false} onClaim={onClaim} onGrant={vi.fn()} onStart={vi.fn()} />,
    );
    expect(onClaim).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Claim paper USDso" }));
    expect(onClaim).toHaveBeenCalledTimes(1);
    rerender(<StartFlow claimed granted={false} running={false} busy={false} onClaim={onClaim} onGrant={vi.fn()} onStart={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Grant the referee" }).className).toContain("btn--primary");
    expect(screen.queryByRole("button", { name: "Claim paper USDso" })).toBeNull();
  });
});

describe("Ticket", () => {
  it("sizes the order from leverage and sends the side", () => {
    const onOrder = vi.fn();
    render(<Ticket equity={1_000n * E18} mark={74_500n * E18} busy={false} onOrder={onOrder} />);
    fireEvent.click(screen.getByRole("button", { name: "Buy / long" }));
    expect(onOrder).toHaveBeenCalledWith(true, 16_107_000n);
  });
});

describe("RailsChart", () => {
  it("draws the target and both floors", () => {
    render(<RailsChart rails={{ start: 1_000n * E18, target: 1_005n * E18, dailyFloor: 995n * E18, trailingFloor: 9_925n * 10n ** 17n }} points={[1_000n * E18, 1_002n * E18]} />);
    expect(screen.getByText("Target +0.50%")).toBeTruthy();
    expect(screen.getByText("Daily floor -0.50%")).toBeTruthy();
    expect(screen.getByText("Trailing floor -0.75%")).toBeTruthy();
  });
});
