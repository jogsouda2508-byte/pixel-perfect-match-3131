import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  MessageCircleQuestion,
  MessagesSquare,
  Plus,
  Search,
  Send,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import {
  acceptAnswer,
  createAnswer,
  createQuestion,
  deleteAnswer,
  deleteQuestion,
  fetchQuestion,
  fetchQuestions,
  QUESTION_CATEGORIES,
  toggleHelpful,
  type CommunityAnswer,
  type CommunityQuestion,
  type QuestionFilter,
} from "@/lib/community";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  Field,
  FormSheet,
  inputCls,
  LocalBadge,
  PersonLine,
  PrimaryButton,
  SkeletonList,
} from "./shared";

const FILTERS: { key: QuestionFilter; label: string }[] = [
  { key: "new", label: "Newest" },
  { key: "unanswered", label: "Needs answers" },
  { key: "mine", label: "Mine" },
];

export function AskTab({ locality, meId }: { locality: string | null; meId: string }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<QuestionFilter>("new");
  const [query, setQuery] = useState("");
  const [sheet, setSheet] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["community", "questions", locality, filter, query.trim().toLowerCase()],
    queryFn: () => fetchQuestions({ locality, filter, query }),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["community", "questions"] });

  if (openId)
    return (
      <QuestionView
        id={openId}
        meId={meId}
        onBack={() => {
          setOpenId(null);
          refresh();
        }}
      />
    );

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className={cn(inputCls, "pl-10")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search questions"
            aria-label="Search questions"
          />
        </div>
        <PrimaryButton onClick={() => setSheet(true)} className="shrink-0 !px-4">
          <Plus className="h-4 w-4" /> Ask
        </PrimaryButton>
      </div>
      <ChipRow>
        {FILTERS.map((f) => (
          <Chip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </Chip>
        ))}
      </ChipRow>

      {q.isLoading ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data && q.data.length > 0 ? (
        <ul className="space-y-3">
          {q.data.map((x) => (
            <li key={x.id}>
              <QuestionRow q={x} onOpen={() => setOpenId(x.id)} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<MessageCircleQuestion className="h-7 w-7" />}
          title={query ? "No questions found" : "No questions yet"}
          text="“Which hospital is best for kids here?” Ask people who actually live in your area. Local answers get a badge."
          action={<PrimaryButton onClick={() => setSheet(true)}>Ask a question</PrimaryButton>}
        />
      )}
      <AskSheet
        open={sheet}
        onOpenChange={setSheet}
        locality={locality}
        meId={meId}
        onDone={(id) => {
          refresh();
          setOpenId(id);
        }}
      />
    </div>
  );
}

function QuestionRow({ q, onOpen }: { q: CommunityQuestion; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="glass-card block w-full space-y-2 p-4 text-left transition active:scale-[0.99]"
    >
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
        <span className="rounded-full bg-elevated px-2 py-0.5 text-primary">{q.category}</span>
        <span className="text-muted-foreground">
          {q.locality} · {timeAgo(q.created_at)}
        </span>
        {q.answered && (
          <span className="ml-auto inline-flex items-center gap-1 text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> Solved
          </span>
        )}
      </div>
      <h3 className="text-base font-bold leading-snug">{q.title}</h3>
      {q.body && <p className="line-clamp-2 text-sm text-muted-foreground">{q.body}</p>}
      <div className="flex items-center justify-between gap-2">
        <PersonLine person={q.author} size={24} />
        <p className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <MessagesSquare className="h-3.5 w-3.5" /> {q.answer_count}{" "}
          {q.answer_count === 1 ? "answer" : "answers"}
          {q.local_answer_count > 0 && <LocalBadge />}
        </p>
      </div>
    </button>
  );
}

function QuestionView({ id, meId, onBack }: { id: string; meId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const q = useQuery({
    queryKey: ["community", "question", id],
    queryFn: () => fetchQuestion(id),
    staleTime: 10_000,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["community", "question", id] });
    void qc.invalidateQueries({ queryKey: ["community", "questions"] });
  };
  const onErr = (e: unknown) =>
    toast.error(e instanceof Error ? e.message : "Something went wrong.");

  const post = useMutation({
    mutationFn: () => createAnswer(id, meId, text),
    onSuccess: () => {
      setText("");
      toast.success("Answer posted");
      refresh();
    },
    onError: onErr,
  });
  const helpful = useMutation({ mutationFn: toggleHelpful, onSuccess: refresh, onError: onErr });
  const accept = useMutation({
    mutationFn: (a: string | null) => acceptAnswer(id, a),
    onSuccess: refresh,
    onError: onErr,
  });
  const delAns = useMutation({
    mutationFn: deleteAnswer,
    onSuccess: () => {
      toast.success("Answer deleted");
      refresh();
    },
    onError: onErr,
  });
  const delQ = useMutation({
    mutationFn: () => deleteQuestion(id),
    onSuccess: () => {
      toast.success("Question deleted");
      onBack();
    },
    onError: onErr,
  });

  const d = q.data;
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-full pr-3 text-sm font-semibold text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All questions
      </button>
      {q.isLoading ? (
        <SkeletonList rows={2} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !d ? (
        <EmptyState
          icon={<MessageCircleQuestion className="h-7 w-7" />}
          title="Question not found"
          text="It may have been deleted."
          action={<PrimaryButton onClick={onBack}>Back</PrimaryButton>}
        />
      ) : (
        <>
          <article className="glass-card space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
              <span className="rounded-full bg-elevated px-2 py-0.5 text-primary">
                {d.category}
              </span>
              <span className="text-muted-foreground">
                {d.locality} · {timeAgo(d.created_at)}
              </span>
            </div>
            <h2 className="text-lg font-bold leading-snug">{d.title}</h2>
            {d.body && <p className="whitespace-pre-line text-sm leading-relaxed">{d.body}</p>}
            <div className="flex items-center justify-between">
              <PersonLine person={d.author} sub={d.is_mine ? "You asked" : "Asked"} />
              {d.is_mine && (
                <button
                  type="button"
                  onClick={() => delQ.mutate()}
                  aria-label="Delete question"
                  className="grid h-10 w-10 place-items-center rounded-full text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </article>

          <h3 className="text-sm font-semibold text-muted-foreground">
            {d.answers.length} {d.answers.length === 1 ? "answer" : "answers"} · locals first
          </h3>
          {d.answers.length === 0 && (
            <p className="glass-card p-4 text-center text-sm text-muted-foreground">
              No answers yet. If you know, help your neighbour out!
            </p>
          )}
          <ul className="space-y-3">
            {d.answers.map((a) => (
              <li key={a.id}>
                <AnswerCard
                  a={a}
                  asker={d.is_mine}
                  onHelpful={() => helpful.mutate(a.id)}
                  onAccept={() => accept.mutate(a.accepted ? null : a.id)}
                  onDelete={() => delAns.mutate(a.id)}
                />
              </li>
            ))}
          </ul>

          <form
            className="glass-card sticky bottom-20 space-y-2 p-3 sm:bottom-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim().length >= 2) post.mutate();
            }}
          >
            <textarea
              className={cn(inputCls, "min-h-20 resize-none")}
              value={text}
              maxLength={1000}
              onChange={(e) => setText(e.target.value)}
              placeholder="Share what you know about this area…"
              aria-label="Your answer"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{text.length}/1000</span>
              <PrimaryButton type="submit" busy={post.isPending} disabled={text.trim().length < 2}>
                <Send className="h-4 w-4" /> Answer
              </PrimaryButton>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

function AnswerCard({
  a,
  asker,
  onHelpful,
  onAccept,
  onDelete,
}: {
  a: CommunityAnswer;
  asker: boolean;
  onHelpful: () => void;
  onAccept: () => void;
  onDelete: () => void;
}) {
  return (
    <article className={cn("glass-card space-y-2 p-4", a.accepted && "ring-2 ring-success/60")}>
      {a.accepted && (
        <p className="flex items-center gap-1.5 text-xs font-bold text-success">
          <BadgeCheck className="h-4 w-4" /> Best answer, picked by the asker
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <PersonLine
          person={a.author}
          sub={timeAgo(a.created_at)}
          badge={a.is_local ? <LocalBadge /> : null}
        />
      </div>
      <p className="whitespace-pre-line text-[15px] leading-relaxed">{a.body}</p>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          disabled={a.is_mine}
          onClick={onHelpful}
          aria-pressed={a.my_helpful}
          className={cn(
            "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition active:scale-95 disabled:opacity-60",
            a.my_helpful ? "border-primary bg-elevated text-primary" : "border-border bg-card",
          )}
        >
          <ThumbsUp className={cn("h-4 w-4", a.my_helpful && "fill-current")} /> Helpful
          {a.helpful_count > 0 && ` · ${a.helpful_count}`}
        </button>
        {asker && !a.is_mine && (
          <button
            type="button"
            onClick={onAccept}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-success"
          >
            <CheckCircle2 className="h-4 w-4" /> {a.accepted ? "Unpick" : "Best answer"}
          </button>
        )}
        {a.is_mine && (
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-destructive"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        )}
      </div>
    </article>
  );
}

function AskSheet({
  open,
  onOpenChange,
  locality,
  meId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  locality: string | null;
  meId: string;
  onDone: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<string>("Other");
  const [area, setArea] = useState("");
  const [tried, setTried] = useState(false);
  const place = area || locality || "";
  const eT = title.trim().length < 5 ? "Write your question (at least 5 letters)" : undefined;
  const eA = place.trim().length < 2 ? "Add the area, so locals can answer" : undefined;
  const m = useMutation({
    mutationFn: () => createQuestion(meId, { title, body, category, locality: place }),
    onSuccess: (id) => {
      toast.success("Question posted");
      setTitle("");
      setBody("");
      setArea("");
      setTried(false);
      onOpenChange(false);
      onDone(id);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't post your question."),
  });
  const submit = () => {
    setTried(true);
    if (eT || eA) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    m.mutate();
  };
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Ask a local"
      description="People from the area answer, and locals get a badge."
      submitLabel="Post question"
      busy={m.isPending}
      onSubmit={submit}
    >
      <Field label="Your question" error={tried ? eT : undefined}>
        <input
          className={inputCls}
          value={title}
          maxLength={140}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Which hospital is best for kids here?"
        />
      </Field>
      <Field label="More details (optional)">
        <textarea
          className={cn(inputCls, "min-h-24 resize-none")}
          value={body}
          maxLength={1000}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Anything that helps people answer better"
        />
      </Field>
      <div>
        <p className="mb-1.5 text-sm font-semibold">Topic</p>
        <ChipRow>
          {QUESTION_CATEGORIES.map((c) => (
            <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
              {c}
            </Chip>
          ))}
        </ChipRow>
      </div>
      <Field
        label="Area"
        error={tried ? eA : undefined}
        hint="Answers from people who live here get a “Local” badge."
      >
        <input
          className={inputCls}
          value={place}
          maxLength={60}
          onChange={(e) => setArea(e.target.value)}
          placeholder="Whitefield"
        />
      </Field>
    </FormSheet>
  );
}
