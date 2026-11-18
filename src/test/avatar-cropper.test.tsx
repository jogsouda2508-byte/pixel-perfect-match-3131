import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { renderCrop } = vi.hoisted(() => ({ renderCrop: vi.fn() }));
vi.mock("@/lib/image-crop", async () => {
  const actual = await vi.importActual<object>("@/lib/image-crop");
  return { ...actual, renderCrop: (...a: unknown[]) => renderCrop(...a) };
});

import { AvatarCropper } from "@/components/avatar-cropper";

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
});

const file = new File([new Uint8Array([1, 2, 3])], "me.png", { type: "image/png" });

function loadPicture(w = 1000, h = 500) {
  const img = screen.getByAltText("Your photo") as HTMLImageElement;
  Object.defineProperty(img, "naturalWidth", { value: w, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: h, configurable: true });
  fireEvent.load(img);
  return img;
}

describe("AvatarCropper", () => {
  beforeEach(() => {
    renderCrop.mockReset();
  });

  it("cannot save until the picture has loaded", () => {
    render(<AvatarCropper file={file} onCancel={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Save photo" })).toBeDisabled();
    loadPicture();
    expect(screen.getByRole("button", { name: "Save photo" })).toBeEnabled();
  });

  it("covers the round window and grows when zoomed", () => {
    render(<AvatarCropper file={file} onCancel={vi.fn()} onDone={vi.fn()} />);
    const img = loadPicture(1000, 500);
    const before = parseFloat(img.style.width);
    expect(parseFloat(img.style.height)).toBeGreaterThanOrEqual(280); // fills the 280px window
    fireEvent.change(screen.getByRole("slider", { name: "Zoom" }), { target: { value: "2" } });
    expect(parseFloat(img.style.width)).toBeCloseTo(before * 2, 3);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(parseFloat(img.style.width)).toBeLessThan(before * 2);
  });

  it("hands back a square JPEG named avatar.jpg", async () => {
    renderCrop.mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }));
    const onDone = vi.fn();
    render(<AvatarCropper file={file} onCancel={vi.fn()} onDone={onDone} />);
    loadPicture();
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const out = onDone.mock.calls[0]![0] as File;
    expect(out.name).toBe("avatar.jpg");
    expect(out.type).toBe("image/jpeg");
    const region = renderCrop.mock.calls[0]![1];
    expect(region.size).toBeCloseTo(500); // the biggest square of a 1000x500 picture
  });

  it("shows the problem and lets you try again if saving fails", async () => {
    // a canvas that cannot produce a picture
    renderCrop.mockImplementation(() => {
      throw new Error("Couldn't save the cropped photo.");
    });
    const onDone = vi.fn();
    render(<AvatarCropper file={file} onCancel={vi.fn()} onDone={onDone} />);
    loadPicture();
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't save/);
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save photo" })).toBeEnabled();
  });

  it("says so when the photo cannot be opened", () => {
    render(<AvatarCropper file={file} onCancel={vi.fn()} onDone={vi.fn()} />);
    fireEvent.error(screen.getByAltText("Your photo"));
    expect(screen.getByRole("alert")).toHaveTextContent(/Couldn't open this photo/);
    expect(screen.getByRole("button", { name: "Save photo" })).toBeDisabled();
  });

  it("closes with Cancel and with Escape", () => {
    const onCancel = vi.fn();
    render(<AvatarCropper file={file} onCancel={onCancel} onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
