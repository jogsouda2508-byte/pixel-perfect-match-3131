import { createFileRoute, useBlocker, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, Globe, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ediraa";
import { PageShell } from "@/components/page-shell";
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
import { userMessage } from "@/lib/security";

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [
      { title: "Create Post — SabZone" },
      {
        name: "description",
        content: "Share an update with your SabZone network.",
      },
      { property: "og:title", content: "Create Post — SabZone" },
      {
        property: "og:description",
        content: "Share an update with your SabZone network.",
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
      toast.error(userMessage(error, "Couldn't publish your post. Please try again.")),
  });

  const used = text.length;
  const nearLimit = used > MAX * 0.9;
  const C = 2 * Math.PI * 9;
  const myName = profile?.full_name || profile?.username || "";

  return (
    <PageShell>
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate({ to: "/home" })}
          aria-label="Back"
          className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card/70 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <h1 className="text-2xl font-extrabold">Create Post</h1>
      </header>
      <section className="glass-card space-y-4 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <Avatar src={profile?.avatar_url} name={myName} size={44} />
          <div className="min-w-0">
            <p className="truncate font-display text-[0.95rem] font-bold leading-tight">{myName}</p>
            <p className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-semibold text-primary">
              {audience}
            </p>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-elevated/40 transition-colors focus-within:border-primary/70">
          <textarea
            ref={textInput}
            value={text}
            onChange={(event) => setText(event.currentTarget.value.slice(0, MAX))}
            placeholder="What's on your mind?"
            rows={5}
            aria-label="Post text"
            className="w-full resize-none rounded-2xl bg-transparent p-4 text-[0.95rem] leading-relaxed outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-end gap-2 px-4 pb-3">
            <svg viewBox="0 0 24 24" className="h-5 w-5 -rotate-90" aria-hidden="true">
              <circle cx="12" cy="12" r="9" fill="none" strokeWidth="3" className="stroke-border" />
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={C * (1 - used / MAX)}
                className={nearLimit ? "stroke-warning" : "stroke-primary"}
              />
            </svg>
            <p
              className={`text-xs tabular-nums ${nearLimit ? "text-warning" : "text-muted-foreground"}`}
            >
              {text.length}/{MAX}
            </p>
          </div>
        </div>
        <ComposerLauncher variant="media" extras={extras} onExtrasChange={setExtras} />
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
      <section className="glass-card p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-bold">Post to</h2>
        <div className="grid grid-cols-3 gap-2">
          {audiences.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => setAudience(label)}
              aria-pressed={audience === label}
              className={`flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl border px-2 text-center text-xs font-semibold transition-colors sm:text-sm ${
                audience === label
                  ? "border-primary/60 bg-primary/12 text-primary shadow-[0_8px_24px_-14px_rgba(249,178,51,0.6)]"
                  : "border-border bg-elevated/40 text-muted-foreground hover:border-primary/30 hover:text-foreground"
              }`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </section>
      <button
        type="button"
        onClick={() => publish.mutate()}
        disabled={!text.trim() || !profile || publish.isPending}
        className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-gradient-brand py-3.5 text-[0.95rem] font-bold text-primary-foreground glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
      >
        {publish.isPending ? "Posting..." : "Post"}
      </button>
    </PageShell>
  );
}
