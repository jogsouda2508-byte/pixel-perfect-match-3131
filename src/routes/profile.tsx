import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, MapPin, Settings } from "lucide-react";
import { BottomNav, SideNav } from "@/components/ediraa";
import { useAuth } from "@/lib/auth";
import { fetchFollowCounts, fetchUserPosts } from "@/lib/social";

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

function ProfilePage() {
  const { profile } = useAuth();
  const profileId = profile?.id;
  const [tab, setTab] = useState<(typeof tabs)[number]>("Posts");
  const name = profile?.full_name || profile?.username || "";

  const counts = useQuery({
    queryKey: ["follow-counts", profileId],
    queryFn: () => fetchFollowCounts(profileId!),
    enabled: !!profileId,
  });
  const posts = useQuery({
    queryKey: ["user-posts", profileId],
    queryFn: () => fetchUserPosts(profileId!),
    enabled: !!profileId,
  });

  return (
    <div className="mx-auto max-w-6xl px-4 pb-28 pt-5 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,640px)] lg:justify-center">
      <SideNav />
      <main className="min-w-0">
        <section className="glass-card overflow-hidden">
          <div className="relative">
            <div className="h-40 w-full bg-gradient-brand opacity-80 md:h-52" />
            <Link
              to="/more"
              aria-label="Settings"
              className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-background/60 backdrop-blur"
            >
              <Settings className="h-5 w-5" />
            </Link>
          </div>
          <div className="relative px-4 pb-4">
            <div className="-mt-10 flex items-end justify-between">
              <div className="rounded-full bg-gradient-brand p-[3px]">
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt={name}
                    className="h-20 w-20 rounded-full border-4 border-background object-cover md:h-24 md:w-24"
                  />
                ) : (
                  <div className="grid h-20 w-20 place-items-center rounded-full border-4 border-background bg-elevated text-2xl font-bold md:h-24 md:w-24">
                    {name.slice(0, 1).toUpperCase() || "?"}
                  </div>
                )}
              </div>
              <button className="rounded-full border border-primary px-5 py-2 text-sm font-semibold text-primary">
                Edit Profile
              </button>
            </div>
            <h1 className="mt-3 flex items-center gap-1.5 text-xl font-bold">{name}</h1>
            <p className="text-sm text-muted-foreground">@{profile?.username}</p>
            {profile?.bio && (
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{profile.bio}</p>
            )}
            {profile?.location && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" />
                {profile.location}
              </p>
            )}
            <div className="mt-4 grid grid-cols-3 text-center">
              <Stat n={String(counts.data?.posts ?? 0)} l="Posts" />
              <Stat n={String(counts.data?.followers ?? 0)} l="Followers" />
              <Stat n={String(counts.data?.following ?? 0)} l="Following" />
            </div>
          </div>
          <div className="grid grid-cols-3 border-t border-border">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`py-3 text-sm font-semibold ${tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
              >
                {t}
              </button>
            ))}
          </div>
        </section>
        {tab === "Posts" ? (
          <>
            {posts.isLoading && (
              <div className="grid place-items-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            )}
            {posts.isError && (
              <p className="mt-3 text-center text-sm text-destructive">Couldn't load your posts.</p>
            )}
            {posts.isSuccess && posts.data.length === 0 && (
              <p className="mt-3 glass-card p-6 text-center text-sm text-muted-foreground">
                You haven't posted anything yet.
              </p>
            )}
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {posts.data?.map((p) =>
                p.image_url ? (
                  <img
                    key={p.id}
                    src={p.image_url}
                    alt={p.content.slice(0, 80)}
                    loading="lazy"
                    className="aspect-square w-full rounded-lg object-cover"
                  />
                ) : (
                  <div
                    key={p.id}
                    className="flex aspect-square items-center rounded-lg bg-elevated p-3"
                  >
                    <p className="line-clamp-5 break-words text-xs font-medium leading-snug">
                      {p.content}
                    </p>
                  </div>
                ),
              )}
            </div>
          </>
        ) : (
          <p className="mt-3 glass-card p-6 text-center text-sm text-muted-foreground">
            {tab === "Reels"
              ? "Reels are coming soon."
              : "Posts you're tagged in will appear here."}
          </p>
        )}
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
