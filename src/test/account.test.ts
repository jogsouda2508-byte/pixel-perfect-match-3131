import { describe, expect, it } from "vitest";
import { DELETE_WORD, USER_BUCKETS, isDeleteConfirmed } from "@/lib/account";

describe("account deletion", () => {
  it("needs the confirmation word, in any case", () => {
    expect(isDeleteConfirmed("delete")).toBe(true);
    expect(isDeleteConfirmed("  Delete ")).toBe(true);
    expect(isDeleteConfirmed(DELETE_WORD)).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isDeleteConfirmed("")).toBe(false);
    expect(isDeleteConfirmed("deleted")).toBe(false);
    expect(isDeleteConfirmed("del")).toBe(false);
  });
  it("cleans every bucket the app uploads to", () => {
    expect([...USER_BUCKETS].sort()).toEqual(["avatars", "chat-media", "media", "videos", "voice"]);
  });
});
