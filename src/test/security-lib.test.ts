import { describe, expect, it } from "vitest";
import { escapeXml, isHexColor, safeLinkUrl, safeMediaUrl, userMessage } from "@/lib/security";

describe("escapeXml", () => {
  it("escapes every character that can break out of XML text or an attribute", () => {
    expect(escapeXml(`<script>alert("x")</script> & 'y'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &apos;y&apos;",
    );
  });
  it("escapes & first, so entities are not double-decoded", () => {
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
  });
  it("leaves ordinary text alone", () => {
    expect(escapeXml("@asha_rao 123")).toBe("@asha_rao 123");
  });
});

describe("isHexColor", () => {
  it("accepts hex colours", () => {
    for (const c of ["#fff", "#FFFF", "#12ab34", "#12ab34cc"]) expect(isHexColor(c)).toBe(true);
  });
  it("rejects anything that could carry an attribute or a script", () => {
    for (const c of ['red" onload="x', "#12", "#12ab3", "url(#x)", "#fff;", "#ggg", "", null, 5])
      expect(isHexColor(c)).toBe(false);
  });
});

describe("safeLinkUrl", () => {
  it("allows https links", () => {
    expect(safeLinkUrl("https://x.supabase.co/storage/v1/object/public/media/a.pdf")).toBe(
      "https://x.supabase.co/storage/v1/object/public/media/a.pdf",
    );
    expect(safeLinkUrl("  https://example.com/a  ")).toBe("https://example.com/a");
  });
  it("allows plain http only for localhost", () => {
    expect(safeLinkUrl("http://localhost:3000/a")).not.toBeNull();
    expect(safeLinkUrl("http://127.0.0.1/a")).not.toBeNull();
    expect(safeLinkUrl("http://evil.example/a")).toBeNull();
  });
  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "intent://x#Intent;scheme=http;end",
    "sabzone://auth-callback",
    "//evil.example/x",
    "/relative/path",
    "https://",
    "https://exa mple.com",
    "https://evil.example\\@good.example",
    "https://x.com/\nSet-Cookie: a=b",
    "https://x.com/" + "a".repeat(3000),
    "",
    "   ",
  ])("refuses %j", (bad) => {
    expect(safeLinkUrl(bad)).toBeNull();
  });
  it("refuses non-strings", () => {
    for (const v of [null, undefined, 42, {}, ["https://x.com"]]) expect(safeLinkUrl(v)).toBeNull();
  });
});

describe("safeMediaUrl", () => {
  it("allows what safeLinkUrl allows, the app's own paths, blob: previews and raster data URLs", () => {
    expect(safeMediaUrl("https://x.co/a.jpg")).toBe("https://x.co/a.jpg");
    expect(safeMediaUrl("/assets/empty.png")).toBe("/assets/empty.png");
    expect(safeMediaUrl("blob:http://localhost:3000/1234-abcd")).toBe(
      "blob:http://localhost:3000/1234-abcd",
    );
    expect(safeMediaUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
  });
  it.each([
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==",
    "data:image/svg+xml,<svg onload=alert(1)>",
    "data:text/html;base64,PHNjcmlwdD4=",
    "//evil.example/pixel.gif",
    "/\\evil.example",
    "http://evil.example/pixel.gif",
    "ftp://x.co/a",
    "",
  ])("refuses %j", (bad) => {
    expect(safeMediaUrl(bad)).toBeNull();
  });
  it("refuses non-strings", () => {
    expect(safeMediaUrl(null)).toBeNull();
    expect(safeMediaUrl(undefined)).toBeNull();
  });
});

describe("userMessage", () => {
  const FALLBACK = "Couldn't do that.";

  it("keeps a message that was written for people", () => {
    expect(userMessage(new Error("Your note is too long"), FALLBACK)).toBe("Your note is too long");
    expect(userMessage({ message: "Video upload failed. Check the file." }, FALLBACK)).toBe(
      "Video upload failed. Check the file.",
    );
  });
  it("keeps the text of a deliberate `raise exception` (SQLSTATE P0001)", () => {
    expect(userMessage({ message: "A poll needs 2 to 6 options", code: "P0001" }, FALLBACK)).toBe(
      "A poll needs 2 to 6 options",
    );
  });
  it("hides database errors, which reveal table, column and constraint names", () => {
    for (const message of [
      'new row for relation "posts" violates check constraint "posts_content_length"',
      'duplicate key value violates unique constraint "profiles_username_key"',
      'null value in column "author_id" of relation "posts" violates not-null constraint',
      'new row violates row-level security policy for table "messages"',
      "permission denied for function get_login_email",
      'column "secret" does not exist',
      "JWT expired",
      'syntax error at or near "select"',
      "Could not find the function public.foo(bar) in the schema cache",
    ])
      expect(userMessage(new Error(message), FALLBACK)).toBe(FALLBACK);
  });
  it("hides any message that carries a database error code other than P0001", () => {
    expect(userMessage({ message: "Something harmless", code: "23505" }, FALLBACK)).toBe(FALLBACK);
    expect(userMessage({ message: "Something harmless", code: "42501" }, FALLBACK)).toBe(FALLBACK);
    expect(userMessage({ message: "Something harmless", code: "PGRST116" }, FALLBACK)).toBe(
      FALLBACK,
    );
  });
  it("turns browser network failures into one friendly sentence", () => {
    for (const message of [
      "Failed to fetch",
      "Load failed",
      "NetworkError when attempting to fetch resource.",
      "Network request failed",
    ])
      expect(userMessage(new TypeError(message), FALLBACK)).toBe(
        "Network error. Check your connection and try again.",
      );
  });
  it("does not mistake 'upload failed' for a network error", () => {
    expect(userMessage(new Error("Photo upload failed"), FALLBACK)).toBe("Photo upload failed");
  });
  it("hides stack-like, multi-line, empty and very long messages", () => {
    expect(userMessage(new Error("boom\n    at foo (bar.js:1:2)"), FALLBACK)).toBe(FALLBACK);
    expect(userMessage(new Error("   "), FALLBACK)).toBe(FALLBACK);
    expect(userMessage(new Error("x".repeat(300)), FALLBACK)).toBe(FALLBACK);
    expect(
      userMessage(new TypeError("Cannot read properties of undefined (reading 'id')"), FALLBACK),
    ).toBe(FALLBACK);
  });
  it("uses the fallback for things that are not errors", () => {
    for (const v of [null, undefined, "a string", 42, {}, { message: 5 }])
      expect(userMessage(v, FALLBACK)).toBe(FALLBACK);
  });
});
