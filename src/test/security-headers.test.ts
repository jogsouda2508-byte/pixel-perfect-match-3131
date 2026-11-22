import { describe, expect, it } from "vitest";
import { buildCsp, securityHeaders, withSecurityHeaders } from "@/lib/security-headers";

const SB = "https://abcd1234.supabase.co";

describe("buildCsp", () => {
  const csp = buildCsp({ supabaseUrl: SB });
  const directive = (name: string) =>
    csp
      .split("; ")
      .find((d) => d.startsWith(`${name} `))
      ?.slice(name.length + 1)
      .split(" ") ?? [];

  it("starts from 'self' and closes the dangerous doors", () => {
    expect(directive("default-src")).toEqual(["'self'"]);
    expect(directive("object-src")).toEqual(["'none'"]);
    expect(directive("frame-src")).toEqual(["'none'"]);
    expect(directive("base-uri")).toEqual(["'self'"]);
    expect(directive("form-action")).toEqual(["'self'"]);
    expect(directive("frame-ancestors")).toEqual(["'self'"]);
  });
  it("never allows eval or remote scripts", () => {
    expect(csp).not.toContain("'unsafe-eval'");
    expect(directive("script-src").filter((v) => v.startsWith("http") || v === "*")).toEqual([]);
  });
  it("lets the app reach its own Supabase project, including realtime websockets", () => {
    expect(directive("connect-src")).toContain(SB);
    expect(directive("connect-src")).toContain("wss://abcd1234.supabase.co");
    expect(directive("img-src")).toContain(SB);
    expect(directive("media-src")).toContain(SB);
  });
  it("allows only the third parties the app really uses", () => {
    expect(directive("connect-src")).toEqual(
      expect.arrayContaining([
        "https://api.giphy.com",
        "https://itunes.apple.com",
        "https://photon.komoot.io",
      ]),
    );
    expect(directive("style-src")).toContain("https://fonts.googleapis.com");
    expect(directive("font-src")).toContain("https://fonts.gstatic.com");
  });
  it("does not allow arbitrary https images (that would permit tracking pixels)", () => {
    expect(directive("img-src")).not.toContain("https:");
    expect(directive("img-src")).not.toContain("*");
  });
  it("still produces a valid policy without a Supabase URL, or with a malformed one", () => {
    for (const url of [undefined, "", "not a url", "javascript:alert(1)"]) {
      const c = buildCsp({ supabaseUrl: url });
      expect(c).toContain("default-src 'self'");
      expect(c).not.toContain("javascript:");
    }
  });
});

describe("securityHeaders", () => {
  it("always sends the low-risk headers", () => {
    const h = securityHeaders();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toContain("camera=(self)");
    expect(h["permissions-policy"]).toContain("payment=()");
  });
  it("sends the CSP as report-only by default, enforced only when asked", () => {
    const report = securityHeaders({ supabaseUrl: SB });
    expect(report["content-security-policy-report-only"]).toContain("default-src 'self'");
    expect(report["content-security-policy"]).toBeUndefined();
    const enforced = securityHeaders({ supabaseUrl: SB, enforceCsp: true });
    expect(enforced["content-security-policy"]).toContain("default-src 'self'");
    expect(enforced["content-security-policy-report-only"]).toBeUndefined();
  });
  it("adds HSTS only over https", () => {
    expect(securityHeaders({ https: true })["strict-transport-security"]).toMatch(
      /max-age=31536000/,
    );
    expect(securityHeaders({ https: false })["strict-transport-security"]).toBeUndefined();
  });
});

describe("withSecurityHeaders", () => {
  it("adds the headers and keeps the body, status and existing headers", async () => {
    const res = withSecurityHeaders(
      new Response("hello", { status: 201, statusText: "Created", headers: { "x-keep": "1" } }),
      securityHeaders({ https: true }),
    );
    expect(res.status).toBe(201);
    expect(res.statusText).toBe("Created");
    expect(res.headers.get("x-keep")).toBe("1");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe("hello");
  });
  it("does not override a header the page already set", () => {
    const res = withSecurityHeaders(
      new Response("x", { headers: { "referrer-policy": "no-referrer" } }),
      securityHeaders(),
    );
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("works for responses without a body", () => {
    const res = withSecurityHeaders(new Response(null, { status: 204 }), securityHeaders());
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });
});
