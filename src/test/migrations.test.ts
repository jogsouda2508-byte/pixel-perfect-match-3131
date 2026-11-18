import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

describe("supabase migrations", () => {
  it("has migrations", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("every file starts with a 14-digit version (YYYYMMDDHHMMSS_name.sql)", () => {
    const bad = files.filter((f) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(f));
    expect(bad).toEqual([]);
  });

  // `supabase db push` stores the version in a primary-keyed table, so two files with the same
  // version fail with "duplicate key value violates unique constraint schema_migrations_pkey".
  it("has no two migrations sharing a version", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const f of files) {
      const v = f.slice(0, 14);
      const other = seen.get(v);
      if (other) dupes.push(`${other} <-> ${f}`);
      else seen.set(v, f);
    }
    expect(dupes).toEqual([]);
  });

  it("referrals hardening runs after the referrals migration", () => {
    const base = files.findIndex((f) => f.endsWith("_referrals.sql"));
    const hardening = files.findIndex((f) => f.endsWith("_referrals_hardening.sql"));
    expect(base).toBeGreaterThanOrEqual(0);
    expect(hardening).toBeGreaterThan(base);
  });

  it("never embeds a service-role key or JWT in SQL", () => {
    for (const f of files) {
      const sql = readFileSync(path.join(DIR, f), "utf8");
      expect(sql, f).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
    }
  });
});
