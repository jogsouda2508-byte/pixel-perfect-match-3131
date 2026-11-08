import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Clock, Loader2, MapPin, Search } from "lucide-react";
import { Stars } from "@/components/business-reviews";
import { Avatar, Pill } from "@/components/ediraa";
import { useAuth } from "@/lib/auth";
import {
  computeOpenStatus,
  fetchBusinessCategories,
  fetchBusinessDirectory,
  type BusinessListing,
} from "@/lib/business";

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function ListingRow({ b, now }: { b: BusinessListing; now: Date }) {
  const status = computeOpenStatus(b.hours, now);
  const name = b.full_name || b.username;
  return (
    <li>
      <Link
        to="/u/$username"
        params={{ username: b.username }}
        className="flex min-h-16 items-center gap-3 rounded-xl py-1.5 hover:bg-elevated/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Avatar src={b.avatar_url} name={name} size={48} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{name}</p>
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            {b.category ?? `@${b.username}`}
            {b.address && (
              <>
                <span aria-hidden="true">·</span>
                <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{b.address}</span>
              </>
            )}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            {b.rating_count > 0 && (
              <span className="flex items-center gap-1">
                <Stars value={b.rating_avg ?? 0} size={12} />
                <span className="font-semibold">{(b.rating_avg ?? 0).toFixed(1)}</span>
                <span className="text-muted-foreground">({b.rating_count})</span>
              </span>
            )}
            {status.state !== "unknown" && (
              <span
                className={`flex items-center gap-1 font-medium ${status.state === "open" ? "text-success" : "text-muted-foreground"}`}
              >
                <Clock className="h-3 w-3" aria-hidden="true" />
                {status.state === "open" ? "Open now" : "Closed"}
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

/**
 * Find businesses: search by name / area / category, tap a category chip, or show only the ones
 * that are open now. Used on the Business page (with its own search box) and in Discover > Business
 * (which passes its search text in).
 */
export function BusinessDirectory({
  query: externalQuery,
  showSearch = false,
}: {
  query?: string;
  showSearch?: boolean;
}) {
  const { user } = useAuth();
  const meId = user?.id ?? "";
  const [own, setOwn] = useState("");
  const [category, setCategory] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const q = useDebounced((externalQuery ?? own).trim());
  const [now, setNow] = useState(() => new Date());

  const cats = useQuery({
    queryKey: ["business-categories", meId],
    queryFn: fetchBusinessCategories,
    enabled: !!meId,
    staleTime: 60_000,
  });
  const list = useQuery({
    queryKey: ["business-directory", q, category, meId],
    queryFn: () => fetchBusinessDirectory({ query: q, category, limit: 100 }),
    enabled: !!meId,
    staleTime: 30_000,
  });

  // Re-read the clock whenever the list or the filters change, so "Open now" is current.
  useEffect(() => setNow(new Date()), [list.data, openOnly]);

  const shown = useMemo(
    () =>
      (list.data ?? []).filter(
        (b) => !openOnly || computeOpenStatus(b.hours, now).state === "open",
      ),
    [list.data, openOnly, now],
  );

  const filtered = !!q || !!category || openOnly;

  return (
    <section className="glass-card space-y-3 p-4" aria-label="Businesses on SabZone">
      <h2 className="font-semibold">Businesses near you</h2>

      {showSearch && (
        <label className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Search businesses</span>
          <input
            value={own}
            onChange={(e) => setOwn(e.target.value)}
            placeholder="Search salon, restaurant, area…"
            className="w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </label>
      )}

      <div className="scrollbar-hidden -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <Pill active={openOnly} onClick={() => setOpenOnly((v) => !v)}>
          Open now
        </Pill>
        <Pill active={category === ""} onClick={() => setCategory("")}>
          All
        </Pill>
        {(cats.data ?? []).map((c) => (
          <Pill
            key={c.category}
            active={category === c.category}
            onClick={() => setCategory(category === c.category ? "" : c.category)}
          >
            {c.category}
          </Pill>
        ))}
      </div>

      {list.isLoading && (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />
      )}
      {list.isError && (
        <p className="text-sm text-destructive">
          Couldn't load businesses.{" "}
          <button
            type="button"
            onClick={() => void list.refetch()}
            className="font-semibold underline"
          >
            Try again
          </button>
        </p>
      )}
      {list.isSuccess && shown.length === 0 && (
        <div className="py-4 text-center text-sm text-muted-foreground">
          {filtered ? (
            <>
              <p>No businesses match.</p>
              <button
                type="button"
                onClick={() => {
                  setOwn("");
                  setCategory("");
                  setOpenOnly(false);
                }}
                className="mt-1 font-semibold text-primary"
              >
                Clear filters
              </button>
            </>
          ) : (
            <p>No other businesses have joined yet.</p>
          )}
        </div>
      )}
      <ul className="space-y-1">
        {shown.map((b) => (
          <ListingRow key={b.id} b={b} now={now} />
        ))}
      </ul>
    </section>
  );
}
