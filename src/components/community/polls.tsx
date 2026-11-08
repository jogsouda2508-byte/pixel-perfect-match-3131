import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BarChart3, Check, Flame, Lightbulb, Plus, Trash2, X } from "lucide-react";
import {
  createPoll,
  dailyPrompt,
  deletePoll,
  fetchPollStreak,
  fetchPolls,
  pctOf,
  pollClosesText,
  validatePollForm,
  votePoll,
  type CommunityPoll,
  type PollForm,
  type PollScope,
} from "@/lib/community";
import { cn } from "@/lib/utils";
import {
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  Field,
  FormSheet,
  GhostButton,
  inputCls,
  PersonLine,
  PrimaryButton,
  SkeletonList,
  useNow,
} from "./shared";

const DURATIONS = [
  { h: 6, label: "6 hours" },
  { h: 24, label: "1 day" },
  { h: 72, label: "3 days" },
  { h: 168, label: "7 days" },
];
const SCOPES: { key: PollScope; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "closed", label: "Closed" },
  { key: "mine", label: "Mine" },
];

const blankForm = (locality: string | null): PollForm => ({
  kind: "poll",
  question: "",
  options: ["", ""],
  correct: 0,
  hours: 24,
  everyone: !locality,
  locality: locality ?? "",
});

