import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() } }));
vi.mock("@tanstack/react-router", async () => {
  const React = await import("react");
  return {
    Link: ({ children, ...rest }: { children?: React.ReactNode }) =>
      React.createElement("a", rest, children),
    useNavigate: () => vi.fn(),
    useRouter: () => ({ history: { back: vi.fn() } }),
  };
});

import { cardSvg, ProfileQrSheet } from "@/components/profile-qr";
import { FileBody } from "@/components/chat-parts";
import { Avatar } from "@/components/ediraa";
import { resolveRedirect } from "@/components/auth-gate";

const MODULES = [
  [true, false, true],
  [false, true, false],
  [true, false, true],
];

describe("profile QR card (rendered with dangerouslySetInnerHTML)", () => {
  const parse = (svg: string) => new DOMParser().parseFromString(svg, "image/svg+xml");

  it("escapes a hostile label, so it can never open a tag", () => {
    const label = `@x"><script>alert(1)</script><img src=x onerror=alert(2)>`;
    const svg = cardSvg(MODULES, "#000000", label);
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("<img");
    const doc = parse(svg);
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.querySelectorAll("script, img, foreignObject")).toHaveLength(0);
    // the label is still shown, as text
    expect(doc.querySelector("text")?.textContent).toBe(label);
  });

  it("never lets a colour break out of its attribute", () => {
    const svg = cardSvg(MODULES, `red" onload="alert(1)`, "@ok");
    expect(svg).not.toContain("onload");
    expect(parse(svg).querySelector("parsererror")).toBeNull();
    expect(svg).toContain('fill="#000000"');
  });

  it("renders the sheet without any script or event-handler attribute, even for a hostile username", () => {
    const { baseElement } = render(
      <ProfileQrSheet
        username={`a"><img src=x onerror=alert(1)>`}
        url="https://sabzone.example/u/asha"
        onClose={() => {}}
      />,
    );
    expect(baseElement.querySelector("script")).toBeNull();
    expect(baseElement.querySelectorAll("[onerror], [onload], [onclick]")).toHaveLength(0);
    expect(baseElement.querySelector("svg")).not.toBeNull();
  });
});

describe("FileBody (a link built from a database value)", () => {
  const link = () => screen.queryByRole("link");

  it("opens https files in a new tab without giving the page to the new tab", () => {
    render(
      <FileBody
        url="https://x.supabase.co/storage/v1/object/public/media/a.pdf"
        name="a.pdf"
        size={1200}
      />,
    );
    expect(link()).toHaveAttribute(
      "href",
      "https://x.supabase.co/storage/v1/object/public/media/a.pdf",
    );
    expect(link()).toHaveAttribute("target", "_blank");
    expect(link()?.getAttribute("rel")).toContain("noopener");
    expect(link()?.getAttribute("rel")).toContain("noreferrer");
  });
  it("keeps the local preview of a file that is still sending (blob:)", () => {
    render(<FileBody url="blob:http://localhost:3000/abcd" name="a.pdf" size={1200} />);
    expect(link()).toHaveAttribute("href", "blob:http://localhost:3000/abcd");
  });
  it.each([
    "javascript:alert(document.cookie)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "//evil.example/x.pdf",
    "http://evil.example/x.pdf",
    "",
  ])("does not make %j clickable", (url) => {
    const { container } = render(<FileBody url={url} name="evil.pdf" size={1} />);
    expect(link()).toBeNull();
    expect(container.querySelector("[href]")).toBeNull();
    // the file name is still shown, as plain text
    expect(screen.getByText("evil.pdf")).toBeInTheDocument();
  });
  it("shows a hostile file name as text, not as markup", () => {
    const { container } = render(
      <FileBody url="https://x.co/a.pdf" name={`<img src=x onerror=alert(1)>.pdf`} size={1} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>.pdf");
  });
});

describe("Avatar (src comes from a profile anyone can edit)", () => {
  it("shows an https photo", () => {
    const { container } = render(<Avatar src="https://x.co/a.jpg" name="Asha Rao" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "https://x.co/a.jpg");
  });
  it.each([
    "javascript:alert(1)",
    "data:image/svg+xml,<svg onload=alert(1)>",
    "//evil.example/p.gif",
    "http://evil.example/p.gif",
  ])("falls back to the initials for %j", (src) => {
    const { container } = render(<Avatar src={src} name="Asha Rao" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("AR");
  });
});

describe("route guard: screens that need a signed-in, onboarded user", () => {
  const out = { session: false, onboardingDone: false };
  const half = { session: true, onboardingDone: false };
  const full = { session: true, onboardingDone: true };

  it.each(["/post/abc", "/group/abc", "/invite", "/post/abc/", "/chat/123", "/u/asha"])(
    "%s sends a logged-out visitor to /login and an un-onboarded user to /onboarding",
    (path) => {
      expect(resolveRedirect(path, out)).toBe("/login");
      expect(resolveRedirect(path, half)).toBe("/onboarding");
      expect(resolveRedirect(path, full)).toBeNull();
    },
  );
  it.each([
    "/privacy",
    "/terms",
    "/guidelines",
    "/child-safety",
    "/delete-account",
    "/reset-password",
    "/verify",
    "/help-nothing",
  ])("%s stays reachable without an account", (path) => {
    expect(resolveRedirect(path, out)).toBeNull();
  });
  it("does not treat a look-alike path as protected, or let a prefix trick through", () => {
    expect(resolveRedirect("/posts", out)).toBeNull();
    expect(resolveRedirect("/groups", out)).toBe("/login"); // already protected on its own
    expect(resolveRedirect("/post", out)).toBeNull();
  });
});

beforeEach(() => vi.clearAllMocks());
