import { Link } from "@tanstack/react-router";
import { BellRing, CalendarDays, ChevronRight, HeartHandshake } from "lucide-react";
import {
  buildHomeStrip,
  communityBadgeCount,
  communityBadgeText,
  useCommunityHome,
} from "@/lib/community-home";
import { cn } from "@/lib/utils";

/** The small count on the Community icon. Shows nothing when there is nothing new. */
export function CommunityBadge({ className = "" }: { className?: string }) {
  const { home } = useCommunityHome();
  const count = communityBadgeCount(home);
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "grid min-h-5 min-w-5 place-items-center rounded-full bg-brand-accent px-1 text-[10px] font-bold leading-none text-brand-accent-foreground ring-2 ring-background",
        className,
      )}
    >
      {communityBadgeText(count)}
      <span className="sr-only"> new in Community</span>
    </span>
  );
}

/** One-line Community card for the Home feed: "2 events this weekend near you". */
export function CommunityHomeStrip() {
  const { home, near } = useCommunityHome();
  if (!home) return null;
  const strip = buildHomeStrip(home, near);
  const Icon =
    strip.kind === "alert" ? BellRing : strip.kind === "event" ? CalendarDays : HeartHandshake;
  return (
    <Link
      to="/community"
      search={{ tab: strip.tab }}
      aria-label={`Community: ${strip.title}. ${strip.sub}`}
      className="glass-card flex items-center gap-3 p-3 transition active:scale-[0.98]"
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-full",
          strip.kind === "alert"
            ? "bg-brand-accent/15 text-brand-accent"
            : "bg-primary/10 text-primary",
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{strip.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{strip.sub}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}
