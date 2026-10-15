import { createFileRoute, useBlocker, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, Globe, Hash, MapPin, UserCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { BottomNav, SideNav } from "@/components/ediraa";
import { ComposerLauncher } from "@/components/composer";
import { useAuth } from "@/lib/auth";
import { createPost } from "@/lib/social";
import type { Audience } from "@/integrations/supabase/types";

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
const audiences: { label: Audience; icon: typeof Globe }[] = [
  { label: "Public", icon: Globe },
  { label: "Friends", icon: UserCheck },
  { label: "Local Community", icon: Building2 },
];

function CreatePostPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [audience, setAudience] = useState<Audience>("Public");
  const dirty = !!text.trim();

  useBlocker({
    shouldBlockFn: () =>
      dirty && !window.confirm("You have unsaved changes. Leave without publishing?"),
    enableBeforeUnload: false,
  });

  const warnBeforeLeaving = useCallback(
    (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    },
    [dirty],
  );

  useEffect(() => {
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [warnBeforeLeaving]);

  const publish = useMutation({
    mutationFn: () =>
      createPost({ authorId: profile!.id, content: text.trim(), audience, image: null }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["feed"] }),
        queryClient.invalidateQueries({ queryKey: ["user-posts"] }),
        queryClient.invalidateQueries({ queryKey: ["follow-counts"] }),
        queryClient.invalidateQueries({ queryKey: ["trending"] }),
      ]);
      toast.success("Posted!");
      navigate({ to: "/home" });
    },
    onError: (error: Error) =>
      toast.error(error.message || "Couldn't publish your post. Please try again."),
  });

  return (
    <div className="mx-auto max-w-6xl px-4 pb-28 pt-5 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,640px)] lg:justify-center">
      <SideNav />
      <main className="min-w-0 space-y-4">
        <header className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate({ to: "/home" })}
            aria-label="Back"
            className="grid h-11 w-11 place-items-center rounded-full hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <h1 className="text-xl font-bold">Create Post</h1>
        </header>
        <section className="glass-card space-y-4 p-4">
          <textarea
            value={text}
            onChange={(event) => setText(event.currentTarget.value.slice(0, MAX))}
            placeholder="What's on your mind?"
            rows={5}
            aria-label="Post text"
            className="w-full resize-none rounded-xl border border-border bg-elevated/40 p-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="-mt-3 text-right text-xs text-muted-foreground">
            {text.length}/{MAX}
          </p>
          <ComposerLauncher variant="media" />
          <div className="grid grid-cols-2 gap-2 text-sm">
            <button
              type="button"
              onClick={() => toast("Location tagging is coming soon.")}
              className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border"
            >
              <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
              Location
            </button>
            <button
              type="button"
              onClick={() => toast("Tagging people is coming soon.")}
              className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border"
            >
              <Users className="h-4 w-4 text-primary" aria-hidden="true" />
              Tag People
            </button>
            <button
              type="button"
              onClick={() =>
                setText((value) =>
                  (value && !value.endsWith(" ") && !value.endsWith("\n")
                    ? `${value} #`
                    : `${value}#`
                  ).slice(0, MAX),
                )
              }
              className="col-span-2 flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border"
            >
              <Hash className="h-4 w-4 text-primary" aria-hidden="true" />
              Add Hashtag
            </button>
          </div>
        </section>
        <section className="glass-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Post to</h2>
          <div className="space-y-1">
            {audiences.map(({ label, icon: Icon }) => (
              <button
                key={label}
                type="button"
                onClick={() => setAudience(label)}
                aria-pressed={audience === label}
                className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm ${audience === label ? "bg-elevated text-primary" : "text-foreground hover:bg-card"}`}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                {label}
                <span
                  className={`ml-auto h-4 w-4 rounded-full border-2 ${audience === label ? "border-primary bg-primary" : "border-muted-foreground"}`}
                />
              </button>
            ))}
          </div>
        </section>
        <button
          type="button"
          onClick={() => publish.mutate()}
          disabled={!text.trim() || !profile || publish.isPending}
          className="flex min-h-11 w-full items-center justify-center rounded-full bg-gradient-brand py-3.5 font-semibold text-primary-foreground glow disabled:cursor-not-allowed disabled:opacity-60"
        >
          {publish.isPending ? "Posting..." : "Post"}
        </button>
      </main>
      <BottomNav />
    </div>
  );
}
