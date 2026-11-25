import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { BottomNav, SideNav } from "@/components/ediraa";

/** The standard signed-in page layout: side nav, content column, bottom nav on mobile. */
export function PageShell({
  children,
  showBottomNav = true,
  aside,
  rowGap = "space-y-1.5 sm:space-y-4",
}: {
  children: ReactNode;
  showBottomNav?: boolean;
  /** Optional right-hand column (shown from large screens up), e.g. suggestions on Home. */
  aside?: ReactNode;
  /** Tailwind `space-y-*` classes for the gap between the rows of the content column. */
  rowGap?: string;
}) {
  return (
    <div
      className={`mx-auto max-w-[1480px] app-page px-4 sm:px-6 ${showBottomNav ? "pb-28 sm:pb-32 md:pb-8" : "pb-5"} pt-0 sm:pt-5 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,680px)_300px] lg:justify-center 2xl:grid-cols-[240px_minmax(0,800px)_340px]`}
    >
      <SideNav />
      <main className={`app-main min-w-0 ${rowGap}`}>{children}</main>
      {aside}
      {showBottomNav && <BottomNav />}
    </div>
  );
}

/**
 * THE one page header. Every page uses this, so the back arrow and the title always sit in
 * exactly the same place, with the same height, gap and size.
 *   - fixed 44px row (arrow button is 44x44, same on every page)
 *   - same arrow icon (ArrowLeft, 20px) inside a bordered round button
 *   - same title size on every page
 */
export const PAGE_HEADER_BTN =
  "grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-card/70 transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const PAGE_HEADER_TITLE = "min-w-0 truncate text-xl font-bold leading-none sm:text-2xl";

export function PageHeader({
  title,
  back = "/more",
  smartBack = false,
  onBack,
  right,
}: {
  title: ReactNode;
  back?: string;
  /** Go back to wherever the person came from (e.g. Home or More); `back` is only the fallback. */
  smartBack?: boolean;
  /** Custom back handler (overrides `back` / `smartBack`). */
  onBack?: () => void;
  /** Optional element on the far right of the header row. */
  right?: ReactNode;
  /** @deprecated kept so old callers still compile; all titles now share one size. */
  compact?: boolean;
}) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();
  const handleBack = () => {
    if (onBack) return onBack();
    if (smartBack && canGoBack) return router.history.back();
    navigate({ to: back as "/more" });
  };
  return (
    <header className="flex h-11 w-full items-center gap-3">
      <button type="button" aria-label="Back" onClick={handleBack} className={PAGE_HEADER_BTN}>
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <h1 className={PAGE_HEADER_TITLE}>{title}</h1>
      {right ? <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div> : null}
    </header>
  );
}
