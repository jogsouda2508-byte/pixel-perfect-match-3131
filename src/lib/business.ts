import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BusinessDirectoryRow } from "@/integrations/supabase/types";
import { isMissingFunctionError, isMissingTableError } from "@/lib/db-errors";
import { randomId } from "@/lib/uuid";

/** Shown when the business-pages SQL migration has not been run yet. */
export const BUSINESS_MIGRATION_HINT =
  "Business pages need a one-time database update. In Supabase open SQL Editor, run " +
  "supabase/migrations/20261103000000_business_pages.sql, then try again.";

function fail(action: string, error: { message: string; code?: string | null }): never {
  console.error(`${action} failed`, error);
  if (isMissingFunctionError(error) || isMissingTableError(error))
    throw new Error(BUSINESS_MIGRATION_HINT);
  throw new Error(error.message || `${action} failed`);
}

// ------------------------------------------------------------------ categories
export const BUSINESS_CATEGORIES = [
  "Salon & Beauty",
  "Restaurant & Cafe",
  "Grocery & Kirana",
  "Clothing & Boutique",
  "Electronics & Mobile",
  "Medical & Pharmacy",
  "Clinic & Doctor",
  "Gym & Fitness",
  "Education & Tuition",
  "Home Services",
  "Repair & Garage",
  "Real Estate",
  "Photography & Events",
  "Travel & Transport",
  "Other",
] as const;

// ---------------------------------------------------------- Indian mobile numbers
/** Keeps only the 10-digit mobile number: drops +91, 91 and a leading 0, and any spaces or dashes. */
export function sanitizeIndianMobile(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+") && d.startsWith("91")) d = d.slice(2);
  else if (d.length >= 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length >= 11 && d.startsWith("0")) d = d.slice(1);
  return d.slice(0, 10);
}

/** Indian mobile numbers are 10 digits and start with 6, 7, 8 or 9. */
export function isValidIndianMobile(n: string): boolean {
  return /^[6-9]\d{9}$/.test(n);
}

