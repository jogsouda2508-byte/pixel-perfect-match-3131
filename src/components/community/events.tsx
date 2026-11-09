import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  Check,
  MapPin,
  Plus,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import {
  cancelEvent,
  createEvent,
  deleteEvent,
  EVENT_CATEGORIES,
  eventBadge,
  eventStatus,
  eventToIcs,
  fetchEvents,
  formatEventWhen,
  istToday,
  setRsvp,
  spotsLeft,
  validateEventForm,
  type CommunityEvent,
  type EventForm,
  type EventScope,
  type RsvpStatus,
} from "@/lib/community";
import { eventShareText } from "@/lib/community-share";
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
  useNow,
} from "./shared";
import { communityLink, WhatsAppShare } from "./share-button";

const SCOPES: { key: EventScope; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "going", label: "My plans" },
  { key: "hosting", label: "Hosting" },
  { key: "past", label: "Past" },
];

const emptyForm = (locality: string): EventForm => ({
  title: "",
  category: "Community",
  date: "",
  start: "",
  end: "",
  venue: "",
  description: "",
  capacity: "",
  locality,
});

export function EventsTab({ locality, meId }: { locality: string | null; meId: string }) {
  const qc = useQueryClient();
  const now = useNow();
  const [scope, setScope] = useState<EventScope>("upcoming");
  const [category, setCategory] = useState("");
  const [sheet, setSheet] = useState(false);

  const key = ["community", "events", locality, scope, category] as const;
  const q = useQuery({
    queryKey: key,
    queryFn: () => fetchEvents({ locality, scope, category }),
    staleTime: 20_000,
  });

  const rsvp = useMutation({
    mutationFn: (v: { id: string; status: RsvpStatus | null }) => setRsvp(v.id, v.status),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["community", "events"] });
      const snap = qc.getQueriesData<CommunityEvent[]>({ queryKey: ["community", "events"] });
      qc.setQueriesData<CommunityEvent[]>({ queryKey: ["community", "events"] }, (old) =>
        old?.map((e) => {
          if (e.id !== v.id) return e;
          const was = e.my_status;
          return {
            ...e,
            my_status: v.status,
            going_count: e.going_count + (v.status === "going" ? 1 : 0) - (was === "going" ? 1 : 0),
            interested_count:
              e.interested_count +
              (v.status === "interested" ? 1 : 0) -
              (was === "interested" ? 1 : 0),
          };
        }),
      );
      return { snap };
    },
    onError: (err, _v, ctx) => {
      ctx?.snap.forEach(([k, d]) => qc.setQueryData(k, d));
      toast.error(err instanceof Error ? err.message : "Couldn't save your response.");
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["community", "events"] }),
    onSuccess: (_d, v) => {
      if (v.status === "going")
        toast.success("You're going! Tap the calendar icon to add a reminder.");
    },
  });

  const manage = useMutation({
    mutationFn: (v: { id: string; action: "cancel" | "delete" }) =>
      v.action === "cancel" ? cancelEvent(v.id) : deleteEvent(v.id),
    onSuccess: (_d, v) => {
      toast.success(v.action === "cancel" ? "Event cancelled" : "Event deleted");
      void qc.invalidateQueries({ queryKey: ["community", "events"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Something went wrong."),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <ChipRow className="mx-0 min-w-0 flex-1 px-0">
          {SCOPES.map((s) => (
            <Chip key={s.key} active={scope === s.key} onClick={() => setScope(s.key)}>
              {s.label}
            </Chip>
          ))}
        </ChipRow>
        <PrimaryButton onClick={() => setSheet(true)} className="w-9 shrink-0 !px-0 sm:w-auto sm:!px-4">
          <Plus className="h-4 w-4" /> <span className="sr-only sm:not-sr-only">Host</span>
        </PrimaryButton>
      </div>

      {scope === "upcoming" && (
        <ChipRow>
          <Chip tone="plain" active={category === ""} onClick={() => setCategory("")}>
            All
          </Chip>
          {EVENT_CATEGORIES.map((c) => (
            <Chip key={c} tone="plain" active={category === c} onClick={() => setCategory(c)}>
              {c}
            </Chip>
          ))}
        </ChipRow>
      )}

      {q.isLoading ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data && q.data.length > 0 ? (
        <ul className="space-y-3">
          {q.data.map((e) => (
            <li key={e.id}>
              <EventCard
                e={e}
                now={now}
                past={scope === "past"}
                onRsvp={(status) => rsvp.mutate({ id: e.id, status })}
                onManage={(action) => manage.mutate({ id: e.id, action })}
              />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<CalendarDays className="h-7 w-7" />}
          title={
            scope === "going"
              ? "No plans yet"
              : scope === "hosting"
                ? "You're not hosting anything"
                : "No events here yet"
          }
          text={
            scope === "going"
              ? "Tap Going or Interested on an event and it will show up here."
              : "A festival, a cricket match, a blood-donation camp: be the first to put something on the calendar."
          }
          action={<PrimaryButton onClick={() => setSheet(true)}>Host an event</PrimaryButton>}
        />
      )}

      <EventSheet open={sheet} onOpenChange={setSheet} locality={locality} meId={meId} />
    </div>
  );
}

function EventCard({
  e,
  now,
  past,
  onRsvp,
  onManage,
}: {
  e: CommunityEvent;
  now: Date;
  past: boolean;
  onRsvp: (s: RsvpStatus | null) => void;
  onManage: (a: "cancel" | "delete") => void;
}) {
  const badge = eventBadge(e.starts_at);
  const status = eventStatus(e, now);
  const left = spotsLeft(e);
  const full = left === 0 && e.my_status !== "going";
  const closed = past || status.state === "ended" || status.state === "cancelled";
  const [confirm, setConfirm] = useState<null | "cancel" | "delete">(null);

  const addToCalendar = () => {
    try {
      const blob = new Blob([eventToIcs(e)], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${e.title.replace(/[^\w]+/g, "-").slice(0, 40) || "event"}.ics`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.success("Calendar file ready. Open it to get reminders.");
    } catch {
      toast.error("Couldn't create the calendar file.");
    }
  };

  return (
    <article className={cn("glass-card space-y-3 p-4", e.cancelled && "opacity-70")}>
      <div className="flex gap-3">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-elevated text-center leading-none">
          <div>
            <p className="text-[10px] font-bold tracking-widest text-primary">{badge.month}</p>
            <p className="text-xl font-extrabold">{badge.day}</p>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] font-semibold text-primary">
              {e.category}
            </span>
            {status.text && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-bold",
                  status.state === "live" && "bg-success/15 text-success",
                  status.state === "soon" && "bg-primary/15 text-primary",
                  (status.state === "cancelled" || status.state === "ended") &&
                    "bg-muted text-muted-foreground",
                )}
              >
                {status.state === "live" && (
                  <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                )}
                {status.text}
              </span>
            )}
          </div>
          <h3
            className={cn("mt-1 text-base font-bold leading-snug", e.cancelled && "line-through")}
          >
            {e.title}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {formatEventWhen(e.starts_at, now)}
          </p>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{[e.venue, e.locality].filter(Boolean).join(", ")}</span>
          </p>
        </div>
      </div>

      {e.description && (
        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
          {e.description}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 text-sm">
        <PersonLine person={e.host} sub={e.host.is_business ? "Business host" : "Host"} size={28} />
        <p className="flex shrink-0 items-center gap-1 text-muted-foreground">
          <Users className="h-4 w-4" />
          <span className="font-semibold text-foreground">{e.going_count}</span> going
          {left !== null && (
            <span className={cn("ml-1", left === 0 ? "font-semibold text-destructive" : "")}>
              · {left === 0 ? "Full" : `${left} left`}
            </span>
          )}
        </p>
      </div>

      {!closed && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={full}
            onClick={() => onRsvp(e.my_status === "going" ? null : "going")}
            className={cn(
              "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full text-sm font-semibold transition active:scale-95 disabled:opacity-50",
              e.my_status === "going"
                ? "bg-success text-success-foreground"
                : "bg-primary text-primary-foreground",
            )}
          >
            {e.my_status === "going" ? (
              <>
                <Check className="h-4 w-4" /> Going
              </>
            ) : full ? (
              "Event full"
            ) : (
              "I'm going"
            )}
          </button>
          <button
            type="button"
            onClick={() => onRsvp(e.my_status === "interested" ? null : "interested")}
            aria-pressed={e.my_status === "interested"}
            className={cn(
              "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition active:scale-95",
              e.my_status === "interested"
                ? "border-primary bg-elevated text-primary"
                : "border-border bg-card",
            )}
          >
            <Star className={cn("h-4 w-4", e.my_status === "interested" && "fill-current")} />{" "}
            Interested
          </button>
          <button
            type="button"
            onClick={addToCalendar}
            aria-label="Add to calendar with reminders"
            className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card transition active:scale-95"
          >
            <CalendarPlus className="h-4 w-4" />
          </button>
        </div>
      )}

      {!closed && (
        <WhatsAppShare
          className="w-full"
          text={eventShareText(e, formatEventWhen(e.starts_at, now), communityLink("events"))}
        />
      )}

      {e.is_mine && !past && (
        <div className="flex items-center gap-2 border-t border-border pt-3">
          {confirm ? (
            <>
              <span className="flex-1 text-sm font-medium">
                {confirm === "cancel" ? "Cancel this event?" : "Delete this event for good?"}
              </span>
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="min-h-10 rounded-full px-3 text-sm font-semibold text-muted-foreground"
              >
                Keep
              </button>
              <button
                type="button"
                onClick={() => {
                  onManage(confirm);
                  setConfirm(null);
                }}
                className="min-h-10 rounded-full bg-destructive px-4 text-sm font-semibold text-destructive-foreground"
              >
                Yes
              </button>
            </>
          ) : (
            <>
              {!e.cancelled && !closed && (
                <button
                  type="button"
                  onClick={() => setConfirm("cancel")}
                  className="min-h-10 rounded-full px-3 text-sm font-semibold text-muted-foreground hover:text-foreground"
                >
                  Cancel event
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirm("delete")}
                className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-destructive"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function EventSheet({
  open,
  onOpenChange,
  locality,
  meId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  locality: string | null;
  meId: string;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState<EventForm>(() => emptyForm(locality ?? ""));
  const [tried, setTried] = useState(false);
  const errors = validateEventForm(f);
  const set = <K extends keyof EventForm>(k: K, v: EventForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const show = (k: keyof Omit<typeof errors, "count">) => (tried ? errors[k] : undefined);

  const m = useMutation({
    mutationFn: () => createEvent(meId, f),
    onSuccess: () => {
      toast.success("Event posted. Neighbours can RSVP now!");
      void qc.invalidateQueries({ queryKey: ["community", "events"] });
      setF(emptyForm(locality ?? ""));
      setTried(false);
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't create the event."),
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
      onOpenChange={(o) => {
        if (o) setF((p) => (p.locality ? p : { ...p, locality: locality ?? "" }));
        onOpenChange(o);
      }}
      title="Host an event"
      description="Festival, match, camp or meetup. Neighbours can RSVP."
      submitLabel="Post event"
      busy={m.isPending}
      onSubmit={submit}
    >
      <Field label="Event name" error={show("title")}>
        <input
          className={inputCls}
          value={f.title}
          maxLength={100}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Ganesh festival celebration"
        />
      </Field>
      <div>
        <p className="mb-1.5 text-sm font-semibold">Category</p>
        <ChipRow>
          {EVENT_CATEGORIES.map((c) => (
            <Chip key={c} active={f.category === c} onClick={() => set("category", c)}>
              {c}
            </Chip>
          ))}
        </ChipRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date (IST)" error={show("date")}>
          <input
            type="date"
            min={istToday()}
            className={inputCls}
            value={f.date}
            onChange={(e) => set("date", e.target.value)}
          />
        </Field>
        <Field label="Starts" error={show("start")}>
          <input
            type="time"
            className={inputCls}
            value={f.start}
            onChange={(e) => set("start", e.target.value)}
          />
        </Field>
      </div>
      <Field
        label="Ends (optional)"
        error={show("end")}
        hint="If you skip this, the event is shown for 3 hours."
      >
        <input
          type="time"
          className={inputCls}
          value={f.end}
          onChange={(e) => set("end", e.target.value)}
        />
      </Field>
      <Field label="Area" error={show("locality")}>
        <input
          className={inputCls}
          value={f.locality}
          maxLength={60}
          onChange={(e) => set("locality", e.target.value)}
          placeholder="Whitefield"
        />
      </Field>
      <Field label="Venue (optional)">
        <input
          className={inputCls}
          value={f.venue}
          maxLength={120}
          onChange={(e) => set("venue", e.target.value)}
          placeholder="Community hall, 2nd cross"
        />
      </Field>
      <Field label="Spots (optional)" error={show("capacity")} hint="Leave empty for no limit.">
        <input
          inputMode="numeric"
          className={inputCls}
          value={f.capacity}
          onChange={(e) => set("capacity", e.target.value.replace(/\D/g, ""))}
          placeholder="50"
        />
      </Field>
      <Field label="Details (optional)">
        <textarea
          className={cn(inputCls, "min-h-24 resize-none")}
          value={f.description}
          maxLength={1000}
          onChange={(e) => set("description", e.target.value)}
          placeholder="What should people know or bring?"
        />
      </Field>
      <p className="flex items-center gap-2 rounded-xl bg-elevated p-3 text-xs text-muted-foreground">
        <CalendarCheck className="h-4 w-4 shrink-0 text-primary" /> Anyone who taps “I'm going” can
        add a calendar reminder (1 day and 1 hour before).
      </p>
    </FormSheet>
  );
}
