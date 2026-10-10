import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Image,
  Video,
  MapPin,
  Users,
  Hash,
  Globe,
  UserCheck,
  Building2,
  Loader2,
  X,
} from "lucide-react";
import { Avatar, BottomNav, SideNav } from "@/components/ediraa";
import { useAuth } from "@/lib/auth";
import { createPost, validateImage } from "@/lib/social";

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
  const { profile } = useAuth();
  const [text, setText] = useState("");
  const [audience, setAudience] = useState<(typeof audiences)[number]["label"]>("Public");
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const empty = text.trim().length === 0 && !image;

  useEffect(() => {
    if (!image) return setPreview(null);
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const publish = useMutation({
    mutationFn: () => createPost({ authorId: profile!.id, content: text.trim(), audience, image }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["feed"] }),
        qc.invalidateQueries({ queryKey: ["user-posts"] }),
        qc.invalidateQueries({ queryKey: ["follow-counts"] }),
        qc.invalidateQueries({ queryKey: ["trending"] }),
      ]);
      toast.success("Posted!");
      navigate({ to: "/home" });
    },
    onError: (e: Error) =>
      toast.error(e.message || "Couldn't publish your post. Please try again."),
  });

  const post = () => {
    if (empty || !profile || publish.isPending) return;
    publish.mutate();
  };

  const pickImage = (file: File | undefined) => {
    if (!file) return;
    const problem = validateImage(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    setImage(file);
  };
  const soon = (what: string) => toast(`${what} is coming soon.`);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-28 pt-5 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,640px)] lg:justify-center">
      <SideNav />
      <main className="min-w-0 space-y-4">
        <header className="flex items-center gap-3">
          <button
            onClick={() => navigate({ to: "/home" })}
            aria-label="Back"
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-card"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold">Create Post</h1>
        </header>
        <section className="glass-card p-4">
          <div className="flex items-start gap-3">
            <Avatar
              src={profile?.avatar_url}
              name={profile?.full_name || profile?.username}
              size={40}
            />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX))}
              placeholder="What's on your mind?"
              rows={5}
              className="w-full resize-none rounded-xl border border-border bg-elevated/40 p-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
            />
          </div>
          <p className="mt-1 text-right text-xs text-muted-foreground">
            {text.length}/{MAX}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              hidden
              onChange={(e) => {
                pickImage(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded-lg border border-border py-2.5"
            >
              <Image className="h-4 w-4 text-success" />
              Photo
            </button>
            <button
              onClick={() => soon("Video posts")}
              className="flex items-center justify-center gap-2 rounded-lg border border-border py-2.5"
            >
              <Video className="h-4 w-4 text-destructive" />
              Video
            </button>
            <button
              onClick={() => soon("Location tagging")}
              className="flex items-center justify-center gap-2 rounded-lg border border-border py-2.5"
            >
              <MapPin className="h-4 w-4 text-primary" />
              Location
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <button
              onClick={() => soon("Tagging people")}
              className="flex items-center justify-center gap-2 rounded-lg border border-border py-2.5"
            >
              <Users className="h-4 w-4 text-violet" />
              Tag People
            </button>
            <button
              onClick={() =>
                setText((t) =>
                  (t && !t.endsWith(" ") && !t.endsWith("\n") ? `${t} #` : `${t}#`).slice(0, MAX),
                )
              }
              className="flex items-center justify-center gap-2 rounded-lg border border-border py-2.5"
            >
              <Hash className="h-4 w-4 text-primary" />
              Add Hashtag
            </button>
          </div>
          {preview && (
            <div className="relative mt-3">
              <img
                src={preview}
                alt="Selected"
                className="max-h-72 w-full rounded-xl object-cover"
              />
              <button
                onClick={() => setImage(null)}
                aria-label="Remove photo"
                className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-background/70 backdrop-blur"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
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
                <span
                  className={`ml-auto h-4 w-4 rounded-full border-2 ${audience === a.label ? "border-primary bg-primary" : "border-muted-foreground"}`}
                />
              </button>
            ))}
          </div>
        </section>
        <button
          onClick={post}
          disabled={empty || publish.isPending}
          className={`flex w-full items-center justify-center gap-2 rounded-full py-3.5 font-semibold transition ${empty ? "cursor-not-allowed bg-elevated text-muted-foreground" : "bg-gradient-brand text-primary-foreground glow"} disabled:opacity-80`}
        >
          {publish.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Post
        </button>
      </main>
      <BottomNav />
    </div>
  );
}
