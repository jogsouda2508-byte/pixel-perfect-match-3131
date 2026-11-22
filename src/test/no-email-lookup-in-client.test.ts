import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// get_login_email / get_reset_emails hand back real email addresses. They must only ever be called
// from the two documented legacy fallbacks (used while the auth-lookup edge function is not yet
// deployed). Any other caller would re-open the email-enumeration hole this patch closes.
const ALLOWED = new Set(["src/lib/auth.tsx", "src/routes/forgot-password.tsx"]);
// Matches real calls such as supabase.rpc("get_login_email", ...), not mentions in comments.
const FORBIDDEN = /rpc\(\s*["'`](get_login_emails?|get_reset_emails)["'`]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("client code and email lookups", () => {
  const root = path.resolve(__dirname, "../..");
  const files = walk(path.join(root, "src")).filter(
    (f) => !f.includes(`${path.sep}test${path.sep}`) && !f.includes("integrations"),
  );

  it("only the two legacy fallbacks mention the email-returning RPCs", () => {
    const offenders = files
      .filter((f) => FORBIDDEN.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f).split(path.sep).join("/"))
      .filter((f) => !ALLOWED.has(f));
    expect(offenders).toEqual([]);
  });

  it("the legacy fallbacks are marked for removal", () => {
    for (const f of ALLOWED) {
      const text = readFileSync(path.join(root, f), "utf8");
      expect(text).toMatch(/TODO: remove once 20261118000001_revoke_email_lookup/);
    }
  });

  it("the get_login_emails RPC (unused by the app) is not called anywhere", () => {
    const users = files.filter((f) =>
      /rpc\(\s*["'`]get_login_emails["'`]/.test(readFileSync(f, "utf8")),
    );
    expect(users).toEqual([]);
  });
});
