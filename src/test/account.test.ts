import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, rpc, storage, calls } = vi.hoisted(() => {
  const calls: string[] = [];
  type Bucket = { list: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  const buckets: Record<string, Bucket> = {};
  const storage = {
    buckets,
    from: (name: string): Bucket => {
      const bucket = buckets[name] ?? { list: vi.fn(), remove: vi.fn() };
      buckets[name] = bucket;
      return bucket;
    },
  };
  return {
    calls,
    auth: { signInWithPassword: vi.fn() },
    rpc: vi.fn(),
    storage,
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  isSupabaseConfigured: true,
  supabase: { auth, rpc, storage },
}));

import {
  AccountDeletionError,
  DELETE_WORD,
  USER_BUCKETS,
  clearLocalUserData,
  deleteMyAccount,
  hasPasswordLogin,
  isDeleteConfirmed,
} from "@/lib/account";

const ME = "11111111-1111-1111-1111-111111111111";

type Mode = "list-error" | "remove-error" | "missing" | "missing-no-code" | "error-no-code";

/** Every bucket holds one file for the person; removing records the call order. */
function stubStorage(overrides: Partial<Record<string, Mode>> = {}) {
  for (const name of USER_BUCKETS) {
    const b = storage.from(name);
    const mode = overrides[name];
    b.list.mockReset();
    b.remove.mockReset();
    b.list.mockImplementation(async (prefix: string) => {
      if (mode === "missing")
        return { data: null, error: { message: "Bucket not found", statusCode: "404" } };
      if (mode === "missing-no-code")
        return { data: null, error: { message: "Object not found", statusCode: undefined } };
      if (mode === "error-no-code")
        return { data: null, error: { message: "boom", statusCode: undefined } };
      if (mode === "list-error")
        return { data: null, error: { message: "boom", statusCode: "500" } };
      return { data: prefix === ME ? [{ name: "a.jpg", id: "file-1" }] : [], error: null };
    });
    b.remove.mockImplementation(async () => {
      calls.push(`remove:${name}`);
      return mode === "remove-error"
        ? { data: null, error: { message: "boom", statusCode: "500" } }
        : { data: [], error: null };
    });
  }
}

function stubRpc(opts: { fresh?: boolean; deleteError?: string } = {}) {
  rpc.mockImplementation(async (fn: string) => {
    calls.push(`rpc:${fn}`);
    if (fn === "my_session_is_fresh") return { data: opts.fresh ?? true, error: null };
    if (fn === "delete_my_account")
      return { data: null, error: opts.deleteError ? { message: opts.deleteError } : null };
    return { data: null, error: null };
  });
}

beforeEach(() => {
  calls.length = 0;
  rpc.mockReset();
  auth.signInWithPassword.mockReset();
  auth.signInWithPassword.mockImplementation(async () => {
    calls.push("signIn");
    return { data: { user: { id: ME } }, error: null };
  });
  stubStorage();
  stubRpc();
  window.localStorage.clear();
});

describe("account deletion helpers", () => {
  it("needs the confirmation word, in any case", () => {
    expect(isDeleteConfirmed("delete")).toBe(true);
    expect(isDeleteConfirmed("  Delete ")).toBe(true);
    expect(isDeleteConfirmed(DELETE_WORD)).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isDeleteConfirmed("")).toBe(false);
    expect(isDeleteConfirmed("deleted")).toBe(false);
    expect(isDeleteConfirmed("del")).toBe(false);
  });
  it("cleans every bucket the app uploads to", () => {
    expect([...USER_BUCKETS].sort()).toEqual([
      "avatars",
      "chat-media",
      "media",
      "videos",
      "voice",
    ]);
  });
  it("tells password accounts from Google-only accounts", () => {
    const check = (u: unknown) => hasPasswordLogin(u as Parameters<typeof hasPasswordLogin>[0]);
    expect(check({ app_metadata: { providers: ["email"] }, identities: [] })).toBe(true);
    expect(check({ app_metadata: { providers: ["email", "google"] } })).toBe(true);
    expect(check({ app_metadata: {}, identities: [{ provider: "email" }] })).toBe(true);
    expect(
      check({ app_metadata: { providers: ["google"] }, identities: [{ provider: "google" }] }),
    ).toBe(false);
  });
  it("wipes only this person's data stored on the device", () => {
    window.localStorage.setItem(`ediraa-user-posts:${ME}`, "[]");
    window.localStorage.setItem(`ediraa.local-locality.${ME}`, "Indiranagar");
    window.localStorage.setItem("ediraa.local-locality.someone-else", "Koramangala");
    window.localStorage.setItem("sabzone.feed-sound", "true");
    clearLocalUserData(ME);
    expect(window.localStorage.getItem(`ediraa-user-posts:${ME}`)).toBe(null);
    expect(window.localStorage.getItem(`ediraa.local-locality.${ME}`)).toBe(null);
    expect(window.localStorage.getItem("ediraa.local-locality.someone-else")).toBe("Koramangala");
    expect(window.localStorage.getItem("sabzone.feed-sound")).toBe("true");
  });
});

