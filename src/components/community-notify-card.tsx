import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { Loader2, MapPin } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import {
  DEFAULT_NOTIFY_PREFS,
  fetchNotifyPrefs,
  hasNotifyLocation,
  notifyExample,
  saveNotifyPrefs,
  type CommunityNotifyPrefs,
} from "@/lib/community-notify";

const ROWS: { key: keyof CommunityNotifyPrefs; label: string }[] = [
  { key: "alerts", label: "Nearby alerts" },
  { key: "events", label: "Nearby events" },
];

/** Settings card: choose which Community notifications you get. Uses the same push as chat. */
export function CommunityNotifyCard() {
  const { profile } = useAuth();
  const [prefs, setPrefs] = useState<CommunityNotifyPrefs | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetchNotifyPrefs()
      .then((p) => live && setPrefs(p))
      .catch((e: unknown) => {
        if (live) setFailed(e instanceof Error ? e.message : "Couldn't load your choices.");
      });
    return () => {
      live = false;
    };
  }, []);

  const change = async (key: keyof CommunityNotifyPrefs, value: boolean) => {
    if (busy) return;
    const before = prefs ?? DEFAULT_NOTIFY_PREFS;
    setPrefs({ ...before, [key]: value }); // show the change at once, undo if it fails
    setBusy(true);
    try {
      setPrefs(await saveNotifyPrefs({ ...before, [key]: value }));
    } catch (e) {
      setPrefs(before);
      toast.error(e instanceof Error ? e.message : "Couldn't save your choice.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass-card space-y-3 p-4" aria-labelledby="community-notify-heading">
      <h2 id="community-notify-heading" className="font-semibold">
        Community notifications
      </h2>
      {failed ? (
        <p className="text-sm text-muted-foreground">{failed}</p>
      ) : !prefs ? (
        <div className="flex justify-center py-3" role="status" aria-label="Loading">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {ROWS.map((row) => (
            <div key={row.key} className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <label htmlFor={`cn-${row.key}`} className="block text-sm font-semibold">
                  {row.label}
                </label>
                <p className="text-xs text-muted-foreground">{notifyExample(row.key)}</p>
              </div>
              <Switch
                id={`cn-${row.key}`}
                checked={prefs[row.key]}
                disabled={busy}
                onCheckedChange={(v) => void change(row.key, v)}
              />
            </div>
          ))}
          {!hasNotifyLocation(profile?.location) && (
            <p className="flex items-start gap-2 rounded-xl bg-primary/10 p-3 text-xs">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>
                Add your area in{" "}
                <Link to="/settings" className="font-semibold underline">
                  Edit profile
                </Link>{" "}
                so we know what is near you. Without it you only hear about events you joined.
              </span>
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            These use the notifications switch above. Turn that on to receive them.
          </p>
        </>
      )}
    </section>
  );
}
