import { renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createSignedUrl, from } = vi.hoisted(() => {
  const createSignedUrl = vi.fn();
  return { createSignedUrl, from: vi.fn(() => ({ createSignedUrl })) };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from } } }));

import {
  CHAT_FILE_ACCEPT,
  clearSignedUrlCache,
  getSignedChatMediaUrl,
  isLocalMediaUrl,
  parseChatMediaRef,
  REFRESH_MARGIN_MS,
  resolveChatFile,
  SIGNED_URL_TTL_SECONDS,
  useChatMediaUrl,
} from "@/lib/chat-media";

const UID = "00000000-0000-4000-8000-00000000000a";
const FILE = "11111111-1111-4111-8111-111111111111.jpg";
const HOST = "https://proj.supabase.co/storage/v1/object";
const stored = (bucket = "chat-media", file = FILE) => `${HOST}/public/${bucket}/${UID}/${file}`;

let counter = 0;
beforeEach(() => {
  clearSignedUrlCache();
  counter = 0;
  from.mockClear();
  createSignedUrl.mockReset();
  createSignedUrl.mockImplementation(async (path: string) => ({
    data: { signedUrl: `https://signed.test/${path}?token=t${++counter}` },
    error: null,
  }));
});
afterEach(() => vi.useRealTimers());

describe("parseChatMediaRef: only our own chat files are recognised", () => {
  it("reads the bucket and path from the addresses the app has always stored", () => {
    expect(parseChatMediaRef(stored())).toEqual({ bucket: "chat-media", path: `${UID}/${FILE}` });
    expect(parseChatMediaRef(stored("voice", "a.webm"))).toEqual({
      bucket: "voice",
      path: `${UID}/a.webm`,
    });
    expect(parseChatMediaRef(`${HOST}/sign/chat-media/${UID}/${FILE}?token=abc`)?.path).toBe(
      `${UID}/${FILE}`,
    );
    expect(parseChatMediaRef(`${HOST}/authenticated/chat-media/${UID}/${FILE}`)?.bucket).toBe(
      "chat-media",
    );
  });

  it.each([
    ["null", null],
    ["empty", ""],
    ["an address on another site", `https://evil.example/photo.jpg`],
    ["a look-alike that only contains the path", `https://evil.example/?u=${stored()}`],
    ["a different bucket", `${HOST}/public/avatars/${UID}/${FILE}`],
    ["a dot-dot path", `${HOST}/public/chat-media/${UID}/../${UID}/${FILE}`],
    ["a dot-dot file name", `${HOST}/public/chat-media/${UID}/..`],
    ["an upper-case id", `${HOST}/public/chat-media/${UID.toUpperCase()}/${FILE}`],
    ["something that is not an id", `${HOST}/public/chat-media/someone/${FILE}`],
    ["a space in the name", `${HOST}/public/chat-media/${UID}/a b.jpg`],
    ["an extra folder", `${HOST}/public/chat-media/${UID}/x/${FILE}`],
    ["a bare path", `${UID}/${FILE}`],
    ["a javascript address", "javascript:alert(1)"],
    ["an over-long value", stored("chat-media", "a".repeat(1100))],
  ])("refuses %s", (_name, value) => {
    expect(parseChatMediaRef(value as string | null)).toBeNull();
  });

  it("knows a preview that only exists on this device", () => {
    expect(isLocalMediaUrl("blob:http://localhost/abc")).toBe(true);
    expect(isLocalMediaUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isLocalMediaUrl("data:text/html;base64,AAAA")).toBe(false);
    expect(isLocalMediaUrl("https://x/y.jpg")).toBe(false);
    expect(isLocalMediaUrl(null)).toBe(false);
  });
});

