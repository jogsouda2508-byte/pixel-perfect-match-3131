import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  BarChart3,
  BellRing,
  CalendarDays,
  Flame,
  MessageCircleQuestion,
} from "lucide-react";
import { AlertsTab } from "@/components/community/alerts";
import { AskTab } from "@/components/community/ask";
import { EventsTab } from "@/components/community/events";
import { PollsTab } from "@/components/community/polls";
import { LocalityBar, useNow } from "@/components/community/shared";
import { SwapsTab } from "@/components/community/swaps";
import { PageHeader, PageShell } from "@/components/page-shell";
import { useAuth } from "@/lib/auth";
import {
  fetchAlerts,
  fetchEvents,
  fetchPollStreak,
  formatEventWhen,
  useCommunityLocality,
} from "@/lib/community";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/community")({
  head: () => ({
    meta: [
      { title: "Community — SabZone" },
      {
        name: "description",
        content: "Local events, alerts, skill swaps, polls and questions from your neighbourhood.",
      },
    ],
  }),
  component: CommunityPage,
});

type TabKey = "events" | "alerts" | "swap" | "polls" | "ask";
const TABS: { key: TabKey; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { key: "events", label: "Events", icon: CalendarDays },
  { key: "alerts", label: "Alerts", icon: BellRing },
  { key: "swap", label: "Skill swap", icon: ArrowLeftRight },
  { key: "polls", label: "Polls", icon: BarChart3 },
  { key: "ask", label: "Ask", icon: MessageCircleQuestion },
];
const TAB_KEY = "ediraa.community-tab";

function CommunityPage() {
  const { user } = useAuth();
  const meId = user?.id ?? "";
  const { locality, setLocality, profileLocation } = useCommunityLocality();
  const [tab, setTab] = useState<TabKey>("events");

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(TAB_KEY) as TabKey | null;
      if (saved && TABS.some((t) => t.key === saved)) setTab(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const go = (t: TabKey) => {
    setTab(t);
    try {
      window.sessionStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  };

  return (
    <PageShell>
      {/* Phones: a small 8px gap at the left and right (the page itself has 16px, so pull in by 8px). */}
      <div className="-mx-2 space-y-1.5 sm:mx-0 sm:space-y-4">
        <PageHeader title="Community" back="/home" smartBack compact />
        {/* Wrapped so the phone rule that stretches direct-child cards edge to edge does not apply: it pushed this card off-centre. */}
        <div>
          <LocalityBar
            locality={locality}
            profileLocation={profileLocation}
            onChange={setLocality}
          />
        </div>
        <TodayStrip locality={locality} onGo={go} />

        <nav
          aria-label="Community sections"
          className="sticky top-1 z-20 rounded-2xl border border-border bg-card/95 px-1.5 shadow-sm backdrop-blur"
        >
          <div
            role="tablist"
            className="flex gap-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                type="button"
                aria-selected={tab === t.key}
                onClick={() => go(t.key)}
                className={cn(
                  "inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold transition active:scale-95 sm:min-h-10 sm:gap-1.5 sm:px-3.5 sm:text-sm",
                  tab === t.key
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-card",
                )}
              >
                <t.icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> {t.label}
              </button>
            ))}
          </div>
        </nav>

        {meId && (
          <div
            role="tabpanel"
            key={tab}
            className="animate-in fade-in slide-in-from-bottom-1 duration-200"
          >
            {tab === "events" && <EventsTab locality={locality} meId={meId} />}
            {tab === "alerts" && <AlertsTab locality={locality} meId={meId} />}
            {tab === "swap" && <SwapsTab locality={locality} meId={meId} />}
            {tab === "polls" && <PollsTab locality={locality} />}
            {tab === "ask" && <AskTab locality={locality} meId={meId} />}
          </div>
        )}
      </div>
    </PageShell>
  );
}

/** A quick "what's happening" glance. Each tile opens its tab and shares the tab's cached data. */
function TodayStrip({ locality, onGo }: { locality: string | null; onGo: (t: TabKey) => void }) {
  const now = useNow(60_000);
  const events = useQuery({
    queryKey: ["community", "events", locality, "upcoming", ""],
    queryFn: () => fetchEvents({ locality, scope: "upcoming", category: "" }),
    staleTime: 20_000,
  });
  const alerts = useQuery({
    queryKey: ["community", "alerts", locality],
    queryFn: () => fetchAlerts(locality),
    staleTime: 15_000,
  });
  const streak = useQuery({
    queryKey: ["community", "streak"],
    queryFn: fetchPollStreak,
    staleTime: 30_000,
  });

  const next = events.data?.[0];
  const live = alerts.data?.filter((a) => a.status !== "resolved").length ?? 0;
  const days = streak.data ?? 0;

  return (
    <section aria-label="Today" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Tile
        wide
        onClick={() => onGo("events")}
        icon={<CalendarDays className="h-3.5 w-3.5" />}
        label="Next event"
        loading={events.isLoading}
        value={next ? next.title : "Nothing yet"}
        sub={next ? formatEventWhen(next.starts_at, now) : "Host one"}
      />
      <Tile
        onClick={() => onGo("alerts")}
        icon={<BellRing className="h-3.5 w-3.5" />}
        label="Alerts"
        loading={alerts.isLoading}
        value={live === 0 ? "All clear" : `${live} active`}
        sub={live === 0 ? "Nothing reported" : "Tap to see"}
        accent={live > 0}
      />
      <Tile
        onClick={() => onGo("polls")}
        icon={<Flame className="h-3.5 w-3.5" />}
        label="Streak"
        loading={streak.isLoading}
        value={days > 0 ? `${days} day${days === 1 ? "" : "s"}` : "Start today"}
        sub="Answer a poll"
        accent={days > 0}
      />
    </section>
  );
}

function Tile({
  icon,
  label,
  value,
  sub,
  onClick,
  loading,
  accent,
  wide,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  onClick: () => void;
  loading?: boolean;
  accent?: boolean;
  /** Full width on phones so the event title has room. */
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "glass-card min-w-0 p-2.5 text-left transition active:scale-95 sm:p-3",
        wide && "col-span-2 sm:col-span-1",
      )}
    >
      <span
        className={cn(
          "mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide sm:mb-1.5 sm:text-[11px]",
          accent ? "text-primary" : "text-muted-foreground",
        )}
      >
        {icon} {label}
      </span>
      {loading ? (
        <span className="block h-4 w-3/4 animate-pulse rounded bg-muted" />
      ) : (
        <>
          <span className="block truncate text-[13px] font-bold sm:text-sm">{value}</span>
          <span className="block truncate text-[11px] text-muted-foreground sm:text-xs">{sub}</span>
        </>
      )}
    </button>
  );
}
