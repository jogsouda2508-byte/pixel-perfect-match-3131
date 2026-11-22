import { describe, expect, it } from "vitest";
import {
  checkPassword,
  clientIp,
  keyHash,
  maskEmail,
  normalizeEmail,
  normalizeUsername,
  originAllowed,
  parseOrigins,
  redirectAllowed,
} from "../../supabase/functions/auth-gateway/logic";

describe("normalizeUsername", () => {
  it("accepts plain, @-prefixed and mixed-case names", () => {
    expect(normalizeUsername("susheel_08")).toBe("susheel_08");
    expect(normalizeUsername("@Susheel_08 ")).toBe("susheel_08");
  });
  it("rejects anything that is not 3-20 letters, numbers or underscores", () => {
    for (const bad of [
      "ab",
      "a".repeat(21),
      "has space",
      "dot.name",
      "me@x.com",
      "",
      "@",
      5,
      null,
    ]) {
      expect(normalizeUsername(bad)).toBeNull();
    }
  });
});

describe("normalizeEmail", () => {
  it("trims and lower-cases", () =>
    expect(normalizeEmail("  Me@Example.COM ")).toBe("me@example.com"));
  it("rejects bad or oversized values", () => {
    for (const bad of ["nope", "a@b", "a b@c.com", `${"a".repeat(250)}@x.com`, 3, undefined]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });
});

describe("maskEmail", () => {
  it("shows only the first letter of each part", () => {
    expect(maskEmail("john.doe@gmail.com")).toBe("j***@g***.com");
    expect(maskEmail("a@b.co.in")).toBe("a***@b***.in");
  });
  it("never leaks the local part or the full host", () => {
    const m = maskEmail("verylongname@company.org");
    expect(m).not.toContain("verylongname");
    expect(m).not.toContain("company");
  });
  it("handles odd input", () => expect(maskEmail("nonsense")).toBe("***"));
});

describe("checkPassword", () => {
  it("accepts a decent password", () => expect(checkPassword("blue-Tiger-42")).toBeNull());
  it("rejects short, long, common and look-alike passwords", () => {
    expect(checkPassword("short1")).toBe("too_short");
    expect(checkPassword(undefined)).toBe("too_short");
    expect(checkPassword("x".repeat(73))).toBe("too_long");
    expect(checkPassword("é".repeat(40))).toBe("too_long"); // 80 bytes
    expect(checkPassword("Password123")).toBe("too_common");
    expect(checkPassword("aaaaaaaa")).toBe("too_common");
    expect(checkPassword("susheel_08", { username: "susheel_08" })).toBe("too_similar");
    expect(checkPassword("johnsmith", { email: "johnsmith@x.com" })).toBe("too_similar");
  });
});

describe("clientIp", () => {
  it("prefers the Cloudflare header, then the first forwarded address", () => {
    expect(clientIp({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9" })).toBe(
      "1.1.1.1",
    );
    expect(clientIp({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" })).toBe("2.2.2.2");
    expect(clientIp({ "x-real-ip": "4.4.4.4" })).toBe("4.4.4.4");
    expect(clientIp({})).toBe("unknown");
  });
});

describe("origins and redirects", () => {
  const allowed = parseOrigins("https://sabzone.onrender.com/, https://app.sabzone.in");
  it("parses a comma list", () =>
    expect(allowed).toEqual(["https://sabzone.onrender.com", "https://app.sabzone.in"]));
  it("allows our sites, the Android app and local dev; refuses everything else", () => {
    expect(originAllowed("https://sabzone.onrender.com", allowed)).toBe(true);
    expect(originAllowed("https://localhost", allowed)).toBe(true);
    expect(originAllowed("capacitor://localhost", allowed)).toBe(true);
    expect(originAllowed("https://evil.example", allowed)).toBe(false);
    expect(originAllowed("https://sabzone.onrender.com.evil.example", allowed)).toBe(false);
    expect(originAllowed(undefined, allowed)).toBe(false);
  });
  it("only lets emailed links point at our own site or app", () => {
    expect(redirectAllowed("https://sabzone.onrender.com/reset-password", allowed)).toBe(true);
    expect(redirectAllowed("sabzone://reset-password", allowed)).toBe(true);
    expect(redirectAllowed("sabzone://auth-callback", allowed)).toBe(true);
    for (const bad of [
      "https://evil.example/reset-password",
      "https://sabzone.onrender.com@evil.example/",
      "https://sabzone.onrender.com.evil.example/",
      "http://sabzone.onrender.com/reset-password", // wrong scheme for a non-localhost host
      "javascript:alert(1)",
      "sabzone://anything-else",
      "//evil.example",
      "",
      42,
      `https://sabzone.onrender.com/${"a".repeat(400)}`,
    ]) {
      expect(redirectAllowed(bad, allowed)).toBe(false);
    }
  });
});

describe("keyHash", () => {
  it("is stable, secret-dependent, label-separated and hides the value", async () => {
    const a = await keyHash("secret-one-secret-one-secret-one!", "ip", "1.2.3.4");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(await keyHash("secret-one-secret-one-secret-one!", "ip", "1.2.3.4")).toBe(a);
    expect(await keyHash("secret-two-secret-two-secret-two!", "ip", "1.2.3.4")).not.toBe(a);
    expect(await keyHash("secret-one-secret-one-secret-one!", "user", "1.2.3.4")).not.toBe(a);
    expect(a).not.toContain("1.2.3.4");
  });
});