describe("getSignedChatMediaUrl", () => {
  const ref = { bucket: "chat-media" as const, path: `${UID}/${FILE}` };

  it("asks for a link that lasts an hour, from the right bucket", async () => {
    const url = await getSignedChatMediaUrl(ref);
    expect(url).toBe(`https://signed.test/${UID}/${FILE}?token=t1`);
    expect(from).toHaveBeenCalledWith("chat-media");
    expect(createSignedUrl).toHaveBeenCalledWith(
      `${UID}/${FILE}`,
      SIGNED_URL_TTL_SECONDS,
      undefined,
    );
    expect(SIGNED_URL_TTL_SECONDS).toBe(3600);
  });

  it("reuses a link instead of asking again, and shares one request between simultaneous callers", async () => {
    const [a, b] = await Promise.all([getSignedChatMediaUrl(ref), getSignedChatMediaUrl(ref)]);
    expect(a).toBe(b);
    await getSignedChatMediaUrl(ref);
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
  });

  it("gets a fresh link when the old one is about to run out", async () => {
    vi.useFakeTimers();
    await getSignedChatMediaUrl(ref);
    vi.advanceTimersByTime(SIGNED_URL_TTL_SECONDS * 1000 - REFRESH_MARGIN_MS - 1000);
    await getSignedChatMediaUrl(ref);
    expect(createSignedUrl).toHaveBeenCalledTimes(1); // still comfortably valid
    vi.advanceTimersByTime(2000);
    await getSignedChatMediaUrl(ref);
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it("can be told to skip the cache", async () => {
    await getSignedChatMediaUrl(ref);
    await getSignedChatMediaUrl(ref, { force: true });
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it("makes a save-as link under the file's own name, kept apart from the inline link", async () => {
    await getSignedChatMediaUrl(ref);
    await getSignedChatMediaUrl(ref, { download: "plan.pdf" });
    expect(createSignedUrl).toHaveBeenLastCalledWith(`${UID}/${FILE}`, 3600, {
      download: "plan.pdf",
    });
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it("fails clearly when the server will not hand out a link, and does not remember the failure", async () => {
    createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: "Object not found" } });
    await expect(getSignedChatMediaUrl(ref)).rejects.toThrow(/isn't available/);
    await expect(getSignedChatMediaUrl(ref)).resolves.toContain("https://signed.test/");
  });

  it("forgets every link on sign-out", async () => {
    await getSignedChatMediaUrl(ref);
    clearSignedUrlCache();
    await getSignedChatMediaUrl(ref);
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });
});

describe("useChatMediaUrl", () => {
  it("uses a local preview as it is, without asking the server", () => {
    const { result } = renderHook(() => useChatMediaUrl("blob:http://localhost/abc"));
    expect(result.current).toMatchObject({ status: "ready", src: "blob:http://localhost/abc" });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("is idle with no value", () => {
    const { result } = renderHook(() => useChatMediaUrl(null));
    expect(result.current.status).toBe("idle");
    expect(result.current.src).toBeUndefined();
  });

  it("refuses an address that is not one of our chat files, without asking the server", () => {
    const { result } = renderHook(() => useChatMediaUrl("https://evil.example/track.gif"));
    expect(result.current.status).toBe("error");
    expect(result.current.src).toBeUndefined();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("signs a stored address", async () => {
    const { result } = renderHook(() => useChatMediaUrl(stored()));
    expect(result.current.status).toBe("loading");
    expect(result.current.src).toBeUndefined();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.src).toBe(`https://signed.test/${UID}/${FILE}?token=t1`);
  });

  it("reports an error when the file cannot be opened", async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: "denied" } });
    const { result } = renderHook(() => useChatMediaUrl(stored()));
    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("refresh() swaps in a new link", async () => {
    const { result } = renderHook(() => useChatMediaUrl(stored()));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    let ok = false;
    await act(async () => {
      ok = await result.current.refresh();
    });
    expect(ok).toBe(true);
    expect(result.current.src).toBe(`https://signed.test/${UID}/${FILE}?token=t2`);
  });
});

describe("resolveChatFile: what may be sent as a file", () => {
  it.each([
    ["plan.pdf", "", "application/pdf"],
    ["PLAN.PDF", "application/pdf", "application/pdf"],
    ["notes.txt", "text/plain", "text/plain"],
    ["sheet.xlsx", "", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    [
      "report.docx",
      "application/octet-stream",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    ["clip.mp4", "video/mp4", "video/mp4"],
    ["clip.mov", "video/quicktime", "video/quicktime"],
    ["bundle.rar", "application/x-rar-compressed", "application/vnd.rar"],
    ["bundle.zip", "application/x-zip-compressed", "application/zip"],
    ["song.mp3", "audio/mpeg", "audio/mpeg"],
  ])("accepts %s (%s)", (name, type, mime) => {
    expect(resolveChatFile({ name, type })).toEqual({
      ext: name.split(".").pop()!.toLowerCase(),
      mime,
    });
  });

  it.each([
    ["page.html", "text/html"],
    ["page.htm", ""],
    ["logo.svg", "image/svg+xml"],
    ["logo.svg", ""],
    ["app.apk", "application/vnd.android.package-archive"],
    ["setup.exe", "application/x-msdownload"],
    ["run.js", "text/javascript"],
    ["run.sh", ""],
    ["macro.xlsm", ""],
    ["archive.tar.gz", ""],
    ["no-extension", ""],
  ])("refuses %s (%s)", (name, type) => {
    expect(resolveChatFile({ name, type })).toBeNull();
  });

  it("refuses a file that is named like a document but says it is something else", () => {
    expect(resolveChatFile({ name: "photo.png", type: "image/svg+xml" })).toBeNull();
    expect(resolveChatFile({ name: "report.pdf", type: "text/html" })).toBeNull();
  });

  it("offers only safe extensions in the file picker", () => {
    const list = CHAT_FILE_ACCEPT.split(",");
    expect(list).toEqual(expect.arrayContaining([".pdf", ".docx", ".mp4", ".zip"]));
    for (const bad of [".svg", ".html", ".htm", ".js", ".exe", ".apk", ".sh"])
      expect(list).not.toContain(bad);
    expect(CHAT_FILE_ACCEPT).not.toMatch(/\*/);
  });
});
