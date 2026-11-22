import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSignedUrl } = vi.hoisted(() => ({ createSignedUrl: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ createSignedUrl }) } },
}));

import { FileBody, ImageBody, ImageLightbox, ReplyQuote } from "@/components/chat-parts";
import { VoiceBubble } from "@/components/voice-recorder";
import { clearSignedUrlCache } from "@/lib/chat-media";
import type { MessageRow } from "@/integrations/supabase/types";

const UID = "00000000-0000-4000-8000-00000000000a";
const HOST = "https://proj.supabase.co/storage/v1/object/public";
const photo = `${HOST}/chat-media/${UID}/11111111-1111-4111-8111-111111111111.jpg`;
const doc = `${HOST}/chat-media/${UID}/22222222-2222-4222-8222-222222222222.pdf`;
const voice = `${HOST}/voice/${UID}/33333333-3333-4333-8333-333333333333.webm`;

let n = 0;
beforeEach(() => {
  clearSignedUrlCache();
  n = 0;
  createSignedUrl.mockReset();
  createSignedUrl.mockImplementation(
    async (path: string, _ttl: number, opts?: { download?: string }) => ({
      data: {
        signedUrl: `https://signed.test/${path}?token=t${++n}${opts?.download ? `&dl=${opts.download}` : ""}`,
      },
      error: null,
    }),
  );
});

describe("photos in a chat bubble", () => {
  it("are loaded from a signed link, never from the stored address", async () => {
    render(<ImageBody url={photo} width={100} height={100} />);
    const img = await screen.findByAltText("Photo");
    expect(img.getAttribute("src")).toMatch(/^https:\/\/signed\.test\//);
    expect(img.getAttribute("src")).not.toContain("/object/public/");
  });

  it("show a placeholder while the link is being fetched", async () => {
    let release: (v: unknown) => void = () => undefined;
    createSignedUrl.mockImplementationOnce(() => new Promise((r) => (release = r)));
    render(<ImageBody url={photo} width={100} height={100} />);
    expect(screen.queryByAltText("Photo")).toBeNull();
    release({ data: { signedUrl: "https://signed.test/x" }, error: null });
    expect(await screen.findByAltText("Photo")).toBeInTheDocument();
  });

  it("show a local preview straight away while a photo uploads (nothing is signed)", () => {
    render(<ImageBody url="blob:http://localhost/preview" uploading />);
    expect(screen.getByAltText("Photo").getAttribute("src")).toBe("blob:http://localhost/preview");
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("say so when the person is not allowed to open the photo", async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: "denied" } });
    render(<ImageBody url={photo} />);
    expect(await screen.findByText("Photo unavailable")).toBeInTheDocument();
    expect(screen.queryByAltText("Photo")).toBeNull();
  });

  it("refuse an address that is not one of our files, and never ask the server about it", () => {
    render(<ImageBody url="https://evil.example/tracker.gif" />);
    expect(screen.getByText("Photo unavailable")).toBeInTheDocument();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("get ONE fresh link if the browser rejects the first, then give up", async () => {
    render(<ImageBody url={photo} />);
    const first = await screen.findByAltText("Photo");
    expect(first.getAttribute("src")).toContain("token=t1");
    fireEvent.error(first);
    await waitFor(() =>
      expect(screen.getByAltText("Photo").getAttribute("src")).toContain("token=t2"),
    );
    fireEvent.error(screen.getByAltText("Photo"));
    expect(await screen.findByText("Photo unavailable")).toBeInTheDocument();
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it("open full screen from a signed link too", async () => {
    render(<ImageLightbox url={photo} onClose={() => undefined} />);
    const img = await screen.findByAltText("Photo");
    expect(img.getAttribute("src")).toMatch(/^https:\/\/signed\.test\//);
  });
});

describe("quoted photos in a reply", () => {
  it("use a signed link as well", async () => {
    const quoted = { id: "m1", body: "📷 Photo", image_url: photo } as unknown as MessageRow;
    const { container } = render(
      <ReplyQuote quoted={quoted} name="Anna" color="#000" onJump={() => undefined} />,
    );
    await waitFor(() =>
      expect(container.querySelector("img")?.getAttribute("src")).toMatch(/signed\.test/),
    );
  });
});

describe("documents", () => {
  it("link to a signed save-as address under the file's own name", async () => {
    render(<FileBody url={doc} name="plan.pdf" size={1000} />);
    const link = await screen.findByRole("link", { name: "Open plan.pdf" });
    await waitFor(() => expect(link.getAttribute("href")).toMatch(/^https:\/\/signed\.test\//));
    expect(link.getAttribute("href")).toContain("dl=plan.pdf");
    expect(createSignedUrl).toHaveBeenCalledWith(
      `${UID}/22222222-2222-4222-8222-222222222222.pdf`,
      3600,
      {
        download: "plan.pdf",
      },
    );
  });

  it("cannot be opened until the link is ready", async () => {
    let release: (v: unknown) => void = () => undefined;
    createSignedUrl.mockImplementationOnce(() => new Promise((r) => (release = r)));
    render(<FileBody url={doc} name="plan.pdf" size={1} />);
    const link = screen.getByLabelText("Open plan.pdf");
    expect(link.getAttribute("href")).toBeNull();
    expect(link.getAttribute("aria-disabled")).toBe("true");
    release({ data: { signedUrl: "https://signed.test/ok" }, error: null });
    await waitFor(() =>
      expect(screen.getByLabelText("Open plan.pdf").getAttribute("href")).toBe(
        "https://signed.test/ok",
      ),
    );
  });

  it("say so when the file can't be opened", async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: "denied" } });
    render(<FileBody url={doc} name="plan.pdf" size={1} />);
    expect(await screen.findByText("File unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("use the local file while it uploads", () => {
    render(<FileBody url="blob:http://localhost/doc" name="plan.pdf" size={1} />);
    expect(screen.getByLabelText("Open plan.pdf").getAttribute("href")).toBe(
      "blob:http://localhost/doc",
    );
  });
});

describe("voice messages", () => {
  it("play from a signed link", async () => {
    const { container } = render(<VoiceBubble url={voice} seconds={4} own={false} />);
    await waitFor(() =>
      expect(container.querySelector("audio")?.getAttribute("src")).toMatch(
        /^https:\/\/signed\.test\/.*33333333/,
      ),
    );
  });

  it("say they can't be played when the file can't be opened", async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: "denied" } });
    render(<VoiceBubble url={voice} seconds={4} own={false} />);
    expect(await screen.findByText("Couldn't play")).toBeInTheDocument();
  });

  it("ask for a new link once if playback fails (the old one may have run out)", async () => {
    const { container } = render(<VoiceBubble url={voice} seconds={4} own={false} />);
    await waitFor(() =>
      expect(container.querySelector("audio")?.getAttribute("src")).toContain("token=t1"),
    );
    fireEvent.error(container.querySelector("audio")!);
    await waitFor(() =>
      expect(container.querySelector("audio")?.getAttribute("src")).toContain("token=t2"),
    );
    fireEvent.error(container.querySelector("audio")!);
    expect(await screen.findByText("Couldn't play")).toBeInTheDocument();
  });
});
