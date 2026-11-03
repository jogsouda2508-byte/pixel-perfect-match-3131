import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Star } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ediraa";
import {
  deleteBusinessReview,
  fetchBusinessReviews,
  replyToBusinessReview,
  saveBusinessReview,
  type BusinessPage,
  type BusinessReview,
} from "@/lib/business";
import { timeAgo } from "@/lib/time";

const MAX_TEXT = 500;
const RATING_WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

/** Read-only stars (supports halves for averages like 4.3 by rounding to the nearest half). */
export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  const rounded = Math.round(value * 2) / 2;
  return (
    <span
      className="inline-flex items-center gap-0.5"
      role="img"
      aria-label={`${value.toFixed(1)} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((i) => {
        const full = rounded >= i;
        const half = !full && rounded >= i - 0.5;
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <Star
              aria-hidden="true"
              className="absolute inset-0 text-border"
              style={{ width: size, height: size }}
            />
            {(full || half) && (
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: full ? "100%" : "50%" }}
              >
                <Star
                  aria-hidden="true"
                  className="fill-warning text-warning"
                  style={{ width: size, height: size }}
                />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/** Tap a star to choose 1-5. */
function StarPicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div role="radiogroup" aria-label="Your rating" className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            disabled={disabled}
            onClick={() => onChange(n)}
            className="grid h-11 w-10 place-items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <Star
              aria-hidden="true"
              className={`h-8 w-8 transition ${n <= value ? "fill-warning text-warning" : "text-muted-foreground/50"}`}
            />
          </button>
        ))}
        <span className="ml-2 text-sm font-medium text-muted-foreground" aria-live="polite">
          {RATING_WORDS[value] ?? ""}
        </span>
      </div>
    </div>
  );
}

function RatingSummary({ page }: { page: BusinessPage }) {
  const total = page.rating_count;
  return (
    <div className="flex items-center gap-5">
      <div className="text-center">
        <p className="text-4xl font-bold leading-none">{(page.rating_avg ?? 0).toFixed(1)}</p>
        <div className="mt-1.5 flex justify-center">
          <Stars value={page.rating_avg ?? 0} size={14} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {total} review{total === 1 ? "" : "s"}
        </p>
      </div>
      <ul className="min-w-0 flex-1 space-y-1" aria-label="Ratings breakdown">
        {[5, 4, 3, 2, 1].map((n) => {
          const count = Number(page.distribution[String(n)] ?? 0);
          return (
            <li key={n} className="flex items-center gap-2 text-xs">
              <span className="w-3 text-muted-foreground">{n}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                <span
                  className="block h-full rounded-full bg-warning"
                  style={{ width: total ? `${(count / total) * 100}%` : "0%" }}
                />
              </span>
              <span className="w-6 text-right text-muted-foreground">{count}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ReviewForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial?: { rating: number; body: string } | undefined;
  submitLabel: string;
  pending: boolean;
  onSubmit: (rating: number, body: string) => void;
  onCancel?: () => void;
}) {
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [body, setBody] = useState(initial?.body ?? "");
  const [touched, setTouched] = useState(false);
  const missing = touched && rating === 0;

  return (
    <div className="space-y-3">
      <StarPicker value={rating} onChange={setRating} disabled={pending} />
      {missing && (
        <p role="alert" className="text-sm text-destructive">
          Tap a star to rate
        </p>
      )}
      <div>
        <label htmlFor="review-text" className="sr-only">
          Your review
        </label>
        <textarea
          id="review-text"
          value={body}
          maxLength={MAX_TEXT}
          rows={3}
          disabled={pending}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a line about your visit (optional)"
          className="w-full resize-none rounded-xl border border-border bg-card px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="mt-1 text-right text-xs text-muted-foreground">
          {body.length}/{MAX_TEXT}
        </p>
      </div>
      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="min-h-11 flex-1 rounded-full border border-border text-sm font-semibold disabled:opacity-60"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setTouched(true);
            if (rating === 0) return;
            onSubmit(rating, body);
          }}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-gradient-brand text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function ReplyBox({
  review,
  isOwner,
  businessName,
  onSave,
  pending,
}: {
  review: BusinessReview;
  isOwner: boolean;
  businessName: string;
  onSave: (reviewerId: string, text: string) => void;
  pending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(review.owner_reply ?? "");

  if (editing && isOwner)
    return (
      <div className="mt-2 space-y-2 rounded-xl bg-elevated/60 p-3">
        <label htmlFor={`reply-${review.reviewer_id}`} className="sr-only">
          Your reply
        </label>
        <textarea
          id={`reply-${review.reviewer_id}`}
          value={text}
          maxLength={MAX_TEXT}
          rows={2}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a reply"
          className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-base outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setText(review.owner_reply ?? "");
              setEditing(false);
            }}
            className="min-h-10 flex-1 rounded-full border border-border text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending || (!text.trim() && !review.owner_reply)}
            onClick={() => {
              onSave(review.reviewer_id, text);
              setEditing(false);
            }}
            className="min-h-10 flex-1 rounded-full bg-gradient-brand text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {text.trim() ? "Post reply" : "Remove reply"}
          </button>
        </div>
      </div>
    );

  return (
    <>
      {review.owner_reply && (
        <div className="mt-2 rounded-xl bg-elevated/60 p-3">
          <p className="text-xs font-semibold">Reply from {businessName}</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{review.owner_reply}</p>
        </div>
      )}
      {isOwner && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-1 min-h-9 text-sm font-semibold text-primary"
        >
          {review.owner_reply ? "Edit reply" : "Reply"}
        </button>
      )}
    </>
  );
}

function ReviewItem({
  review,
  isOwner,
  businessName,
  onReply,
  replyPending,
  children,
}: {
  review: BusinessReview;
  isOwner: boolean;
  businessName: string;
  onReply: (reviewerId: string, text: string) => void;
  replyPending: boolean;
  children?: React.ReactNode;
}) {
  const name = review.reviewer?.full_name || review.reviewer?.username || "Someone";
  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <Avatar src={review.reviewer?.avatar_url} name={name} size={36} />
        <div className="min-w-0 flex-1">
          {review.reviewer ? (
            <Link
              to="/u/$username"
              params={{ username: review.reviewer.username }}
              className="block truncate text-sm font-semibold"
            >
              {name}
            </Link>
          ) : (
            <p className="truncate text-sm font-semibold">{name}</p>
          )}
          <div className="flex items-center gap-2">
            <Stars value={review.rating} size={13} />
            <span className="text-xs text-muted-foreground">{timeAgo(review.created_at)}</span>
          </div>
        </div>
      </div>
      {review.body && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{review.body}</p>}
      <ReplyBox
        review={review}
        isOwner={isOwner}
        businessName={businessName}
        onSave={onReply}
        pending={replyPending}
      />
      {children}
    </li>
  );
}

/**
 * Ratings and reviews of a business: summary, "write a review" (one per person, can be edited or
 * deleted, never for your own shop) and the list. The owner can reply but not delete.
 */
export function BusinessReviews({
  businessId,
  businessName,
  isOwner,
  meId,
  page,
}: {
  businessId: string;
  businessName: string;
  isOwner: boolean;
  meId: string;
  page: BusinessPage;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const reviews = useQuery({
    queryKey: ["business-reviews", businessId],
    queryFn: () => fetchBusinessReviews(businessId),
    staleTime: 15_000,
  });
  // Arriving from a "#reviews" link: the section appears after the data loads, so scroll once it's here.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#reviews")
      document.getElementById("reviews")?.scrollIntoView({ block: "start" });
  }, []);
  const mine = reviews.data?.find((r) => r.reviewer_id === meId) ?? null;
  const others = (reviews.data ?? []).filter((r) => r.reviewer_id !== meId);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["business-reviews", businessId] });
    void qc.invalidateQueries({ queryKey: ["business-page", businessId] });
    void qc.invalidateQueries({ queryKey: ["business-directory"] });
  };

  const save = useMutation({
    mutationFn: (v: { rating: number; body: string }) =>
      saveBusinessReview({
        businessId,
        reviewerId: meId,
        rating: v.rating,
        body: v.body,
        exists: !!mine,
      }),
    onSuccess: () => {
      toast.success(mine ? "Review updated" : "Thanks for your review!");
      setEditing(false);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => deleteBusinessReview(businessId, meId),
    onSuccess: () => {
      toast.success("Review deleted");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const reply = useMutation({
    mutationFn: (v: { reviewerId: string; text: string }) =>
      replyToBusinessReview(v.reviewerId, v.text),
    onSuccess: () => {
      toast.success("Reply saved");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onReply = (reviewerId: string, text: string) => reply.mutate({ reviewerId, text });

  return (
    <section id="reviews" aria-labelledby="reviews-title" className="space-y-4 scroll-mt-20">
      <h2 id="reviews-title" className="text-base font-bold">
        Ratings &amp; reviews
      </h2>

      {page.rating_count > 0 ? (
        <RatingSummary page={page} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {isOwner
            ? "No reviews yet. Reviews from your customers will show up here."
            : "No reviews yet. Be the first to share your experience."}
        </p>
      )}

      {!isOwner && (
        <div className="rounded-2xl border border-border p-3">
          {mine && !editing ? (
            <div>
              <p className="text-sm font-semibold">Your review</p>
              <ul>
                <ReviewItem
                  review={mine}
                  isOwner={false}
                  businessName={businessName}
                  onReply={onReply}
                  replyPending={false}
                >
                  <div className="mt-1 flex gap-4">
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      className="min-h-9 text-sm font-semibold text-primary"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm("Delete your review?")) remove.mutate();
                      }}
                      className="min-h-9 text-sm font-semibold text-destructive disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                </ReviewItem>
              </ul>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-semibold">
                {mine ? "Edit your review" : "Rate and review this business"}
              </p>
              <ReviewForm
                initial={mine ? { rating: mine.rating, body: mine.body } : undefined}
                submitLabel={mine ? "Save changes" : "Post review"}
                pending={save.isPending}
                onSubmit={(rating, body) => save.mutate({ rating, body })}
                {...(mine ? { onCancel: () => setEditing(false) } : {})}
              />
            </div>
          )}
        </div>
      )}

      {reviews.isLoading && (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />
      )}
      {reviews.isError && (
        <p className="text-sm text-destructive">
          Couldn't load reviews.{" "}
          <button
            type="button"
            onClick={() => void reviews.refetch()}
            className="font-semibold underline"
          >
            Try again
          </button>
        </p>
      )}
      {others.length > 0 && (
        <ul className="divide-y divide-border">
          {others.map((r) => (
            <ReviewItem
              key={r.reviewer_id}
              review={r}
              isOwner={isOwner}
              businessName={businessName}
              onReply={onReply}
              replyPending={reply.isPending}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
