import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static guards for the database's speed and safety. They read the migration files, so they run in
// plain CI without a database. The real-Postgres versions of the same checks are in
// supabase/tests/replay/performance.assert.sql.

const DIR = path.resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const read = (name: string) => readFileSync(path.join(DIR, name), "utf8");
const strip = (sql: string) => sql.replace(/--[^\n]*/g, "");

const PERF = "20261117000000_backend_performance.sql";
const RLS = "20261117000001_rls_initplan.sql";

// ---- foreign keys without an index of their own ---------------------------------------------

type Table = { fks: { col: string; target: string }[]; lead: Set<string> };

function splitTop(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim());
}

const firstCol = (text: string): string | undefined => {
  const inside = /\(([^)]*)\)/.exec(text)?.[1] ?? "";
  return /\w+/.exec(inside)?.[0];
};

/** Foreign-key columns that no primary key, unique constraint or index starts with. */
export function foreignKeysWithoutIndex(sqlFiles: string[]): string[] {
  const sql = strip(sqlFiles.join("\n"));
  const tables = new Map<string, Table>();
  const table = (n: string): Table => {
    let t = tables.get(n);
    if (!t) tables.set(n, (t = { fks: [], lead: new Set() }));
    return t;
  };

  const create = /create table(?: if not exists)? (?:public\.)?(\w+)\s*\(([\s\S]*?)\n\)\s*;/gi;
  for (const m of sql.matchAll(create)) {
    const t = table(m[1] ?? "");
    for (const part of splitTop(m[2] ?? "")) {
      const low = part.toLowerCase();
      if (low.startsWith("primary key") || low.startsWith("unique")) {
        const c = firstCol(part);
        if (c) t.lead.add(c);
      } else if (/^(constraint|check|foreign key)/.test(low)) {
        const fk = /foreign key\s*\((\w+)\)\s*references\s+(?:public\.)?([\w.]+)/i.exec(part);
        if (fk) t.fks.push({ col: fk[1] ?? "", target: fk[2] ?? "" });
        const u = /unique\s*\(([^)]*)\)/i.exec(part);
        const uc = u ? /\w+/.exec(u[1] ?? "")?.[0] : undefined;
        if (uc) t.lead.add(uc);
        const pk = /primary key\s*\(([^)]*)\)/i.exec(part);
        const pc = pk ? /\w+/.exec(pk[1] ?? "")?.[0] : undefined;
        if (pc) t.lead.add(pc);
      } else {
        const col = /^(\w+)\s/.exec(part)?.[1];
        if (!col) continue;
        if (low.includes("primary key") || / unique/.test(low)) t.lead.add(col);
        const ref = /references\s+(?:public\.)?([\w.]+)/i.exec(part);
        if (ref) t.fks.push({ col, target: ref[1] ?? "" });
      }
    }
  }

  const alter =
    /alter table(?: if exists)?(?: only)? (?:public\.)?(\w+)\s+add column(?: if not exists)? (\w+)([^;]*?)(?:;|,\s*add column)/gi;
  for (const m of sql.matchAll(alter)) {
    const ref = /references\s+(?:public\.)?([\w.]+)/i.exec(m[3] ?? "");
    if (ref) table(m[1] ?? "").fks.push({ col: m[2] ?? "", target: ref[1] ?? "" });
  }

  const index =
    /create (?:unique )?index(?: if not exists)? \w+\s+on\s+(?:public\.)?(\w+)(?:\s+using\s+\w+)?\s*\(\s*([^)]*?)\)/gi;
  for (const m of sql.matchAll(index)) {
    const c = /\w+/.exec(m[2] ?? "")?.[0];
    if (c) table(m[1] ?? "").lead.add(c);
  }

  const missing: string[] = [];
  for (const [name, t] of [...tables].sort(([a], [b]) => a.localeCompare(b))) {
    for (const fk of t.fks) if (!t.lead.has(fk.col)) missing.push(`${name}.${fk.col} -> ${fk.target}`);
  }
  return missing;
}

