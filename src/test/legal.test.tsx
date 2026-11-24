import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LegalPage } from "@/components/legal-page";
import { APP_NAME, COMPANY_NAME, MIN_AGE, SUPPORT_EMAIL } from "@/lib/legal";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    replace: _replace,
    ...rest
  }: {
    to: string;
    children: React.ReactNode;
    replace?: boolean;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ history: { back: vi.fn() } }),
  useCanGoBack: () => true,
  useNavigate: () => vi.fn(),
}));

describe("legal details", () => {
  it("has a usable support email and names", () => {
    expect(SUPPORT_EMAIL).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    expect(SUPPORT_EMAIL).not.toContain("example.com");
    expect(APP_NAME).toBe("SabZone");
    expect(COMPANY_NAME.length).toBeGreaterThan(3);
    expect(MIN_AGE).toBeGreaterThanOrEqual(13);
  });
});

describe("LegalPage", () => {
  it("numbers sections, shows the date and links the support email and the other policies", () => {
    render(
      <LegalPage
        title="Privacy Policy"
        intro="Intro text"
        sections={[
          { title: "What we collect", body: <p>Email</p> },
          { title: "Your choices", body: <p>Delete</p> },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "1. What we collect" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "2. Your choices" })).toBeTruthy();
    expect(screen.getByText(/Last updated/)).toBeTruthy();
    const mail = screen.getByRole("link", { name: SUPPORT_EMAIL });
    expect(mail.getAttribute("href")).toBe(`mailto:${SUPPORT_EMAIL}`);
    for (const path of ["/terms", "/privacy", "/guidelines", "/delete-account"]) {
      expect(document.querySelector(`a[href="${path}"]`)).not.toBeNull();
    }
  });

  it("can hide the date (used by the guidelines)", () => {
    render(<LegalPage showUpdated={false} title="T" intro="i" sections={[]} />);
    expect(screen.queryByText(/Last updated/)).toBeNull();
  });
});
