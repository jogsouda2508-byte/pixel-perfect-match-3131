import type { SupabaseClient } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { communityError, type CommunityPerson } from "@/lib/community";

// The generated database types don't know these tables or functions, so talk to them untyped.
const db = supabase as unknown as SupabaseClient;

export const BOOKINGS_MIGRATION_HINT =
  "Offers and bookings need a one-time database update. In Supabase open SQL Editor, run " +
  "supabase/migrations/20261109000000_business_offers_bookings.sql, then try again.";

function bookingError(
  error: { message?: string | null; code?: string | null },
  fallback: string,
): Error {
  const e = communityError(error, fallback);
  // The generic community hint names the wrong file for this feature.
  return /one-time database update/.test(e.message) ? new Error(BOOKINGS_MIGRATION_HINT) : e;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ------------------------------------------------------------------- offers
export const OFFER_DURATIONS = [
  { key: "1d", label: "1 day", ms: DAY },
  { key: "3d", label: "3 days", ms: 3 * DAY },
  { key: "7d", label: "1 week", ms: 7 * DAY },
  { key: "30d", label: "1 month", ms: 30 * DAY },
] as const;
export type OfferDuration = (typeof OFFER_DURATIONS)[number]["key"];

export type BusinessOffer = {
  id: string;
  business_id: string;
  title: string;
  details: string | null;
  badge: string | null;
  valid_until: string;
  created_at: string;
};

/** "Ends in 2 h", "Ends today", "Ends tomorrow", "Ends in 5 days". */
export function offerEndsText(validUntilIso: string, now: Date = new Date()): string {
  const ms = new Date(validUntilIso).getTime() - now.getTime();
  if (ms <= 0) return "Ended";
  if (ms < HOUR) return `Ends in ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < DAY) return `Ends in ${Math.round(ms / HOUR)} h`;
  const days = Math.round(ms / DAY);
  return days <= 1 ? "Ends tomorrow" : `Ends in ${days} days`;
}

export function validateOffer(f: {
  title: string;
  details: string;
  badge: string;
}): Partial<Record<"title" | "badge", string>> {
  const e: Partial<Record<"title" | "badge", string>> = {};
  if (f.title.trim().length < 3) e.title = "Say what the offer is (at least 3 letters)";
  if (f.badge.trim().length > 16) e.badge = "Keep the tag short, like 20% OFF";
  return e;
}

export async function fetchOffers(businessId: string): Promise<BusinessOffer[]> {
  const { data, error } = await db
    .from("business_offers")
    .select("id, business_id, title, details, badge, valid_until, created_at")
    .eq("business_id", businessId)
    .gt("valid_until", new Date().toISOString())
    .order("valid_until", { ascending: true })
    .limit(10);
  if (error) {
    console.error("load offers failed", error);
    throw bookingError(error, "Couldn't load the offers.");
  }
  return (data ?? []) as BusinessOffer[];
}

export function useOffers(businessId: string | undefined) {
  return useQuery({
    queryKey: ["business-offers", businessId],
    queryFn: () => fetchOffers(businessId!),
    enabled: !!businessId,
    staleTime: 30_000,
    // An offer list is a nice-to-have; if the database update has not been run yet, show nothing.
    retry: false,
  });
}

export async function createOffer(
  businessId: string,
  v: { title: string; details: string; badge: string; duration: OfferDuration },
): Promise<void> {
  const ms = OFFER_DURATIONS.find((d) => d.key === v.duration)?.ms ?? DAY;
  const { error } = await db.from("business_offers").insert({
    business_id: businessId,
    title: v.title.trim(),
    details: v.details.trim() || null,
    badge: v.badge.trim() || null,
    valid_until: new Date(Date.now() + ms).toISOString(),
  });
  if (error) {
    console.error("create offer failed", error);
    throw bookingError(error, "Couldn't post the offer.");
  }
}

export async function deleteOffer(id: string): Promise<void> {
  const { error } = await db.from("business_offers").delete().eq("id", id);
  if (error) throw bookingError(error, "Couldn't remove the offer.");
}

// ----------------------------------------------------------------- bookings
export type BookingStatus = "pending" | "accepted" | "declined" | "cancelled";

export type Booking = {
  id: string;
  service: string | null;
  requested_at: string;
  note: string | null;
  status: BookingStatus;
  reply: string | null;
  created_at: string;
  person: CommunityPerson;
};

export const bookingStatusLabel = (s: BookingStatus) =>
  ({
    pending: "Waiting for reply",
    accepted: "Confirmed",
    declined: "Declined",
    cancelled: "Cancelled",
  })[s];

const IST = "Asia/Kolkata";

/** "Wed, 18 Nov, 4:30 pm" in Indian time, whatever the phone's time zone is. */
export function bookingWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: IST,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Today's date in India as YYYY-MM-DD (the format a date input uses). */
export function istDate(d: Date = new Date(), plusDays = 0): string {
  return new Date(d.getTime() + plusDays * DAY).toLocaleDateString("en-CA", { timeZone: IST });
}

/** Combines a date input (YYYY-MM-DD) and a time input (HH:MM), read as Indian time. */
export function requestedAt(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function validateBooking(
  f: { date: string; time: string; note: string },
  now: Date = new Date(),
): Partial<Record<"date" | "time" | "when", string>> {
  const e: Partial<Record<"date" | "time" | "when", string>> = {};
  if (!f.date) e.date = "Pick a day";
  if (!f.time) e.time = "Pick a time";
  if (e.date || e.time) return e;
  const at = requestedAt(f.date, f.time);
  if (!at) e.when = "That date or time doesn't look right";
  else if (at.getTime() <= now.getTime()) e.when = "Pick a time in the future";
  else if (at.getTime() > now.getTime() + 90 * DAY) e.when = "You can book up to 90 days ahead";
  return e;
}

export async function createBooking(args: {
  businessId: string;
  service: string;
  date: string;
  time: string;
  note: string;
}): Promise<void> {
  const at = requestedAt(args.date, args.time);
  if (!at) throw new Error("That date or time doesn't look right");
  const { error } = await db.rpc("create_booking", {
    p_business: args.businessId,
    p_service: args.service.trim() || null,
    p_requested_at: at.toISOString(),
    p_note: args.note.trim() || null,
  });
  if (error) {
    console.error("create_booking failed", error);
    throw bookingError(error, "Couldn't send your request.");
  }
}

export async function respondToBooking(id: string, accept: boolean, reply: string): Promise<void> {
  const { error } = await db.rpc("respond_to_booking", {
    p_id: id,
    p_accept: accept,
    p_reply: reply.trim() || null,
  });
  if (error) {
    console.error("respond_to_booking failed", error);
    throw bookingError(error, "Couldn't save your answer.");
  }
}

export async function cancelBooking(id: string): Promise<void> {
  const { error } = await db.rpc("cancel_booking", { p_id: id });
  if (error) {
    console.error("cancel_booking failed", error);
    throw bookingError(error, "Couldn't cancel the booking.");
  }
}

export async function fetchMyBookings(role: "business" | "customer"): Promise<Booking[]> {
  const { data, error } = await db.rpc("get_my_bookings", { p_role: role });
  if (error) {
    console.error("get_my_bookings failed", error);
    throw bookingError(error, "Couldn't load your bookings.");
  }
  return Array.isArray(data) ? (data as Booking[]) : [];
}

export function useMyBookings(role: "business" | "customer", enabled = true) {
  return useQuery({
    queryKey: ["my-bookings", role],
    queryFn: () => fetchMyBookings(role),
    enabled,
    staleTime: 15_000,
    retry: false,
  });
}
