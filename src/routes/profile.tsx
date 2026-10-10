import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MapPin, Settings } from "lucide-react";
import { Avatar, BottomNav, SideNav } from "@/components/ediraa";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { getUserPosts } from "@/lib/posts";
import city from "@/assets/city-sunset.jpg";
import desk from "@/assets/desk.jpg";
import road from "@/assets/mountain-road.jpg";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Ediraa" },
      { name: "description", content: "Your posts, reels and tagged photos on Ediraa." },
      { property: "og:title", content: "Profile — Ediraa" },
      { property: "og:description", content: "Your posts, reels and tagged photos on Ediraa." },
    ],
  }),
  component: ProfilePage,
});

const tabs = ["Posts", "Reels", "Tagged"] as const;

type Quote = { a: string; b: string; c: string; d: string };

const quotes: Quote[] = [
  { a: "Better", b: "Ideas", c: "Bigger", d: "Dreams" },
  { a: "Patience", b: "Builds", c: "Success", d: "" },
  { a: "Small", b: "Steps", c: "Big", d: "Results" },
  { a: "Keep", b: "Going", c: "", d: "" },
];

function ProfilePage() {
  const { profile } = useAuth();
  const [counts, setCounts] = useState({ posts: 0, followers: 0, following: 0 });
  const profileId = profile?.id;
  useEffect(() => {
    if (!profileId) return;
    let active = true;
    (async () => {
      const [followers, following] = await Promise.all([
        supabase.from("follows").select("*", { count: "exact", head: true }).eq("following_id", profileId),
        supabase.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", profileId),
      ]);
      if (!active) return;
      setCounts({ posts: getUserPosts(profileId).length, followers: followers.count ?? 0, following: following.count ?? 0 });
    })();
    return () => { active = false; };
  }, [profileId]);
  const name = profile?.full_name || profile?.username || "";
  const [tab, setTab] = useState<(typeof tabs)[number]>("Posts");
  const tiles: ({ img: string; alt: string } | { quote: Quote })[] = [
    { quote: quotes[0]! },
    { img: city, alt: "City skyline at sunset" },
    { img: desk, alt: "Workspace with laptop and coffee" },
    { img: road, alt: "Mountain road at dusk" },
    { img: city, alt: "City skyline at sunset" },
    { quote: quotes[2]! },
    { img: desk, alt: "Workspace with laptop and coffee" },
    { img: road, alt: "Mountain road at dusk" },
    { quote: quotes[3]! },
  ];
  return (
    <div className="mx-auto max-w-6xl px-4 pb-28 pt-5 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,640px)] lg:justify-center">
      <SideNav />
      <main className="min-w-0">
        <section className="glass-card overflow-hidden">
          <div className="relative">
            <img src={city} alt="Sunset over the city" className="h-40 w-full object-cover md:h-52" />
            <Link to="/more" aria-label="Settings" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-background/60 backdrop-blur">
              <Settings className="h-5 w-5" />
            </Link>
          </div>
          <div className="relative px-4 pb-4">
            <div className="-mt-10 flex items-end justify-between">
              <div className="rounded-full bg-gradient-brand p-[3px]">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt={name} className="h-20 w-20 rounded-full border-4 border-background object-cover md:h-24 md:w-24" />
                ) : (
                  <div className="grid h-20 w-20 place-items-center rounded-full border-4 border-background bg-elevated text-2xl font-bold md:h-24 md:w-24">{name.slice(0, 1).toUpperCase() || "?"}</div>
                )}
              </div>
              <button className="rounded-full border border-primary px-5 py-2 text-sm font-semibold text-primary">Edit Profile</button>
            </div>
            <h1 className="mt-3 flex items-center gap-1.5 text-xl font-bold">{name}</h1>
            <p className="text-sm text-muted-foreground">@{profile?.username}</p>
            {profile?.bio && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{profile.bio}</p>}
            {profile?.location && <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin className="h-4 w-4" />{profile.location}</p>}
            <div className="mt-4 grid grid-cols-3 text-center">
              <Stat n={String(counts.posts)} l="Posts" />
              <Stat n={String(counts.followers)} l="Followers" />
              <Stat n={String(counts.following)} l="Following" />
            </div>
          </div>
          <div className="grid grid-cols-3 border-t border-border">
            {tabs.map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`py-3 text-sm font-semibold ${tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}>{t}</button>
            ))}
          </div>
        </section>
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {tiles.map((tile, i) =>
            "img" in tile ? (
              <img key={i} src={tile.img} alt={tile.alt} loading="lazy" width={816} height={816} className="aspect-square w-full rounded-lg object-cover" />
            ) : (
              <QuoteTile key={i} q={tile.quote} />
            )
          )}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div>
      <p className="text-lg font-bold">{n}</p>
      <p className="text-xs text-muted-foreground">{l}</p>
    </div>
  );
}

function QuoteTile({ q }: { q: (typeof quotes)[number] }) {
  return (
    <div className="flex aspect-square flex-col items-start justify-center gap-0.5 rounded-lg bg-elevated p-3">
      <span className="font-serif text-sm italic text-foreground/90">{q.a}</span>
      <span className="text-sm font-extrabold uppercase tracking-wide text-primary">{q.b}</span>
      {q.c && <span className="font-serif text-sm italic text-foreground/90">{q.c}</span>}
      {q.d && <span className="text-sm font-extrabold uppercase tracking-wide text-violet">{q.d}</span>}
    </div>
  );
}
