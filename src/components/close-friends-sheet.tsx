import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Star } from "lucide-react";
import { BottomSheet } from "@/components/bottom-sheet";
import { Avatar } from "@/components/ediraa";
import { Switch } from "@/components/ui/switch";
import {
  addCloseFriend,
  filterPeople,
  removeCloseFriend,
  useCloseFriendIds,
} from "@/lib/close-friends";
import { fetchFollowList } from "@/lib/social";

/**
 * Choose which of your followers are on your Close Friends list. Every switch saves straight away.
 * Only people who follow you can be added. `z` lets it open above the full-screen story editor.
 */
export function CloseFriendsSheet({
  open,
  onOpenChange,
  meId,
  z = 60,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meId: string;
  z?: number;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const ids = useCloseFriendIds(open ? meId : undefined);
  const followers = useQuery({
    queryKey: ["followers-list", meId],
    queryFn: () => fetchFollowList(meId, "followers"),
    enabled: open && !!meId,
    staleTime: 30_000,
  });

  const toggle = useMutation({
    mutationFn: async ({ friendId, on }: { friendId: string; on: boolean }) =>
      on ? addCloseFriend(meId, friendId) : removeCloseFriend(meId, friendId),
    onMutate: async ({ friendId, on }) => {
      // flip the switch at once; it is put back if saving fails
      await qc.cancelQueries({ queryKey: ["close-friends", meId] });
      const before = qc.getQueryData<string[]>(["close-friends", meId]) ?? [];
      qc.setQueryData<string[]>(
        ["close-friends", meId],
        on ? [...before, friendId] : before.filter((x) => x !== friendId),
      );
      return { before };
    },
    onError: (e, _v, ctx) => {
      if (ctx) qc.setQueryData(["close-friends", meId], ctx.before);
      toast.error(e instanceof Error ? e.message : "Couldn't save that. Please try again.");
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["close-friends", meId] }),
  });

  const chosen = new Set(ids.data ?? []);
  const people = filterPeople(followers.data ?? [], search);
  const loading = followers.isLoading || ids.isLoading;
  const failed = followers.error ?? ids.error;

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Close Friends"
      description="Stories you share with Close Friends are seen only by the people you pick here. They are never told they are on the list."
      z={z}
      compact
      footer={
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="flex min-h-12 w-full items-center justify-center rounded-full bg-gradient-brand text-sm font-semibold text-primary-foreground"
        >
          Done{chosen.size > 0 ? ` · ${chosen.size} selected` : ""}
        </button>
      }
    >
      <div className="space-y-3 pb-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your followers"
            aria-label="Search your followers"
            className="h-11 w-full rounded-full border border-border bg-card pl-10 pr-4 text-sm outline-none focus:border-primary"
          />
        </div>

        {loading ? (
          <div className="space-y-2" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-elevated/60" />
            ))}
          </div>
        ) : failed ? (
          <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
            {failed instanceof Error ? failed.message : "Couldn't load your followers."}
          </p>
        ) : (followers.data ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nobody follows you yet. When people follow you, you can add them here.
          </p>
        ) : people.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No one matches that.</p>
        ) : (
          <ul className="divide-y divide-border">
            {people.map((p) => {
              const on = chosen.has(p.id);
              const name = p.full_name || p.username;
              return (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  <Avatar src={p.avatar_url} name={name} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{name}</p>
                    <p className="truncate text-xs text-muted-foreground">@{p.username}</p>
                  </div>
                  <Switch
                    checked={on}
                    onCheckedChange={(v) => toggle.mutate({ friendId: p.id, on: v })}
                    aria-label={`${on ? "Remove" : "Add"} ${name} ${on ? "from" : "to"} Close Friends`}
                    className="data-[state=checked]:bg-success"
                  />
                </li>
              );
            })}
          </ul>
        )}
        {chosen.size > 0 && (
          <p className="flex items-center justify-center gap-1.5 text-xs text-success">
            <Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            {chosen.size} close friend{chosen.size === 1 ? "" : "s"}
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
