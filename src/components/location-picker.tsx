import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Crosshair, Loader2, MapPin, RefreshCw, Search } from "lucide-react";
import { ResponsiveModal } from "@/components/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  nearbyPlaces,
  placeSubtitle,
  requestDeviceLocation,
  searchPlaces,
  type Coordinates,
  type PlaceSelection,
} from "@/lib/places";

const DEBOUNCE_MS = 300;

/**
 * Search for a place (city, college, cafe, restaurant, park, landmark, business) and confirm it
 * with "Add Location". Manual search always works; the optional "nearby" list only appears after
 * the person taps "Use my current location" and grants the browser permission.
 */
export function LocationPickerModal({
  open,
  onOpenChange,
  value,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: PlaceSelection | null;
  onConfirm: (place: PlaceSelection) => void;
}) {
  const isMobile = useIsMobile();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<PlaceSelection | null>(value);
  const [device, setDevice] = useState<Coordinates | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState("");

  // Start fresh (but keep the current choice highlighted) every time the picker opens.
  useEffect(() => {
    if (!open) return;
    setSelected(value);
    setQuery("");
    setDebounced("");
    setLocationNote("");
  }, [open, value]);

  // Debounce typing so we don't call the places service on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const typed = query.trim();
  const searching = debounced.length >= 2;
  const waiting = typed.length >= 2 && typed !== debounced;
  const deviceKey = device ? `${device.latitude.toFixed(2)},${device.longitude.toFixed(2)}` : null;

  // React Query aborts the in-flight request (via `signal`) when the query key changes or the
  // modal closes, so slow, obsolete responses never overwrite newer ones.
  const search = useQuery({
    queryKey: ["places", "search", debounced, deviceKey],
    queryFn: ({ signal }) => searchPlaces(debounced, { signal, bias: device }),
    enabled: open && searching,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const nearby = useQuery({
    queryKey: ["places", "nearby", deviceKey],
    queryFn: ({ signal }) => nearbyPlaces(device!, { signal }),
    enabled: open && !!device && !searching,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const active = searching ? search : nearby;
  const places = active.data ?? [];
  const showResults = searching || !!device;

  const shareMyLocation = async () => {
    setLocating(true);
    setLocationNote("");
    try {
      setDevice(await requestDeviceLocation());
    } catch (error) {
      setLocationNote(
        error instanceof Error && error.message === "denied"
          ? "Location access is blocked, so nearby places can't be shown. You can still search above."
          : "Couldn't get your location right now. You can still search above.",
      );
    } finally {
      setLocating(false);
    }
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Add location"
      description="Search for a place, city, cafe, college or landmark."
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="min-h-11"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              onConfirm(selected);
              onOpenChange(false);
            }}
          >
            Add Location
          </Button>
        </>
      }
    >
      <label className="relative block">
        <span className="sr-only">Search places</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value.slice(0, 100))}
          placeholder="Search places"
          autoComplete="off"
          autoFocus={!isMobile}
          className="h-11 pl-10"
        />
      </label>

      {selected && (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
          <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">
            <span className="font-semibold">{selected.name}</span>
            {selected.city ? `, ${selected.city}` : ""}
          </span>
        </p>
      )}

      <div className="mt-3 min-h-[8rem] flex-1 overflow-y-auto" aria-live="polite">
        {!showResults && !waiting && (
          <div className="space-y-3 py-2 text-sm text-muted-foreground">
            <p>Type at least two letters to search.</p>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-full"
              disabled={locating}
              onClick={() => void shareMyLocation()}
            >
              {locating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Crosshair className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              Use my current location
            </Button>
            <p className="text-xs">
              Optional. We only use your location to suggest nearby places while you pick one — it
              isn't saved or shown on your post.
            </p>
            {locationNote && (
              <p role="status" className="text-xs">
                {locationNote}
              </p>
            )}
          </div>
        )}

        {(waiting || (showResults && active.isFetching && places.length === 0)) && (
          <div className="grid place-items-center py-8" role="status" aria-label="Searching">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        )}

        {!waiting && showResults && active.isError && (
          <div className="space-y-3 py-6 text-center" role="alert">
            <p className="text-sm text-destructive">
              {active.error instanceof Error
                ? active.error.message
                : "Couldn't load places. Please try again."}
            </p>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => void active.refetch()}
            >
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
          </div>
        )}

        {!waiting && showResults && active.isSuccess && places.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {searching ? `No places found for “${debounced}”.` : "No named places found nearby."}
          </p>
        )}

        {!waiting && places.length > 0 && (
          <>
            {!searching && (
              <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Nearby
              </p>
            )}
            <ul className="space-y-1">
              {places.map((place) => {
                const isSelected = selected?.placeId === place.placeId;
                return (
                  <li key={place.placeId}>
                    <button
                      type="button"
                      onClick={() => setSelected(place)}
                      aria-pressed={isSelected}
                      className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isSelected ? "bg-primary/10" : "hover:bg-muted"}`}
                    >
                      <MapPin className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{place.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {placeSubtitle(place)}
                        </span>
                      </span>
                      {isSelected && <Check className="h-5 w-5 shrink-0 text-primary" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </ResponsiveModal>
  );
}
