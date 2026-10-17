import { Link } from "@tanstack/react-router";
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
      className={`mx-auto max-w-[1480px] px-4 sm:px-6 ${showBottomNav ? "pb-28" : "pb-5"} pt-5 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,680px)_300px] lg:justify-center 2xl:grid-cols-[240px_minmax(0,800px)_340px]`}
    >
      <SideNav />
      <main className="min-w-0 space-y-4">{children}</main>
      {showBottomNav && <BottomNav />}
    </div>
  );
}

export function PageHeader({
  title,
  back = "/more",
}: {
  title: string;
  back?: "/more" | "/home" | "/profile";
}) {
  return (
    <header className="flex items-center gap-3">
      <Link
        to={back}
        aria-label="Back"
        className="grid h-11 w-11 place-items-center rounded-full hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>
      <h1 className="text-2xl font-bold">{title}</h1>
    </header>
  );
}