describe("foreign-key indexes", () => {
  it("every foreign key column starts an index (deleting a person must not scan whole tables)", () => {
    expect(foreignKeysWithoutIndex(files.map(read))).toEqual([]);
  });

  it("the checker really catches a missing index (and accepts a covered one)", () => {
    const parent = "create table public.parent (\n  id uuid primary key\n);";
    const child = (extra: string) =>
      "create table public.child (\n  id uuid,\n" +
      `  parent_id uuid references public.parent (id) on delete cascade${extra}\n);`;
    const bad = `${parent}\n${child("")}`;
    expect(foreignKeysWithoutIndex([bad])).toEqual(["child.parent_id -> parent"]);
    const indexed = `${bad}\ncreate index child_parent_idx on public.child (parent_id);`;
    expect(foreignKeysWithoutIndex([indexed])).toEqual([]);
    // the FK column leading a composite key counts; trailing it does not
    const leading = `${parent}\n${child(",\n  primary key (parent_id, id)")}`;
    expect(foreignKeysWithoutIndex([leading])).toEqual([]);
    const trailing = `${parent}\n${child(",\n  primary key (id, parent_id)")}`;
    expect(foreignKeysWithoutIndex([trailing])).toEqual(["child.parent_id -> parent"]);
  });
});

// ---- row-level security stays exactly as strict, only faster --------------------------------

describe("row-level-security speed-up", () => {
  const sql = strip(read(RLS));

  it("only alters policies: it never drops or creates one", () => {
    expect(/drop\s+policy/i.test(sql)).toBe(false);
    expect(/create\s+policy/i.test(sql)).toBe(false);
    expect(/alter policy/i.test(sql)).toBe(true);
  });

  it("changes only the expressions, never the roles or the command", () => {
    // ALTER POLICY without TO keeps the roles; FOR / TO would be a syntax error anyway
    expect(/alter policy[^;]*\bto\b/i.test(sql.replace(/format\([^)]*\)/gi, ""))).toBe(false);
  });

  it("checks that the set of policies is unchanged and aborts if not", () => {
    expect(sql).toMatch(/pg_policies/);
    expect(sql).toMatch(/raise exception/i);
  });

  it("is safe to run twice: it skips an auth.uid() that is already wrapped", () => {
    expect(sql).toContain("(?<!select )auth");
  });

  it("migrations after it keep writing (select auth.uid()) in new policies", () => {
    const later = files.filter((f) => f > RLS);
    const offenders: string[] = [];
    for (const f of later) {
      for (const m of strip(read(f)).matchAll(/create\s+policy[\s\S]*?;/gi)) {
        if (/(?<!select\s)auth\.uid\(\)/i.test(m[0])) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---- the performance migration changes no data and no permission ---------------------------

describe("backend performance migration", () => {
  const sql = strip(read(PERF));

  it("only adds indexes and replaces the one count function", () => {
    expect(/\b(delete|truncate|drop|update|insert)\b/i.test(sql)).toBe(false);
    expect(/alter\s+table/i.test(sql)).toBe(false);
    expect(/create\s+(or replace\s+)?function/gi.exec(sql)).not.toBe(null);
    const functions = [...sql.matchAll(/create or replace function ([\w.]+)/gi)].map((m) => m[1]);
    expect(functions).toEqual(["public.get_unread_notification_count"]);
  });

  it("every index is idempotent and inside the transaction (no CONCURRENTLY)", () => {
    const creates = [...sql.matchAll(/create\s+index[^;]*;/gi)].map((m) => m[0]);
    expect(creates.length).toBeGreaterThan(20);
    for (const c of creates) expect(c).toMatch(/if not exists/i);
    expect(/concurrently/i.test(sql)).toBe(false);
  });

  it("keeps the unread count a plain (RLS-respecting) function open to signed-in users only", () => {
    expect(/security\s+definer/i.test(sql)).toBe(false);
    expect(sql).toMatch(
      /revoke all on function public\.get_unread_notification_count\(\) from public, anon;/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_unread_notification_count\(\) to authenticated;/i,
    );
  });

  it("counts the same kinds as the notification list, and never a chat share", () => {
    const body = sql.slice(sql.indexOf("create or replace function"));
    for (const table of [
      "post_likes",
      "post_comments",
      "follows",
      "post_tags",
      "story_views",
      "follow_requests",
    ]) {
      expect(body.includes(`public.${table}`)).toBe(true);
    }
    expect(body.includes("shared_post_id")).toBe(false);
    expect(body.includes("public.messages")).toBe(false);
  });
});