export function PollsTab({ locality }: { locality: string | null }) {
  const qc = useQueryClient();
  const now = useNow(60_000);
  const [scope, setScope] = useState<PollScope>("open");
  const [sheet, setSheet] = useState(false);
  const [form, setForm] = useState<PollForm>(() => blankForm(locality));

  const q = useQuery({
    queryKey: ["community", "polls", locality, scope],
    queryFn: () => fetchPolls({ locality, scope }),
    staleTime: 15_000,
  });
  const streak = useQuery({
    queryKey: ["community", "streak"],
    queryFn: fetchPollStreak,
    staleTime: 30_000,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["community", "polls"] });
    void qc.invalidateQueries({ queryKey: ["community", "streak"] });
  };

  const vote = useMutation({
    mutationFn: (v: { poll: CommunityPoll; option: string }) => votePoll(v.poll.id, v.option),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["community", "polls"] });
      const snap = qc.getQueriesData<CommunityPoll[]>({ queryKey: ["community", "polls"] });
      qc.setQueriesData<CommunityPoll[]>({ queryKey: ["community", "polls"] }, (old) =>
        old?.map((p) =>
          p.id !== v.poll.id || p.my_vote
            ? p
            : {
                ...p,
                my_vote: v.option,
                total_votes: p.total_votes + 1,
                options: p.options.map((o) =>
                  o.id === v.option ? { ...o, votes: o.votes + 1 } : o,
                ),
              },
        ),
      );
      return { snap };
    },
    onError: (e, _v, ctx) => {
      ctx?.snap.forEach(([k, d]) => qc.setQueryData(k, d));
      toast.error(e instanceof Error ? e.message : "Couldn't save your vote.");
    },
    onSettled: refresh,
  });

  const del = useMutation({
    mutationFn: deletePoll,
    onSuccess: () => {
      toast.success("Poll deleted");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't delete the poll."),
  });

  const openSheet = (preset?: Partial<PollForm>) => {
    setForm({ ...blankForm(locality), ...preset });
    setSheet(true);
  };
  const daily = dailyPrompt(now, locality);
  const days = streak.data ?? 0;

  return (
    <div className="space-y-4">
      <section className="glass-card overflow-hidden">
        <div
          className="flex items-center gap-3 p-4"
          style={{ background: "var(--gradient-primary)" }}
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/20 text-white">
            <Lightbulb className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 text-white">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/80">
              Today's {daily.kind === "quiz" ? "quiz" : "question"}
            </p>
            <p className="font-bold leading-snug">{daily.question}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 p-3">
          <span
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-bold",
              days > 0 ? "bg-orange-500/15 text-orange-500" : "bg-muted text-muted-foreground",
            )}
          >
            <Flame className="h-4 w-4" /> {days > 0 ? `${days}-day streak` : "Start a streak"}
          </span>
          <PrimaryButton
            className="ml-auto !px-4"
            onClick={() =>
              openSheet({
                kind: daily.kind,
                question: daily.question,
                options: [...daily.options],
                correct: daily.correct,
              })
            }
          >
            Ask this
          </PrimaryButton>
        </div>
      </section>

      <div className="flex items-center justify-between gap-3">
        <ChipRow>
          {SCOPES.map((s) => (
            <Chip key={s.key} active={scope === s.key} onClick={() => setScope(s.key)}>
              {s.label}
            </Chip>
          ))}
        </ChipRow>
        <PrimaryButton onClick={() => openSheet()} className="shrink-0 !px-4">
          <Plus className="h-4 w-4" /> New
        </PrimaryButton>
      </div>

      {q.isLoading ? (
        <SkeletonList tall />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data && q.data.length > 0 ? (
        <ul className="space-y-3">
          {q.data.map((p) => (
            <li key={p.id}>
              <PollCard
                p={p}
                now={now}
                onVote={(option) => vote.mutate({ poll: p, option })}
                onDelete={() => del.mutate(p.id)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<BarChart3 className="h-7 w-7" />}
          title={
            scope === "open"
              ? "No open polls"
              : scope === "mine"
                ? "You haven't asked anything"
                : "Nothing closed yet"
          }
          text="Ask something fun like “Best dosa in your area?” People love to vote, and you'll see the results live."
          action={<PrimaryButton onClick={() => openSheet()}>Create a poll</PrimaryButton>}
        />
      )}

      <PollSheet
        open={sheet}
        onOpenChange={setSheet}
        form={form}
        setForm={setForm}
        locality={locality}
        onDone={refresh}
      />
    </div>
  );
}

function PollCard({
  p,
  now,
  onVote,
  onDelete,
}: {
  p: CommunityPoll;
  now: Date;
  onVote: (id: string) => void;
  onDelete: () => void;
}) {
  const closed = new Date(p.closes_at) <= now;
  const showResults = !!p.my_vote || closed || p.is_mine;
  const quiz = p.kind === "quiz";
  const gotIt = quiz && !!p.my_vote && p.my_vote === p.correct_option_id;
  const [confirm, setConfirm] = useState(false);
  return (
    <article className="glass-card space-y-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <PersonLine person={p.author} sub={p.locality ? p.locality : "Everyone"} size={28} />
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold",
            quiz ? "bg-violet/15 text-violet" : "bg-elevated text-primary",
          )}
        >
          {quiz ? "QUIZ" : "POLL"}
        </span>
      </div>
      <h3 className="text-base font-bold leading-snug">{p.question}</h3>
      <ul className="space-y-2">
        {p.options.map((o) => {
          const pct = pctOf(o.votes, p.total_votes);
          const mine = p.my_vote === o.id;
          const right = quiz && p.correct_option_id === o.id;
          const wrong = quiz && mine && !right && !!p.correct_option_id;
          return (
            <li key={o.id}>
              <button
                type="button"
                disabled={showResults || closed}
                onClick={() => onVote(o.id)}
                className={cn(
                  "relative flex min-h-12 w-full items-center gap-2 overflow-hidden rounded-xl border px-3.5 text-left text-[15px] font-medium transition",
                  !showResults && "active:scale-[0.98] hover:border-primary",
                  showResults ? "border-border" : "border-border bg-card",
                  right && showResults && "border-success",
                  wrong && "border-destructive",
                  mine && !quiz && "border-primary",
                )}
              >
                {showResults && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute inset-y-0 left-0 transition-[width] duration-700 ease-out",
                      right
                        ? "bg-success/20"
                        : wrong
                          ? "bg-destructive/20"
                          : mine
                            ? "bg-primary/25"
                            : "bg-muted",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                )}
                <span className="relative flex-1 break-words">{o.label}</span>
                {showResults && (
                  <span className="relative flex items-center gap-1.5 text-sm font-bold">
                    {right && <Check className="h-4 w-4 text-success" />}
                    {wrong && <X className="h-4 w-4 text-destructive" />}
                    {mine && !quiz && <Check className="h-4 w-4 text-primary" />}
                    {pct}%
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {quiz && p.my_vote && (
        <p
          className={cn(
            "rounded-xl px-3 py-2 text-sm font-semibold",
            gotIt ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive",
          )}
        >
          {gotIt ? "Correct! Nice one." : "Not quite. The right answer is highlighted."}
        </p>
      )}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {p.total_votes} {p.total_votes === 1 ? "vote" : "votes"} ·{" "}
          {pollClosesText(p.closes_at, now)}
        </span>
        {p.is_mine &&
          (confirm ? (
            <span className="flex items-center gap-2">
              <button type="button" onClick={() => setConfirm(false)} className="font-semibold">
                Keep
              </button>
              <button type="button" onClick={onDelete} className="font-bold text-destructive">
                Delete
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirm(true)}
              aria-label="Delete poll"
              className="grid h-9 w-9 place-items-center rounded-full text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ))}
      </div>
    </article>
  );
}

function PollSheet({
  open,
  onOpenChange,
  form,
  setForm,
  locality,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  form: PollForm;
  setForm: (f: PollForm) => void;
  locality: string | null;
  onDone: () => void;
}) {
  const [tried, setTried] = useState(false);
  const errors = validatePollForm(form);
  const set = (p: Partial<PollForm>) => setForm({ ...form, ...p });
  const setOpt = (i: number, v: string) =>
    set({ options: form.options.map((o, j) => (j === i ? v : o)) });
  const m = useMutation({
    mutationFn: () => createPoll(form),
    onSuccess: () => {
      toast.success(form.kind === "quiz" ? "Quiz posted!" : "Poll posted!");
      setTried(false);
      onDone();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't create the poll."),
  });
  const submit = () => {
    setTried(true);
    if (errors.count > 0) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    m.mutate();
  };
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={form.kind === "quiz" ? "New quiz" : "New poll"}
      description="Quick to answer, fun to watch."
      submitLabel="Post"
      busy={m.isPending}
      onSubmit={submit}
    >
      <ChipRow>
        <Chip active={form.kind === "poll"} onClick={() => set({ kind: "poll" })}>
          Poll: no right answer
        </Chip>
        <Chip active={form.kind === "quiz"} onClick={() => set({ kind: "quiz" })}>
          Quiz: one right answer
        </Chip>
      </ChipRow>
      <Field label="Question" error={tried ? errors.question : undefined}>
        <input
          className={inputCls}
          value={form.question}
          maxLength={100}
          onChange={(e) => set({ question: e.target.value })}
          placeholder="Best dosa in Whitefield?"
        />
      </Field>
      <div className="space-y-2">
        <p className="text-sm font-semibold">
          Options
          {form.kind === "quiz" && (
            <span className="font-normal text-muted-foreground">
              {" "}
              · tap the circle for the right answer
            </span>
          )}
        </p>
        {form.options.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            {form.kind === "quiz" && (
              <button
                type="button"
                onClick={() => set({ correct: i })}
                aria-label={`Option ${i + 1} is the right answer`}
                aria-pressed={form.correct === i}
                className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-full border-2",
                  form.correct === i
                    ? "border-success bg-success text-success-foreground"
                    : "border-border",
                )}
              >
                {form.correct === i && <Check className="h-4 w-4" />}
              </button>
            )}
            <input
              className={inputCls}
              value={o}
              maxLength={40}
              onChange={(e) => setOpt(i, e.target.value)}
              placeholder={`Option ${i + 1}`}
              aria-label={`Option ${i + 1}`}
            />
            {form.options.length > 2 && (
              <button
                type="button"
                aria-label="Remove option"
                onClick={() =>
                  set({
                    options: form.options.filter((_, j) => j !== i),
                    correct:
                      form.correct === i ? 0 : form.correct > i ? form.correct - 1 : form.correct,
                  })
                }
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        {tried && (errors.options || errors.correct) && (
          <p role="alert" className="text-xs font-medium text-destructive">
            {errors.options ?? errors.correct}
          </p>
        )}
        {form.options.length < 6 && (
          <GhostButton
            onClick={() => set({ options: [...form.options, ""] })}
            className="!min-h-10 !px-4"
          >
            <Plus className="h-4 w-4" /> Add option
          </GhostButton>
        )}
      </div>
      <div>
        <p className="mb-1.5 text-sm font-semibold">Open for</p>
        <ChipRow>
          {DURATIONS.map((d) => (
            <Chip key={d.h} active={form.hours === d.h} onClick={() => set({ hours: d.h })}>
              {d.label}
            </Chip>
          ))}
        </ChipRow>
      </div>
      <div>
        <p className="mb-1.5 text-sm font-semibold">Who can see it?</p>
        <ChipRow>
          <Chip
            active={!form.everyone}
            onClick={() => set({ everyone: false, locality: form.locality || locality || "" })}
          >
            My area
          </Chip>
          <Chip active={form.everyone} onClick={() => set({ everyone: true })}>
            Everyone
          </Chip>
        </ChipRow>
        {!form.everyone && (
          <div className="mt-2">
            <Field label="Area" error={tried ? errors.locality : undefined}>
              <input
                className={inputCls}
                value={form.locality}
                maxLength={60}
                onChange={(e) => set({ locality: e.target.value })}
                placeholder="Whitefield"
              />
            </Field>
          </div>
        )}
      </div>
    </FormSheet>
  );
}
