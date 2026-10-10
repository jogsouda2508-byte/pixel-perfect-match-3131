import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { BottomNav, SideNav } from "@/components/ediraa";

/** The standard signed-in page layout: side nav, content column, bottom nav on mobile. */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-28 pt-5 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,640px)] lg:justify-center">
      <SideNav />
      <main className="min-w-0 space-y-4">{children}</main>
      <BottomNav />
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
        className="grid h-9 w-9 place-items-center rounded-full hover:bg-card"
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>
      <h1 className="text-2xl font-bold">{title}</h1>
    </header>
  );
}
