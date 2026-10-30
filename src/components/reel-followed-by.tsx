import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Avatar } from "@/components/ediraa";
import { BottomSheet } from "@/components/bottom-sheet";
import { followLabel } from "@/lib/follow-state";
import { fetchMutualFollowers } from "@/lib/mutual";
import { fetchFollowingIds, fetchFollowList } from "@/lib/social";
import { useFollow } from "@/lib/use-follow";

/**
 * Under a reel: [up to 3 photos] Followed by anna, ravi and 37 others (people I follow who also
 * follow the reel's owner). Tapping the line opens a bottom sheet with all of the owner's
 * followers. Renders nothing when there are no mutual followers, or on my own reel.
 */
export function ReelFollowedBy({
  meId,
  ownerId,
  ownerName,
}: {
  meId: string;
  ownerId: string;
  ownerName: string;
}) {
  const [open, setOpen] = useState(false);
  const enabled = !!meId && !!ownerId && meId !== ownerId;
  const { data } = useQuery({
    queryKey: ["mutual-followers", meId, ownerId],
    queryFn: () => fetchMutualFollowers(meId, ownerId),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
  if (!enabled || !data || data.total === 0 || data.people.length === 0) return null;
  const [a, b] = data.people;
  const others = data.total - 2;
  const label = (p: { username: string }) => <span className="font-semibold">{p.username}</span>;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={`Followed by people you follow. See ${ownerName}'s followers`}
        className="flex min-h-9 max-w-full items-center gap-2 rounded-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <span className="flex shrink-0 -space-x-1.5">
          {data.people.slice(0, 3).map((p) => (
            <span key={p.id} className="rounded-full ring-2 ring-black/40">
              <Avatar src={p.avatar_url} name={p.full_name || p.username} size={22} />
            </span>
          ))}
        </span>
        <span className="min-w-0 text-xs leading-snug text-white/85">
          Followed by {a && label(a)}
          {data.total === 1 ? null : data.total === 2 ? (
            <>
              {" and "}
              {b && label(b)}
            </>
          ) : (
            <>
              {", "}
              {b && label(b)}
              {` and ${others} ${others === 1 ? "other" : "others"}`}
            </>
          )}
        </span>
      </button>
      {open && (
        <ReelFollowersSheet
          open={open}
          onOpenChange={setOpen}
          ownerId={ownerId}
          ownerName={ownerName}
          meId={meId}
        />
      )}
    </>
  );
}

function ReelFollowersSheet({
  open,
  onOpenChange,
  ownerId,
  ownerName,
  meId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerId: string;
  ownerName: string;
  meId: string;
}) {
  const follow = useFollow();
  const people = useQuery({
    queryKey: ["follow-list", ownerId, "followers"],
    queryFn: () => fetchFollowList(ownerId, "followers"),
  });
  const mine = useQuery({
    queryKey: ["my-following", meId],
    queryFn: () => fetchFollowingIds(meId),
    enabled: !!meId,
  });
  const mineSet = new Set(mine.data ?? []);

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Followers"
      description={`People who follow ${ownerName}`}
      z={130}
      compact
      focusOnOpen={false}
      footer={
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="min-h-9 flex-1 rounded-full border border-border bg-card text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Close
        </button>
      }
    >
      {people.isLoading && (
        <div className="grid place-items-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="Loading" />
        </div>
      )}
      {people.isError && <p className="text-xs text-destructive">Couldn't load this list.</p>}
      {people.isSuccess && people.data.length === 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">No followers yet.</p>
      )}
      <div className="space-y-2.5">
        {people.data?.map((p) => {
          const isSelf = p.id === meId;
          const isFollowing = follow.isFollowing(p.id, mineSet.has(p.id));
          return (
            <div
              key={p.id}
              onClick={(e) => {
                // following a profile link leaves the reel, so close the sheet; not for Follow
                if ((e.target as HTMLElement).closest("a")) onOpenChange(false);
              }}
            >
              <div className="flex items-center gap-2.5">
                <Link
                  to="/u/$username"
                  params={{ username: p.username }}
                  className="flex min-w-0 flex-1 items-center gap-2.5"
                >
                  <Avatar src={p.avatar_url} name={p.full_name || p.username} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold leading-tight">
                      {p.full_name || p.username}
                    </span>
                    <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                      @{p.username}
                    </span>
                  </span>
                </Link>
                {!isSelf && (
                  <button
                    type="button"
                    disabled={follow.isPending(p.id)}
                    onClick={() => follow.toggle(p.id, isFollowing)}
                    className={`shrink-0 rounded-lg px-2.5 py-0.5 text-[11px] font-medium transition disabled:opacity-60 ${isFollowing || follow.isRequested(p.id) ? "bg-elevated text-muted-foreground" : "border border-primary text-primary"}`}
                  >
                    {followLabel(isFollowing, follow.isRequested(p.id))}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </BottomSheet>
  );
}
