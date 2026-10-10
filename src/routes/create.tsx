import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Image, Video, MapPin, Users, Hash, Globe, UserCheck, Building2 } from "lucide-react";
import { Avatar, BottomNav, SideNav, avatar } from "@/components/ediraa";
import { addUserPost } from "@/lib/posts";

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [
      { title: "Create Post — Ediraa" },
      { name: "description", content: "Share an update with your Ediraa network." },
      { property: "og:title", content: "Create Post — Ediraa" },
      { property: "og:description", content: "Share an update with your Ediraa network." },
    ],
  }),
  component: CreatePostPage,
});

const MAX = 500;
const audiences = [
  { label: "Public", icon: Globe },
  { label: "Friends", icon: UserCheck },
  { label: "Local Community", icon: Building2 },
] as const;

function CreatePostPage() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [audience, setAudience] = useState<(typeof audiences)[number]["label"]>("Public");
  const empty = text.trim().length === 0;

  const post = () => {
    if (empty) return;
    addUserPost({ text: text.trim(), audience });
    navigate({ to: "/home" });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 pb-28 pt-5 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,640px)] lg:justify-center">
      <SideNav />
      <main className="min-w-0 space-y-4">
        <header className="flex items-center gap-3">
          <button onClick={() => navigate({ to: "/home" })} aria-label="Back" className="grid h-9 w-9 place-items-center rounded-full hover:bg-card">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold">Create Post</h1>
        </header>
        <section className="glass-card p-4">
          <div className="flex items-start gap-3">
            <Avatar src={avatar("men", 32)} size={40} />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX))}
              placeholder="What's on your mind?"
              rows={5}
              className="w-full resize-none rounded-xl border border-border bg-elevated/40 p-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
            />
          </div>
          <p className="mt-1 text-right text-xs text-muted-foreground">{text.length}/{MAX}</p>
          <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
            <button className="flex items-center justify-center gap-2 rounded-lg border border-border py-2.5"><Image className="h-4 w-4 text-success" />Photo</button>
            <button className="flex items-center justify-center gap-2 rounded-lg border border-border py-2.5"><Video className="h-4 w-4 text-destructive" />Video</button>
            <button className="flex items-center justify-center gap-2 rounded-lg border border-border py-2.5"><MapPin className="h-4 w-4 text-primary" />Location</button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <button className="flex items-center justify-center gap-2 rounded-lg border border-border py-2.5"><Users className="h-4 w-4 text-violet" />Tag People</button>
            <button className="flex items-center justify-center gap-2 rounded-lg border border-border py-2.5"><Hash className="h-4 w-4 text-primary" />Add Hashtag</button>
          </div>
        </section>
        <section className="glass-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Post to</h2>
          <div className="space-y-1">
            {audiences.map((a) => (
              <button
                key={a.label}
                onClick={() => setAudience(a.label)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${audience === a.label ? "bg-elevated text-primary" : "text-foreground hover:bg-card"}`}
              >
                <a.icon className="h-5 w-5" />
                {a.label}
                <span className={`ml-auto h-4 w-4 rounded-full border-2 ${audience === a.label ? "border-primary bg-primary" : "border-muted-foreground"}`} />
              </button>
            ))}
          </div>
        </section>
        <button
          onClick={post}
          disabled={empty}
          className={`w-full rounded-full py-3.5 font-semibold transition ${empty ? "cursor-not-allowed bg-elevated text-muted-foreground" : "bg-gradient-brand text-primary-foreground glow"}`}
        >
          Post
        </button>
      </main>
      <BottomNav />
    </div>
  );
}
