import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<object>("@tanstack/react-router");
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/social", async () => {
  const actual = await vi.importActual<object>("@/lib/social");
  return { ...actual, fetchPeople: vi.fn().mockResolvedValue([]), createGroup: vi.fn() };
});

import { CreateGroupDialog } from "@/components/create-group-dialog";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const css = read("../styles.css");

describe("smaller text on the New group and New message screens (phones only)", () => {
  it("the New group dialog carries the phone-compact-sheet class", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <CreateGroupDialog open onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("phone-compact-sheet");
    expect(screen.getByText("New group")).toBeInTheDocument();
  });

  it("the New message dialog carries the phone-compact-sheet class", () => {
    const src = read("../routes/chat.index.tsx");
    const start = src.indexOf("function NewMessageDialog");
    expect(start).toBeGreaterThan(-1);
    const dialogContent = src.slice(start).match(/<DialogContent className="([^"]*)"/);
    expect(dialogContent?.[1]).toContain("phone-compact-sheet");
  });

  it("only these two dialogs use the class", () => {
    const usedIn: string[] = [];
    const files = [
      "../components/create-group-dialog.tsx",
      "../components/member-picker.tsx",
      "../components/groups-panel.tsx",
      "../components/responsive-modal.tsx",
      "../components/ui/dialog.tsx",
      "../routes/chat.index.tsx",
      "../routes/group.$id.tsx",
    ];
    for (const f of files) if (read(f).includes("phone-compact-sheet")) usedIn.push(f);
    expect(usedIn.sort()).toEqual([
      "../components/create-group-dialog.tsx",
      "../routes/chat.index.tsx",
    ]);
  });

  it("the smaller sizes exist only inside the phone media query, never for laptops / tablets", () => {
    const rules = [...css.matchAll(/\.phone-compact-sheet[^{]*\{/g)];
    expect(rules.length).toBeGreaterThan(0);
    for (const m of rules) {
      const before = css.slice(0, m.index);
      const lastMedia = before.lastIndexOf("@media");
      expect(lastMedia).toBeGreaterThan(-1);
      // that @media block must still be open at this rule, and be the phone one (below 640px)
      const between = before.slice(lastMedia);
      const opens = (between.match(/\{/g) ?? []).length;
      const closes = (between.match(/\}/g) ?? []).length;
      expect(opens - closes).toBeGreaterThan(0);
      expect(between.startsWith("@media (max-width: 639.98px)")).toBe(true);
    }
  });

  it("makes every size one step smaller than the normal phone sizes", () => {
    const phone = css.match(/:root \{\s*--text-xs: ([\d.]+)rem;\s*\/\*[^*]*\*\/\s*--text-sm: ([\d.]+)rem;\s*\/\*[^*]*\*\/\s*--text-base: ([\d.]+)rem;\s*\/\*[^*]*\*\/\s*--text-lg: ([\d.]+)rem;/);
    const compact = css.match(/\.phone-compact-sheet \{\s*--text-xs: ([\d.]+)rem;[^\n]*\n\s*--text-sm: ([\d.]+)rem;[^\n]*\n\s*--text-base: ([\d.]+)rem;[^\n]*\n\s*--text-lg: ([\d.]+)rem;/);
    expect(phone).not.toBeNull();
    expect(compact).not.toBeNull();
    for (let i = 1; i <= 4; i++) {
      expect(parseFloat(compact![i]!)).toBeLessThan(parseFloat(phone![i]!));
    }
  });
});