describe("deleteMyAccount", () => {
  it("checks the password, then the session, then removes files, then the account", async () => {
    window.localStorage.setItem(`ediraa-user-posts:${ME}`, "[]");
    await deleteMyAccount({ userId: ME, email: "me@test.local", password: "secret" });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "me@test.local",
      password: "secret",
    });
    const firstRemove = calls.findIndex((c) => c.startsWith("remove:"));
    expect(calls[0]).toBe("signIn");
    expect(calls[1]).toBe("rpc:my_session_is_fresh");
    expect(firstRemove).toBeGreaterThan(1);
    expect(calls[calls.length - 1]).toBe("rpc:delete_my_account");
    expect(calls.filter((c) => c.startsWith("remove:")).length).toBe(USER_BUCKETS.length);
    expect(window.localStorage.getItem(`ediraa-user-posts:${ME}`)).toBe(null);
  });

  it("works for a Google account with a fresh sign-in (no password asked)", async () => {
    await deleteMyAccount({ userId: ME, email: "me@gmail.com" });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(calls[calls.length - 1]).toBe("rpc:delete_my_account");
  });

  it("stops on a wrong password and touches nothing", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid login credentials" },
    });
    await expect(
      deleteMyAccount({ userId: ME, email: "me@test.local", password: "nope" }),
    ).rejects.toMatchObject({ code: "wrong_password" });
    expect(rpc).not.toHaveBeenCalled();
    expect(storage.from("avatars").remove).not.toHaveBeenCalled();
  });

  it("refuses an empty password without calling the server", async () => {
    await expect(
      deleteMyAccount({ userId: ME, email: "me@test.local", password: "" }),
    ).rejects.toMatchObject({ code: "wrong_password" });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("refuses a password that signs in as a different account", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: "someone-else" } },
      error: null,
    });
    await expect(
      deleteMyAccount({ userId: ME, email: "me@test.local", password: "x" }),
    ).rejects.toMatchObject({ code: "wrong_password" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("asks for a fresh sign-in BEFORE deleting any file", async () => {
    stubRpc({ fresh: false });
    await expect(deleteMyAccount({ userId: ME, email: "me@gmail.com" })).rejects.toMatchObject({
      code: "reauth_required",
    });
    expect(storage.from("avatars").remove).not.toHaveBeenCalled();
    expect(calls.includes("rpc:delete_my_account")).toBe(false);
  });

  it("does not delete the account while some of its files are still online", async () => {
    stubStorage({ videos: "remove-error" });
    await expect(deleteMyAccount({ userId: ME, email: "me@gmail.com" })).rejects.toMatchObject({
      code: "files_failed",
    });
    expect(calls.includes("rpc:delete_my_account")).toBe(false);
  });

  it("does not treat a failed file listing as 'no files'", async () => {
    stubStorage({ media: "list-error" });
    await expect(deleteMyAccount({ userId: ME, email: "me@gmail.com" })).rejects.toMatchObject({
      code: "files_failed",
    });
    expect(calls.includes("rpc:delete_my_account")).toBe(false);
  });

  it("treats a bucket that doesn't exist as having nothing to remove", async () => {
    stubStorage({ voice: "missing" });
    await deleteMyAccount({ userId: ME, email: "me@gmail.com" });
    expect(calls[calls.length - 1]).toBe("rpc:delete_my_account");
  });

  it("recognises a not-found error that carries no status code", async () => {
    stubStorage({ voice: "missing-no-code" });
    await deleteMyAccount({ userId: ME, email: "me@gmail.com" });
    expect(calls[calls.length - 1]).toBe("rpc:delete_my_account");
  });

  it("still fails on an error that carries no status code and isn't 'not found'", async () => {
    stubStorage({ media: "error-no-code" });
    await expect(deleteMyAccount({ userId: ME, email: "me@gmail.com" })).rejects.toMatchObject({
      code: "files_failed",
    });
    expect(calls.includes("rpc:delete_my_account")).toBe(false);
  });

  it("accepts explicitly undefined email and password (as the screen passes them)", async () => {
    await deleteMyAccount({ userId: ME, email: undefined, password: undefined });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(calls[calls.length - 1]).toBe("rpc:delete_my_account");
  });

  it("maps the server's reauth_required answer", async () => {
    stubRpc({ deleteError: "reauth_required" });
    await expect(deleteMyAccount({ userId: ME, email: "me@gmail.com" })).rejects.toMatchObject({
      code: "reauth_required",
    });
  });

  it("points at the migration when the database function is missing", async () => {
    stubRpc({
      deleteError: "Could not find the function public.delete_my_account in the schema cache",
    });
    await expect(deleteMyAccount({ userId: ME, email: "me@gmail.com" })).rejects.toMatchObject({
      code: "migration_missing",
    });
  });

  it("keeps the device data when the account could not be deleted", async () => {
    window.localStorage.setItem(`ediraa-user-posts:${ME}`, "[]");
    stubRpc({ deleteError: "network down" });
    await expect(deleteMyAccount({ userId: ME, email: "me@gmail.com" })).rejects.toBeInstanceOf(
      AccountDeletionError,
    );
    expect(window.localStorage.getItem(`ediraa-user-posts:${ME}`)).toBe("[]");
  });
});
