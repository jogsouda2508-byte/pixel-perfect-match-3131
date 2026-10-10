import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Heart, MessageSquare, UserPlus, AtSign, MoreHorizontal } from "lucide-react";
import { Avatar, BottomNav, Pill, SideNav, avatar } from "@/components/ediraa";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — Ediraa" },
      { name: "description", content: "Likes, comments and new followers from your Ediraa network." },
      { property: "og:title", content: "Notifications — Ediraa" },
      { property: "og:description", content: "Likes, comments and new followers from your Ediraa network." },
    ],
  }),
  component: NotificationsPage,
});

type Kind = "Likes" | "Comments" | "Follows";
const tabs = ["All", "Likes", "Comments", "Follows"] as const;

const items: { name: string; text: string; time: string; kind: Kind; img: string; followBack?: boolean }[] = [
  { name: "Priya Sharma", text: "liked your post", time: "2m ago", kind: "Likes", img: avatar("women", 26) },
  { name: "Rohit Kumar", text: "commented: Nice post! Keep going 🚀", time: "5m ago", kind: "Comments", img: avatar("men", 45) },
  { name: "Meghana K", text: "started following you", time: "12m ago", kind: "Follows", img: avatar("women", 33), followBack: true },
  { name: "Local Hub", text: "mentioned you in a post", time: "20m ago", kind: "Comments", img: avatar("men", 11) },
  { name: "Sanjay Gowda", text: "liked your photo", time: "32m ago", kind: "Likes", img: avatar("men", 75) },
  { name: "Kiran D", text: "and 3 others liked your post", time: "1h ago", kind: "Likes", img: avatar("men", 52) },
];

const kindIcon = {
  Likes: <Heart className="h-3.5 w-3.5 fill-primary-foreground text-primary-foreground" />,
  Comments: <MessageSquare className="h-3.5 w-3.5 fill-primary-foreground text-primary-foreground" />,
  Follows: <UserPlus className="h-3.5 w-3.5 text-primary-foreground" />,
} as const;

const kindColor = { Likes: "bg-destructive", Comments: "bg-primary", Follows: "bg-success" } as const;

function NotificationsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<(typeof tabs)[number]>("All");
  const [followed, setFollowed] = useState<Record<string, boolean>>({});
  const visible = items.filter((i) => tab === "All" || i.kind === tab);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-28 pt-5 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,640px)] lg:justify-center">
      <SideNav />
      <main className="min-w-0 space-y-4">
        <header className="flex items-center gap-3">
          <button onClick={() => navigate({ to: "/home" })} aria-label="Back" className="grid h-9 w-9 place-items-center rounded-full hover:bg-card md:hidden">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-2xl font-bold">Notifications</h1>
        </header>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {tabs.map((t) => <Pill key={t} active={tab === t} onClick={() => setTab(t)}>{t}</Pill>)}
        </div>
        <section className="glass-card divide-y divide-border">
          {visible.length === 0 && <p className="p-4 text-sm text-muted-foreground">No notifications here yet.</p>}
          {visible.map((n) => (
            <div key={n.name + n.time} className="flex items-center gap-3 p-4">
              <div className="relative shrink-0">
                <Avatar src={n.img} size={44} />
                <span className={`absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-background ${kindColor[n.kind]}`}>
                  {n.name === "Local Hub" ? <AtSign className="h-3.5 w-3.5 text-primary-foreground" /> : kindIcon[n.kind]}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm"><span className="font-semibold">{n.name}</span> <span className="text-muted-foreground">{n.text}</span></p>
                <p className="mt-0.5 text-xs text-muted-foreground">{n.time}</p>
              </div>
              {n.followBack ? (
                <button
                  onClick={() => setFollowed((s) => ({ ...s, [n.name]: !s[n.name] }))}
                  className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition ${followed[n.name] ? "bg-elevated text-muted-foreground" : "bg-gradient-brand text-primary-foreground"}`}
                >
                  {followed[n.name] ? "Following" : "Follow back"}
                </button>
              ) : (
                <MoreHorizontal className="h-5 w-5 shrink-0 text-muted-foreground" />
              )}
            </div>
          ))}
        </section>
      </main>
      <BottomNav />
    </div>
  );
}
