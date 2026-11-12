import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Header } from "../src/App";
import { NO_RUNS_TEXT, READING_TEXT, RunList } from "../src/pages/Home";
import { RunNotFound, runMissing } from "../src/pages/Verdict";

describe("header: the kit's nav (docs/design/frontend.md)", () => {
  it("uses the kit header: header.nav > .wrap.nav__bar with the logo, the links, one filled button and the menu toggle", () => {
    const { container } = render(<Header current="home" />);
    const bar = container.querySelector("header.nav > .wrap.nav__bar");
    expect(bar).toBeTruthy();
    expect(bar?.querySelector(".nav__logo .mark[data-mark='ring']")).toBeTruthy();
    const link = bar?.querySelector(".nav__links .nav__item .nav__link");
    expect(link?.textContent).toBe("Verdicts");
    expect(link?.getAttribute("aria-current")).toBe("page");
    expect(bar?.querySelectorAll(".nav__actions .btn.btn--primary")).toHaveLength(1);
    expect(container.querySelector("a.link, .nav > .wrap:not(.nav__bar)")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Menu" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(container.querySelector("header")?.className).toBe("nav is-open");
    expect(document.body.classList.contains("nav-locked")).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector("header")?.className).toBe("nav");
    expect(document.body.classList.contains("nav-locked")).toBe(false);
  });
});

describe("plain empty states", () => {
  it("says while it reads and when there are no verdicts yet", () => {
    const { container, rerender } = render(<RunList runs={null} />);
    expect(container.textContent).toBe(READING_TEXT);
    rerender(<RunList runs={[]} />);
    expect(container.textContent).toBe(NO_RUNS_TEXT);
  });
  it("shows a run the registry never issued as not found, not as an empty verdict", () => {
    expect(runMissing({ status: 0, account: "0x0000000000000000000000000000000000000000" })).toBe(true);
    expect(runMissing({ status: 3, account: "0x00000000000000000000000000000000000000a1" })).toBe(false);
    render(<RunNotFound runId={99n} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Run 99 not found");
    expect(screen.getByText(/No run 99 is in the registry/)).toBeTruthy();
  });
});
