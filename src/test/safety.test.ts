import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blockedMessage,
  dropMuted,
  isBlockedError,
  isSafetyMissing,
  REPORT_REASONS,
  reportErrorMessage,
  SAFETY_MIGRATION_HINT,
} from "@/lib/safety";

const sql = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20261111000000_block_mute_report.sql"),
  "utf8",
);

describe("dropMuted", () => {
  const rows = [
    { id: 1, author_id: "a" },
    { id: 2, author_id: "b" },
    { id: 3, author_id: "a" },
  ];
  it("leaves out rows by muted people", () => {
    expect(dropMuted(rows, new Set(["a"])).map((r) => r.id)).toEqual([2]);
  });
  it("returns everything when nobody is muted", () => {
    expect(dropMuted(rows, new Set())).toBe(rows);
  });
});

describe("isSafetyMissing", () => {
  it("recognises a database that has not had the update", () => {
    expect(isSafetyMissing({ code: "42P01", message: "x" })).toBe(true);
    expect(isSafetyMissing({ code: "PGRST205", message: "x" })).toBe(true);
    expect(isSafetyMissing({ code: "PGRST202", message: "x" })).toBe(true);
    expect(isSafetyMissing({ message: 'relation "public.reports" does not exist' })).toBe(true);
  });
  it("ignores other errors", () => {
    expect(isSafetyMissing({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(isSafetyMissing(null)).toBe(false);
  });
});

describe("blocked errors", () => {
  it("spots the database's 'blocked' refusal", () => {
    expect(isBlockedError({ message: "blocked" })).toBe(true);
    expect(isBlockedError({ message: "Blocked " })).toBe(true);
    expect(isBlockedError({ message: "not_allowed" })).toBe(false);
    expect(isBlockedError(null)).toBe(false);
  });
  it("gives a plain message for a block and the fallback otherwise", () => {
    expect(blockedMessage({ message: "blocked" }, "fallback")).toBe(
      "You can't do that with this person.",
    );
    expect(blockedMessage(new Error("network down"), "fallback")).toBe("fallback");
    expect(blockedMessage("oops", "fallback")).toBe("fallback");
  });
});

describe("reportErrorMessage", () => {
  it("explains the daily limit, the missing update, and anything else", () => {
    expect(reportErrorMessage({ message: "too_many_reports" })).toMatch(/tomorrow/);
    expect(reportErrorMessage({ code: "42P01", message: "x" })).toBe(SAFETY_MIGRATION_HINT);
    expect(reportErrorMessage({ message: "boom" })).toMatch(/Couldn't send/);
  });
});

describe("report reasons match the database", () => {
  it("every reason in the app is allowed by the SQL check, and the other way round", () => {
    const check = sql.match(/reason\s+text not null check \(reason in\s*\(([^)]*)\)/);
    expect(check).not.toBeNull();
    const inSql = [...check![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(REPORT_REASONS.map((r) => r.value).sort()).toEqual(inSql);
  });
  it("has a label and a hint for each", () => {
    for (const r of REPORT_REASONS) {
      expect(r.label.length).toBeGreaterThan(2);
      expect(r.hint.length).toBeGreaterThan(2);
    }
  });
});

describe("the migration", () => {
  it("protects the tables people read content from", () => {
    for (const t of ["posts", "post_comments", "stories", "community_listings"]) {
      expect(sql).toContain(`'${t}'`);
    }
    expect(sql).toMatch(/as restrictive for select/);
  });
  it("is safe to run twice", () => {
    expect(sql).toMatch(/create table if not exists public\.blocks/);
    expect(sql).toMatch(/create table if not exists public\.mutes/);
    expect(sql).toMatch(/create table if not exists public\.reports/);
    expect(sql).toMatch(/drop trigger if exists messages_block_check/);
  });
  it("never lets a client read the internal two-person check", () => {
    expect(sql).toMatch(
      /revoke all on function public\.blocked_between\(uuid, uuid\) from public, anon, authenticated/,
    );
  });
});
