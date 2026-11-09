import { Link, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { BottomNav, SideNav } from "@/components/ediraa";

/** The standard signed-in page layout: side nav, content column, bottom nav on mobile. */
export function PageShell({
  children,
  showBottomNav = true,
}: {
  children: ReactNode;
  showBottomNav?: boolean;
}) {
  return (
    <div
      className={`mx-auto max-w-[1480px] app-page px-4 sm:px-6 ${showBottomNav ? "pb-24 sm:pb-28" : "pb-5"} pt-0 sm:pt-5 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,680px)_300px] lg:justify-center 2xl:grid-cols-[240px_minmax(0,800px)_340px]`}
    >
      <SideNav />
      <main className="app-main min-w-0 space-y-1.5 sm:space-y-4">{children}</main>
      {showBottomNav && <BottomNav />}
    </div>
  );
}

export function PageHeader({
  title,
  back = "/more",
  smartBack = false,
  compact = false,
}: {
  title: string;
  back?: "/more" | "/home" | "/profile";
  /** Go back to wherever the person came from (e.g. Home or More); `back` is only the fallback. */
  smartBack?: boolean;
  /** Smaller title on phones. */
  compact?: boolean;
}) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();
  const cls =
    "grid h-10 w-10 place-items-center rounded-full hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <header className="flex items-center gap-3">
      {smartBack ? (
        <button
          type="button"
          aria-label="Back"
          onClick={() => (canGoBack ? router.history.back() : navigate({ to: back }))}
          className={cls}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      ) : (
        <Link to={back} aria-label="Back" className={cls}>
          <ArrowLeft className="h-5 w-5" />
        </Link>
      )}
      <h1 className={compact ? "text-xl font-bold sm:text-2xl" : "text-2xl font-bold"}>{title}</h1>
    </header>
  );
}
