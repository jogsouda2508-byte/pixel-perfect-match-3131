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
    tone: "bg-ember/15 text-ember",
    to: "/community",
    tab: "alerts",
  },
  {
    label: "Events",
    icon: CalendarDays,
    tone: "bg-primary/15 text-primary",
    to: "/community",
    tab: "events",
  },
  {
    label: "Market",
    icon: ShoppingBag,
    tone: "bg-success/15 text-success",
    to: "/community",
    tab: "market",
  },
  {
    label: "Shops",
    icon: Store,
    tone: "bg-chart-5/15 text-chart-5",
    to: "/business",
  },
  {
    label: "Ask",
    icon: MessageCircleQuestion,
    tone: "bg-violet/15 text-violet",
    to: "/community",
    tab: "ask",
  },
];

/** "Around Whitefield": one-tap shortcuts to what is happening near the person. */
export function LocalTiles({
  area,
  grid = false,
}: {
  area: string | null;
  /** Wrap the shortcuts in a grid (More page) instead of one sideways-scrolling row. */
  grid?: boolean;
}) {
  return (
    <section aria-label="Around you" className="space-y-2">
      <h2 className="flex items-center gap-1.5 px-1 font-display text-sm font-bold">
        <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
        {area ? `Around ${area}` : "Around you"}
      </h2>
      <div
        className={
          grid
            ? "grid grid-cols-5 gap-2"
            : "scrollbar-hidden -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1"
        }
      >
        {TILES.map((t) => {
          const body = (
            <>
              <span
                className={`grid place-items-center ring-1 ring-inset ring-white/5 ${grid ? "h-8 w-8 rounded-xl" : "h-11 w-11 rounded-2xl"} ${t.tone}`}
              >
                <t.icon className={grid ? "h-4 w-4" : "h-5 w-5"} aria-hidden="true" />
              </span>
              <span className={grid ? "text-[10px] font-semibold" : "text-[11px] font-semibold"}>
                {t.label}
              </span>
            </>
          );
          const cls =
            (grid ? "w-full gap-1 py-2" : "w-[4.75rem] shrink-0 gap-1.5 py-2.5") +
            " flex flex-col items-center rounded-2xl border border-border bg-card/60 px-1 transition hover:border-primary/40 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
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
