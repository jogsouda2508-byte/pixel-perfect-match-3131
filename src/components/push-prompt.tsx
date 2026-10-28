import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, Loader2, X } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import {
  initNativePush,
  isNativePlatform,
  setNativePushHandlers,
  syncNativePush,
} from "@/lib/native-push";
import {
  disablePush,
  enablePush,
  getPushState,
  pushStateText,
  registerServiceWorker,
  type PushState,
} from "@/lib/push";

const DISMISS_KEY = "gicco.push-prompt.dismissed-at";
const DISMISS_DAYS = 14;
/** The prompt appears a while after you are signed in, never on the first page load. */
const SHOW_AFTER_MS = 8000;

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? "0");
    return at > 0 && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

/** Shared by the prompt and the settings card: current state + turn on / off. */
export function usePush() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setState(await getPushState());
    } catch {
      setState("unsupported");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const turnOn = useCallback(async () => {
    setBusy(true);
    try {
      const result = await enablePush();
      if (result === "on") toast.success("Notifications are on");
      else if (result === "denied")
        toast.error(
          isNativePlatform()
            ? "Notifications are blocked. Allow them in your phone's Settings > Apps > Gicco."
            : "Notifications are blocked in your browser settings.",
        );
      else if (result === "needs-app-update") toast.error(pushStateText("needs-app-update"));
      await refresh();
      return result;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't turn notifications on.");
      await refresh();
      return null;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const turnOff = useCallback(async () => {
    setBusy(true);
    try {
      await disablePush();
      toast.success("Notifications are off");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't turn notifications off.");
    } finally {
      await refresh();
      setBusy(false);
    }
  }, [refresh]);

  return { state, busy, turnOn, turnOff };
}

/**
 * A small card, shown once the person is signed in (after a short delay, not on first load),
 * asking if they want notifications. The browser's permission question only appears after
 * they tap "Turn on". "Not now" hides it for 14 days.
 */
export function PushPrompt() {
  const { user, profile } = useAuth();
  const { state, busy, turnOn } = usePush();
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(false);
  const router = useRouter();
  const signedIn = !!user && !!profile;

  // Start the service worker once someone is signed in (harmless, and needed for push).
  // The Android app doesn't use it: it gets its notifications from Firebase instead.
  useEffect(() => {
    if (signedIn && !isNativePlatform()) void registerServiceWorker();
  }, [signedIn]);

  // Android app: open the right screen when a notification is tapped (also from a cold start),
  // and show a small banner when one arrives while the app is open.
  useEffect(() => {
    if (!isNativePlatform()) return;
    setNativePushHandlers({
      onOpen: (path) => router.history.push(path),
      onForeground: ({ title, body, path }) => {
        // already looking at that screen (e.g. the same chat): nothing to announce
        if (path && window.location.pathname === path.split("?")[0]) return;
        toast(title || "New notification", {
          ...(body ? { description: body } : {}),
          ...(path ? { action: { label: "Open", onClick: () => router.history.push(path) } } : {}),
        });
      },
    });
    void initNativePush();
    return () => setNativePushHandlers({});
  }, [router]);

  // Android app: refresh this phone's notification token each time a signed-in person opens the app.
  useEffect(() => {
    if (signedIn) void syncNativePush();
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) {
      setReady(false);
      return;
    }
    const t = setTimeout(() => setReady(true), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [signedIn]);

  // Only the "can turn on now" case is worth interrupting for; the iPhone / blocked
  // explanations live on the Settings page.
  if (!signedIn || !ready || hidden || state !== "off" || recentlyDismissed()) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode: it simply shows again next visit */
    }
    setHidden(true);
  };

  return (
    <div
      role="region"
      aria-label="Turn on notifications"
      className="glass-card fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-md items-start gap-3 p-4 shadow-xl md:bottom-6"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-brand text-primary-foreground">
        <Bell className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Turn on notifications?</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{pushStateText("off")}</p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              const result = await turnOn();
              if (result === "on" || result === "denied") setHidden(true);
            }}
            className="flex min-h-9 items-center gap-2 rounded-full bg-gradient-brand px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Turn on
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="min-h-9 rounded-full border border-border px-4 text-xs font-medium"
          >
            Not now
          </button>
        </div>
      </div>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="rounded-full p-1 hover:bg-muted">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Settings & Privacy card: the on / off switch plus the explanation for the current state. */
export function PushSettingsCard() {
  const { state, busy, turnOn, turnOff } = usePush();
  if (!state) return null;
  const canToggle = state === "on" || state === "off";
  return (
    <section className="glass-card space-y-3 p-4">
      <h2 className="font-semibold">Notifications</h2>
      <p className="text-sm text-muted-foreground">{pushStateText(state)}</p>
      {canToggle && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void (state === "on" ? turnOff() : turnOn())}
          className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold disabled:opacity-60 ${
            state === "on"
              ? "border border-border"
              : "bg-gradient-brand text-primary-foreground"
          }`}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {state === "on" ? "Turn off notifications" : "Turn on notifications"}
        </button>
      )}
    </section>
  );
}
