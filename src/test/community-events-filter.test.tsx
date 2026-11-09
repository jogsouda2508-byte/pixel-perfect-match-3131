import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { activeEventFilterCount, eventFilterSummary } from "@/lib/community";

vi.mock("@/lib/community", async (orig) => {
  const real = await orig<typeof import("@/lib/community")>();
  return { ...real, fetchEvents: vi.fn().mockResolvedValue([]) };
});

import { EventsTab } from "@/components/community/events";

describe("event filter helpers", () => {
  it("counts only filters that differ from the default", () => {
    expect(activeEventFilterCount("upcoming", "")).toBe(0);
    expect(activeEventFilterCount("upcoming", "Sports")).toBe(1);
    expect(activeEventFilterCount("past", "")).toBe(1);
    // a category is ignored (and not counted) outside Upcoming
    expect(activeEventFilterCount("past", "Sports")).toBe(1);
  });
  it("summarises what is showing", () => {
    expect(eventFilterSummary("upcoming", "")).toBe("Upcoming");
    expect(eventFilterSummary("upcoming", "Sports")).toBe("Upcoming · Sports");
    expect(eventFilterSummary("going", "Sports")).toBe("My plans");
  });
});

describe("Events tab on phones", () => {
  const renderTab = () =>
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <EventsTab locality={null} meId="u1" />
      </QueryClientProvider>,
    );

  it("has a Filter button and a floating + that hosts an event", () => {
    renderTab();
    expect(screen.getByRole("button", { name: "Filter" })).toBeTruthy();
    const fab = screen.getByRole("button", { name: "Host an event" });
    expect(fab.className).toContain("fixed");
    expect(fab.parentElement).toBe(document.body); // portal: never trapped inside a transformed card
  });

  it("opens the filter sheet and applies a choice", async () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(await screen.findByText("Filter events")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Sports" }).at(-1)!);
    expect(screen.getByRole("button", { name: "Filter, 1 selected", hidden: true })).toBeTruthy();
  });
});
