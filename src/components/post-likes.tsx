import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { Avatar } from "@/components/ediraa";
import { BottomSheet } from "@/components/bottom-sheet";
import { followLabel } from "@/lib/follow-state";
import { formatCount } from "@/lib/format-count";
import { fetchFollowingIds, fetchPostLikers, type PostLiker } from "@/lib/social";
import { useFollow } from "@/lib/use-follow";

/**
 * Under a post's action bar: [up to 3 photos] Liked by anna and 12 others. Tapping the line opens
 * a bottom sheet with everyone who liked the post. Shows nothing when there are no likes.
 */
export function PostLikedBy({
  postId,
  likes,
  meId,
  authorId,
}: {
  postId: string;
  likes: number;
  meId: string;
  /** The person who posted. Neither they nor the viewer are listed as likers. */
  authorId: string;
}) {
  const [open, setOpen] = useState(false);
  // `likes` is in the key so the names refresh right after someone (me) likes or unlikes
  const likers = useQuery({
    queryKey: ["post-likers", postId, likes],
    queryFn: () => fetchPostLikers(postId),
    enabled: likes > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
  });
  if (likes <= 0) return null;
  // wait for the names instead of flashing ones that are about to be hidden
  if (likers.isLoading && !likers.data) return null;

  // Leave out me and the post's author; the number of "others" shrinks by however many were left out.
  const all = likers.data ?? [];
  const people = all.filter((p) => p.id !== meId && p.id !== authorId);
  const visibleTotal = Math.max(0, likes - (all.length - people.length));
  if (likers.isSuccess && visibleTotal <= 0) return null;
  const [a, b] = people;
  const others = Math.max(0, visibleTotal - 1);

  let text: ReactNode;
  if (!a) {
    text = <>{formatCount(likes) || likes} {likes === 1 ? "like" : "likes"}</>;
  } else if (visibleTotal === 1) {
    text = (
      <>
        Liked by <strong className="font-semibold text-foreground">{a.username}</strong>
      </>
    );
  } else if (visibleTotal === 2 && b) {
    text = (
      <>
        Liked by <strong className="font-semibold text-foreground">{a.username}</strong> and{" "}
        <strong className="font-semibold text-foreground">{b.username}</strong>
      </>
    );
  } else {
    text = (
      <>
        Liked by <strong className="font-semibold text-foreground">{a.username}</strong> and{" "}
        <strong className="font-semibold text-foreground">
          {formatCount(others) || others} {others === 1 ? "other" : "others"}
        </strong>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="See who liked this post"
        className="-mt-0.5 flex min-h-7 max-w-full items-center gap-2 rounded-full px-1 text-left text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {people.length > 0 && (
          <span className="flex shrink-0 -space-x-1.5">
            {people.slice(0, 3).map((p) => (
              <span key={p.id} className="rounded-full ring-2 ring-card">
                <Avatar src={p.avatar_url} name={p.full_name || p.username} size={22} />
              </span>
            ))}
          </span>
        )}
        <span className="min-w-0 truncate">{text}</span>
      </button>
      {open && (
        <LikesSheet
          postId={postId}
          open={open}
          onOpenChange={setOpen}
          meId={meId}
          authorId={authorId}
        />
      )}
    </>
  );
}

function LikesSheet({
  postId,
  open,
  onOpenChange,
  meId,
  authorId,
}: {
  postId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meId: string;
  authorId: string;
}) {
  const [search, setSearch] = useState("");
  const follow = useFollow();
  const list = useQuery({
    queryKey: ["post-likers", postId, "all"],
    queryFn: () => fetchPostLikers(postId),
  });
  const mine = useQuery({
    queryKey: ["my-following", meId],
    queryFn: () => fetchFollowingIds(meId),
    enabled: !!meId,
  });
  const mineSet = new Set(mine.data ?? []);
  const q = search.trim().toLowerCase();
  const shown: PostLiker[] = (list.data ?? []).filter(
    (p) =>
      p.id !== meId &&
      p.id !== authorId &&
      (!q || p.username.toLowerCase().includes(q) || (p.full_name ?? "").toLowerCase().includes(q)),
  );

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Likes"
      description="People who liked this post"
      compact
      focusOnOpen={false}
      footer={
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="min-h-10 flex-1 rounded-full border border-border bg-card text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Close
        </button>
      }
    >
      <div className="space-y-3">
        <label className="flex items-center gap-2 rounded-xl bg-elevated/70 px-3 py-2 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="sr-only">Search people who liked this post</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search username or name"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>

        {list.isLoading && (
          <div className="grid place-items-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="Loading" />
          </div>
        )}
        {list.isError && <p className="text-sm text-destructive">Couldn't load likes.</p>}
        {list.isSuccess && shown.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {q ? "No one found." : "No likes yet."}
          </p>
        )}

        <div className="space-y-3">
          {shown.map((p) => {
            const isSelf = p.id === meId;
            const isFollowing = follow.isFollowing(p.id, mineSet.has(p.id));
            const requested = follow.isRequested(p.id);
            return (
              <div
                key={p.id}
                className="flex items-center gap-3"
                onClick={(e) => {
                  // opening a profile leaves the feed, so close the sheet; not for the Follow button
                  if ((e.target as HTMLElement).closest("a")) onOpenChange(false);
                }}
              >
                <Link
                  to="/u/$username"
                  params={{ username: p.username }}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <Avatar src={p.avatar_url} name={p.full_name || p.username} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold leading-tight">
                      {p.username}
                    </span>
                    {p.full_name && (
                      <span className="block truncate text-xs leading-tight text-muted-foreground">
                        {p.full_name}
                      </span>
                    )}
                  </span>
                </Link>
                {!isSelf && (
                  <button
                    type="button"
                    disabled={follow.isPending(p.id)}
                    onClick={() => follow.toggle(p.id, isFollowing)}
                    className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
                      isFollowing || requested
                        ? "bg-elevated text-muted-foreground"
                        : "bg-gradient-brand text-primary-foreground"
                    }`}
                  >
                    {followLabel(isFollowing, requested)}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </BottomSheet>
  );
}
