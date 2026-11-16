import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitReport, toast } = vi.hoisted(() => ({
  submitReport: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("@/lib/safety", async () => {
  const actual = await vi.importActual<object>("@/lib/safety");
  return { ...actual, submitReport: (...a: unknown[]) => submitReport(...a) };
});

import { ReportSheet } from "@/components/report-sheet";

function renderSheet(onOpenChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ReportSheet open onOpenChange={onOpenChange} targetType="post" targetId="p1" targetUserId="u1" />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

describe("ReportSheet", () => {
  beforeEach(() => {
    submitReport.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
  });

  it("cannot send until a reason is chosen", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: "Send report" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/^Spam/));
    expect(screen.getByRole("button", { name: "Send report" })).toBeEnabled();
  });

  it("sends the reason, the note and who wrote it, then closes", async () => {
    submitReport.mockResolvedValue("sent");
    const onOpenChange = renderSheet();
    fireEvent.click(screen.getByLabelText(/^Scam or fraud/));
    fireEvent.change(screen.getByLabelText(/Anything else/), { target: { value: "asks for money" } });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(submitReport).toHaveBeenCalled());
    expect(submitReport).toHaveBeenCalledWith("me", {
      targetType: "post",
      targetId: "p1",
      targetUserId: "u1",
      reason: "scam",
      details: "asks for money",
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.success).toHaveBeenCalled();
  });

  it("says thanks (not an error) when the same thing was reported before", async () => {
    submitReport.mockResolvedValue("already");
    renderSheet();
    fireEvent.click(screen.getByLabelText(/^Spam/));
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.success.mock.calls[0]![0]).toMatch(/already reported/);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows the problem and stays open when sending fails", async () => {
    submitReport.mockRejectedValue(new Error("Couldn't send your report. Please try again."));
    const onOpenChange = renderSheet();
    fireEvent.click(screen.getByLabelText(/^Spam/));
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
