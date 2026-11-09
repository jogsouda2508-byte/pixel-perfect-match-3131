import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Globe2, Loader2, MapPin, RefreshCw, Search, X } from "lucide-react";
import { Avatar } from "@/components/ediraa";
import { BottomSheet } from "@/components/bottom-sheet";
import { cn } from "@/lib/utils";
import { fetchLocalities } from "@/lib/social";
import type { CommunityPerson } from "@/lib/community";

/** Re-renders now and then so "Starts in 5 min" and "Closes in 2 h" stay fresh. */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), everyMs);
    return () => window.clearInterval(t);
  }, [everyMs]);
  return now;
}

export const inputCls =
  "w-full rounded-xl border border-border bg-card px-3.5 py-3 max-md:py-2.5 text-[15px] max-md:text-[13px] outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/25";

export function Chip({
  active,
  onClick,
  children,
  tone = "primary",
  disabled,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  tone?: "primary" | "plain";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-8 max-md:min-h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3 text-xs max-md:text-[11px] font-medium transition active:scale-95 disabled:opacity-50 sm:min-h-9 sm:gap-1.5 sm:px-3.5 sm:text-sm",
        active
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
        tone === "plain" && !active && "bg-transparent",
      )}
    >
      {children}
    </button>
  );
}

/** A row of chips that scrolls sideways on small screens. */
export function ChipRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:gap-2 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm max-md:text-xs font-semibold">{label}</span>
      {children}
      {error ? (
        <span
          role="alert"
          className="block text-xs max-md:text-[11px] font-medium text-destructive"
        >
          {error}
        </span>
      ) : hint ? (
        <span className="block text-xs max-md:text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="glass-card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="grid h-14 w-14 max-md:h-12 max-md:w-12 place-items-center rounded-full bg-elevated text-primary">
        {icon}
      </div>
      <p className="text-base max-md:text-sm font-semibold">{title}</p>
      <p className="max-w-xs text-sm max-md:text-xs text-muted-foreground">{text}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const msg = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="glass-card flex flex-col items-center gap-3 px-6 py-8 text-center" role="alert">
      <AlertCircle className="h-8 w-8 max-md:h-7 max-md:w-7 text-destructive" aria-hidden="true" />
      <p className="max-w-sm text-sm max-md:text-xs text-muted-foreground">{msg}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex min-h-10 max-md:min-h-9 items-center gap-2 rounded-full bg-primary px-4 text-sm max-md:text-xs font-semibold text-primary-foreground active:scale-95"
      >
        <RefreshCw className="h-4 w-4 max-md:h-3.5 max-md:w-3.5" /> Try again
      </button>
    </div>
  );
}

export function SkeletonList({ rows = 3, tall = false }: { rows?: number; tall?: boolean }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={cn("glass-card animate-pulse space-y-3 p-4", tall ? "h-44" : "h-28")}
        >
          <div className="h-4 w-2/3 rounded bg-muted" />
          <div className="h-3 w-1/2 rounded bg-muted" />
          <div className="h-3 w-5/6 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  busy,
  disabled,
  className,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  busy?: boolean;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy || disabled}
      className={cn(
        "inline-flex min-h-9 max-md:min-h-8 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-xs max-md:text-[11px] font-semibold sm:min-h-11 sm:gap-2 sm:px-5 sm:text-sm text-primary-foreground shadow-sm transition active:scale-95 disabled:opacity-60",
        className,
      )}
    >
      {busy && (
        <Loader2 className="h-4 w-4 max-md:h-3.5 max-md:w-3.5 animate-spin" aria-hidden="true" />
      )}
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  className,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-11 max-md:min-h-9 items-center justify-center gap-2 rounded-full border border-border bg-card px-5 text-sm max-md:text-xs font-semibold transition active:scale-95 disabled:opacity-60",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** A form sheet with Cancel + submit pinned at the bottom. */
export function FormSheet({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  busy,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={title}
      description={description}
      compact
      focusOnOpen={false}
      footer={
        <>
          <GhostButton className="flex-1" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </GhostButton>
          <PrimaryButton className="flex-[2]" onClick={onSubmit} busy={busy}>
            {submitLabel}
          </PrimaryButton>
        </>
      }
    >
      <form
        className="space-y-4 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {children}
      </form>
    </BottomSheet>
  );
}

