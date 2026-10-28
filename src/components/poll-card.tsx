import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BarChart3, Check, Loader2 } from "lucide-react";
import { BottomSheet } from "@/components/bottom-sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  percentages,
  pollKey,
  POLL_OPTION_MAX,
  POLL_QUESTION_MAX,
  usePoll,
  votePoll,
  type Poll,
  type PollDraft,
} from "@/lib/polls";

type Variant = "post" | "story";

const styles = {
  post: {
    box: "rounded-2xl border border-border bg-primary/5 p-4 text-foreground",
    badge: "bg-primary/10 text-primary",
    muted: "text-muted-foreground",
    option: "border border-border bg-background",
    fill: "bg-muted",
    fillPicked: "bg-primary/20",
    ring: "focus-visible:ring-ring",
    check: "bg-primary text-primary-foreground",
  },
  story: {
    box: "rounded-2xl border border-white/25 bg-black/35 p-2.5 text-white shadow-lg backdrop-blur-[2px]",
    badge: "bg-white/15 text-white",
    muted: "text-white/70",
    option: "border border-white/25 bg-black/20",
    fill: "bg-white/15",
    fillPicked: "bg-white/40",
    ring: "focus-visible:ring-white",
    check: "bg-white text-black",
  },
} as const;

/**
 * A 2-option poll under a post or on top of a story. Results (live percentages) appear as soon as
 * you vote, and for the person who made the poll. Nobody can see who voted for what.
 */
