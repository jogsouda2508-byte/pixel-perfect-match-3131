import type { SupabaseClient } from "@supabase/supabase-js";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { isMissingFunctionError } from "@/lib/db-errors";

/**
 * Push notifications inside the Android app (Capacitor).
 *
 * Android's built-in web view has no Web Push, so the app registers with Firebase Cloud
 * Messaging (through the official @capacitor/push-notifications plugin) and saves the phone's
 * token with save_device_token(). The send-push Edge Function then delivers to that token.
 * Nothing here asks for permission by itself: `enableNativePush` must be called from a tap.
 *
 * Like native-share.ts, the plugin is reached with registerPlugin from @capacitor/core, so the
 * web build needs no new package. The plugin only has to be in the APK:
 * `npm i @capacitor/push-notifications`, `npx cap sync android`, rebuild. In a browser, or in an
 * old APK without it, every function reports "not available".
 */

type PermissionState = "prompt" | "prompt-with-rationale" | "granted" | "denied";
type PushNotificationSchema = {
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
};
type ActionPerformed = { actionId?: string; notification: PushNotificationSchema };
type ListenerHandle = { remove: () => Promise<void> };

type PushNotificationsPlugin = {
  checkPermissions(): Promise<{ receive: PermissionState }>;
  requestPermissions(): Promise<{ receive: PermissionState }>;
  register(): Promise<void>;
  unregister(): Promise<void>;
  createChannel(channel: {
    id: string;
    name: string;
    description?: string;
    importance?: 1 | 2 | 3 | 4 | 5;
    visibility?: -1 | 0 | 1;
    vibration?: boolean;
    lights?: boolean;
  }): Promise<void>;
  addListener(event: "registration", fn: (t: { value: string }) => void): Promise<ListenerHandle>;
  addListener(event: "registrationError", fn: (e: { error: string }) => void): Promise<ListenerHandle>;
  addListener(
    event: "pushNotificationReceived",
    fn: (n: PushNotificationSchema) => void,
  ): Promise<ListenerHandle>;
  addListener(
    event: "pushNotificationActionPerformed",
    fn: (a: ActionPerformed) => void,
  ): Promise<ListenerHandle>;
};

const PushNotifications = registerPlugin<PushNotificationsPlugin>("PushNotifications");

/** Must match `default_notification_channel_id` in AndroidManifest.xml and the Edge Function. */
export const ANDROID_CHANNEL_ID = "gicco_default";

const ENABLED_KEY = "gicco.native-push.enabled";
const TOKEN_KEY = "gicco.native-push.token";
const REGISTER_TIMEOUT_MS = 20_000;

// the generated database types don't know the device_tokens table / function yet
const db = supabase as unknown as SupabaseClient;

const MIGRATION_HINT =
  "Android notifications need a one-time database update. In Supabase open SQL Editor, run " +
  "supabase/migrations/20261031000000_device_tokens.sql, then try again.";

/** True inside the Android app (not a normal browser). */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/** True when this APK was built with the push plugin (an old APK won't have it). */
export function nativePushAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("PushNotifications");
}

/** Only in-app paths (e.g. /chat/<id>) may be opened from a notification. */
export function safeAppPath(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const u = url.trim();
  const hasControlChar = [...u].some((c) => c.charCodeAt(0) < 32);
  if (!u.startsWith("/") || u.startsWith("//") || u.includes("\\") || hasControlChar) {
    return null;
  }
  return u.slice(0, 300);
}

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode: it just won't be remembered */
  }
}
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Listeners (set up once)                                             */
/* ------------------------------------------------------------------ */

export type NativePushHandlers = {
  /** the person tapped a notification: open this in-app path */
  onOpen?: (path: string) => void;
  /** a notification arrived while the app is open */
  onForeground?: (n: { title: string; body: string; path: string | null }) => void;
};

let handlers: NativePushHandlers = {};
let listenersReady: Promise<void> | null = null;
const waiters: { resolve: (token: string) => void; reject: (e: Error) => void }[] = [];

export function setNativePushHandlers(next: NativePushHandlers) {
  handlers = next;
}

async function saveToken(token: string): Promise<void> {
  const { error } = await db.rpc("save_device_token", { p_token: token, p_platform: "android" });
  if (error) {
    console.error("Saving the device token failed", error);
    if (isMissingFunctionError(error)) throw new Error(MIGRATION_HINT);
    throw new Error("Couldn't save your notification setting. Please try again.");
  }
}

function toForeground(n: PushNotificationSchema) {
  const data = n.data ?? {};
  return { title: n.title ?? "", body: n.body ?? "", path: safeAppPath(data["url"]) };
}