/** "9876543210" -> "+91 98765 43210" */
export function formatIndianMobile(n: string): string {
  return `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
}

export const telHref = (n: string) => `tel:+91${n}`;

export function whatsappHref(n: string, text?: string): string {
  const base = `https://wa.me/91${n}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

// ---------------------------------------------------------------------- rupees
function groupIndian(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

/** 150000 -> "₹1,50,000"; 99.5 -> "₹99.50" */
export function formatRupees(amount: number): string {
  const whole = Number.isInteger(amount);
  const [i = "0", f = ""] = (whole ? String(amount) : amount.toFixed(2)).split(".");
  return `₹${groupIndian(i)}${f ? `.${f}` : ""}`;
}

export function formatServicePrice(s: { price: number; price_from: boolean }): string {
  if (s.price === 0 && !s.price_from) return "Free";
  return `${s.price_from ? "From " : ""}${formatRupees(s.price)}`;
}

export const MAX_PRICE = 9_999_999;

/** What a person types ("1,500", "₹99.5") -> a number, or null when it is not a valid price. */
export function parsePrice(raw: string): number | null {
  const t = raw.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= MAX_PRICE ? n : null;
}

/** Lets only digits and one dot through (max 7 digits, 2 decimals) while typing. */
export function sanitizePriceInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const [intPart = "", ...rest] = cleaned.split(".");
  const dec = rest.join("").slice(0, 2);
  const i = intPart.slice(0, 7);
  return rest.length > 0 ? `${i}.${dec}` : i;
}

// --------------------------------------------------------------------- hours
export type BusinessHour = {
  /** 0 = Monday ... 6 = Sunday */
  dow: number;
  is_closed: boolean;
  is_24h: boolean;
  /** "HH:MM" (24-hour), null when closed or open 24 hours */
  open_time: string | null;
  close_time: string | null;
};

export const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** "20:00" -> "8 PM", "08:30" -> "8:30 AM" */
export function formatClock(t: string): string {
  const [hs = "0", ms = "0"] = t.split(":");
  const h = Number(hs);
  const m = Number(ms);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

const toMinutes = (t: string) => {
  const [h = "0", m = "0"] = t.split(":");
  return Number(h) * 60 + Number(m);
};

export type OpenStatus = {
  state: "open" | "closed" | "unknown";
  text: string;
};

/** Business hours are always read in Indian time (IST, UTC+5:30), wherever the viewer is. */
function istNow(now: Date): { dow: number; minutes: number } {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  return {
    dow: (ist.getUTCDay() + 6) % 7,
    minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
  };
}

const hourFor = (hours: BusinessHour[], dow: number) => hours.find((h) => h.dow === dow);

/** Is the business open right now, and when does it close / next open? */
export function computeOpenStatus(hours: BusinessHour[], now: Date = new Date()): OpenStatus {
  if (!hours || hours.length === 0) return { state: "unknown", text: "" };
  const { dow, minutes } = istNow(now);
  const today = hourFor(hours, dow);

  if (today && !today.is_closed) {
    if (today.is_24h) return { state: "open", text: "Open 24 hours" };
    if (today.open_time && today.close_time) {
      const o = toMinutes(today.open_time);
      const c = toMinutes(today.close_time);
      const overnight = c < o;
      const openNow = overnight ? minutes >= o : minutes >= o && minutes < c;
      if (openNow)
        return { state: "open", text: `Open now · Closes ${formatClock(today.close_time)}` };
    }
  }
  // Yesterday's late-night hours (e.g. 6 PM - 2 AM) run into today.
  const yest = hourFor(hours, (dow + 6) % 7);
  if (yest && !yest.is_closed && !yest.is_24h && yest.open_time && yest.close_time) {
    const o = toMinutes(yest.open_time);
    const c = toMinutes(yest.close_time);
    if (c < o && minutes < c)
      return { state: "open", text: `Open now · Closes ${formatClock(yest.close_time)}` };
  }

  for (let offset = 0; offset <= 7; offset++) {
    const d = (dow + offset) % 7;
    const h = hourFor(hours, d);
    if (!h || h.is_closed) continue;
    const at = h.is_24h ? "12 AM" : h.open_time ? formatClock(h.open_time) : null;
    if (!at) continue;
    if (offset === 0) {
      const start = h.is_24h ? 0 : toMinutes(h.open_time!);
      if (start <= minutes) continue; // today's slot already passed
    }
    const when = offset === 0 ? "today" : offset === 1 ? "tomorrow" : DAY_SHORT[d]!;
    return { state: "closed", text: `Closed · Opens ${when} at ${at}` };
  }
  return { state: "closed", text: "Closed" };
}

export function isOpenNow(hours: BusinessHour[], now: Date = new Date()): boolean {
  return computeOpenStatus(hours, now).state === "open";
}

export type HoursRow = { day: string; text: string; isToday: boolean };

/** Seven lines for the "Hours" list: "Monday  10 AM – 8 PM", "Sunday  Closed". */
export function hoursRows(hours: BusinessHour[], now: Date = new Date()): HoursRow[] {
  if (!hours || hours.length === 0) return [];
  const { dow } = istNow(now);
  return DAY_NAMES.map((day, i) => {
    const h = hourFor(hours, i);
    let text = "Closed";
    if (h && !h.is_closed) {
      if (h.is_24h) text = "Open 24 hours";
      else if (h.open_time && h.close_time)
        text = `${formatClock(h.open_time)} – ${formatClock(h.close_time)}`;
    }
    return { day, text, isToday: i === dow };
  });
}

/** Reads the JSON stored in the database, ignoring anything malformed. */
export function parseHours(raw: unknown): BusinessHour[] {
  if (!Array.isArray(raw)) return [];
  const out: BusinessHour[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const dow = Number(o["dow"]);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) continue;
    out.push({
      dow,
      is_closed: !!o["is_closed"],
      is_24h: !!o["is_24h"],
      open_time: typeof o["open_time"] === "string" ? o["open_time"] : null,
      close_time: typeof o["close_time"] === "string" ? o["close_time"] : null,
    });
  }
  return out;
}

// ----------------------------------------------------------------- the page
export type BusinessService = {
  id: string;
  name: string;
  price: number;
  price_from: boolean;
  description: string | null;
};

export type BusinessPage = {
  category: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  hours: BusinessHour[];
  services: BusinessService[];
  rating_avg: number | null;
  rating_count: number;
  distribution: Record<string, number>;
};

export function parseBusinessPage(raw: unknown): BusinessPage | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  const services = Array.isArray(o["services"])
    ? (o["services"] as Record<string, unknown>[]).map((s) => ({
        id: String(s["id"]),
        name: String(s["name"] ?? ""),
        price: Number(s["price"] ?? 0),
        price_from: !!s["price_from"],
        description: str(s["description"]),
      }))
    : [];
  const avg = o["rating_avg"];
  return {
    category: str(o["category"]),
    phone: str(o["phone"]),
    whatsapp: str(o["whatsapp"]),
    address: str(o["address"]),
    hours: parseHours(o["hours"]),
    services,
    rating_avg: avg === null || avg === undefined ? null : Number(avg),
    rating_count: Number(o["rating_count"] ?? 0),
    distribution: (o["distribution"] as Record<string, number>) ?? {},
  };
}

