import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Search } from "lucide-react";
import { Avatar, BottomNav, Pill, SideNav, avatar } from "@/components/ediraa";

export const Route = createFileRoute("/discover")({
  head: () => ({
    meta: [
      { title: "Discover — Ediraa" },
      { name: "description", content: "Find people, businesses and trending topics on Ediraa." },
      { property: "og:title", content: "Discover — Ediraa" },
      { property: "og:description", content: "Find people, businesses and trending topics on Ediraa." },
    ],
  }),
  component: DiscoverPage,
});

const filters = ["All", "People", "Business", "Groups"] as const;

const people = [
  { name: "Ananya R", sub: "2 mutual friends", img: avatar("women", 12) },
  { name: "Rahul S", sub: "3 mutual friends", img: avatar("men", 22) },
  { name: "Meghana K", sub: "1 mutual friend", img: avatar("women", 33) },
  { name: "Kiran D", sub: "5 mutual friends", img: avatar("men", 52) },
];

const topics = ["#Ediraa", "#Startups", "#Business", "#Tech", "#Bangalore", "#Networking", "#Growth", "#LocalHub"];

function DiscoverPage() {
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [query, setQuery] = useState("");
  const [following, setFollowing] = useState<Record<string, boolean>>({});

  const visible = people.filter(
    (p) => p.name.toLowerCase().includes(query.toLowerCase()) && (filter === "All" || filter === "People")
  );

  return (
    <div className="mx-auto max-w-6xl px-4 pb-28 pt-5 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,640px)] lg:justify-center">
      <SideNav />
      <main className="min-w-0 space-y-4">
        <h1 className="text-2xl font-bold">Discover</h1>
        <label className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search users, posts, business..."
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {filters.map((f) => <Pill key={f} active={filter === f} onClick={() => setFilter(f)}>{f}</Pill>)}
        </div>
        <section className="glass-card p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">People you may know</h2>
            <button className="text-xs font-medium text-primary">See All</button>
          </div>
          <div className="space-y-4">
            {visible.length === 0 && <p className="text-sm text-muted-foreground">No people match your search.</p>}
            {visible.map((p) => {
              const isFollowing = !!following[p.name];
              return (
                <div key={p.name} className="flex items-center gap-3">
                  <Avatar src={p.img} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{p.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{p.sub}</p>
                  </div>
                  <button
                    onClick={() => setFollowing((s) => ({ ...s, [p.name]: !isFollowing }))}
                    className={`shrink-0 rounded-lg px-3 py-1 text-xs font-medium transition ${isFollowing ? "bg-elevated text-muted-foreground" : "border border-primary text-primary"}`}
                  >
                    {isFollowing ? "Following" : "Follow"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
        <section className="glass-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Trending Topics</h2>
            <button className="text-xs font-medium text-primary">See All</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {topics.map((t) => <span key={t} className="rounded-full bg-elevated px-3 py-1.5 text-xs font-medium">{t}</span>)}
          </div>
        </section>
      </main>
      <BottomNav />
    </div>
  );
}
