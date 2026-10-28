import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isIosDevice, pushStateText, urlBase64ToUint8Array } from "@/lib/push";

describe("push helpers", () => {
  it("decodes a url-safe VAPID key to bytes", () => {
    // "hello" -> aGVsbG8 (url-safe, unpadded)
    expect([...urlBase64ToUint8Array("aGVsbG8")]).toEqual([104, 101, 108, 108, 111]);
    // url-safe alphabet: "-" and "_" instead of "+" and "/"
    expect([...urlBase64ToUint8Array("-_8")]).toEqual([251, 255]);
  });

  it("recognises iPhone, iPad (incl. iPadOS) and not desktop", () => {
    expect(isIosDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5)).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
    expect(isIosDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120", 0)).toBe(false);
  });

  it("explains every state", () => {
    expect(pushStateText("needs-install")).toMatch(/Add to Home Screen/);
    expect(pushStateText("denied")).toMatch(/blocked/);
    expect(pushStateText("unsupported")).toMatch(/doesn't support/);
    expect(pushStateText("needs-app-update")).toMatch(/latest version of the app/);
    expect(pushStateText("on")).toMatch(/on/);
  });
});

/** Runs public/sw.js against a fake service-worker scope. */
function loadSw() {
  const listeners: Record<string, (e: unknown) => void> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const focused: string[] = [];
  let windows: { url: string; focus: () => Promise<void>; navigate: (u: string) => Promise<void> }[] = [];
  const self = {
    location: { origin: "https://app.test" },
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    skipWaiting: () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => windows,
      openWindow: async (u: string) => void opened.push(u),
    },
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) =>
        void shown.push({ title, options }),
    },
  };
  vm.runInNewContext(readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8"), { self, URL });
  return {
    listeners,
    shown,
    opened,
    focused,
    setWindows: (w: typeof windows) => (windows = w),
  };
}

describe("service worker (public/sw.js)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the payload, with the tag so repeats replace each other", async () => {
    const sw = loadSw();
    let done: Promise<unknown> = Promise.resolve();
    sw.listeners["push"]!({
      data: { json: () => ({ title: "Ana", body: "hello", url: "/chat/7", tag: "chat:7" }) },
      waitUntil: (p: Promise<unknown>) => (done = p),
    });
    await done;
    expect(sw.shown[0]?.title).toBe("Ana");
    expect(sw.shown[0]?.options).toMatchObject({
      body: "hello",
      tag: "chat:7",
      renotify: true,
      data: { url: "/chat/7" },
    });
  });

  it("falls back to a plain notification when the payload isn't JSON", async () => {
    const sw = loadSw();
    let done: Promise<unknown> = Promise.resolve();
    sw.listeners["push"]!({
      data: { json: () => { throw new Error("bad"); }, text: () => "plain text" },
      waitUntil: (p: Promise<unknown>) => (done = p),
    });
    await done;
    expect(sw.shown[0]).toMatchObject({ title: "Gicco chat", options: { body: "plain text" } });
  });

  const click = async (sw: ReturnType<typeof loadSw>, url: string) => {
    let done: Promise<unknown> = Promise.resolve();
    sw.listeners["notificationclick"]!({
      notification: { close: () => {}, data: { url } },
      waitUntil: (p: Promise<unknown>) => (done = p),
    });
    await done;
  };

  it("opens the link when the app isn't open", async () => {
    const sw = loadSw();
    await click(sw, "/chat/7");
    expect(sw.opened).toEqual(["/chat/7"]);
  });

  it("focuses an open tab and moves it to the link", async () => {
    const sw = loadSw();
    const navigated: string[] = [];
    let focusCount = 0;
    sw.setWindows([
      {
        url: "https://app.test/home",
        focus: async () => void focusCount++,
        navigate: async (u) => void navigated.push(u),
      },
    ]);
    await click(sw, "/notifications");
    expect(focusCount).toBe(1);
    expect(navigated).toEqual(["/notifications"]);
    expect(sw.opened).toEqual([]);
  });

  it("never opens another site", async () => {
    const sw = loadSw();
    await click(sw, "https://evil.example/x");
    expect(sw.opened).toEqual(["/"]);
  });
});
