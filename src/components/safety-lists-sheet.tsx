import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { BottomSheet } from "@/components/bottom-sheet";
import { Avatar } from "@/components/ediraa";
import { useRefreshAfterSafetyChange } from "@/components/user-safety-menu";
import { useAuth } from "@/lib/auth";
import { fetchBlocked, fetchMuted, unblockUser, unmuteUser, type SafetyPerson } from "@/lib/safety";
import { userMessage } from "@/lib/security";

type Kind = "blocked" | "muted";

/** Settings: the people you have blocked or muted, with a button to undo each. */
export function SafetyListsSheet({
  open,
  onOpenChange,
  initial = "blocked",
  single = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Kind;
  /** Show only the `initial` list, without the Blocked/Muted switcher. */
  single?: boolean;
}) {
  const { user } = useAuth();
  const refresh = useRefreshAfterSafetyChange();
  const [kind, setKind] = useState<Kind>(initial);

  const list = useQuery({
    queryKey: [kind === "blocked" ? "blocked-list" : "muted-list", user?.id],
    queryFn: () => (kind === "blocked" ? fetchBlocked(user!.id) : fetchMuted(user!.id)),
    enabled: open && !!user,
    retry: false,
  });

  const undo = useMutation({
    mutationFn: (p: SafetyPerson) =>
      kind === "blocked" ? unblockUser(user!.id, p.id) : unmuteUser(user!.id, p.id),
    onSuccess: (_d, p) => {
      toast.success(`${kind === "blocked" ? "Unblocked" : "Unmuted"} @${p.username}`);
      refresh();
    },
    onError: (e) => toast.error(userMessage(e, "Couldn't do that. Please try again.")),
  });

  const people = list.data ?? [];

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={single ? (kind === "blocked" ? "Blocked" : "Muted") : "Blocked and muted"}
      description={
        single
          ? kind === "blocked"
            ? "Blocked people can't see your posts or stories or message you."
            : "Muted people are only hidden from your feed."
          : "Blocked people can't see your posts or stories or message you. Muted people are only hidden from your feed."
      }
      z={60}
      compact
      footer={
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="flex min-h-12 w-full items-center justify-center rounded-full bg-gradient-brand text-sm font-bold text-primary-foreground glow"
        >
          Done
        </button>
      }
    >
      <div className="space-y-3 pb-2">
        {!single && (
          <div role="tablist" className="grid grid-cols-2 gap-1 rounded-full bg-secondary/70 p-1">
            {(["blocked", "muted"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                onClick={() => setKind(k)}
                className={`min-h-9 rounded-full text-sm font-semibold capitalize transition ${
                  kind === k
                    ? "bg-card text-foreground shadow-[0_6px_16px_-8px_rgba(0,0,0,0.8)] ring-1 ring-primary/30"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        )}

        {list.isLoading ? (
          <div className="space-y-2" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="sz-skeleton h-14 rounded-2xl" />
            ))}
          </div>
        ) : list.error ? (
          <p
            role="alert"
            className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {userMessage(list.error, "Couldn't load that list.")}
          </p>
        ) : people.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {kind === "blocked" ? "You haven't blocked anyone." : "You haven't muted anyone."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {people.map((p) => {
              const name = p.full_name || p.username;
              return (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  <Avatar src={p.avatar_url} name={name} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{name}</p>
                    <p className="truncate text-xs text-muted-foreground">@{p.username}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => undo.mutate(p)}
                    disabled={undo.isPending}
                    className="min-h-9 rounded-full border border-border px-4 text-sm font-semibold transition-colors hover:border-primary/40 hover:bg-elevated disabled:opacity-60"
                  >
                    {kind === "blocked" ? "Unblock" : "Unmute"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </BottomSheet>
  );
}
