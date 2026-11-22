import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ sign: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  isSupabaseConfigured: true,
  supabase: {
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: (p: string, s: number) => h.sign(bucket, p, s),
      }),
    },
  },
}));

import { clearMediaUrlCache, parsePrivateMediaUrl, resolveMediaUrl } from "@/lib/private-media";
import { FileBody, ImageBody } from "@/components/chat-parts";

const BASE = "https://x.supabase.co/storage/v1/object/public";
const chatUrl = `${BASE}/chat-media/u1/abc.jpg`;

beforeEach(() => {
  clearMediaUrlCache();
  h.sign.mockReset();
  h.sign.mockImplementation(async (bucket: string, path: string) => ({
    data: { signedUrl: `https://x.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=t` },
    error: null,
  }));
});

describe("parsePrivateMediaUrl", () => {
  it("recognises chat-media and voice URLs only", () => {
    expect(parsePrivateMediaUrl(chatUrl)).toEqual({ bucket: "chat-media", path: "u1/abc.jpg" });
    expect(parsePrivateMediaUrl(`${BASE}/voice/u1/a%20b.webm?v=2`)).toEqual({
      bucket: "voice",
      path: "u1/a b.webm",
    });
    expect(parsePrivateMediaUrl(`${BASE}/media/u1/posts/a.jpg`)).toBeNull();
    expect(parsePrivateMediaUrl("blob:http://localhost/123")).toBeNull();
    expect(parsePrivateMediaUrl(null)).toBeNull();
  });
});

describe("resolveMediaUrl", () => {
  it("signs private media for an hour, and reuses the link", async () => {
    const a = await resolveMediaUrl(chatUrl);
    const b = await resolveMediaUrl(chatUrl);
    expect(a).toContain("/object/sign/chat-media/u1/abc.jpg?token=");
    expect(b).toBe(a);
    expect(h.sign).toHaveBeenCalledTimes(1);
    expect(h.sign).toHaveBeenCalledWith("chat-media", "u1/abc.jpg", 3600);
  });

  it("never signs ordinary public media", async () => {
    const url = `${BASE}/media/u1/posts/a.jpg`;
    expect(await resolveMediaUrl(url)).toBe(url);
    expect(h.sign).not.toHaveBeenCalled();
  });

  it("falls back to the stored URL if signing fails (offline, or old database)", async () => {
    h.sign.mockResolvedValueOnce({ data: null, error: { message: "nope" } });
    expect(await resolveMediaUrl(chatUrl)).toBe(chatUrl);
    h.sign.mockRejectedValueOnce(new Error("network"));
    clearMediaUrlCache();
    expect(await resolveMediaUrl(chatUrl)).toBe(chatUrl);
  });

  it("shares one request between simultaneous callers", async () => {
    await Promise.all([
      resolveMediaUrl(chatUrl),
      resolveMediaUrl(chatUrl),
      resolveMediaUrl(chatUrl),
    ]);
    expect(h.sign).toHaveBeenCalledTimes(1);
  });
});

describe("chat components use the signed link", () => {
  it("ImageBody shows the signed URL, not the raw one", async () => {
    render(<ImageBody url={chatUrl} width={10} height={10} />);
    const img = await screen.findByAltText("Photo");
    expect(img.getAttribute("src")).toContain("/object/sign/chat-media/");
  });

  it("FileBody links to the signed URL", async () => {
    render(<FileBody url={`${BASE}/chat-media/u1/doc.pdf`} name="doc.pdf" size={10} />);
    await waitFor(() =>
      expect(screen.getByRole("link").getAttribute("href")).toContain(
        "/object/sign/chat-media/u1/doc.pdf",
      ),
    );
  });

  it("ordinary and local (blob:) URLs are shown immediately, untouched", () => {
    render(<ImageBody url="blob:http://localhost/xyz" width={10} height={10} />);
    expect(screen.getByAltText("Photo").getAttribute("src")).toBe("blob:http://localhost/xyz");
    expect(h.sign).not.toHaveBeenCalled();
  });
});
