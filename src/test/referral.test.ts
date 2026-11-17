import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  captureReferralFromUrl,
  clearStoredRef,
  getStoredRef,
  inviteMessage,
  inviteUrl,
  isReferralMissing,
  normalizeRef,
  refFromSearch,
  storeRef,
} from "@/lib/referral";

const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20261112000000_referrals.sql"), "utf8");

describe("normalizeRef", () => {
  it("accepts usernames, with or without @ and in any case", () => {
    expect(normalizeRef("asha_22")).toBe("asha_22");
    expect(normalizeRef(" @Asha ")).toBe("asha");
  });
  it("rejects anything that is not a valid username", () => {
    for (const bad of [null, undefined, "", "ab", "has space", "a".repeat(21), "x;drop", "../etc", "<b>hi</b>"]) {
      expect(normalizeRef(bad)).toBeNull();
    }
  });
});

describe("refFromSearch", () => {
  it("reads ref from a query string", () => {
    expect(refFromSearch("?ref=Asha")).toBe("asha");
    expect(refFromSearch("?a=1&ref=ben_k")).toBe("ben_k");
  });
  it("ignores a missing or bad ref", () => {
    expect(refFromSearch("")).toBeNull();
    expect(refFromSearch("?ref=")).toBeNull();
    expect(refFromSearch("?ref=no way")).toBeNull();
  });
});

describe("invite link", () => {
  it("points at the sign-up page with the username", () => {
    const url = inviteUrl("asha");
    expect(url).toMatch(/^https?:\/\/.+\/signup\?ref=asha$/);
    expect(refFromSearch(new URL(url).search)).toBe("asha");
  });
  it("puts the name and link in the message", () => {
    const m = inviteMessage("Asha", "https://x.test/signup?ref=asha");
    expect(m).toContain("Asha");
    expect(m).toContain("https://x.test/signup?ref=asha");
  });
});

describe("remembering the code", () => {
  beforeEach(() => localStorage.clear());

  it("stores, reads and clears it", () => {
    expect(getStoredRef()).toBeNull();
    storeRef("asha");
    expect(getStoredRef()).toBe("asha");
    clearStoredRef();
    expect(getStoredRef()).toBeNull();
  });
  it("ignores junk someone put in storage", () => {
    localStorage.setItem("sabzone_ref", "<script>");
    expect(getStoredRef()).toBeNull();
  });
  it("captures the code from the address bar", () => {
    window.history.pushState({}, "", "/signup?ref=Priya");
    expect(captureReferralFromUrl()).toBe("priya");
    expect(getStoredRef()).toBe("priya");
    window.history.pushState({}, "", "/");
  });
  it("keeps an earlier code when the address has none", () => {
    storeRef("asha");
    window.history.pushState({}, "", "/home");
    expect(captureReferralFromUrl()).toBeNull();
    expect(getStoredRef()).toBe("asha");
  });
});

describe("isReferralMissing", () => {
  it("recognises a database without the update", () => {
    expect(isReferralMissing({ code: "42P01" })).toBe(true);
    expect(isReferralMissing({ code: "PGRST202", message: "x" })).toBe(true);
    expect(isReferralMissing({ message: "could not find claim_referral" })).toBe(true);
    expect(isReferralMissing({ code: "23505", message: "dup" })).toBe(false);
    expect(isReferralMissing(null)).toBe(false);
  });
});

describe("the migration", () => {
  it("only lets the database record referrals (no client write access)", () => {
    expect(sql).toMatch(/grant select on public\.referrals to authenticated/);
    expect(sql).not.toMatch(/grant[^;]*(insert|update|delete)[^;]*on public\.referrals/i);
  });
  it("is safe to run twice and covers every result the app understands", () => {
    expect(sql).toMatch(/create table if not exists public\.referrals/);
    expect(sql).toMatch(/drop trigger if exists push_on_referral/);
    for (const r of ["'ok'", "'already'", "'self'", "'unknown_code'", "'too_late'"]) expect(sql).toContain(r);
  });
});
