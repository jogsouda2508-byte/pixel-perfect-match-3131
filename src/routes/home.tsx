import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Search, Bell, Plus, MapPin, Image, Video, FileText, MoreHorizontal, ThumbsUp, MessageSquare, Share2, Heart } from "lucide-react";
import { Avatar, BottomNav, Pill, SideNav, UserRow, Verified, avatar } from "@/components/ediraa";
import { getUserPosts, type UserPost } from "@/lib/posts";
import city from "@/assets/city-sunset.jpg";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Home Feed — Ediraa" },
      { name: "description", content: "Stories, posts and local updates from your Ediraa network." },
      { property: "og:title", content: "Home Feed — Ediraa" },
      { property: "og:description", content: "Stories, posts and local updates from your Ediraa network." },
    ],
  }),
  component: HomePage,
});

const me = avatar("men", 32);
const stories = [
  { n: "Rohit", img: avatar("men", 45) },
  { n: "Sneha", img: avatar("women", 44) },
  { n: "Kavya", img: avatar("women", 65) },
];

function HomePage() {
  const [tab, setTab] = useState("For You");
  const [liked, setLiked] = useState(false);
  const [userPosts, setUserPosts] = useState<UserPost[]>([]);
  useEffect(() => setUserPosts(getUserPosts()), []);
  return (
    <div className="mx-auto max-w-6xl px-4 pb-28 pt-5 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,640px)_300px]">
      <SideNav />
      <main className="min-w-0 space-y-4">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Ediraa</h1>
          <div className="flex items-center gap-4">
            <Search className="h-6 w-6" />
            <Link to="/notifications" aria-label="Notifications" className="relative block"><Bell className="h-6 w-6" /><span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-destructive" /></Link>
            <Avatar src={me} size={34} />
          </div>
        </header>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {["For You", "Following", "Local", "Business"].map((t) => <Pill key={t} active={tab === t} onClick={() => setTab(t)}>{t}</Pill>)}
        </div>
        <div className="flex gap-4 overflow-x-auto pb-1">
          <Story label="Create Story"><div className="relative"><Avatar src={me} size={60} ring /><span className="absolute -bottom-0.5 left-1/2 grid h-6 w-6 -translate-x-1/2 place-items-center rounded-full bg-primary"><Plus className="h-4 w-4" /></span></div></Story>
          {stories.map((s) => <Story key={s.n} label={s.n}><Avatar src={s.img} size={60} ring /></Story>)}
          <Story label="Local Hub"><div className="rounded-full bg-gradient-brand p-[2px]"><div className="grid h-14 w-14 place-items-center rounded-full bg-background"><MapPin className="h-6 w-6 text-success" /></div></div></Story>
        </div>
        <section className="glass-card p-3">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-elevated/40 p-3">
            <Avatar src={me} size={34} /><span className="text-sm text-muted-foreground">What's on your mind?</span>
          </div>
          <div className="mt-3 grid grid-cols-3 divide-x divide-border text-sm">
            <span className="flex items-center justify-center gap-2"><Image className="h-4 w-4 text-success" />Photo</span>
            <span className="flex items-center justify-center gap-2"><Video className="h-4 w-4 text-destructive" />Video</span>
            <span className="flex items-center justify-center gap-2"><FileText className="h-4 w-4 text-violet" />Post</span>
          </div>
        </section>
        {userPosts.map((p) => (
          <article key={p.id} className="glass-card p-3">
            <div className="flex items-center gap-3">
              <Avatar src={me} size={40} />
              <div className="flex-1"><p className="text-sm font-semibold">Basava Jarkande</p><p className="text-xs text-muted-foreground">@basava_2005 • {p.time} • {p.audience}</p></div>
            </div>
            <p className="mt-3 text-sm leading-relaxed">{p.text}</p>
            <div className="mt-3 grid grid-cols-3 border-t border-border pt-2 text-sm">
              <button className="flex items-center justify-center gap-2 py-2"><ThumbsUp className="h-5 w-5" />Like</button>
              <button className="flex items-center justify-center gap-2 py-2"><MessageSquare className="h-5 w-5" />Comment</button>
              <button className="flex items-center justify-center gap-2 py-2"><Share2 className="h-5 w-5" />Share</button>
            </div>
          </article>
        ))}
        <article className="glass-card p-3">
          <div className="flex items-center gap-3">
            <Avatar src={avatar("men", 75)} size={40} />
            <div className="flex-1"><p className="text-sm font-semibold">Sanjay Gowda</p><p className="text-xs text-muted-foreground">@bangalore • 2h ago</p></div>
            <MoreHorizontal className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="mt-3 text-sm leading-relaxed">Great things happen when good people connect! Excited to be part of this amazing community. <span className="text-primary">#Ediraa #Networking #Growth</span></p>
          <img src={city} alt="Bangalore skyline at sunset" width={1280} height={768} className="mt-3 aspect-[16/10] w-full rounded-xl object-cover" />
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-2"><span className="flex"><span className="grid h-5 w-5 place-items-center rounded-full bg-primary"><ThumbsUp className="h-3 w-3 fill-primary-foreground text-primary-foreground" /></span><span className="-ml-1.5 grid h-5 w-5 place-items-center rounded-full bg-destructive"><Heart className="h-3 w-3 fill-primary-foreground text-primary-foreground" /></span></span>{243 + (liked ? 1 : 0)}</span>
            <span>12 comments • 5 shares</span>
          </div>
          <div className="mt-3 grid grid-cols-3 border-t border-border pt-2 text-sm">
            <button onClick={() => setLiked(!liked)} className={`flex items-center justify-center gap-2 py-2 ${liked ? "text-primary" : ""}`}><ThumbsUp className={`h-5 w-5 ${liked ? "fill-primary" : ""}`} />Like</button>
            <button className="flex items-center justify-center gap-2 py-2"><MessageSquare className="h-5 w-5" />Comment</button>
            <button className="flex items-center justify-center gap-2 py-2"><Share2 className="h-5 w-5" />Share</button>
          </div>
        </article>
      </main>
      <aside className="sticky top-6 hidden h-fit space-y-4 lg:block">
        <section className="glass-card space-y-4 p-4">
          <h2 className="font-semibold">People you may know</h2>
          <UserRow name="Ananya R" sub="2 mutual friends" img={avatar("women", 12)} />
          <UserRow name="Rahul S" sub="3 mutual friends" img={avatar("men", 22)} />
          <UserRow name="Meghana K" sub="1 mutual friend" img={avatar("women", 33)} />
          <UserRow name="Kiran D" sub="5 mutual friends" img={avatar("men", 52)} />
        </section>
        <section className="glass-card p-4">
          <h2 className="mb-3 font-semibold">Trending Topics</h2>
          <div className="flex flex-wrap gap-2">{["#Ediraa", "#Startups", "#Business", "#Tech", "#Bangalore"].map((t) => <span key={t} className="rounded-full bg-elevated px-3 py-1.5 text-xs font-medium">{t}</span>)}</div>
          <p className="mt-4 flex items-center gap-1 text-xs text-muted-foreground">Ediraa Official <Verified /></p>
        </section>
      </aside>
      <BottomNav />
    </div>
  );
}

function Story({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex shrink-0 flex-col items-center gap-1.5">{children}<span className="text-xs">{label}</span></div>;
}
