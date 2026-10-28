import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    listeners: {} as Record<string, (e: unknown) => void>,
    perm: { receive: "prompt" } as { receive: string },
    rpc: vi.fn(async (..._a: unknown[]) => ({ error: null as unknown })),
    remove: vi.fn(async (..._a: unknown[]) => ({ error: null as unknown })),
    native: true,
    available: true,
    registerFails: false,
    channel: vi.fn(async (..._a: unknown[]) => {}),
    unregister: vi.fn(async () => {}),
  };
  const plugin = {
    addListener: async (name: string, fn: (e: unknown) => void) => {
      state.listeners[name] = fn;
      return { remove: async () => {} };
    },
    checkPermissions: async () => state.perm,
    requestPermissions: async () => {
      state.perm = { receive: "granted" };
      return state.perm;
    },
    register: async () => {
      if (state.registerFails) state.listeners["registrationError"]?.({ error: "x" });
      else
        queueMicrotask(() =>
          state.listeners["registration"]?.({ value: "FCM_TOKEN_".padEnd(40, "x") }),
        );
    },
    createChannel: (c: unknown) => state.channel(c),
    unregister: () => state.unregister(),
  };
  return { state, plugin };
});

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => h.plugin,
  Capacitor: {
    isNativePlatform: () => h.state.native,
    isPluginAvailable: () => h.state.available,
    getPlatform: () => "android",
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => h.state.rpc(...a),
    from: () => ({ delete: () => ({ eq: (...a: unknown[]) => h.state.remove(...a) }) }),
  },
}));

async function load() {
  vi.resetModules();
  h.state.listeners = {};
  return import("@/lib/native-push");
}

const TOKEN = "FCM_TOKEN_".padEnd(40, "x");

describe("native push (Android app)", () => {
  beforeEach(() => {
    localStorage.clear();
    h.state.perm = { receive: "prompt" };
    h.state.native = true;
    h.state.available = true;
    h.state.registerFails = false;
    h.state.rpc.mockClear();
    h.state.remove.mockClear();
    h.state.channel.mockClear();
    h.state.unregister.mockClear();
  });

  it("only allows in-app links from a notification", async () => {
    const { safeAppPath } = await load();
    expect(safeAppPath("/chat/1")).toBe("/chat/1");
    expect(safeAppPath("//evil.com")).toBeNull();
    expect(safeAppPath("https://evil.com")).toBeNull();
    expect(safeAppPath("/a\\b")).toBeNull();
    expect(safeAppPath("/a\u0007b")).toBeNull();
    expect(safeAppPath(undefined)).toBeNull();
  });

  it("asks permission, creates the channel, registers and saves the token", async () => {
    const { enableNativePush, getNativePushState } = await load();
    expect(await getNativePushState()).toBe("off");
    expect(await enableNativePush()).toBe("on");
    expect(h.state.channel).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gicco_default", importance: 5 }),
    );
    expect(h.state.rpc).toHaveBeenCalledWith("save_device_token", {
      p_token: TOKEN,
      p_platform: "android",
    });
    expect(await getNativePushState()).toBe("on");
  });

  it("reports blocked notifications without registering", async () => {
    h.state.perm = { receive: "denied" };
    const { enableNativePush, getNativePushState } = await load();
    expect(await getNativePushState()).toBe("denied");
    expect(await enableNativePush()).toBe("denied");
    expect(h.state.rpc).not.toHaveBeenCalled();
  });

  it("shows a clear error when Firebase registration fails", async () => {
    h.state.registerFails = true;
    const { enableNativePush } = await load();
    await expect(enableNativePush()).rejects.toThrow(/Couldn't register this phone/);
  });

  it("tells the person to update the app when the APK has no push plugin", async () => {
    h.state.available = false;
    const { getNativePushState, enableNativePush } = await load();
    expect(await getNativePushState()).toBe("needs-app-update");
    expect(await enableNativePush()).toBe("needs-app-update");
  });

  it("opens the in-app link when a notification is tapped", async () => {
    const { initNativePush, setNativePushHandlers } = await load();
    const onOpen = vi.fn();
    setNativePushHandlers({ onOpen });
    await initNativePush();
    h.state.listeners["pushNotificationActionPerformed"]?.({
      notification: { data: { url: "/chat/abc" } },
    });
    h.state.listeners["pushNotificationActionPerformed"]?.({
      notification: { data: { url: "https://evil.com" } },
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("/chat/abc");
  });

  it("refreshes the token on start only if notifications were turned on", async () => {
    const { enableNativePush, syncNativePush } = await load();
    await syncNativePush();
    expect(h.state.rpc).not.toHaveBeenCalled();
    await enableNativePush();
    h.state.rpc.mockClear();
    await syncNativePush();
    expect(h.state.rpc).toHaveBeenCalledTimes(1);
  });

  it("turning off removes the saved token and unregisters", async () => {
    const { enableNativePush, disableNativePush, getNativePushState } = await load();
    await enableNativePush();
    await disableNativePush();
    expect(h.state.remove).toHaveBeenCalledWith("token", TOKEN);
    expect(h.state.unregister).toHaveBeenCalled();
    expect(await getNativePushState()).toBe("off");
  });
});
