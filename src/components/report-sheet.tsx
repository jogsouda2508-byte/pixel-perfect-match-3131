import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { BottomSheet } from "@/components/bottom-sheet";
import { useAuth } from "@/lib/auth";
import {
  REPORT_DETAILS_MAX,
  REPORT_REASONS,
  submitReport,
  type ReportReason,
  type ReportTarget,
} from "@/lib/safety";
import { userMessage } from "@/lib/security";

const NOUN: Record<ReportTarget, string> = {
  user: "account",
  post: "post",
  comment: "comment",
  story: "story",
  message: "message",
};

/**
 * "Why are you reporting this?" Pick a reason, add a note if you like, send. The person who is
 * reported is never told who reported them. `z` lets it open above the full-screen story viewer.
 */
export function ReportSheet({
  open,
  onOpenChange,
  targetType,
  targetId,
  targetUserId,
  z = 70,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: ReportTarget;
  targetId: string;
  targetUserId?: string | null;
  z?: number;
}) {
  const { user } = useAuth();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setReason(null);
      setDetails("");
    }
  };

  const send = useMutation({
    mutationFn: () =>
      submitReport(user!.id, {
        targetType,
        targetId,
        targetUserId: targetUserId ?? null,
        reason: reason!,
        details,
      }),
    onSuccess: (result) => {
      toast.success(
        result === "already"
          ? "You've already reported this. Thank you."
          : "Thanks. We'll review this and they won't know it was you.",
      );
      close(false);
    },
    onError: (e) => toast.error(userMessage(e, "Couldn't send your report. Please try again.")),
  });

  return (
    <BottomSheet
      open={open}
      onOpenChange={close}
      title={`Report this ${NOUN[targetType]}`}
      description="Why are you reporting it? The person is not told it was you."
      z={z}
      compact
      footer={
        <button
          type="button"
          onClick={() => send.mutate()}
          disabled={!reason || send.isPending || !user}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-gradient-brand text-sm font-bold text-primary-foreground glow disabled:opacity-50 disabled:shadow-none"
        >
          {send.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Send report
        </button>
      }
    >
      <fieldset className="space-y-2 pb-2">
        <legend className="sr-only">Reason</legend>
        {REPORT_REASONS.map((r) => (
          <label
            key={r.value}
            className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-3.5 py-3 transition ${
              reason === r.value
                ? "border-primary/60 bg-primary/10 shadow-[0_8px_24px_-16px_rgba(249,178,51,0.6)]"
                : "border-border bg-elevated/30 hover:border-primary/30"
            }`}
          >
            <input
              type="radio"
              name="report-reason"
              value={r.value}
              checked={reason === r.value}
              onChange={() => setReason(r.value)}
              className="mt-1 accent-[var(--primary)]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{r.label}</span>
              <span className="block text-xs text-muted-foreground">{r.hint}</span>
            </span>
          </label>
        ))}
        {reason && (
          <div className="pt-2">
            <label
              htmlFor="report-details"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Anything else we should know? (optional)
            </label>
            <textarea
              id="report-details"
              value={details}
              onChange={(e) => setDetails(e.target.value.slice(0, REPORT_DETAILS_MAX))}
              rows={3}
              className="w-full rounded-2xl border border-border bg-elevated/50 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-primary/60"
            />
            <p className="text-right text-[11px] text-muted-foreground">
              {details.length}/{REPORT_DETAILS_MAX}
            </p>
          </div>
        )}
      </fieldset>
    </BottomSheet>
  );
}

/** A small flag button that opens the report sheet for one thing (e.g. a comment). */
export function ReportButton({
  targetType,
  targetId,
  targetUserId,
  label,
  className,
  children,
}: {
  targetType: ReportTarget;
  targetId: string;
  targetUserId?: string | null;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={label} className={className}>
        {children}
      </button>
      {open && (
        <ReportSheet
          open
          onOpenChange={setOpen}
          targetType={targetType}
          targetId={targetId}
          targetUserId={targetUserId ?? null}
        />
      )}
    </>
  );
}
