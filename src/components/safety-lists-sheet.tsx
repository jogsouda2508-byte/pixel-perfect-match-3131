import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { BottomSheet } from "@/components/bottom-sheet";
import { Avatar } from "@/components/ediraa";
import { useRefreshAfterSafetyChange } from "@/components/user-safety-menu";
import { useAuth } from "@/lib/auth";
import {
  fetchBlocked,
  fetchMuted,
  unblockUser,
  unmuteUser,
  type SafetyPerson,
} from "@/lib/safety";

type Kind = "blocked" | "muted";

/** Settings: the people you have blocked or muted, with a button to undo each. */
export function SafetyListsSheet({
  open,
  onOpenChange,
  initial = "blocked",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Kind;
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
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't do that. Please try again."),
  });

  const people = list.data ?? [];

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Blocked and muted"
      description="Blocked people can't see your posts or stories or message you. Muted people are only hidden from your feed."
      z={60}
      compact
      footer={
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="flex min-h-12 w-full items-center justify-center rounded-full bg-gradient-brand text-sm font-semibold text-primary-foreground"
        >
          Done
        </button>
      }
    >
      <div className="space-y-3 pb-2">
        <div role="tablist" className="grid grid-cols-2 gap-1 rounded-full bg-elevated p-1">
          {(["blocked", "muted"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={`min-h-9 rounded-full text-sm font-semibold capitalize transition ${
                kind === k ? "bg-background shadow-sm" : "text-muted-foreground"
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        {list.isLoading ? (
          <div className="space-y-2" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-elevated/60" />
            ))}
          </div>
        ) : list.error ? (
          <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
            {list.error instanceof Error ? list.error.message : "Couldn't load that list."}
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
                    className="min-h-9 rounded-full border border-border px-4 text-sm font-semibold hover:bg-elevated disabled:opacity-60"
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
