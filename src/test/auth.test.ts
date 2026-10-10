import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";
import { resolveRedirect } from "@/components/auth-gate";
import { friendlyAuthError } from "@/lib/auth-errors";
import { passwordStrength, validateSignUp } from "@/lib/validation";

const out = { session: false, onboardingDone: false };
const needsOnboarding = { session: true, onboardingDone: false };
const done = { session: true, onboardingDone: true };

describe("resolveRedirect (route guard)", () => {
  it("sends logged-out users from protected pages to /login", () => {
    for (const p of [
      "/home",
      "/discover",
      "/create",
      "/profile",
      "/notifications",
      "/more",
      "/saved",
      "/groups",
      "/business",
      "/settings",
      "/help",
    ])
      expect(resolveRedirect(p, out)).toBe("/login");
  });
  it("protects other people's profiles (/u/<username>)", () => {
    expect(resolveRedirect("/u/someone", out)).toBe("/login");
    expect(resolveRedirect("/u/someone", needsOnboarding)).toBe("/onboarding");
    expect(resolveRedirect("/u/someone", done)).toBeNull();
  });
  it("lets logged-out users see public pages", () => {
    for (const p of ["/", "/login", "/signup", "/forgot-password", "/verify", "/reset-password"])
      expect(resolveRedirect(p, out)).toBeNull();
  });
  it("skips the splash/login for logged-in users", () => {
    expect(resolveRedirect("/", done)).toBe("/home");
    expect(resolveRedirect("/login", done)).toBe("/home");
    expect(resolveRedirect("/signup", needsOnboarding)).toBe("/onboarding");
  });
  it("forces onboarding before the app, and not after", () => {
    expect(resolveRedirect("/home", needsOnboarding)).toBe("/onboarding");
    expect(resolveRedirect("/onboarding", needsOnboarding)).toBeNull();
    expect(resolveRedirect("/onboarding", done)).toBe("/home");
    expect(resolveRedirect("/onboarding", out)).toBe("/login");
  });
  it("ignores trailing slashes and unknown pages", () => {
    expect(resolveRedirect("/home/", out)).toBe("/login");
    expect(resolveRedirect("/nope", out)).toBeNull();
  });
  it("leaves /reset-password open even when logged in (recovery link signs the user in)", () => {
    expect(resolveRedirect("/reset-password", done)).toBeNull();
  });
});

describe("passwordStrength", () => {
  it("rates by length and variety", () => {
    expect(passwordStrength("short").label).toBe("Too short");
    expect(passwordStrength("alllowercase").label).toBe("Weak");
    expect(passwordStrength("Password1").label).toBe("Medium");
    expect(passwordStrength("Str0ng!Passw0rd#").label).toBe("Strong");
  });
});

describe("validateSignUp", () => {
  const ok = {
    fullName: "Basava J",
    username: "basava_2005",
    email: "a@b.co",
    password: "Password1",
    confirm: "Password1",
    terms: true,
  };
  it("accepts a valid form", () =>
    expect(Object.values(validateSignUp(ok)).some(Boolean)).toBe(false));
  it("flags each invalid field", () => {
    const e = validateSignUp({
      fullName: "",
      username: "a!",
      email: "nope",
      password: "short",
      confirm: "x",
      terms: false,
    });
    expect(Object.keys(e).sort()).toEqual([
      "confirm",
      "email",
      "fullName",
      "password",
      "terms",
      "username",
    ]);
  });
});

describe("friendlyAuthError", () => {
  it("maps common Supabase errors", () => {
    expect(friendlyAuthError({ message: "Invalid login credentials" })).toMatch(/Incorrect/);
    expect(friendlyAuthError({ message: "User already registered" })).toMatch(/already registered/);
    expect(friendlyAuthError({ message: "Database error saving new user" })).toMatch(/username/i);
    expect(friendlyAuthError({ message: "x", status: 429 })).toMatch(/Too many/);
    expect(friendlyAuthError({ message: "Failed to fetch" })).toMatch(/Network/);
    expect(friendlyAuthError({ message: "Token has expired or is invalid" })).toMatch(/code/);
  });
});

describe("route tree", () => {
  it("registers every auth screen", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    for (const p of [
      "/",
      "/signup",
      "/login",
      "/verify",
      "/forgot-password",
      "/reset-password",
      "/onboarding",
      "/more",
      "/home",
    ])
      expect(router.matchRoutes(p).at(-1)?.routeId, p).not.toBe(rootRouteId);
  });
});
