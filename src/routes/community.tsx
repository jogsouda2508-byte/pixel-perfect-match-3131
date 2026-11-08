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
      <PageHeader title="Community" back="/home" smartBack />
      <LocalityBar locality={locality} profileLocation={profileLocation} onChange={setLocality} />
      <TodayStrip locality={locality} onGo={go} />

      <nav
        aria-label="Community sections"
        className="sticky top-0 z-20 -mx-4 border-b border-border bg-background/90 px-4 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border"
      >
        <div
          role="tablist"
          className="flex gap-1 overflow-x-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={tab === t.key}
              onClick={() => go(t.key)}
              className={cn(
                "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition active:scale-95",
                tab === t.key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-card",
              )}
            >
              <t.icon className="h-4 w-4" /> {t.label}
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
        icon={<CalendarDays className="h-4 w-4" />}
        label="Next event"
        loading={events.isLoading}
        value={next ? next.title : "Nothing yet"}
        sub={next ? formatEventWhen(next.starts_at, now) : "Host one"}
      />
      <Tile
        onClick={() => onGo("alerts")}
        icon={<BellRing className="h-4 w-4" />}
        label="Alerts"
        loading={alerts.isLoading}
        value={live === 0 ? "All clear" : `${live} active`}
        sub={live === 0 ? "Nothing reported" : "Tap to see"}
        accent={live > 0}
      />
      <Tile
        onClick={() => onGo("polls")}
        icon={<Flame className="h-4 w-4" />}
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
        "glass-card min-w-0 p-3 text-left transition active:scale-95",
        wide && "col-span-2 sm:col-span-1",
      )}
    >
      <span
        className={cn(
          "mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide",
          accent ? "text-primary" : "text-muted-foreground",
        )}
      >
        {icon} {label}
      </span>
      {loading ? (
        <span className="block h-4 w-3/4 animate-pulse rounded bg-muted" />
      ) : (
        <>
          <span className="block truncate text-sm font-bold">{value}</span>
          <span className="block truncate text-xs text-muted-foreground">{sub}</span>
        </>
      )}
    </button>
  );
}