export function PollCard({
  postId,
  storyId,
  variant = "post",
}: {
  postId?: string | undefined;
  storyId?: string | undefined;
  variant?: Variant;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { kind, id, query } = usePoll({ postId, storyId });
  const poll = query.data ?? null;
  const key: readonly unknown[] = pollKey(kind, id);
  const pollId = poll?.id;

  // live percentages: the database counts every vote and tells everyone watching the poll
  useEffect(() => {
    if (!pollId) return;
    const channel = supabase
      .channel(`poll:${pollId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "poll_options",
          filter: `poll_id=eq.${pollId}`,
        },
        (payload) => {
          const row = payload.new as { id: string; vote_count: number };
          qc.setQueryData<Poll | null>(key, (p) =>
            p
              ? {
                  ...p,
                  options: p.options.map((o) =>
                    o.id === row.id ? { ...o, votes: row.vote_count } : o,
                  ),
                }
              : p,
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollId]);

  const vote = useMutation({
    mutationFn: (optionId: string) => votePoll(pollId!, optionId, user!.id),
    onMutate: async (optionId) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<Poll | null>(key);
      if (before) {
        const next: Poll = {
          ...before,
          myVote: optionId,
          options: before.options.map((o) =>
            o.id === optionId ? { ...o, votes: o.votes + 1 } : o,
          ),
        };
        qc.setQueryData<Poll | null>(key, next);
      }
      return { before };
    },
    onError: (e: Error, _o, ctx) => {
      if (ctx) qc.setQueryData(key, ctx.before);
      toast.error(e.message || "Couldn't save your vote.");
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });

  if (!poll || poll.options.length < 2) return null;
  const s = styles[variant];
  const compact = variant === "story";
  const voted = poll.myVote !== null;
  const showResults = voted || poll.createdBy === user?.id;
  const pct = percentages(poll.options);
  const total = poll.options.reduce((n, o) => n + o.votes, 0);

  return (
    <section
      aria-label={`Poll: ${poll.question}`}
      className={`${s.box} ${variant === "post" ? "mt-3" : ""}`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`mt-0.5 grid shrink-0 place-items-center rounded-full ${compact ? "h-6 w-6" : "h-8 w-8"} ${s.badge}`}
        >
          <BarChart3 className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        </span>
        <p className={`min-w-0 flex-1 break-words font-bold leading-snug ${compact ? "text-sm" : "text-base"}`}>
          {poll.question}
        </p>
      </div>

      <div className={`space-y-1.5 ${compact ? "mt-2" : "mt-3 space-y-2"}`}>
        {poll.options.map((o, i) => {
          const picked = poll.myVote === o.id;
          return (
            <button
              key={o.id}
              type="button"
              disabled={voted || vote.isPending}
              aria-pressed={picked}
              aria-label={showResults ? `${o.label}, ${pct[i]}%` : o.label}
              onClick={() => vote.mutate(o.id)}
              className={`relative flex ${compact ? "min-h-9 text-[13px]" : "min-h-12 text-sm"} w-full items-center overflow-hidden rounded-xl text-left transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 ${s.ring} ${s.option} ${voted ? "cursor-default" : "hover:brightness-110"}`}
            >
              {showResults && (
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 transition-[width] duration-700 ease-out ${picked ? s.fillPicked : s.fill}`}
                  style={{ width: `${pct[i] ?? 0}%` }}
                />
              )}
              <span className="relative flex w-full items-center gap-2 px-3.5 py-2">
                {picked && (
                  <span
                    aria-hidden="true"
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${s.check}`}
                  >
                    <Check className="h-3 w-3" strokeWidth={3.5} />
                  </span>
                )}
                <span className="min-w-0 flex-1 break-words font-semibold">{o.label}</span>
                {showResults && <span className="shrink-0 font-bold tabular-nums">{pct[i]}%</span>}
              </span>
            </button>
          );
        })}
      </div>

      <p className={`flex items-center gap-1.5 ${compact ? "mt-1.5 text-[11px]" : "mt-3 text-xs"} ${s.muted}`}>
        {vote.isPending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
        {total} {total === 1 ? "vote" : "votes"}
        <span aria-hidden="true">•</span>
        {voted ? "You voted" : showResults ? "Live results" : "Tap to vote"}
      </p>
    </section>
  );
}

/**
 * Bottom sheet to write a 2-option poll. The buttons stay at the bottom. `onSubmit` may be async;
 * the sheet closes when it succeeds.
 */
export function PollSheet({
  open,
  onOpenChange,
  initial,
  submitLabel = "Add poll",
  onSubmit,
  z,
  compact = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: PollDraft | null | undefined;
  submitLabel?: string;
  onSubmit: (draft: PollDraft) => void | Promise<void>;
  z?: number | undefined;
  /** Smaller sheet and fonts on phones (used on the story poll). */
  compact?: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);

  // start from what was written before (or empty) every time the sheet opens
  useEffect(() => {
    if (!open) return;
    setQuestion(initial?.question ?? "");
    setA(initial?.options[0] ?? "");
    setB(initial?.options[1] ?? "");
  }, [open, initial]);

  const ready = question.trim() && a.trim() && b.trim();
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await onSubmit({ question: question.trim(), options: [a.trim(), b.trim()] });
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add the poll.");
    } finally {
      setBusy(false);
    }
  };

  const field =
    `w-full rounded-xl border border-border bg-elevated/40 px-3.5 py-3 text-base ${compact ? "max-md:rounded-lg max-md:px-3 max-md:py-2 max-md:text-sm" : ""} outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring`;
  const label = `mb-1.5 block text-sm font-semibold ${compact ? "max-md:mb-1 max-md:text-xs" : ""}`;

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      compact={compact}
      title="Create a poll"
      description="Ask a question with two answers. People see live results after they vote."
      {...(z !== undefined ? { z } : {})}
      footer={
        <>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={`min-h-12 flex-1 rounded-full border border-border bg-card text-sm font-semibold ${compact ? "max-md:min-h-10 max-md:text-xs" : ""} hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!ready || busy}
            className={`flex min-h-12 flex-[1.4] items-center justify-center gap-2 rounded-full bg-gradient-brand text-sm font-semibold ${compact ? "max-md:min-h-10 max-md:text-xs" : ""} text-primary-foreground glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {submitLabel}
          </button>
        </>
      }
    >
      <div className={compact ? "space-y-4 max-md:space-y-2.5" : "space-y-4"}>
        <div>
          <label htmlFor="poll-question" className={label}>
            Question
          </label>
          <input
            id="poll-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value.slice(0, POLL_QUESTION_MAX))}
            placeholder="Ask something…"
            maxLength={POLL_QUESTION_MAX}
            className={field}
          />
          <p className={`mt-1 text-right text-xs text-muted-foreground ${compact ? "max-md:mt-0.5 max-md:text-[11px]" : ""}`}>
            {question.length}/{POLL_QUESTION_MAX}
          </p>
        </div>
        {(
          [
            ["poll-a", "Option 1", a, setA, "Yes"],
            ["poll-b", "Option 2", b, setB, "No"],
          ] as const
        ).map(([id, label, value, set, hint]) => (
          <div key={id}>
            <label htmlFor={id} className={label}>
              {label}
            </label>
            <input
              id={id}
              value={value}
              onChange={(e) => set(e.target.value.slice(0, POLL_OPTION_MAX))}
              placeholder={hint}
              maxLength={POLL_OPTION_MAX}
              className={field}
            />
          </div>
        ))}
      </div>
    </BottomSheet>
  );
}
