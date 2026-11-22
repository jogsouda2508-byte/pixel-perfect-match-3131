import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, resetPasswordForEmail, requestPasswordReset } = vi.hoisted(() => ({
  rpc: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  requestPasswordReset: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc, auth: { resetPasswordForEmail } },
}));
vi.mock("@/lib/auth-lookup", () => ({ requestPasswordReset }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@tanstack/react-router", async (orig) => ({
  ...(await orig<object>()),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

import { Route } from "@/routes/forgot-password";

const Page = Route.options.component as () => React.JSX.Element;

async function submit(text: string) {
  render(<Page />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: [], error: null });
  resetPasswordForEmail.mockResolvedValue({ error: null });
});

describe("forgot password", () => {
  it("server path: shows the same 'check your inbox' screen and never touches the email lookup", async () => {
    requestPasswordReset.mockResolvedValue({ kind: "ok" });
    await submit("alice");
    await screen.findByText(/check your inbox/i);
    expect(requestPasswordReset).toHaveBeenCalledWith("alice", expect.any(String));
    expect(rpc).not.toHaveBeenCalled();
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
    // the several-accounts hint is shown for EVERYONE, so it can't reveal how many accounts exist
    expect(screen.getByText(/more than one account/i)).toBeTruthy();
  });

  it("rate limited: tells the person to wait and does not claim a link was sent", async () => {
    requestPasswordReset.mockResolvedValue({ kind: "limited" });
    await submit("alice");
    await screen.findByText(/too many requests/i);
    expect(screen.queryByText(/check your inbox/i)).toBeNull();
  });

  it("server error: shows an error, no fallback to the email lookup", async () => {
    requestPasswordReset.mockResolvedValue({ kind: "error" });
    await submit("alice");
    await screen.findByText(/couldn't send the reset link/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("only when the function is missing does it use the legacy path", async () => {
    requestPasswordReset.mockResolvedValue({ kind: "unavailable" });
    rpc.mockResolvedValue({ data: ["a@x.com"], error: null });
    await submit("alice");
    await waitFor(() =>
      expect(resetPasswordForEmail).toHaveBeenCalledWith("a@x.com", expect.anything()),
    );
    expect(rpc).toHaveBeenCalledWith("get_reset_emails", { p_identifier: "alice" });
    await screen.findByText(/check your inbox/i);
  });
});