export function PersonLine({
  person,
  sub,
  size = 32,
  badge,
}: {
  person: CommunityPerson;
  sub?: string;
  size?: number;
  badge?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar src={person.avatar_url} name={person.name} size={size} />
      <div className="min-w-0 leading-tight">
        <p className="flex items-center gap-1.5 truncate text-sm max-md:text-xs font-semibold">
          <span className="truncate">{person.name}</span>
          {badge}
        </p>
        {sub && <p className="truncate text-xs max-md:text-[11px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

export function LocalBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-success">
      <MapPin className="h-2.5 w-2.5" aria-hidden="true" /> Local
    </span>
  );
}

/** The area switcher at the top of Community: tap it to pick another place or "Everywhere". */
export function LocalityBar({
  locality,
  profileLocation,
  onChange,
}: {
  locality: string | null;
  profileLocation: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const places = useQuery({
    queryKey: ["localities"],
    queryFn: () => fetchLocalities(20),
    staleTime: 5 * 60_000,
    enabled: open,
  });

  const pick = (v: string | null) => {
    onChange(v);
    setDraft("");
    setOpen(false);
  };
  const list = Array.from(
    new Set(
      [profileLocation, ...(places.data?.map((p) => p.locality) ?? [])].filter(Boolean) as string[],
    ),
  ).filter((p) => !draft.trim() || p.toLowerCase().includes(draft.trim().toLowerCase()));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="glass-card flex w-full items-center gap-2.5 p-2.5 text-left transition active:scale-[0.99] sm:gap-3 sm:p-3"
        aria-label="Change area"
      >
        <span className="grid h-9 w-9 max-md:h-8 max-md:w-8 shrink-0 place-items-center rounded-full bg-elevated text-primary sm:h-10 sm:w-10">
          {locality ? (
            <MapPin className="h-4 w-4 max-md:h-3.5 max-md:w-3.5 sm:h-5 sm:w-5" />
          ) : (
            <Globe2 className="h-4 w-4 max-md:h-3.5 max-md:w-3.5 sm:h-5 sm:w-5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] max-md:text-[10px] text-muted-foreground sm:text-xs">
            Showing
          </span>
          <span className="block truncate text-sm max-md:text-xs font-semibold sm:text-base">
            {locality ?? "Everywhere"}
          </span>
        </span>
        <span className="rounded-full bg-elevated px-2.5 py-1 text-[11px] max-md:text-[10px] font-semibold text-primary sm:px-3 sm:py-1.5 sm:text-xs">
          Change
        </span>
      </button>

      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title="Choose your area"
        description="Community shows what is happening around this place."
        focusOnOpen={false}
        footer={
          <GhostButton className="flex-1" onClick={() => setOpen(false)}>
            Close
          </GhostButton>
        }
      >
        <div className="space-y-3">
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim().length >= 2) pick(draft);
            }}
          >
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 max-md:h-3.5 max-md:w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type an area, e.g. Whitefield"
              maxLength={60}
              className={cn(inputCls, "pl-10")}
              aria-label="Area name"
            />
            {draft && (
              <button
                type="button"
                onClick={() => setDraft("")}
                aria-label="Clear"
                className="absolute right-2 top-1/2 grid h-8 w-8 max-md:h-7 max-md:w-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground"
              >
                <X className="h-4 w-4 max-md:h-3.5 max-md:w-3.5" />
              </button>
            )}
          </form>
          {draft.trim().length >= 2 && (
            <button
              type="button"
              onClick={() => pick(draft)}
              className="flex min-h-12 max-md:min-h-10 w-full items-center gap-3 rounded-xl bg-elevated px-3 text-left font-semibold text-primary"
            >
              <MapPin className="h-4 w-4 max-md:h-3.5 max-md:w-3.5" /> Use “{draft.trim()}”
            </button>
          )}
          <button
            type="button"
            onClick={() => pick(null)}
            className={cn(
              "flex min-h-12 max-md:min-h-10 w-full items-center gap-3 rounded-xl border px-3 text-left",
              locality === null ? "border-primary bg-elevated" : "border-border",
            )}
          >
            <Globe2 className="h-4 w-4 max-md:h-3.5 max-md:w-3.5 text-primary" /> Everywhere
          </button>
          {places.isLoading && open && (
            <p className="flex items-center gap-2 text-sm max-md:text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 max-md:h-3.5 max-md:w-3.5 animate-spin" /> Finding areas…
            </p>
          )}
          {list.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => pick(p)}
              className={cn(
                "flex min-h-12 max-md:min-h-10 w-full items-center gap-3 rounded-xl border px-3 text-left",
                locality?.toLowerCase() === p.toLowerCase()
                  ? "border-primary bg-elevated"
                  : "border-border",
              )}
            >
              <MapPin className="h-4 w-4 max-md:h-3.5 max-md:w-3.5 text-muted-foreground" />
              <span className="flex-1 truncate">{p}</span>
              {p === profileLocation && (
                <span className="text-xs max-md:text-[11px] text-muted-foreground">
                  Your profile
                </span>
              )}
            </button>
          ))}
        </div>
      </BottomSheet>
    </>
  );
}
