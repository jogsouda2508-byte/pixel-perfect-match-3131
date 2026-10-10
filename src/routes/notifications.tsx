import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Heart, Loader2, MessageSquare, UserPlus } from "lucide-react";
import { Avatar, BottomNav, Pill, SideNav } from "@/components/ediraa";
import { useAuth } from "@/lib/auth";
import { fetchNotifications, markNotificationsSeen } from "@/lib/social";
import { timeAgo } from "@/lib/time";
import { useFollow } from "@/lib/use-follow";
import type { NotificationRow } from "@/integrations/supabase/types";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — Ediraa" },
      {
        name: "description",
        content: "Likes, comments and new followers from your Ediraa network.",
      },
      { property: "og:title", content: "Notifications — Ediraa" },
      {
        property: "og:description",
        content: "Likes, comments and new followers from your Ediraa network.",
      },
    ],
  }),
  component: NotificationsPage,
});

const tabs = ["All", "Likes", "Comments", "Follows"] as const;
const tabKind: Record<(typeof tabs)[number], NotificationRow["kind"] | null> = {
  All: null,
  Likes: "like",
  Comments: "comment",
  Follows: "follow",
};

const kindIcon = {
  like: <Heart className="h-3.5 w-3.5 fill-primary-foreground text-primary-foreground" />,
  comment: (
    <MessageSquare className="h-3.5 w-3.5 fill-primary-foreground text-primary-foreground" />
  ),
  follow: <UserPlus className="h-3.5 w-3.5 text-primary-foreground" />,
} as const;
const kindColor = { like: "bg-destructive", comment: "bg-primary", follow: "bg-success" } as const;

function describe(n: NotificationRow) {
  if (n.kind === "like") return "liked your post";
  if (n.kind === "comment") return `commented: ${n.snippet ?? ""}`;
  return "started following you";
}

function NotificationsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const meId = user?.id ?? "";
  const [tab, setTab] = useState<(typeof tabs)[number]>("All");
  const follow = useFollow();
  const list = useQuery({
    queryKey: ["notifications", meId],
    queryFn: fetchNotifications,
    enabled: !!meId,
  });

  // Opening the page marks everything as read, which clears the red dot on the bell.
  useEffect(() => {
    if (!meId) return;
    markNotificationsSeen(meId)
      .then(() => qc.invalidateQueries({ queryKey: ["unread"] }))
      .catch(() => {});
  }, [meId, qc]);

  const kind = tabKind[tab];
  const visible = (list.data ?? []).filter((n) => !kind || n.kind === kind);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-28 pt-5 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,640px)] lg:justify-center">
      <SideNav />
      <main className="min-w-0 space-y-4">
        <header className="flex items-center gap-3">
          <button
            onClick={() => navigate({ to: "/home" })}
            aria-label="Back"
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-card md:hidden"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-2xl font-bold">Notifications</h1>
        </header>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {tabs.map((t) => (
            <Pill key={t} active={tab === t} onClick={() => setTab(t)}>
              {t}
            </Pill>
          ))}
        </div>
        <section className="glass-card divide-y divide-border">
          {list.isLoading && (
            <div className="grid place-items-center p-6">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          )}
          {list.isError && (
            <p className="p-4 text-sm text-destructive">Couldn't load notifications.</p>
          )}
          {list.isSuccess && visible.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">No notifications here yet.</p>
          )}
          {visible.map((n) => {
            const following = follow.isFollowing(n.actor_id, n.i_follow_actor);
            return (
              <div
                key={`${n.kind}-${n.actor_id}-${n.post_id ?? ""}-${n.created_at}`}
                className="flex items-center gap-3 p-4"
              >
                <div className="relative shrink-0">
                  <Avatar src={n.actor_avatar} name={n.actor_name || n.actor_username} size={44} />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-background ${kindColor[n.kind]}`}
                  >
                    {kindIcon[n.kind]}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm">
                    <span className="font-semibold">{n.actor_name || n.actor_username}</span>{" "}
                    <span className="text-muted-foreground">{describe(n)}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{timeAgo(n.created_at)}</p>
                </div>
                {n.kind === "follow" && (
                  <button
                    onClick={() => follow.toggle(n.actor_id, following)}
                    disabled={follow.isPending(n.actor_id)}
                    className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${following ? "bg-elevated text-muted-foreground" : "bg-gradient-brand text-primary-foreground"}`}
                  >
                    {following ? "Following" : "Follow back"}
                  </button>
                )}
              </div>
            );
          })}
        </section>
      </main>
      <BottomNav />
    </div>
  );
}
