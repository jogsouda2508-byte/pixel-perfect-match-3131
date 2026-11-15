import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarCheck, Check, Plus, Tag, Trash2, X } from "lucide-react";
import { Avatar } from "@/components/ediraa";
import {
  Chip,
  ChipRow,
  Field,
  FormSheet,
  GhostButton,
  inputCls,
  PrimaryButton,
} from "@/components/community/shared";
import {
  bookingStatusLabel,
  bookingWhen,
  cancelBooking,
  createBooking,
  createOffer,
  deleteOffer,
  istDate,
  OFFER_DURATIONS,
  offerEndsText,
  respondToBooking,
  useMyBookings,
  useOffers,
  validateBooking,
  validateOffer,
  type Booking,
  type OfferDuration,
} from "@/lib/bookings";
import { cn } from "@/lib/utils";

const STATUS_STYLE = {
  pending: "bg-muted text-muted-foreground",
  accepted: "bg-success/15 text-success",
  declined: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
} as const;

// ------------------------------------------------------------------ offers
/** Running offers on a business page. The owner can add and remove them; visitors just see them. */
export function BusinessOffers({ businessId, isMe }: { businessId: string; isMe: boolean }) {
  const qc = useQueryClient();
  const offers = useOffers(businessId);
  const [sheet, setSheet] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["business-offers", businessId] });

  const remove = useMutation({
    mutationFn: (id: string) => deleteOffer(id),
    onSuccess: () => {
      toast.success("Offer removed");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't remove the offer."),
  });

  const list = offers.data ?? [];
  if (!isMe && list.length === 0) return null;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold">Offers</h3>
        {isMe && (
          <button
            type="button"
            onClick={() => setSheet(true)}
            className="inline-flex min-h-9 items-center gap-1 rounded-full border border-primary px-3 text-xs font-semibold text-primary"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add offer
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Post a deal and your followers get a notification.
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((o) => (
            <li
              key={o.id}
              className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3"
            >
              <Tag className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold">
                  <span className="break-words">{o.title}</span>
                  {o.badge && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
                      {o.badge}
                    </span>
                  )}
                </p>
                {o.details && (
                  <p className="break-words text-xs text-muted-foreground">{o.details}</p>
                )}
                <p className="mt-0.5 text-xs font-medium text-primary">
                  {offerEndsText(o.valid_until)}
                </p>
              </div>
              {isMe && (
                <button
                  type="button"
                  aria-label={`Remove offer ${o.title}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(o.id)}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-destructive disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {isMe && (
        <OfferSheet open={sheet} onOpenChange={setSheet} businessId={businessId} onDone={refresh} />
      )}
    </div>
  );
}

function OfferSheet({
  open,
  onOpenChange,
  businessId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  businessId: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [badge, setBadge] = useState("");
  const [details, setDetails] = useState("");
  const [duration, setDuration] = useState<OfferDuration>("7d");
  const [tried, setTried] = useState(false);
  const errors = validateOffer({ title, details, badge });

  const m = useMutation({
    mutationFn: () => createOffer(businessId, { title, details, badge, duration }),
    onSuccess: () => {
      toast.success("Offer posted. Your followers will be told.");
      setTitle("");
      setBadge("");
      setDetails("");
      setTried(false);
      onDone();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't post the offer."),
  });

  const submit = () => {
    setTried(true);
    if (Object.keys(errors).length > 0) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    m.mutate();
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New offer"
      description="Your followers get a notification."
      submitLabel="Post offer"
      busy={m.isPending}
      onSubmit={submit}
    >
      <Field label="What's the offer?" error={tried ? errors.title : undefined}>
        <input
          className={inputCls}
          value={title}
          maxLength={60}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Diwali haircut special"
        />
      </Field>
      <Field
        label="Tag (optional)"
        error={tried ? errors.badge : undefined}
        hint="A short label on the offer, like 20% OFF or FREE."
      >
        <input
          className={inputCls}
          value={badge}
          maxLength={16}
          onChange={(e) => setBadge(e.target.value)}
          placeholder="20% OFF"
        />
      </Field>
      <Field label="Details (optional)">
        <textarea
          className={cn(inputCls, "min-h-20 resize-none")}
          value={details}
          maxLength={200}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="What is included, any conditions"
        />
      </Field>
      <div>
        <p className="mb-1.5 text-sm max-md:text-xs font-semibold">How long does it run?</p>
        <ChipRow>
          {OFFER_DURATIONS.map((d) => (
            <Chip key={d.key} active={duration === d.key} onClick={() => setDuration(d.key)}>
              {d.label}
            </Chip>
          ))}
        </ChipRow>
      </div>
    </FormSheet>
  );
}

// ---------------------------------------------------------------- booking
/** The "Book a visit" button on someone else's business page, and the form it opens. */
export function BookButton({
  businessId,
  businessName,
  services,
}: {
  businessId: string;
  businessName: string;
  services: string[];
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [service, setService] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const errors = validateBooking({ date, time, note });

  const m = useMutation({
    mutationFn: () => createBooking({ businessId, service, date, time, note }),
    onSuccess: () => {
      toast.success(`Request sent to ${businessName}. You'll be told when they reply.`);
      setService("");
      setDate("");
      setTime("");
      setNote("");
      setTried(false);
      void qc.invalidateQueries({ queryKey: ["my-bookings"] });
      setOpen(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't send your request."),
  });

  const submit = () => {
    setTried(true);
    if (Object.keys(errors).length > 0) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    m.mutate();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-primary text-sm font-semibold text-primary active:scale-[0.98]"
      >
        <CalendarCheck className="h-4 w-4" aria-hidden="true" /> Book a visit
      </button>
      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title="Book a visit"
        description={`${businessName} will confirm or suggest another time.`}
        submitLabel="Send request"
        busy={m.isPending}
        onSubmit={submit}
      >
        {services.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm max-md:text-xs font-semibold">What do you need?</p>
            <ChipRow>
              {services.slice(0, 12).map((s) => (
                <Chip
                  key={s}
                  active={service === s}
                  onClick={() => setService(service === s ? "" : s)}
                >
                  {s}
                </Chip>
              ))}
            </ChipRow>
          </div>
        )}
        {services.length === 0 && (
          <Field label="What do you need? (optional)">
            <input
              className={inputCls}
              value={service}
              maxLength={60}
              onChange={(e) => setService(e.target.value)}
              placeholder="Haircut"
            />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Day" error={tried ? errors.date : undefined}>
            <input
              type="date"
              className={inputCls}
              value={date}
              min={istDate()}
              max={istDate(new Date(), 90)}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Time" error={tried ? errors.time : undefined}>
            <input
              type="time"
              className={inputCls}
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
        </div>
        {tried && errors.when && (
          <p role="alert" className="text-xs max-md:text-[11px] font-medium text-destructive">
            {errors.when}
          </p>
        )}
        <Field label="Note (optional)">
          <textarea
            className={cn(inputCls, "min-h-20 resize-none")}
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything they should know"
          />
        </Field>
      </FormSheet>
    </>
  );
}

// ----------------------------------------------------------------- inbox
/**
 * On the Business page: requests people sent to my business (answer them here) and the visits I
 * asked other businesses for (cancel them here). Shows nothing when there is nothing to show.
 */
export function BookingsPanel({ isBusiness }: { isBusiness: boolean }) {
  const incoming = useMyBookings("business", isBusiness);
  const mine = useMyBookings("customer");
  const inList = incoming.data ?? [];
  const myList = mine.data ?? [];
  if (inList.length === 0 && myList.length === 0) return null;

  return (
    <section className="space-y-4" aria-label="Bookings">
      {isBusiness && inList.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-base font-bold">Booking requests</h2>
          <ul className="space-y-2">
            {inList.map((b) => (
              <li key={b.id}>
                <BookingCard b={b} role="business" />
              </li>
            ))}
          </ul>
        </div>
      )}
      {myList.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-base font-bold">My bookings</h2>
          <ul className="space-y-2">
            {myList.map((b) => (
              <li key={b.id}>
                <BookingCard b={b} role="customer" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function BookingCard({ b, role }: { b: Booking; role: "business" | "customer" }) {
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const refresh = () => void qc.invalidateQueries({ queryKey: ["my-bookings"] });

  const answer = useMutation({
    mutationFn: (accept: boolean) => respondToBooking(b.id, accept, reply),
    onSuccess: (_d, accept) => {
      toast.success(accept ? "Booking confirmed" : "Request declined");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save your answer."),
  });
  const cancel = useMutation({
    mutationFn: () => cancelBooking(b.id),
    onSuccess: () => {
      toast.success("Booking cancelled");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't cancel the booking."),
  });
  const busy = answer.isPending || cancel.isPending;
  const fading = b.status === "declined" || b.status === "cancelled";

  return (
    <article className={cn("glass-card space-y-3 p-4", fading && "opacity-70")}>
      <div className="flex items-start gap-3">
        <Avatar src={b.person.avatar_url} name={b.person.name} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{b.person.name}</p>
          <p className="text-sm">
            {bookingWhen(b.requested_at)}
            {b.service && <span className="text-muted-foreground"> · {b.service}</span>}
          </p>
          {b.note && <p className="mt-0.5 break-words text-xs text-muted-foreground">“{b.note}”</p>}
          {b.reply && (
            <p className="mt-0.5 break-words text-xs text-muted-foreground">Reply: {b.reply}</p>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
            STATUS_STYLE[b.status],
          )}
        >
          {bookingStatusLabel(b.status)}
        </span>
      </div>

      {role === "business" && b.status === "pending" && (
        <div className="space-y-2 border-t border-border pt-3">
          <input
            className={inputCls}
            value={reply}
            maxLength={200}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Add a reply (optional)"
            aria-label="Reply to the customer"
          />
          <div className="flex gap-2">
            <GhostButton className="flex-1" disabled={busy} onClick={() => answer.mutate(false)}>
              <X className="h-4 w-4" /> Decline
            </GhostButton>
            <PrimaryButton
              className="flex-1"
              busy={answer.isPending}
              disabled={busy}
              onClick={() => answer.mutate(true)}
            >
              <Check className="h-4 w-4" /> Accept
            </PrimaryButton>
          </div>
        </div>
      )}
      {role === "customer" && (b.status === "pending" || b.status === "accepted") && (
        <div className="border-t border-border pt-3">
          <GhostButton className="w-full" disabled={busy} onClick={() => cancel.mutate()}>
            Cancel booking
          </GhostButton>
        </div>
      )}
    </article>
  );
}
