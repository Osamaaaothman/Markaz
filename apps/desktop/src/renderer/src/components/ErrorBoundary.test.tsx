import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import "../i18n";
import { ErrorBoundary } from "./ErrorBoundary";

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("boom");
  return <div>recovered</div>;
}

function renderBoundary(shouldThrow: boolean) {
  return render(
    <MantineProvider>
      <ErrorBoundary>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>
    </MantineProvider>,
  );
}

describe("ErrorBoundary", () => {
  it("shows the fatal error screen when a child throws, and recovers on retry", () => {
    // Error boundaries log to console.error by design; keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { rerender } = renderBoundary(true);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    rerender(
      <MantineProvider>
        <ErrorBoundary>
          <Bomb shouldThrow={false} />
        </ErrorBoundary>
      </MantineProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByText("recovered")).toBeInTheDocument();
  });
});
