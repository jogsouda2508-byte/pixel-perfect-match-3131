import {
  createFileRoute,
  useBlocker,
  useNavigate,
} from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, Globe, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { BottomNav, SideNav } from "@/components/ediraa";
import { ComposerLauncher } from "@/components/composer";
import {
  EMPTY_EXTRAS,
  PostExtrasFields,
  type PostExtrasValue,
} from "@/components/post-extras-fields";
import { useAuth } from "@/lib/auth";
import { appendHashtagMark, extractHashtags } from "@/lib/post-extras";
import { createPost } from "@/lib/social";
import { createPoll } from "@/lib/polls";
import type { Audience } from "@/integrations/supabase/types";

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [
      { title: "Create Post — Gicco chat" },
      {
        name: "description",
        content: "Share an update with your Gicco chat network.",
      },
      { property: "og:title", content: "Create Post — Gicco chat" },
      {
        property: "og:description",
        content: "Share an update with your Gicco chat network.",
      },
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
  const textInput = useRef<HTMLTextAreaElement>(null);
  const [audience, setAudience] = useState<Audience>("Public");
  // Location and tagged people are kept here, so they survive picking a photo or video below.
  const [extras, setExtras] = useState<PostExtrasValue>(EMPTY_EXTRAS);
  const dirty = !!text.trim() || !!extras.location || extras.tagged.length > 0 || !!extras.poll;

  // Set once the post is published, so leaving the page afterwards isn't treated as "unsaved".
  const publishedRef = useRef(false);

  useBlocker({
    shouldBlockFn: () =>
      dirty &&
      !publishedRef.current &&
      !window.confirm("You have unsaved changes. Leave without publishing?"),
    enableBeforeUnload: false,
  });

  const warnBeforeLeaving = useCallback(
    (event: BeforeUnloadEvent) => {
      if (!dirty || publishedRef.current) return;
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
    mutationFn: async () => {
      const created = await createPost({
        authorId: profile!.id,
        content: text.trim(),
        audience,
        image: null,
        location: extras.location,
        taggedUserIds: extras.tagged.map((person) => person.id),
      });
      // the poll belongs to the new post; if it fails the post is still published
      let pollFailed = false;
      if (extras.poll) {
        try {
          await createPoll({ postId: created.id }, extras.poll.question, extras.poll.options);
        } catch {
          pollFailed = true;
        }
      }
      return { ...created, pollFailed };
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["feed"] }),
        queryClient.invalidateQueries({ queryKey: ["user-posts"] }),
        queryClient.invalidateQueries({ queryKey: ["follow-counts"] }),
        queryClient.invalidateQueries({ queryKey: ["trending"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
        queryClient.invalidateQueries({ queryKey: ["poll"] }),
      ]);
      if (result.pollFailed) toast.warning("Posted, but the poll couldn't be added.");
      else if (result.tagsFailed)
        toast.warning(
          "Posted, but we couldn't tag everyone. Some people may not be able to see this post.",
        );
      else toast.success("Posted!");
      publishedRef.current = true;
      navigate({ to: "/home" });
    },
    onError: (error: Error) =>
      toast.error(
        error.message || "Couldn't publish your post. Please try again.",
      ),
  });

  return (
    <div className="mx-auto max-w-[1480px] app-page px-4 sm:px-6 pb-24 pt-0 sm:pt-5 sm:pb-28 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,680px)_300px] lg:justify-center 2xl:grid-cols-[240px_minmax(0,800px)_340px]">
      <SideNav />
      <main className="app-main min-w-0 space-y-1.5 sm:space-y-4">
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
            ref={textInput}
            value={text}
            onChange={(event) =>
              setText(event.currentTarget.value.slice(0, MAX))
            }
            placeholder="What's on your mind?"
            rows={5}
            aria-label="Post text"
            className="w-full resize-none rounded-xl border border-border bg-elevated/40 p-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="-mt-3 text-right text-xs text-muted-foreground">
            {text.length}/{MAX}
          </p>
          <ComposerLauncher
            variant="media"
            extras={extras}
            onExtrasChange={setExtras}
          />
          <PostExtrasFields
            value={extras}
            onChange={setExtras}
            audience={audience}
            hashtags={extractHashtags(text)}
            onAddHashtag={() => {
              setText((value) => appendHashtagMark(value, MAX));
              textInput.current?.focus();
            }}
          />
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
