import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * These tests drive the REAL upload functions with a fake Supabase client and look at exactly what
 * would be sent to storage: which bucket and path, which Content-Type, and the bytes themselves.
 */
const h = vi.hoisted(() => ({
  uploads: [] as { bucket: string; path: string; body: Blob; options: Record<string, unknown> }[],
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: () => ({
      insert: () => ({
        select: () => ({ single: async () => ({ data: { id: "p1" }, error: null }) }),
      }),
    }),
    rpc: h.rpc,
    auth: { getSession: async () => ({ data: { session: { access_token: "tok" } }, error: null }) },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: Blob, options: Record<string, unknown>) => {
          h.uploads.push({ bucket, path, body, options });
          return { error: null };
        },
        remove: async () => ({ error: null }),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${bucket}/${path}` },
        }),
      }),
    },
  },
}));

import { createPost, uploadAvatar } from "@/lib/social";
import { uploadListingPhoto } from "@/lib/market";
import { prepareImage, sendFileMessage, sendImageMessage } from "@/lib/chat-extras";
import { sendVoiceMessage } from "@/lib/voice";
import { uploadVideoFile } from "@/lib/videos";
import { readBytes } from "@/lib/file-sniff";
import { bytes, enc, has, makeGif, makeJpeg, makeMp4 } from "@/test/upload-fixtures";

const f = (b: Uint8Array, name: string, type: string) => new File([b as BlobPart], name, { type });
const lastUpload = () => h.uploads[h.uploads.length - 1]!;

beforeEach(() => {
  h.uploads.length = 0;
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: { id: "m1" }, error: null });
});

describe("post / story / market / avatar images", () => {
  it("post image: GPS is stripped, extension and type come from the content", async () => {
    // declared as PNG with a .png name, but really a JPEG carrying GPS
    await createPost({
      authorId: "u1",
      content: "hi",
      audience: "Public",
      image: f(makeJpeg({ trailing: "PK-hidden" }), "holiday.png", "image/png"),
    });
    const up = lastUpload();
    expect(up.bucket).toBe("media");
    expect(up.path).toMatch(/^u1\/posts\/.+\.jpg$/);
    expect(up.options["contentType"]).toBe("image/jpeg");
    const sent = await readBytes(up.body);
    expect(has(sent, "GPS:")).toBe(false);
    expect(has(sent, "PK-hidden")).toBe(false);
  });

  it("post image: an HTML/SVG file with an image type is refused and nothing is uploaded", async () => {
    await expect(
      createPost({
        authorId: "u1",
        content: "x",
        audience: "Public",
        image: f(Uint8Array.from(enc("<svg onload=alert(1)>")), "a.png", "image/png"),
      }),
    ).rejects.toThrow(/SVG|image/i);
    expect(h.uploads).toHaveLength(0);
  });

  it("animated GIF keeps its frames but loses comments", async () => {
    await createPost({
      authorId: "u1",
      content: "x",
      audience: "Public",
      image: f(makeGif(), "a.gif", "image/gif"),
    });
    const sent = await readBytes(lastUpload().body);
    expect(lastUpload().path).toMatch(/\.gif$/);
    expect(has(sent, "secret")).toBe(false);
    expect(has(sent, "NETSCAPE2.0")).toBe(true);
  });

  it("market photo and avatar go through the same cleaning", async () => {
    await uploadListingPhoto("u1", f(makeJpeg(), "a.jpg", "image/jpeg"));
    expect(has(await readBytes(lastUpload().body), "GPS:")).toBe(false);
    expect(lastUpload().path).toMatch(/^u1\/market\/.+\.jpg$/);

    await uploadAvatar("u1", f(makeJpeg(), "me.jpg", "image/jpeg"));
    expect(lastUpload().bucket).toBe("avatars");
    expect(lastUpload().path).toBe("u1/avatar.jpg");
    expect(has(await readBytes(lastUpload().body), "GPS:")).toBe(false);
  });
});

describe("chat photos and files", () => {
  beforeEach(() => {
    // jsdom never loads images, so give prepareImage a decoder that reports a size
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 1;
        naturalHeight = 1;
        onload: (() => void) | null = null;
        set src(_v: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    URL.createObjectURL = () => "blob:test";
    URL.revokeObjectURL = () => {};
  });

  it("prepareImage never returns the original bytes of a small photo", async () => {
    const out = await prepareImage(f(makeJpeg(), "p.jpg", "image/jpeg"));
    expect(has(await readBytes(out.blob), "GPS:")).toBe(false);
    expect(out.ext).toBe("jpg");
  });

  it("prepareImage refuses SVG (it used to be passed through untouched)", async () => {
    await expect(
      prepareImage(
        f(
          Uint8Array.from(enc("<svg xmlns='http://www.w3.org/2000/svg'/>")),
          "a.svg",
          "image/svg+xml",
        ),
      ),
    ).rejects.toThrow(/SVG/);
  });

  it("sendImageMessage refuses a non-image blob even if prepareImage was bypassed", async () => {
    await expect(
      sendImageMessage({
        conversationId: "c1",
        userId: "u1",
        image: {
          blob: new Blob(["<html>"], { type: "image/png" }),
          width: 1,
          height: 1,
          ext: "png",
        },
      }),
    ).rejects.toThrow();
    expect(h.uploads).toHaveLength(0);
  });

  it("sendFileMessage: stores a real PDF under its true type and a cleaned name", async () => {
    await sendFileMessage({
      conversationId: "c1",
      userId: "u1",
      file: f(Uint8Array.from(enc("%PDF-1.7 body")), "cv\u202Efdp.pdf", ""),
    });
    expect(lastUpload().bucket).toBe("chat-media");
    expect(lastUpload().path).toMatch(/^u1\/.+\.pdf$/);
    expect(lastUpload().options["contentType"]).toBe("application/pdf");
    const call = h.rpc.mock.calls[0]![1] as { p_file_name: string };
    expect(call.p_file_name).toBe("cvfdp.pdf");
  });

  it.each([
    ["setup.exe", "MZ\x90\0"],
    ["page.html", "<html><script>1</script>"],
    ["x.svg", "<svg/>"],
    ["invoice.exe.pdf", "%PDF-1.4"],
    ["renamed.pdf", "MZ\x90\0"],
  ])("sendFileMessage refuses %s", async (name, content) => {
    await expect(
      sendFileMessage({
        conversationId: "c1",
        userId: "u1",
        file: f(Uint8Array.from(enc(content)), name, "application/octet-stream"),
      }),
    ).rejects.toThrow();
    expect(h.uploads).toHaveLength(0);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("voice notes", () => {
  const webm = bytes([0x1a, 0x45, 0xdf, 0xa3, 0x84], enc("B\x82\x84webm"), new Array(30).fill(0));

  it("uploads a real recording with the container's true type", async () => {
    await sendVoiceMessage(
      "c1",
      "u1",
      new Blob([webm as BlobPart], { type: "video/x-whatever" }),
      3,
    );
    expect(lastUpload().bucket).toBe("voice");
    expect(lastUpload().path).toMatch(/\.webm$/);
    expect(lastUpload().options["contentType"]).toBe("audio/webm");
  });

  it("refuses files that are not audio, and oversized recordings", async () => {
    await expect(
      sendVoiceMessage(
        "c1",
        "u1",
        new Blob([Uint8Array.from(enc("MZ......"))], { type: "audio/webm" }),
        3,
      ),
    ).rejects.toThrow();
    const big = { size: 6 * 1024 * 1024, type: "audio/webm" } as unknown as Blob;
    await expect(sendVoiceMessage("c1", "u1", big, 3)).rejects.toThrow(/too long/);
    expect(h.uploads).toHaveLength(0);
  });
});

describe("video upload", () => {
  type Sent = { url: string; headers: Record<string, string>; body: Blob | null };
  const sent: Sent[] = [];
  class FakeXhr {
    status = 200;
    responseText = "";
    upload: { onprogress: unknown } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    private rec: Sent = { url: "", headers: {}, body: null };
    open(_m: string, url: string) {
      this.rec.url = url;
    }
    setRequestHeader(k: string, v: string) {
      this.rec.headers[k] = v;
    }
    abort() {}
    send(body: Blob) {
      this.rec.body = body;
      sent.push(this.rec);
      queueMicrotask(() => this.onload?.());
    }
  }

  beforeEach(() => {
    sent.length = 0;
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    vi.stubEnv("VITE_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon");
  });

  it("stores by content: extension and Content-Type ignore the file name, GPS is removed", async () => {
    const res = await uploadVideoFile(
      f(makeMp4(), "evil.html", "video/mp4"),
      "u1",
      new AbortController().signal,
      () => {},
    );
    expect(res.path).toMatch(/^u1\/.+\.mp4$/);
    expect(sent[0]!.url).toMatch(/\/object\/videos\/u1\/.+\.mp4$/);
    expect(sent[0]!.headers["Content-Type"]).toBe("video/mp4");
    const body = await readBytes(sent[0]!.body!);
    expect(has(body, "+12.9716")).toBe(false);
    expect(has(body, "MEDIA-DATA-MEDIA-DATA")).toBe(true);
  });

  it("refuses a web page named .mp4 before any network request", async () => {
    await expect(
      uploadVideoFile(
        f(Uint8Array.from(enc("<html><script>x</script></html>")), "clip.mp4", "video/mp4"),
        "u1",
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow(/real MP4/);
    expect(sent).toHaveLength(0);
  });
});
