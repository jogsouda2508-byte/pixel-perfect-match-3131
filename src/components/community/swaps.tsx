import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  GraduationCap,
  Loader2,
  MapPin,
  MessageCircle,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  createSkillSwap,
  deleteSwap,
  fetchSkillSwaps,
  SKILL_SUGGESTIONS,
  SWAP_MODES,
  setSwapActive,
  skillsMatch,
  swapMatchText,
  swapModeLabel,
  type SkillSwap,
  type SwapMode,
} from "@/lib/community";
import { startConversation } from "@/lib/chat";
import { cn } from "@/lib/utils";
import {
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  Field,
  FormSheet,
  inputCls,
  PersonLine,
  PrimaryButton,
  SkeletonList,
} from "./shared";

export function SwapsTab({ locality, meId }: { locality: string | null; meId: string }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [sheet, setSheet] = useState(false);
  const q = useQuery({
    queryKey: ["community", "swaps", locality, query.trim().toLowerCase()],
    queryFn: () => fetchSkillSwaps({ locality, query }),
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["community", "swaps"] });

  const act = useMutation({
    mutationFn: (v: { id: string; action: "pause" | "resume" | "delete" }) =>
      v.action === "delete" ? deleteSwap(v.id) : setSwapActive(v.id, v.action === "resume"),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Something went wrong."),
  });

  const mine = q.data?.filter((s) => s.is_mine) ?? [];
  const others = q.data?.filter((s) => !s.is_mine) ?? [];
  const matches = others.filter((s) => s.match !== "none").length;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className={cn(inputCls, "pl-10")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a skill, like guitar"
            aria-label="Search skills"
          />
        </div>
        <PrimaryButton onClick={() => setSheet(true)} className="shrink-0 !px-4">
          <Plus className="h-4 w-4" /> Post
        </PrimaryButton>
      </div>

      {mine.some((s) => s.active) && matches > 0 && (
        <p className="flex items-center gap-2 rounded-2xl bg-primary/10 p-3 text-sm font-semibold text-primary">
          <Sparkles className="h-4 w-4" /> {matches} nearby{" "}
          {matches === 1 ? "person matches" : "people match"} your swap!
        </p>
      )}

      {q.isLoading ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : mine.length + others.length === 0 ? (
        <EmptyState
          icon={<ArrowLeftRight className="h-7 w-7" />}
          title={query ? "No skills found" : "No skill swaps yet"}
          text={
            query
              ? "Try another word, or post what you can teach."
              : "“I teach guitar, I want Hindi tuition.” Post yours and we'll match you with neighbours."
          }
          action={<PrimaryButton onClick={() => setSheet(true)}>Post a swap</PrimaryButton>}
        />
      ) : (
        <>
          {mine.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">Your swaps</h2>
              <ul className="space-y-3">
                {mine.map((s) => (
                  <li key={s.id}>
                    <SwapCard s={s} onAct={(action) => act.mutate({ id: s.id, action })} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {others.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">People nearby</h2>
              <ul className="space-y-3">
                {others.map((s) => (
                  <li key={s.id}>
                    <SwapCard s={s} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <SwapSheet
        open={sheet}
        onOpenChange={setSheet}
        locality={locality}
        meId={meId}
        onDone={refresh}
      />
    </div>
  );
}

function SwapCard({
  s,
  onAct,
}: {
  s: SkillSwap;
  onAct?: (a: "pause" | "resume" | "delete") => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const message = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const id = await startConversation(s.person.id);
      navigate({ to: "/chat/$id", params: { id } });
    } catch {
      toast.error("Couldn't open the chat. Please try again.");
      setBusy(false);
    }
  };
  const matchText = swapMatchText(s.match);
  return (
    <article
      className={cn(
        "glass-card space-y-3 p-4",
        !s.active && "opacity-60",
        s.match === "perfect" && "ring-2 ring-primary/60",
      )}
    >
      {matchText && (
        <p
          className={cn(
            "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold",
            s.match === "perfect"
              ? "bg-primary text-primary-foreground"
              : "bg-primary/10 text-primary",
          )}
        >
          <Sparkles className="h-3.5 w-3.5" /> {matchText}
        </p>
      )}
      {!s.is_mine && <PersonLine person={s.person} sub={s.locality} />}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-elevated p-3">
          <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-primary">
            <GraduationCap className="h-3.5 w-3.5" /> Teaches
          </p>
          <p className="mt-0.5 break-words font-semibold">{s.teach}</p>
        </div>
        <div className="rounded-xl bg-elevated p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-primary">
            Wants to learn
          </p>
          <p className="mt-0.5 break-words font-semibold">{s.want}</p>
        </div>
      </div>
      {s.note && <p className="text-sm text-foreground/90">{s.note}</p>}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-full bg-muted px-2 py-1 font-medium">{swapModeLabel(s.mode)}</span>
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          {s.locality}
        </span>
        {s.is_mine && !s.active && <span className="font-semibold">Paused</span>}
      </div>
      {s.is_mine ? (
        <div className="flex items-center gap-2 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => onAct?.(s.active ? "pause" : "resume")}
            className="min-h-10 rounded-full border border-border bg-card px-4 text-sm font-semibold active:scale-95"
          >
            {s.active ? "Pause" : "Show again"}
          </button>
          <button
            type="button"
            onClick={() => onAct?.("delete")}
            className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-destructive"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>
      ) : (
        <PrimaryButton onClick={() => void message()} busy={busy} className="w-full">
          {!busy && <MessageCircle className="h-4 w-4" />} Say hi
        </PrimaryButton>
      )}
    </article>
  );
}

function SwapSheet({
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
  onDone: () => void;
}) {
  const [teach, setTeach] = useState("");
  const [want, setWant] = useState("");
  const [mode, setMode] = useState<SwapMode>("either");
  const [note, setNote] = useState("");
  const [area, setArea] = useState("");
  const [tried, setTried] = useState(false);
  const place = area || locality || "";
  const same = skillsMatch(teach, want);
  const eT = teach.trim().length < 2 ? "What can you teach?" : undefined;
  const eW =
    want.trim().length < 2
      ? "What do you want to learn?"
      : same
        ? "Pick something different from what you teach"
        : undefined;
  const eA = place.trim().length < 2 ? "Add the area, like Whitefield" : undefined;

  const m = useMutation({
    mutationFn: () => createSkillSwap(meId, { teach, want, mode, note, locality: place }),
    onSuccess: () => {
      toast.success("Posted! We'll show you people who match.");
      setTeach("");
      setWant("");
      setNote("");
      setArea("");
      setMode("either");
      setTried(false);
      onDone();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't post your skill swap."),
  });
  const submit = () => {
    setTried(true);
    if (eT || eW || eA) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    m.mutate();
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Post a skill swap"
      description="Teach something, learn something. Neighbours nearby get matched."
      submitLabel="Post swap"
      busy={m.isPending}
      onSubmit={submit}
    >
      <Field label="I can teach" error={tried ? eT : undefined}>
        <input
          className={inputCls}
          value={teach}
          maxLength={40}
          onChange={(e) => setTeach(e.target.value)}
          placeholder="Guitar"
        />
      </Field>
      <Suggest onPick={setTeach} />
      <Field label="I want to learn" error={tried ? eW : undefined}>
        <input
          className={inputCls}
          value={want}
          maxLength={40}
          onChange={(e) => setWant(e.target.value)}
          placeholder="Hindi tuition"
        />
      </Field>
      <Suggest onPick={setWant} />
      <div>
        <p className="mb-1.5 text-sm font-semibold">How?</p>
        <ChipRow>
          {SWAP_MODES.map((x) => (
            <Chip key={x.mode} active={mode === x.mode} onClick={() => setMode(x.mode)}>
              {x.label}
            </Chip>
          ))}
        </ChipRow>
      </div>
      <Field label="Area" error={tried ? eA : undefined}>
        <input
          className={inputCls}
          value={place}
          maxLength={60}
          onChange={(e) => setArea(e.target.value)}
          placeholder="Whitefield"
        />
      </Field>
      <Field label="A short note (optional)">
        <textarea
          className={cn(inputCls, "min-h-20 resize-none")}
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Weekends are best for me"
        />
      </Field>
      {m.isPending && <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />}
    </FormSheet>
  );
}

function Suggest({ onPick }: { onPick: (v: string) => void }) {
  return (
    <ChipRow>
      {SKILL_SUGGESTIONS.slice(0, 10).map((s) => (
        <Chip key={s} tone="plain" onClick={() => onPick(s)}>
          {s}
        </Chip>
      ))}
    </ChipRow>
  );
}
