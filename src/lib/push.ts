import { supabase } from "@/integrations/supabase/client";

/**
 * Web Push (notifications while the app / tab is closed).
 * The service worker is /sw.js; the server side is the `send-push` Edge Function.
 * Nothing here asks for permission by itself: `enablePush` must be called from a tap.
 */

export type PushState =
  /** this browser can't do Web Push at all */
  | "unsupported"
  /** iPhone / iPad: only works once the app was added to the Home Screen */
  | "needs-install"
  /** the app has no VAPID public key configured */
  | "not-configured"
  /** the person blocked notifications in the browser settings */
  | "denied"
  /** not asked yet, or asked but not subscribed */
  | "off"
  /** this browser is subscribed */
  | "on";

const SW_URL = "/sw.js";

export function vapidPublicKey(): string {
  return ((import.meta.env["VITE_VAPID_PUBLIC_KEY"] as string | undefined) ?? "").trim();
}

export function isIosDevice(ua: string = navigator.userAgent, maxTouchPoints = navigator.maxTouchPoints): boolean {
  // iPadOS 13+ reports itself as a Mac with touch support
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** VAPID keys are url-safe base64; the Push API wants raw bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SW_URL, { scope: "/" });
  } catch (e) {
    console.error("Service worker registration failed", e);
    return null;
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** What the UI should show right now. */
export async function getPushState(): Promise<PushState> {
  if (typeof window === "undefined") return "unsupported";
  // iPhone Safari (in a normal tab) has no PushManager until the app is on the Home Screen.
  if (isIosDevice() && !isStandalone()) return "needs-install";
  if (!isPushSupported()) return "unsupported";
  if (!vapidPublicKey()) return "not-configured";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted" && (await currentSubscription())) return "on";
  return "off";
}

export type EnableResult = "on" | "denied" | "dismissed" | "unsupported" | "needs-install" | "not-configured";

/**
 * Asks for permission (call this from a tap!), subscribes this browser and saves the
 * subscription for the signed-in person.
 */
export async function enablePush(): Promise<EnableResult> {
  const state = await getPushState();
  if (state === "unsupported" || state === "needs-install" || state === "not-configured") return state;
  if (state === "denied") return "denied";

  const permission = await Notification.requestPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "dismissed"; // closed the prompt without choosing

  const reg = (await registerServiceWorker()) ?? null;
  if (!reg) throw new Error("Couldn't start the notification service.");
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey()),
    });
  }
  const json = sub.toJSON();
  const p256dh = json.keys?.["p256dh"];
  const auth = json.keys?.["auth"];
  if (!json.endpoint || !p256dh || !auth) throw new Error("This browser returned an incomplete subscription.");

  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: json.endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_user_agent: navigator.userAgent,
  });
  if (error) {
    console.error("Saving the push subscription failed", error);
    throw new Error("Couldn't save your notification setting. Please try again.");
  }
  return "on";
}

/** Turns notifications off for this browser: removes the saved row, then unsubscribes. */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  if (error) {
    console.error("Removing the push subscription failed", error);
    throw new Error("Couldn't turn notifications off. Please try again.");
  }
  await sub.unsubscribe();
}

/**
 * Call BEFORE signing out: this browser must stop receiving the signed-out person's
 * notifications. Never throws, so logging out can't be blocked by it.
 */
export async function removePushOnLogout(): Promise<void> {
  try {
    await disablePush();
  } catch (e) {
    console.error("Couldn't remove the push subscription on logout", e);
  }
}

/** Short, friendly text for each state (shared by the prompt and the settings card). */
export function pushStateText(state: PushState): string {
  switch (state) {
    case "on":
      return "Notifications are on for this device.";
    case "off":
      return "Get notified about messages, likes, comments and follows, even when the app is closed.";
    case "denied":
      return "Notifications are blocked. Allow them for this site in your browser settings, then come back.";
    case "needs-install":
      return "On iPhone, first tap Share → Add to Home Screen, then open Gicco from your Home Screen to turn notifications on.";
    case "not-configured":
      return "Notifications aren't set up yet.";
    default:
      return "This browser doesn't support notifications.";
  }
}