/** Has the owner added anything at all that visitors can see? */
export function hasBusinessInfo(page: BusinessPage | null | undefined): boolean {
  if (!page) return false;
  return !!(
    page.category ||
    page.phone ||
    page.whatsapp ||
    page.address ||
    page.hours.length > 0 ||
    page.services.length > 0
  );
}

/** The owner's "complete your page" checklist. */
export function setupProgress(page: BusinessPage | null | undefined) {
  const contact = !!page && !!page.category && !!page.phone;
  const hours = !!page && page.hours.length > 0;
  const prices = !!page && page.services.length > 0;
  return {
    contact,
    hours,
    prices,
    done: [contact, hours, prices].filter(Boolean).length,
    total: 3,
  };
}

export async function fetchBusinessPage(ownerId: string): Promise<BusinessPage | null> {
  const { data, error } = await supabase.rpc("get_business_page", { p_owner_id: ownerId });
  if (error) {
    // Migration not run yet: just show no business info instead of an error.
    if (isMissingFunctionError(error)) return null;
    fail("Loading the business page", error);
  }
  return parseBusinessPage(data);
}

export function useBusinessPage(ownerId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["business-page", ownerId],
    queryFn: () => fetchBusinessPage(ownerId!),
    enabled: !!ownerId && enabled,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------- edit form
export type HourDraft = {
  dow: number;
  closed: boolean;
  allDay: boolean;
  open: string;
  close: string;
};

export type ServiceDraft = {
  key: string;
  name: string;
  /** what the person typed, e.g. "1,500" */
  price: string;
  priceFrom: boolean;
  description: string;
};

export type BusinessForm = {
  category: string;
  phone: string;
  whatsappSame: boolean;
  whatsapp: string;
  address: string;
  hoursEnabled: boolean;
  hours: HourDraft[];
  services: ServiceDraft[];
};

/** Mon-Sat 10 AM - 8 PM, Sunday closed: a sensible starting point. */
export function defaultHoursDraft(): HourDraft[] {
  return DAY_NAMES.map((_, dow) => ({
    dow,
    closed: dow === 6,
    allDay: false,
    open: "10:00",
    close: "20:00",
  }));
}

export function newServiceDraft(): ServiceDraft {
  return { key: randomId(), name: "", price: "", priceFrom: false, description: "" };
}

export function formFromPage(page: BusinessPage | null | undefined): BusinessForm {
  const hours = defaultHoursDraft();
  for (const h of page?.hours ?? []) {
    hours[h.dow] = {
      dow: h.dow,
      closed: h.is_closed,
      allDay: h.is_24h,
      open: h.open_time ?? "10:00",
      close: h.close_time ?? "20:00",
    };
  }
  const phone = page?.phone ?? "";
  const wa = page?.whatsapp ?? "";
  return {
    category: page?.category ?? "",
    phone,
    whatsappSame: !wa || wa === phone,
    whatsapp: wa && wa !== phone ? wa : "",
    address: page?.address ?? "",
    hoursEnabled: !page || page.hours.length > 0 || !hasBusinessInfo(page),
    hours,
    services: (page?.services ?? []).map((s) => ({
      key: s.id,
      name: s.name,
      price: String(s.price),
      priceFrom: s.price_from,
      description: s.description ?? "",
    })),
  };
}

export type FormErrors = {
  category?: string;
  phone?: string;
  whatsapp?: string;
  hours?: string;
  services?: Record<string, { name?: string; price?: string }>;
  count: number;
};

const rowIsEmpty = (s: ServiceDraft) => !s.name.trim() && !s.price.trim() && !s.description.trim();

export function validateBusinessForm(f: BusinessForm): FormErrors {
  const e: FormErrors = { count: 0 };
  if (!f.category) e.category = "Choose a category so people can find you";
  if (!f.phone) e.phone = "Add your phone number";
  else if (!isValidIndianMobile(f.phone)) e.phone = "Enter a 10-digit Indian mobile number";
  if (!f.whatsappSame && f.whatsapp && !isValidIndianMobile(f.whatsapp))
    e.whatsapp = "Enter a 10-digit Indian mobile number";
  if (f.hoursEnabled) {
    const bad = f.hours.find(
      (h) => !h.closed && !h.allDay && (!h.open || !h.close || h.open === h.close),
    );
    if (bad) e.hours = `${DAY_NAMES[bad.dow]}: opening and closing time can't be the same`;
  }
  const svc: NonNullable<FormErrors["services"]> = {};
  for (const s of f.services) {
    if (rowIsEmpty(s)) continue;
    const row: { name?: string; price?: string } = {};
    if (!s.name.trim()) row.name = "Add a name";
    if (!s.price.trim()) row.price = "Add a price";
    else if (parsePrice(s.price) === null) row.price = "Enter a valid price";
    if (row.name || row.price) svc[s.key] = row;
  }
  if (Object.keys(svc).length > 0) e.services = svc;
  e.count =
    (e.category ? 1 : 0) +
    (e.phone ? 1 : 0) +
    (e.whatsapp ? 1 : 0) +
    (e.hours ? 1 : 0) +
    Object.keys(svc).length;
  return e;
}

/** Saves the owner's business info and replaces the price list. */
export async function saveBusinessInfo(ownerId: string, f: BusinessForm): Promise<void> {
  const hours = f.hoursEnabled
    ? f.hours.map((h) => ({
        dow: h.dow,
        is_closed: h.closed,
        is_24h: !h.closed && h.allDay,
        open_time: h.closed || h.allDay ? null : h.open,
        close_time: h.closed || h.allDay ? null : h.close,
      }))
    : [];

  const { error } = await supabase.from("business_info").upsert(
    {
      owner_id: ownerId,
      category: f.category || null,
      phone: f.phone || null,
      whatsapp: f.whatsappSame ? f.phone || null : f.whatsapp || null,
      address: f.address.trim() || null,
      hours,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id" },
  );
  if (error) fail("Saving business info", error);

  // Price list: add the new rows first, then remove the old ones, so a failure never loses the list.
  const existing = await supabase.from("business_services").select("id").eq("owner_id", ownerId);
  if (existing.error) fail("Saving the price list", existing.error);
  const oldIds = (existing.data ?? []).map((r) => r.id);

  const rows = f.services
    .filter((s) => !rowIsEmpty(s))
    .map((s, i) => ({
      owner_id: ownerId,
      name: s.name.trim(),
      price: parsePrice(s.price) ?? 0,
      price_from: s.priceFrom,
      description: s.description.trim() || null,
      sort_order: i,
    }));
  if (oldIds.length > 0) {
    const del = await supabase.from("business_services").delete().in("id", oldIds);
    if (del.error) fail("Saving the price list", del.error);
  }
  if (rows.length > 0) {
    const ins = await supabase.from("business_services").insert(rows);
    if (ins.error) fail("Saving the price list", ins.error);
  }
}

// ------------------------------------------------------------------- reviews
export type BusinessReview = {
  business_id: string;
  reviewer_id: string;
  rating: number;
  body: string;
  owner_reply: string | null;
  replied_at: string | null;
  created_at: string;
  updated_at: string;
  reviewer: { full_name: string; username: string; avatar_url: string | null } | null;
};

export async function fetchBusinessReviews(businessId: string): Promise<BusinessReview[]> {
  const { data, error } = await supabase
    .from("business_reviews")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) fail("Loading reviews", error);
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const people = await supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url")
    .in(
      "id",
      rows.map((r) => r.reviewer_id),
    );
  const byId = new Map((people.data ?? []).map((p) => [p.id, p]));
  return rows.map((r) => {
    const p = byId.get(r.reviewer_id);
    return {
      ...r,
      reviewer: p
        ? { full_name: p.full_name, username: p.username, avatar_url: p.avatar_url }
        : null,
    };
  });
}

export async function saveBusinessReview(args: {
  businessId: string;
  reviewerId: string;
  rating: number;
  body: string;
  /** true when this person already has a review of this business */
  exists: boolean;
}): Promise<void> {
  const body = args.body.trim();
  if (args.exists) {
    const { error } = await supabase
      .from("business_reviews")
      .update({ rating: args.rating, body, updated_at: new Date().toISOString() })
      .eq("business_id", args.businessId)
      .eq("reviewer_id", args.reviewerId);
    if (error) fail("Saving your review", error);
    return;
  }
  const { error } = await supabase.from("business_reviews").insert({
    business_id: args.businessId,
    reviewer_id: args.reviewerId,
    rating: args.rating,
    body,
  });
  if (error) {
    if (error.code === "23505") throw new Error("You have already reviewed this business.");
    fail("Saving your review", error);
  }
}

export async function deleteBusinessReview(businessId: string, reviewerId: string): Promise<void> {
  const { error } = await supabase
    .from("business_reviews")
    .delete()
    .eq("business_id", businessId)
    .eq("reviewer_id", reviewerId);
  if (error) fail("Deleting your review", error);
}

export async function replyToBusinessReview(reviewerId: string, reply: string): Promise<void> {
  const { error } = await supabase.rpc("reply_to_business_review", {
    p_reviewer_id: reviewerId,
    p_reply: reply,
  });
  if (error) fail("Saving your reply", error);
}

// ------------------------------------------------------------------ directory
export type BusinessListing = Omit<BusinessDirectoryRow, "hours"> & { hours: BusinessHour[] };

export async function fetchBusinessDirectory(args: {
  query?: string;
  category?: string;
  limit?: number;
}): Promise<BusinessListing[]> {
  const { data, error } = await supabase.rpc("get_business_directory", {
    p_query: args.query?.trim() ? args.query.trim() : null,
    p_category: args.category ? args.category : null,
    p_limit: args.limit ?? 40,
  });
  if (error) {
    // Migration not run yet: fall back to an empty directory.
    if (isMissingFunctionError(error)) return [];
    fail("Loading businesses", error);
  }
  return (data ?? []).map((r) => ({
    ...r,
    rating_avg: r.rating_avg === null ? null : Number(r.rating_avg),
    rating_count: Number(r.rating_count),
    hours: parseHours(r.hours),
  }));
}

export async function fetchBusinessCategories(): Promise<{ category: string; n: number }[]> {
  const { data, error } = await supabase.rpc("get_business_categories");
  if (error) {
    if (isMissingFunctionError(error)) return [];
    fail("Loading categories", error);
  }
  return (data ?? []).map((r) => ({ category: r.category, n: Number(r.n) }));
}
