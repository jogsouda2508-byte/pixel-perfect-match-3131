import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { communityError, type CommunityPerson } from "@/lib/community";
import { validateImage } from "@/lib/social";
import { compressImageFile } from "@/lib/image-compress";
import { sanitizeImageFile } from "@/lib/image-sanitize";
import { randomId } from "@/lib/uuid";

// The generated database types don't know the market table, so talk to it untyped.
const db = supabase as unknown as SupabaseClient;

export const MARKET_MIGRATION_HINT =
  "The Market needs a one-time database update. In Supabase open SQL Editor, run " +
  "supabase/migrations/20261108000000_community_market.sql, then try again.";

export const MAX_PHOTOS = 4;

export const MARKET_CATEGORIES = [
  { key: "furniture", label: "Furniture" },
  { key: "electronics", label: "Electronics" },
  { key: "vehicles", label: "Vehicles" },
  { key: "clothes", label: "Clothes" },
  { key: "home", label: "Home & kitchen" },
  { key: "books", label: "Books" },
  { key: "kids", label: "Kids" },
  { key: "other", label: "Other" },
] as const;
export type MarketCategory = (typeof MARKET_CATEGORIES)[number]["key"];

export const MARKET_CONDITIONS = [
  { key: "new", label: "New" },
  { key: "like_new", label: "Like new" },
  { key: "used", label: "Used" },
] as const;
export type MarketCondition = (typeof MARKET_CONDITIONS)[number]["key"];

export const categoryLabel = (k: string) =>
  MARKET_CATEGORIES.find((c) => c.key === k)?.label ?? "Other";
export const conditionLabel = (k: string) =>
  MARKET_CONDITIONS.find((c) => c.key === k)?.label ?? "Used";

export type Listing = {
  id: string;
  title: string;
  description: string | null;
  price: number;
  category: MarketCategory;
  condition: MarketCondition;
  locality: string;
  image_urls: string[];
  created_at: string;
  sold_at: string | null;
  is_mine: boolean;
  seller: CommunityPerson;
};

/** "Free", "₹450" or "₹12,500": rupees, Indian digit grouping, no paise when there are none. */
export function formatPrice(price: number): string {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return "Free";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/**
 * Reads what was typed in the price box. Empty or "free" means 0 (free). Returns null when it is
 * not a usable amount. Commas and a leading ₹ are ignored.
 */
export function parsePrice(text: string): number | null {
  const t = text.replace(/[₹,\s]/g, "").toLowerCase();
  if (t === "" || t === "free") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= 9_999_999 ? n : null;
}

export type ListingForm = {
  title: string;
  description: string;
  price: string;
  category: MarketCategory;
  condition: MarketCondition;
  locality: string;
  photos: number;
};

export function validateListing(
  f: ListingForm,
): Partial<Record<"title" | "price" | "locality" | "photos", string>> {
  const e: Partial<Record<"title" | "price" | "locality" | "photos", string>> = {};
  if (f.title.trim().length < 3) e.title = "Say what you are selling (at least 3 letters)";
  if (parsePrice(f.price) === null)
    e.price = "Enter the price in rupees, or leave it empty for free";
  if (f.locality.trim().length < 2) e.locality = "Add the area, like Whitefield";
  if (f.photos < 1) e.photos = "Add at least one photo so buyers can see it";
  return e;
}

export async function fetchListings(args: {
  locality: string | null;
  query?: string;
  category?: MarketCategory | null;
}): Promise<Listing[]> {
  const { data, error } = await db.rpc("get_community_listings", {
    p_locality: args.locality,
    p_query: args.query ?? "",
    p_category: args.category ?? null,
    p_limit: 60,
  });
  if (error) {
    console.error("get_community_listings failed", error);
    throw marketError(error, "Couldn't load the Market.");
  }
  return (Array.isArray(data) ? (data as Listing[]) : []).map((l) => ({
    ...l,
    price: Number(l.price),
    image_urls: Array.isArray(l.image_urls) ? l.image_urls : [],
  }));
}

function marketError(
  error: { message?: string | null; code?: string | null },
  fallback: string,
): Error {
  const e = communityError(error, fallback);
  // The generic community hint names the wrong file for this feature.
  return /one-time database update/.test(e.message) ? new Error(MARKET_MIGRATION_HINT) : e;
}

/** Uploads one photo to the public `media` bucket under <uid>/market/<uuid>.<ext>. */
export async function uploadListingPhoto(userId: string, file: File): Promise<string> {
  const problem = validateImage(file);
  if (problem) throw new Error(problem);
  const clean = await sanitizeImageFile(await compressImageFile(file), 10 * 1024 * 1024);
  const ext = clean.type === "image/jpeg" ? "jpg" : clean.type.split("/")[1];
  const path = `${userId}/market/${randomId()}.${ext}`;
  const { error } = await supabase.storage.from("media").upload(path, clean, {
    contentType: clean.type,
    cacheControl: "31536000",
  });
  if (error) {
    console.error("market photo upload failed", error);
    throw new Error("Couldn't upload the photo. Check your internet and try again.");
  }
  return supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
}

export async function createListing(
  sellerId: string,
  v: {
    title: string;
    description: string;
    price: number;
    category: MarketCategory;
    condition: MarketCondition;
    locality: string;
    imageUrls: string[];
  },
): Promise<void> {
  const { error } = await db.from("community_listings").insert({
    seller_id: sellerId,
    title: v.title.trim(),
    description: v.description.trim() || null,
    price: v.price,
    category: v.category,
    condition: v.condition,
    locality: v.locality.trim(),
    image_urls: v.imageUrls,
  });
  if (error) {
    console.error("create listing failed", error);
    throw marketError(error, "Couldn't post your item.");
  }
}

export async function setListingSold(id: string, sold: boolean): Promise<void> {
  const { error } = await db
    .from("community_listings")
    .update({ sold_at: sold ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw marketError(error, "Couldn't update the item.");
}

export async function deleteListing(id: string): Promise<void> {
  const { error } = await db.from("community_listings").delete().eq("id", id);
  if (error) throw marketError(error, "Couldn't remove the item.");
}
