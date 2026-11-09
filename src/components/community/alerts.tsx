import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BellRing,
  Check,
  Droplets,
  HelpCircle,
  Megaphone,
  Plus,
  ShieldAlert,
  Trash2,
  TrafficCone,
  X,
  Zap,
} from "lucide-react";
import type { ComponentType } from "react";
import {
  ALERT_KINDS,
  alertExpiryText,
  alertKindLabel,
  alertStatusText,
  createAlert,
  deleteAlert,
  fetchAlerts,
  resolveAlert,
  voteAlert,
  type AlertKind,
  type CommunityAlert,
} from "@/lib/community";
import { alertShareText } from "@/lib/community-share";
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
  PrimaryButton,
  SkeletonList,
  useNow,
} from "./shared";
import { communityLink, WhatsAppShare } from "./share-button";

const ICONS: Record<AlertKind, ComponentType<{ className?: string }>> = {
  power: Zap,
  water: Droplets,
  road: TrafficCone,
  safety: ShieldAlert,
  other: Megaphone,
};

export function AlertsTab({ locality, meId }: { locality: string | null; meId: string }) {
  const qc = useQueryClient();
  const now = useNow();
  const [sheet, setSheet] = useState(false);
  const q = useQuery({
    queryKey: ["community", "alerts", locality],
    queryFn: () => fetchAlerts(locality),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["community", "alerts"] });

  const vote = useMutation({
    mutationFn: (v: { id: string; vote: "confirm" | "dispute" | null }) => voteAlert(v.id, v.vote),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["community", "alerts"] });
      const snap = qc.getQueriesData<CommunityAlert[]>({ queryKey: ["community", "alerts"] });
      qc.setQueriesData<CommunityAlert[]>({ queryKey: ["community", "alerts"] }, (old) =>
        old?.map((a) => {
          if (a.id !== v.id) return a;
          const c =
            a.confirm_count + (v.vote === "confirm" ? 1 : 0) - (a.my_vote === "confirm" ? 1 : 0);
          const d =
            a.dispute_count + (v.vote === "dispute" ? 1 : 0) - (a.my_vote === "dispute" ? 1 : 0);
          const status =
            a.status === "resolved"
              ? a.status
              : c >= 2 && c > d
                ? "confirmed"
                : d >= 2 && d >= c
                  ? "disputed"
                  : "unconfirmed";
          return { ...a, my_vote: v.vote, confirm_count: c, dispute_count: d, status };
        }),
      );
      return { snap };
    },
    onError: (e, _v, ctx) => {
      ctx?.snap.forEach(([k, d]) => qc.setQueryData(k, d));
      toast.error(e instanceof Error ? e.message : "Couldn't save your vote.");
    },
    onSettled: refresh,
  });

  const act = useMutation({
    mutationFn: (v: { id: string; action: "resolve" | "delete" }) =>
      v.action === "resolve" ? resolveAlert(v.id) : deleteAlert(v.id),
    onSuccess: (_d, v) => {
      toast.success(
        v.action === "resolve" ? "Marked as fixed. Thanks for the update!" : "Alert removed",
      );
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Something went wrong."),
  });

  const active = q.data?.filter((a) => a.status !== "resolved") ?? [];
  const done = q.data?.filter((a) => a.status === "resolved") ?? [];

  return (
    <div className="space-y-4">
      <div className="glass-card flex items-center gap-3 p-3.5">
        <span className="grid h-11 w-11 max-md:h-9 max-md:w-9 shrink-0 place-items-center rounded-full bg-elevated text-primary">
          <BellRing className="h-5 w-5 max-md:h-4 max-md:w-4" />
        </span>
        <p className="min-w-0 flex-1 text-sm max-md:text-xs text-muted-foreground">
          See something? Tell your neighbours.{" "}
          <span className="text-foreground">Others confirm it</span>, so alerts stay honest.
        </p>
        <PrimaryButton onClick={() => setSheet(true)} className="shrink-0 !px-4">
          <Plus className="h-4 w-4 max-md:h-3.5 max-md:w-3.5" /> Report
        </PrimaryButton>
      </div>

      {q.isLoading ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : active.length + done.length === 0 ? (
        <EmptyState
          icon={<Check className="h-7 w-7" />}
          title="All quiet right now"
          text="No power cuts, water problems or road blocks reported. If something happens, be the first to let people know."
          action={<PrimaryButton onClick={() => setSheet(true)}>Report an alert</PrimaryButton>}
        />
      ) : (
        <>
          <ul className="space-y-3">
            {active.map((a) => (
              <li key={a.id}>
                <AlertCard
                  a={a}
                  now={now}
                  onVote={(v) => vote.mutate({ id: a.id, vote: v })}
                  onAct={(action) => act.mutate({ id: a.id, action })}
                />
              </li>
            ))}
          </ul>
          {done.length > 0 && (
            <>
              <h2 className="pt-1 text-sm max-md:text-xs font-semibold text-muted-foreground">
                Recently fixed
              </h2>
              <ul className="space-y-3">
                {done.map((a) => (
                  <li key={a.id}>
                    <AlertCard
                      a={a}
                      now={now}
                      onVote={() => {}}
                      onAct={(action) => act.mutate({ id: a.id, action })}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <AlertSheet
        open={sheet}
        onOpenChange={setSheet}
        locality={locality}
        meId={meId}
        onDone={refresh}
      />
    </div>
  );
}

const STATUS_STYLE = {
  confirmed: "bg-success/15 text-success",
  unconfirmed: "bg-muted text-muted-foreground",
  disputed: "bg-destructive/15 text-destructive",
  resolved: "bg-primary/15 text-primary",
} as const;

function AlertCard({
  a,
  now,
  onVote,
  onAct,
}: {
  a: CommunityAlert;
  now: Date;
  onVote: (v: "confirm" | "dispute" | null) => void;
  onAct: (a: "resolve" | "delete") => void;
}) {
  const Icon = ICONS[a.kind] ?? Megaphone;
  const resolved = a.status === "resolved";
  return (
    <article className={cn("glass-card space-y-3 p-4", resolved && "opacity-75")}>
      <div className="flex gap-3">
        <span className="grid h-11 w-11 max-md:h-9 max-md:w-9 shrink-0 place-items-center rounded-2xl bg-elevated text-primary">
          <Icon className="h-5 w-5 max-md:h-4 max-md:w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs max-md:text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {alertKindLabel(a.kind)} · {a.locality}
          </p>
          <h3 className="text-base max-md:text-sm font-bold leading-snug">{a.title}</h3>
          {a.details && (
            <p className="mt-0.5 text-sm max-md:text-xs text-foreground/90">{a.details}</p>
          )}
          <p className="mt-1 text-xs max-md:text-[11px] text-muted-foreground">
            {timeAgo(a.created_at)} · by {a.is_mine ? "you" : (a.author?.name ?? "a neighbour")}
            {!resolved && ` · ${alertExpiryText(a.expires_at, now)}`}
          </p>
        </div>
      </div>
      <p
        className={cn(
          "rounded-xl px-3 py-2 text-sm max-md:text-xs font-semibold",
          STATUS_STYLE[a.status],
        )}
      >
        {alertStatusText(a)}
      </p>

      {!resolved && !a.is_mine && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onVote(a.my_vote === "confirm" ? null : "confirm")}
            aria-pressed={a.my_vote === "confirm"}
            className={cn(
              "inline-flex min-h-11 max-md:min-h-9 flex-1 items-center justify-center gap-1.5 rounded-full border text-sm max-md:text-xs font-semibold transition active:scale-95",
              a.my_vote === "confirm"
                ? "border-success bg-success text-success-foreground"
                : "border-border bg-card",
            )}
          >
            <Check className="h-4 w-4 max-md:h-3.5 max-md:w-3.5" /> Yes, it's true
          </button>
          <button
            type="button"
            onClick={() => onVote(a.my_vote === "dispute" ? null : "dispute")}
            aria-pressed={a.my_vote === "dispute"}
            className={cn(
              "inline-flex min-h-11 max-md:min-h-9 flex-1 items-center justify-center gap-1.5 rounded-full border text-sm max-md:text-xs font-semibold transition active:scale-95",
              a.my_vote === "dispute"
                ? "border-destructive bg-destructive text-destructive-foreground"
                : "border-border bg-card",
            )}
          >
            <X className="h-4 w-4 max-md:h-3.5 max-md:w-3.5" /> Not true
          </button>
        </div>
      )}
      {!resolved && (
        <WhatsAppShare
          className="w-full"
          text={alertShareText(a, alertStatusText(a), communityLink("alerts"))}
        />
      )}
      {a.is_mine && (
        <div className="flex items-center gap-2 border-t border-border pt-3">
          {!resolved && (
            <button
              type="button"
              onClick={() => onAct("resolve")}
              className="inline-flex min-h-10 max-md:min-h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm max-md:text-xs font-semibold text-primary-foreground active:scale-95"
            >
              <Check className="h-4 w-4 max-md:h-3.5 max-md:w-3.5" /> It's fixed
            </button>
          )}
          <button
            type="button"
            onClick={() => onAct("delete")}
            className="ml-auto inline-flex min-h-10 max-md:min-h-9 items-center gap-1.5 rounded-full px-3 text-sm max-md:text-xs font-semibold text-destructive"
          >
            <Trash2 className="h-4 w-4 max-md:h-3.5 max-md:w-3.5" /> Remove
          </button>
        </div>
      )}
    </article>
  );
}

function AlertSheet({
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
  const [kind, setKind] = useState<AlertKind>("power");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [area, setArea] = useState("");
  const [tried, setTried] = useState(false);
  const place = area || locality || "";
  const tErr = title.trim().length < 3 ? "Say what is happening (at least 3 letters)" : undefined;
  const aErr = place.trim().length < 2 ? "Add the area, like Whitefield" : undefined;

  const m = useMutation({
    mutationFn: () => createAlert(meId, { kind, title, details, locality: place }),
    onSuccess: () => {
      toast.success("Alert posted. Neighbours can confirm it.");
      setTitle("");
      setDetails("");
      setArea("");
      setTried(false);
      onDone();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't post the alert."),
  });

  const submit = () => {
    setTried(true);
    if (tErr || aErr) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    m.mutate();
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Report an alert"
      description="It shows for 12 hours, or until you mark it fixed."
      submitLabel="Post alert"
      busy={m.isPending}
      onSubmit={submit}
    >
      <div>
        <p className="mb-1.5 text-sm max-md:text-xs font-semibold">What kind?</p>
        <ChipRow>
          {ALERT_KINDS.map((k) => {
            const Icon = ICONS[k.kind];
            return (
              <Chip
                key={k.kind}
                active={kind === k.kind}
                onClick={() => {
                  setKind(k.kind);
                  if (!title.trim()) setTitle(k.example);
                }}
              >
                <Icon className="h-4 w-4 max-md:h-3.5 max-md:w-3.5" /> {k.label}
              </Chip>
            );
          })}
        </ChipRow>
      </div>
      <Field label="What's happening?" error={tried ? tErr : undefined}>
        <input
          className={inputCls}
          value={title}
          maxLength={80}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Power cut since 6 PM"
        />
      </Field>
      <Field label="More details (optional)">
        <textarea
          className={cn(inputCls, "min-h-20 resize-none")}
          value={details}
          maxLength={300}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Which streets? Any idea when it will be fixed?"
        />
      </Field>
      <Field label="Area" error={tried ? aErr : undefined}>
        <input
          className={inputCls}
          value={place}
          maxLength={60}
          onChange={(e) => setArea(e.target.value)}
          placeholder="Whitefield"
        />
      </Field>
      <p className="flex items-start gap-2 rounded-xl bg-elevated p-3 text-xs max-md:text-[11px] text-muted-foreground">
        <HelpCircle className="mt-0.5 h-4 w-4 max-md:h-3.5 max-md:w-3.5 shrink-0 text-primary" />{" "}
        Only post what you have seen yourself. Neighbours vote “true” or “not true”, and wrong
        alerts get flagged.
      </p>
    </FormSheet>
  );
}
