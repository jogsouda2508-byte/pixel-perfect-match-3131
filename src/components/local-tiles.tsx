import { Link } from "@tanstack/react-router";
import {
  BellRing,
  CalendarDays,
  MapPin,
  MessageCircleQuestion,
  ShoppingBag,
  Store,
  type LucideIcon,
} from "lucide-react";

type Tile = {
  label: string;
  icon: LucideIcon;
  /** soft background + icon colour, so each shortcut is easy to tell apart */
  tone: string;
} & ({ to: "/business" } | { to: "/community"; tab: string });

const TILES: Tile[] = [
  {
    label: "Alerts",
    icon: BellRing,
    tone: "bg-rose-500/12 text-rose-600 dark:text-rose-300",
    to: "/community",
    tab: "alerts",
  },
  {
    label: "Events",
    icon: CalendarDays,
    tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    to: "/community",
    tab: "events",
  },
  {
    label: "Market",
    icon: ShoppingBag,
    tone: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    to: "/community",
    tab: "market",
  },
  {
    label: "Shops",
    icon: Store,
    tone: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
    to: "/business",
  },
  {
    label: "Ask",
    icon: MessageCircleQuestion,
    tone: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
    to: "/community",
    tab: "ask",
  },
];

/** "Around Whitefield": one-tap shortcuts to what is happening near the person. */
export function LocalTiles({ area }: { area: string | null }) {
  return (
    <section aria-label="Around you" className="space-y-2">
      <h2 className="flex items-center gap-1.5 px-1 text-sm font-semibold">
        <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
        {area ? `Around ${area}` : "Around you"}
      </h2>
      <div className="scrollbar-hidden -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1">
        {TILES.map((t) => {
          const body = (
            <>
              <span className={`grid h-11 w-11 place-items-center rounded-2xl ${t.tone}`}>
                <t.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="text-xs font-medium">{t.label}</span>
            </>
          );
          const cls =
            "flex w-[4.5rem] shrink-0 flex-col items-center gap-1.5 rounded-2xl py-1.5 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
          return t.to === "/business" ? (
            <Link key={t.label} to="/business" className={cls}>
              {body}
            </Link>
          ) : (
            <Link key={t.label} to="/community" search={{ tab: t.tab }} className={cls}>
              {body}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
