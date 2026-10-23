import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from: vi.fn() } }));

import { followLabel, isProfileLocked, nextFollowAction } from "@/lib/follow-state";
import { NOTIFICATION_TABS, notificationMatchesTab } from "@/lib/notification-tabs";
import { respondFollowRequest, sendFollowRequest } from "@/lib/social";

describe("follow button state", () => {
  it("picks the right action", () => {
    expect(nextFollowAction(false, false)).toBe("follow");
    expect(nextFollowAction(true, false)).toBe("unfollow");
    expect(nextFollowAction(false, true)).toBe("cancel");
    // following always wins, even if a stale request is still remembered
    expect(nextFollowAction(true, true)).toBe("unfollow");
  });

  it("labels Follow / Requested / Following", () => {
    expect(followLabel(false, false)).toBe("Follow");
    expect(followLabel(false, true)).toBe("Requested");
    expect(followLabel(true, false)).toBe("Following");
    expect(followLabel(true, true)).toBe("Following");
  });
});

describe("isProfileLocked", () => {
  it("locks only private accounts that are not mine and not followed", () => {
    expect(isProfileLocked({ isPrivate: true, isMe: false, following: false })).toBe(true);
    expect(isProfileLocked({ isPrivate: true, isMe: false, following: true })).toBe(false);
    expect(isProfileLocked({ isPrivate: true, isMe: true, following: false })).toBe(false);
    expect(isProfileLocked({ isPrivate: false, isMe: false, following: false })).toBe(false);
  });
});

describe("notificationMatchesTab", () => {
  it("shows follow requests and accepted requests under Follows, and everything under All", () => {
    expect(notificationMatchesTab("follow_request", "Follows")).toBe(true);
    expect(notificationMatchesTab("follow_accepted", "Follows")).toBe(true);
    expect(notificationMatchesTab("follow", "Follows")).toBe(true);
    expect(notificationMatchesTab("follow_request", "Likes")).toBe(false);
    expect(notificationMatchesTab("story_like", "Likes")).toBe(true);
    for (const kind of ["like", "follow_request", "follow_accepted", "tag"] as const) {
      expect(notificationMatchesTab(kind, "All")).toBe(true);
    }
    expect(NOTIFICATION_TABS).toContain("Follows");
  });
});

describe("follow request API", () => {
  beforeEach(() => rpc.mockReset());

  it("reports whether the follow was instant or only requested", async () => {
    rpc.mockResolvedValueOnce({ data: "following", error: null });
    await expect(sendFollowRequest("u2")).resolves.toBe("following");
    rpc.mockResolvedValueOnce({ data: "requested", error: null });
    await expect(sendFollowRequest("u3")).resolves.toBe("requested");
    expect(rpc).toHaveBeenCalledWith("send_follow_request", { p_target: "u3" });
  });

  it("accepts and declines through the database function", async () => {
    rpc.mockResolvedValueOnce({ data: "accepted", error: null });
    await expect(respondFollowRequest("u2", true)).resolves.toBe("accepted");
    expect(rpc).toHaveBeenCalledWith("respond_follow_request", {
      p_requester: "u2",
      p_accept: true,
    });
    rpc.mockResolvedValueOnce({ data: "declined", error: null });
    await expect(respondFollowRequest("u2", false)).resolves.toBe("declined");
  });

  it("treats an already-answered request as done, but still throws real errors", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "request_not_found" } });
    await expect(respondFollowRequest("u2", true)).resolves.toBe("accepted");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(respondFollowRequest("u2", true)).rejects.toThrow();
  });
});
