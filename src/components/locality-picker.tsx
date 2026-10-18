import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { fetchLocalities } from "@/lib/social";

export function LocalityPicker({
  active,
  profileLocation,
  selected,
  onSelect,
}: {
  /** the locality the feed is currently using (picked one, else the profile's), or null */
  active: string | null;
  profileLocation: string | null;
  selected: string | null;
  onSelect: (value: string | null) => void;
}) {
  const [draft, setDraft] = useState("");
  const localities = useQuery({
    queryKey: ["localities"],
    queryFn: () => fetchLocalities(20),
    staleTime: 5 * 60_000,
  });

  const apply = (value: string) => {
    const v = value.trim();
    if (v) {
      onSelect(v);
      setDraft("");
    }
  };

  return (
    <section className="glass-card space-y-3 p-4" aria-label="Local feed location">
      <div className="flex items-start gap-2">
        <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1 text-sm">
          {active ? (
            <>
              <p className="font-semibold">
                Posts from <span className="break-words">{active}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {selected
                  ? "Only posts shared with everyone are shown for a place that isn't your own."
                  : "Using the location from your profile."}
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">Choose a locality to see local posts</p>
              <p className="text-xs text-muted-foreground">
                Local posts need a place. Pick one below, or{" "}
                <Link to="/settings" className="font-medium text-primary underline">
                  add a location to your profile
                </Link>
                .
              </p>
            </>
          )}
        </div>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply(draft);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          list="ediraa-localities"
          maxLength={80}
          placeholder="Type a city or area"
          aria-label="Locality"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm"
        />
        <datalist id="ediraa-localities">
          {localities.data?.map((l) => (
            <option key={l.locality} value={l.locality} />
          ))}
        </datalist>
        <button
          type="submit"
          disabled={!draft.trim()}
          className="min-h-11 shrink-0 rounded-xl bg-gradient-brand px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          Show
        </button>
      </form>

      {localities.data && localities.data.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {localities.data.slice(0, 6).map((l) => {
            const on = active?.toLowerCase() === l.locality.toLowerCase();
            return (
              <button
                key={l.locality}
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(l.locality)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${on ? "bg-gradient-brand text-primary-foreground" : "border border-border bg-card"}`}
              >
                {l.locality}
              </button>
            );
          })}
        </div>
      )}

      {selected && profileLocation && selected.toLowerCase() !== profileLocation.toLowerCase() && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="text-xs font-medium text-primary underline"
        >
          Back to my location ({profileLocation})
        </button>
      )}
      {selected && !profileLocation && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="text-xs font-medium text-primary underline"
        >
          Clear
        </button>
      )}
    </section>
  );
}
