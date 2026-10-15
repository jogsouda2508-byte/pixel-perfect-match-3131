import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc },
}));

import { shareErrorMessage, shareVideoWithUser } from "@/lib/video-share";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("shareErrorMessage", () => {
  it("maps the server's rejection codes to readable messages", () => {
    expect(shareErrorMessage("not_following_recipient")).toMatch(/people you follow/);
    expect(shareErrorMessage("recipient_cannot_view_post")).toMatch(/audience settings/);
    expect(shareErrorMessage("post_not_found")).toMatch(/no longer available/);
    expect(shareErrorMessage("recipient_not_found")).toMatch(/no longer exists/);
    expect(shareErrorMessage("invalid_recipient")).toMatch(/someone else/);
    expect(shareErrorMessage("not_authenticated")).toMatch(/sign in/);
  });

  it("finds the code inside a longer database message and has a safe fallback", () => {
    expect(shareErrorMessage("ERROR: not_following_recipient (P0001)")).toMatch(
      /people you follow/,
    );
    expect(shareErrorMessage("connection reset")).toMatch(/Couldn't share/);
    expect(shareErrorMessage(null)).toMatch(/Couldn't share/);
    expect(shareErrorMessage(undefined)).toMatch(/Couldn't share/);
  });
});

describe("shareVideoWithUser", () => {
  it("calls the share_post_to_user RPC and returns the conversation id", async () => {
    rpc.mockResolvedValue({ data: "conv-1", error: null });

    await expect(shareVideoWithUser("post-1", "user-2")).resolves.toBe("conv-1");

    expect(rpc).toHaveBeenCalledWith("share_post_to_user", {
      p_post_id: "post-1",
      p_recipient_id: "user-2",
    });
  });

  it("surfaces the backend refusal for someone the sender does not follow", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not_following_recipient" } });

    await expect(shareVideoWithUser("post-1", "stranger")).rejects.toThrow(
      "You can only share videos with people you follow.",
    );
  });

  it("fails clearly when the RPC returns nothing", async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    await expect(shareVideoWithUser("post-1", "user-2")).rejects.toThrow(/Couldn't share/);
  });
});