/** Registers the plugin's listeners. Safe to call many times. */
export function initNativePush(): Promise<void> {
  if (!nativePushAvailable()) return Promise.resolve();
  if (listenersReady) return listenersReady;
  listenersReady = (async () => {
    await PushNotifications.addListener("registration", (t) => {
      // also fires later when Google rotates the token: keep the saved one fresh
      store(TOKEN_KEY, t.value);
      saveToken(t.value).then(
        () => waiters.splice(0).forEach((w) => w.resolve(t.value)),
        (e: unknown) => {
          waiters.splice(0).forEach((w) => w.reject(e instanceof Error ? e : new Error("Failed.")));
        },
      );
    });
    await PushNotifications.addListener("registrationError", (e) => {
      console.error("Push registration failed", e);
      waiters
        .splice(0)
        .forEach((w) =>
          w.reject(
            new Error(
              "Couldn't register this phone for notifications. Check your internet connection and try again.",
            ),
          ),
        );
    });
    await PushNotifications.addListener("pushNotificationReceived", (n) => {
      handlers.onForeground?.(toForeground(n));
    });
    await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const path = safeAppPath(action.notification.data?.["url"]);
      if (path) handlers.onOpen?.(path);
    });
  })().catch((e: unknown) => {
    listenersReady = null;
    console.error("Setting up push listeners failed", e);
  });
  return listenersReady;
}

/* ------------------------------------------------------------------ */
/* State / enable / disable                                            */
/* ------------------------------------------------------------------ */

type Permission = "granted" | "denied" | "prompt";

async function permission(): Promise<Permission> {
  const r = await PushNotifications.checkPermissions();
  if (r.receive === "granted") return "granted";
  if (r.receive === "denied") return "denied";
  return "prompt";
}

/** Android 8+ needs a channel; this one is loud (sound + heads-up) like a chat app's. */
async function ensureChannel(): Promise<void> {
  if (Capacitor.getPlatform() !== "android") return;
  try {
    await PushNotifications.createChannel({
      id: ANDROID_CHANNEL_ID,
      name: "Messages & activity",
      description: "Chat messages, likes, comments and follows",
      importance: 5,
      visibility: 1,
      vibration: true,
      lights: true,
    });
  } catch (e) {
    console.error("Creating the notification channel failed", e);
  }
}

export type NativePushState = "on" | "off" | "denied" | "needs-app-update";

export async function getNativePushState(): Promise<NativePushState> {
  if (!nativePushAvailable()) return "needs-app-update";
  const p = await permission();
  if (p === "denied") return "denied";
  if (p === "granted" && read(ENABLED_KEY) === "1") return "on";
  return "off";
}

function waitForToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      const i = waiters.findIndex((w) => w.resolve === done);
      if (i >= 0) waiters.splice(i, 1);
      reject(
        new Error(
          "Notifications didn't start. Check your internet connection and that the app was built with Firebase set up.",
        ),
      );
    }, REGISTER_TIMEOUT_MS);
    const done = (t: string) => {
      window.clearTimeout(timer);
      resolve(t);
    };
    waiters.push({
      resolve: done,
      reject: (e) => {
        window.clearTimeout(timer);
        reject(e);
      },
    });
    PushNotifications.register().catch((e: unknown) => {
      window.clearTimeout(timer);
      reject(e instanceof Error ? e : new Error("Couldn't start notifications."));
    });
  });
}

export type NativeEnableResult = "on" | "denied" | "dismissed" | "needs-app-update";

/** Asks for permission (call this from a tap!), registers the phone and saves its token. */
export async function enableNativePush(): Promise<NativeEnableResult> {
  if (!nativePushAvailable()) return "needs-app-update";
  await initNativePush();

  let p = await permission();
  if (p === "denied") return "denied";
  if (p !== "granted") {
    const asked = await PushNotifications.requestPermissions();
    if (asked.receive === "denied") return "denied";
    if (asked.receive !== "granted") return "dismissed";
    p = "granted";
  }
  await ensureChannel();
  await waitForToken();
  store(ENABLED_KEY, "1");
  return "on";
}

/**
 * On every app start for a signed-in person who turned notifications on: ask Google for the
 * current token again (tokens change after reinstalls / restores) and save it. Never throws.
 */
export async function syncNativePush(): Promise<void> {
  try {
    if (!nativePushAvailable() || read(ENABLED_KEY) !== "1") return;
    await initNativePush();
    if ((await permission()) !== "granted") return;
    await ensureChannel();
    await waitForToken();
  } catch (e) {
    console.error("Refreshing the notification token failed", e);
  }
}

/** Turns notifications off for this phone: forgets the saved token, then drops it at Google. */
export async function disableNativePush(): Promise<void> {
  const token = read(TOKEN_KEY);
  if (token) {
    const { error } = await db.from("device_tokens").delete().eq("token", token);
    if (error) {
      console.error("Removing the device token failed", error);
      throw new Error("Couldn't turn notifications off. Please try again.");
    }
  }
  store(ENABLED_KEY, null);
  store(TOKEN_KEY, null);
  try {
    if (nativePushAvailable()) await PushNotifications.unregister();
  } catch (e) {
    console.error("Unregistering from push failed", e);
  }
}
