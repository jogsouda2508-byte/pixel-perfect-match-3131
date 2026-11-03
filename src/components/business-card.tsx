import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Clock, MapPin, MessageCircle, Pencil, Phone } from "lucide-react";
import { BusinessReviews, Stars } from "@/components/business-reviews";
import {
  computeOpenStatus,
  formatIndianMobile,
  formatServicePrice,
  hasBusinessInfo,
  hoursRows,
  setupProgress,
  telHref,
  useBusinessPage,
  whatsappHref,
} from "@/lib/business";
import type { Profile } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";

/** Re-reads "now" every minute so "Open now" stays correct while the page is open. */
function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * Shown on a business profile: category, open/closed, rating, Call and WhatsApp buttons,
 * address, price list, opening hours and reviews. For the owner it also nudges them to finish setup.
 */
export function BusinessInfoCard({ profile, isMe }: { profile: Profile; isMe: boolean }) {
  const { user } = useAuth();
  const isBusiness = profile.account_type === "business";
  const q = useBusinessPage(profile.id, isBusiness);
  const now = useNow();
  const [hoursOpen, setHoursOpen] = useState(false);

  if (!isBusiness) return null;
  if (q.isLoading) {
    return (
      <div className="mt-3 h-24 animate-pulse rounded-2xl bg-elevated/60" aria-hidden="true" />
    );
  }
  const page = q.data;

  if (!hasBusinessInfo(page) || !page) {
    // Visitors see nothing until the owner adds info; the owner gets a clear first step.
    return isMe ? (
      <Link
        to="/business-edit"
        className="mt-3 flex min-h-12 items-center gap-3 rounded-2xl border border-dashed border-primary/60 px-4 py-3 text-sm"
      >
        <Pencil className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Set up your business info</span>
          <span className="block text-muted-foreground">
            Add hours, phone, WhatsApp and your price list
          </span>
        </span>
      </Link>
    ) : null;
  }

  const status = computeOpenStatus(page.hours, now);
  const rows = hoursRows(page.hours, now);
  const progress = setupProgress(page);
  const name = profile.full_name || profile.username;
  const whatsappMsg = `Hi ${name}, I found you on Gicco chat.`;

  return (
    <>
      <section
        aria-label="Business info"
        className="mt-3 space-y-4 rounded-2xl border border-border p-4"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {page.category && (
            <span className="rounded-full bg-elevated px-2.5 py-1 text-xs font-semibold text-primary">
              {page.category}
            </span>
          )}
          {page.rating_count > 0 && (
            <button
              type="button"
              onClick={() =>
                document.getElementById("reviews")?.scrollIntoView({ behavior: "smooth" })
              }
              className="flex min-h-8 items-center gap-1.5"
              aria-label={`${(page.rating_avg ?? 0).toFixed(1)} stars, ${page.rating_count} reviews. Jump to reviews`}
            >
              <Stars value={page.rating_avg ?? 0} size={14} />
              <span className="font-semibold">{(page.rating_avg ?? 0).toFixed(1)}</span>
              <span className="text-muted-foreground">({page.rating_count})</span>
            </button>
          )}
          {status.state !== "unknown" && (
            <span
              className={`flex items-center gap-1 font-medium ${status.state === "open" ? "text-success" : "text-destructive"}`}
            >
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {status.text}
            </span>
          )}
        </div>

        {page.address && (
          <p className="flex items-start gap-2 text-sm">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 break-words">{page.address}</span>
          </p>
        )}

        {(page.phone || page.whatsapp) && (
          <div className="grid grid-cols-2 gap-2">
            {page.phone && (
              <a
                href={telHref(page.phone)}
                className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-gradient-brand text-sm font-semibold text-primary-foreground"
                aria-label={`Call ${formatIndianMobile(page.phone)}`}
              >
                <Phone className="h-4 w-4" aria-hidden="true" />
                Call
              </a>
            )}
            {page.whatsapp && (
              <a
                href={whatsappHref(page.whatsapp, whatsappMsg)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 items-center justify-center gap-2 rounded-full border border-success text-sm font-semibold text-success"
                aria-label="Message on WhatsApp"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                WhatsApp
              </a>
            )}
            {page.phone && !page.whatsapp && <span aria-hidden="true" />}
          </div>
        )}
        {page.phone && (
          <p className="-mt-2 text-center text-xs text-muted-foreground">
            {formatIndianMobile(page.phone)}
          </p>
        )}

        {page.services.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-bold">Price list</h3>
            <ul className="divide-y divide-border">
              {page.services.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-medium">{s.name}</span>
                    {s.description && (
                      <span className="block break-words text-xs text-muted-foreground">
                        {s.description}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-sm font-semibold">{formatServicePrice(s)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {rows.length > 0 && (
          <div>
            <button
              type="button"
              aria-expanded={hoursOpen}
              onClick={() => setHoursOpen((v) => !v)}
              className="flex min-h-11 w-full items-center justify-between text-sm font-bold"
            >
              Opening hours
              <ChevronDown
                className={`h-4 w-4 transition ${hoursOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>
            {hoursOpen && (
              <ul className="space-y-1.5 pb-1 text-sm">
                {rows.map((r) => (
                  <li
                    key={r.day}
                    className={`flex justify-between gap-3 ${r.isToday ? "font-semibold" : "text-muted-foreground"}`}
                  >
                    <span>
                      {r.day}
                      {r.isToday ? " (today)" : ""}
                    </span>
                    <span>{r.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {isMe && (
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              {progress.done === progress.total
                ? "Your business page is complete"
                : `${progress.done} of ${progress.total} set up`}
            </p>
            <Link
              to="/business-edit"
              className="flex min-h-10 items-center gap-1.5 rounded-full border border-primary px-4 text-sm font-semibold text-primary"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Edit business info
            </Link>
          </div>
        )}
      </section>

      <div className="mt-4">
        <BusinessReviews
          businessId={profile.id}
          businessName={name}
          isOwner={isMe}
          meId={user?.id ?? ""}
          page={page}
        />
      </div>
    </>
  );
}
