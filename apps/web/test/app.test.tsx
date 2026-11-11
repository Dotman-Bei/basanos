import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";

describe("App", () => {
  it("renders the shared header and the home view by default", () => {
    window.location.hash = "#/";
    render(<App />);
    expect(screen.getByRole("link", { name: "Take a challenge" }).getAttribute("href")).toBe("#/challenge");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Recent verdicts");
    expect(screen.getByText("Every certificate is chain-checked at mint; every verdict is replayable.")).toBeTruthy();
  });
});
