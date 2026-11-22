/**
 * Repository-wide guards. They read the source files and fail when a known-dangerous pattern
 * appears, so the fixes in docs/SECURITY-UI.md cannot be undone by accident.
 * If one fails for a good reason, fix the code or update the allow-list here AND the docs.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRedirect } from "@/components/auth-gate";
import { safeAppPath } from "@/lib/native-push";

const ROOT = path.resolve(__dirname, "..");
const SKIP = ["/test/", "routeTree.gen.ts", "integrations/supabase/types.ts"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}
const FILES = walk(ROOT)
  .filter((f) => !SKIP.some((s) => f.replaceAll("\\", "/").includes(s)))
  .map((f) => ({
    file: path.relative(ROOT, f).replaceAll("\\", "/"),
    text: readFileSync(f, "utf8"),
  }));

const hits = (re: RegExp) =>
  FILES.flatMap(({ file, text }) => (text.match(re) ?? []).map(() => file));

describe("unsafe rendering", () => {
  it("dangerouslySetInnerHTML is used only in the two reviewed places", () => {
    expect([...new Set(hits(/dangerouslySetInnerHTML/g))].sort()).toEqual([
      "components/profile-qr.tsx",
      "components/ui/chart.tsx",
    ]);
  });
  it("the QR card that uses it escapes its input", () => {
    const qr = FILES.find((f) => f.file === "components/profile-qr.tsx")!.text;
    expect(qr).toMatch(/escapeXml\(label\)/);
    expect(qr).toMatch(/isHexColor\(fg\)/);
  });
  it("no direct HTML sinks, dynamic code or document.write anywhere", () => {
    expect(hits(/\.(innerHTML|outerHTML)\s*=[^=]/g)).toEqual([]);
    expect(hits(/insertAdjacentHTML|document\.write\s*\(/g)).toEqual([]);
    expect(hits(/\beval\s*\(|new Function\s*\(/g)).toEqual([]);
    expect(hits(/\bsrcDoc\s*=|\bsrcdoc\s*=/g)).toEqual([]);
  });
  it("no javascript: or data: URL literals in links", () => {
    expect(hits(/href=["'`]\s*(javascript|data|vbscript):/gi)).toEqual([]);
  });
});

describe("links and redirects", () => {
  it('every target="_blank" anchor sets rel with noopener and noreferrer', () => {
    const bad: string[] = [];
    for (const { file, text } of FILES) {
      for (const m of text.matchAll(/<a\b[^>]*?>/gs)) {
        const tag = m[0];
        if (
          tag.includes("_blank") &&
          !/rel="[^"]*noopener[^"]*noreferrer|rel="[^"]*noreferrer[^"]*noopener/.test(tag)
        )
          bad.push(file);
      }
    }
    expect(bad).toEqual([]);
  });
  it("window.open is not used (it would need its own noopener handling)", () => {
    expect(hits(/window\.open\s*\(/g)).toEqual([]);
  });
  it("only known third-party hosts are written into the code (keep the CSP and docs in sync)", () => {
    const allowed = new Set([
      "wa.me", // WhatsApp share / contact links
      "www.w3.org", // SVG namespace
      "fonts.googleapis.com",
      "api.giphy.com",
      "media.giphy.com",
      "itunes.apple.com",
      "photon.komoot.io",
      "pixel-perfect-match-3131.onrender.com", // the public site (invite links)
      "www.facebook.com",
      "twitter.com",
      "t.me",
      "placeholder.supabase.co", // client.ts placeholder when env vars are missing
      "fonts.gstatic.com", // font files for the Google Fonts stylesheet (preconnect)
      // examples inside comments, and a base for parsing relative URLs; never contacted
      "site.com",
      "mysite.com",
      "abcd.supabase.co",
      "placeholder.invalid",
    ]);
    const found = new Set<string>();
    for (const { text } of FILES)
      for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi))
        found.add(m[1]!.toLowerCase());
    expect([...found].filter((h) => !allowed.has(h)).sort()).toEqual([]);
  });
  it("AuthGate can only ever redirect to fixed in-app paths", () => {
    const outputs = new Set<unknown>();
    const paths = [
      "/",
      "/login",
      "/home",
      "/post/x",
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "/u/%2f%2fevil",
      "javascript:alert(1)",
      "/onboarding",
      "",
    ];
    for (const p of paths)
      for (const session of [true, false])
        for (const onboardingDone of [true, false])
          outputs.add(resolveRedirect(p, { session, onboardingDone }));
    expect(
      [...outputs].every(
        (o) => o === null || ["/login", "/home", "/onboarding"].includes(o as string),
      ),
    ).toBe(true);
  });
});

describe("sensitive data", () => {
  it("no secret keys or JWTs are written into the app code", () => {
    expect(hits(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)).toEqual([]);
    expect(hits(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g)).toEqual([]);
    expect(
      hits(/SERVICE_ROLE|service_role/g).filter((f) => !f.endsWith("supabase/client.ts")),
    ).toEqual([]);
  });
  it("nothing secret is put in browser storage by the app (Supabase manages its own session key)", () => {
    const bad: string[] = [];
    for (const { file, text } of FILES)
      for (const m of text.matchAll(/(?:localStorage|sessionStorage)\.setItem\(([^)]*)\)/g))
        if (/password|secret|access_token|refresh_token|service/i.test(m[1]!)) bad.push(file);
    expect(bad).toEqual([]);
  });
  it("raw error messages are not shown to people (they reveal tables, columns and constraints)", () => {
    const bad: string[] = [];
    for (const { file, text } of FILES) {
      if (file.startsWith("lib/")) continue; // library code decides what to throw; screens decide what to show
      if (/toast\.(error|warning|message|info)\(\s*(?:\w+\.)?(?:e|err|error)\.message/.test(text))
        bad.push(file);
      if (/instanceof Error\s*\?\s*[\w.]+\.message/.test(text)) bad.push(file);
      if (/\{\s*[\w.]*(?:error|err|e)\.message\s*\}/.test(text)) bad.push(file);
    }
    expect([...new Set(bad)]).toEqual([]);
  });
});

describe("server headers", () => {
  it("the server entry applies the security headers to every response", () => {
    const server = readFileSync(path.join(ROOT, "server.ts"), "utf8");
    expect(server).toContain("securityHeaders");
    expect(server.match(/withSecurityHeaders\(/g)?.length).toBeGreaterThanOrEqual(2); // success AND error page
  });
});

describe("service worker: where a notification click may go", () => {
  // public/sw.js is plain JS served as-is, so load its validator from the file itself
  const source = readFileSync(path.resolve(ROOT, "..", "public", "sw.js"), "utf8");
  const fn = source.match(/function safeUrl\(url\) \{[\s\S]*?\n\}/)![0];
  const make = (origin: string) =>
    new Function("self", "URL", `${fn}; return safeUrl;`)({ location: { origin } }, URL) as (
      u: unknown,
    ) => string;
  const safeUrl = make("https://app.sabzone.example");

  it("keeps same-origin paths (with query and hash)", () => {
    expect(safeUrl("/chat/123")).toBe("/chat/123");
    expect(safeUrl("/post/9?comments=true#c")).toBe("/post/9?comments=true#c");
    expect(safeUrl("https://app.sabzone.example/home")).toBe("/home");
  });
  it.each([
    "https://evil.example/phish",
    "//evil.example/phish",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https://app.sabzone.example.evil.example/",
    "https://app.sabzone.example@evil.example/",
    "http://app.sabzone.example/downgrade",
  ])("sends %j to the home page instead", (url) => {
    expect(safeUrl(url)).toBe("/");
  });
  it("copes with garbage", () => {
    for (const v of [undefined, null, "", "   ", 42, {}]) expect(safeUrl(v)).toMatch(/^\//);
  });
});

describe("safeAppPath (notification taps in the Android app)", () => {
  it("keeps in-app paths", () => {
    expect(safeAppPath("/chat/abc")).toBe("/chat/abc");
    expect(safeAppPath("  /u/asha  ")).toBe("/u/asha");
  });
  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "sabzone://auth-callback#access_token=x",
    "/path\twith-tab",
    "/path\nnewline",
    "chat/no-leading-slash",
    "",
    null,
    undefined,
    {},
  ])("refuses %j", (v) => {
    expect(safeAppPath(v)).toBeNull();
  });
  it("caps very long paths", () => {
    expect(safeAppPath("/" + "a".repeat(1000))!.length).toBe(300);
  });
});
