import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { PUBLIC_URL } from "@/lib/public-url";

// The generated database types don't know the referrals table / functions, so talk to them untyped.
const db = supabase as unknown as SupabaseClient;

export const REFERRAL_MIGRATION_HINT =
  "Invites need a one-time database update. In Supabase open SQL Editor, run " +
  "supabase/migrations/20261112000000_referrals.sql, then try again.";

const STORAGE_KEY = "sabzone_ref";

/** Turns whatever came in a link into a username, or null when it isn't one. */
export function normalizeRef(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{3,20}$/.test(code) ? code : null;
}

/** The `ref` value in a URL's query string ("?ref=asha"), or null. */
export function refFromSearch(search: string): string | null {
  try {
    return normalizeRef(new URLSearchParams(search).get("ref"));
  } catch {
    return null;
  }
}

/** Where someone signs up through your invite. Always the public site, never localhost. */
export function inviteUrl(username: string): string {
  return `${PUBLIC_URL}/signup?ref=${encodeURIComponent(username)}`;
}

/** The message that goes with the link when it is shared. */
export function inviteMessage(name: string, url: string): string {
  return `${name} invited you to SabZone, to connect with your neighbours and local businesses. Join here: ${url}`;
}

// ---- remembering the code until the new person has finished signing up ----------------------
// The link opens on the sign-up page, but the account is only usable after email verification or a
// Google redirect, so the code is kept on this device until it can be claimed.

export function getStoredRef(): string | null {
  try {
    return normalizeRef(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function storeRef(code: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* private mode: the link still works if they finish in this same tab */
  }
}

export function clearStoredRef(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Run once when the app opens: if the address has ?ref=..., remember it. Returns what it kept. */
export function captureReferralFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const code = refFromSearch(window.location.search);
  if (code) storeRef(code);
  return code;
}

// ---- talking to the database ---------------------------------------------------------------

type DbError = { message?: string | null; code?: string | null };

export function isReferralMissing(error: DbError | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "42883" ||
    error.code === "PGRST205" ||
    error.code === "PGRST202" ||
    /\b(referrals|claim_referral|get_referrer)\b/i.test(error.message ?? "")
  );
}

export type ClaimResult = "ok" | "already" | "self" | "unknown_code" | "too_late";
const CLAIM_RESULTS: ClaimResult[] = ["ok", "already", "self", "unknown_code", "too_late"];

/**
 * Records "they invited me". Returns the database's answer, or null when it could not be reached
 * (so the code is kept and tried again later).
 */
export async function claimReferral(code: string): Promise<ClaimResult | null> {
  try {
    const { data, error } = await db.rpc("claim_referral", { p_code: code });
    if (error) {
      // The database update hasn't been run: forget the code instead of retrying on every page.
      if (isReferralMissing(error)) return "unknown_code";
      return null;
    }
    return CLAIM_RESULTS.includes(data as ClaimResult) ? (data as ClaimResult) : null;
  } catch {
    return null;
  }
}

export type Referrer = { username: string; full_name: string | null; avatar_url: string | null };

/** Who is behind an invite code (for "Asha invited you"). Null when unknown or unavailable. */
export async function fetchReferrer(code: string): Promise<Referrer | null> {
  try {
    const { data, error } = await db.rpc("get_referrer", { p_code: code });
    if (error) return null;
    const row = (Array.isArray(data) ? data[0] : data) as Referrer | undefined;
    return row?.username ? row : null;
  } catch {
    return null;
  }
}

export type JoinedPerson = {
  created_at: string;
  person: { id: string; full_name: string | null; username: string; avatar_url: string | null };
};

/** The people who joined through my link, newest first. */
export async function fetchReferrals(me: string): Promise<JoinedPerson[]> {
  const { data, error } = await db
    .from("referrals")
    .select("created_at, person:profiles!referrals_referred_id_fkey(id, full_name, username, avatar_url)")
    .eq("referrer_id", me)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("Loading invites failed", error);
    throw new Error(
      isReferralMissing(error) ? REFERRAL_MIGRATION_HINT : "Couldn't load your invites. Please try again.",
    );
  }
  return ((data ?? []) as unknown as JoinedPerson[]).filter((r) => !!r.person);
}
