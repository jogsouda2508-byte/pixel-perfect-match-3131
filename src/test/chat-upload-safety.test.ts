import { beforeEach, describe, expect, it, vi } from "vitest";

const { upload, remove, getPublicUrl, rpc } = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  getPublicUrl: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ upload, remove, getPublicUrl }) }, rpc },
}));

import { prepareImage, sendFileMessage } from "@/lib/chat-extras";
import { UNSUPPORTED_FILE_MESSAGE } from "@/lib/chat-media";

const UID = "00000000-0000-4000-8000-00000000000a";
const file = (name: string, type = "", body = "x") => new File([body], name, { type });

beforeEach(() => {
  upload.mockReset().mockResolvedValue({ error: null });
  remove.mockReset().mockResolvedValue({ error: null });
  getPublicUrl.mockReset().mockImplementation((p: string) => ({
    data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/chat-media/${p}` },
  }));
  rpc.mockReset().mockResolvedValue({ data: { id: "m1" }, error: null });
});

describe("sending a file", () => {
  it.each([
    ["page.html", "text/html"],
    ["logo.svg", "image/svg+xml"],
    ["app.apk", "application/vnd.android.package-archive"],
    ["setup.exe", ""],
    ["run.js", "text/javascript"],
    ["sneaky.png", "image/svg+xml"],
  ])("refuses %s without uploading anything", async (name, type) => {
    await expect(
      sendFileMessage({ conversationId: "c1", userId: UID, file: file(name, type) }),
    ).rejects.toThrow(UNSUPPORTED_FILE_MESSAGE);
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uploads a PDF into the sender's own folder with a safe name and the right type", async () => {
    await sendFileMessage({ conversationId: "c1", userId: UID, file: file("Plan v2.PDF", "") });
    expect(upload).toHaveBeenCalledTimes(1);
    const [path, , options] = upload.mock.calls[0]!;
    expect(path).toMatch(new RegExp(`^${UID}/[0-9a-f-]{36}\\.pdf$`));
    expect(options).toMatchObject({ contentType: "application/pdf", upsert: false });
    expect(rpc).toHaveBeenCalledWith(
      "send_chat_message",
      expect.objectContaining({
        p_conversation: "c1",
        p_file_name: "Plan v2.PDF",
        p_file_url: expect.stringContaining(`/chat-media/${UID}/`),
      }),
    );
  });

  it("does not trust the file name's extension for the stored type", async () => {
    await sendFileMessage({
      conversationId: "c1",
      userId: UID,
      file: file("clip.mp4", "application/octet-stream"),
    });
    expect(upload.mock.calls[0]![2]).toMatchObject({ contentType: "video/mp4" });
  });

  it("removes the upload again if the message can't be sent", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not_allowed" } });
    await expect(
      sendFileMessage({ conversationId: "c1", userId: UID, file: file("a.pdf") }),
    ).rejects.toBeTruthy();
    expect(remove).toHaveBeenCalledWith([expect.stringMatching(new RegExp(`^${UID}/`))]);
  });
});

describe("sending a photo", () => {
  it("never sends an SVG (it can carry scripts)", async () => {
    await expect(
      prepareImage(file("logo.svg", "image/svg+xml", "<svg onload=alert(1)/>")),
    ).rejects.toThrow(UNSUPPORTED_FILE_MESSAGE);
  });
});
