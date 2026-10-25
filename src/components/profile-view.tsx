import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  CalendarDays,
  Loader2,
  Lock,
  MapPin,
  MessageSquare,
  Play,
  Settings,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { BottomNav, SideNav, UserRow } from "@/components/ediraa";
import { Gallery, type GalleryItem } from "@/components/gallery";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import {
  fetchFollowCounts,
  fetchFollowingIds,
  fetchFollowList,
  fetchIsFollowing,
  fetchTaggedPosts,
  fetchUserPosts,
} from "@/lib/social";
import { followLabel, isProfileLocked } from "@/lib/follow-state";
import { useFollow } from "@/lib/use-follow";
import { startConversation } from "@/lib/chat";
import { fetchUserVideos } from "@/lib/videos";
import type { Profile } from "@/integrations/supabase/types";

const tabs = ["Posts", "Reels", "Tagged"] as const;

/** Shared by /profile (your own) and /u/<username> (anyone else). */
export function ProfileView({
  profile,
  isMe,
}: {
  profile: Profile;
  isMe: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<(typeof tabs)[number]>("Posts");
  const [list, setList] = useState<"followers" | "following" | null>(null);
  const [startingMessage, setStartingMessage] = useState(false);
  const name = profile.full_name || profile.username;
  const follow = useFollow();
  const joined = Number.isNaN(new Date(profile.created_at).getTime())
    ? ""
    : new Date(profile.created_at).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      });

  const followState = useQuery({
    queryKey: ["is-following", user?.id, profile.id],
    queryFn: () => fetchIsFollowing(user!.id, profile.id),
    enabled: !isMe && !!user,
  });
  const following = follow.isFollowing(profile.id, followState.data ?? false);
  const requested = follow.isRequested(profile.id);
  // Private accounts keep their posts, videos and tags hidden until the viewer is an accepted follower.
  const lockKnown = isMe || !profile.is_private || !followState.isLoading;
  const locked =
    lockKnown &&
    isProfileLocked({ isPrivate: !!profile.is_private, isMe, following });

  const counts = useQuery({
    queryKey: ["follow-counts", profile.id],
    queryFn: () => fetchFollowCounts(profile.id),
  });
  const posts = useQuery({
    queryKey: ["user-posts", profile.id],
    queryFn: () => fetchUserPosts(profile.id),
    enabled: lockKnown && !locked,
  });
  // Posts this person is tagged in (only the ones the viewer is allowed to see).
  const tagged = useQuery({
    queryKey: ["user-tagged", profile.id],
    queryFn: () => fetchTaggedPosts(profile.id),
    enabled: tab === "Tagged" && lockKnown && !locked,
  });
  const videos = useQuery({
    queryKey: ["user-videos", profile.id],
    queryFn: () => fetchUserVideos(profile.id),
    enabled: tab === "Reels" && lockKnown && !locked,
  });

  // Every photo and video post, in grid order, for the full-screen gallery.
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const galleryItems: GalleryItem[] = [];
  const galleryIndexByPost = new Map<string, number>();
  // The Posts and Tagged tabs share one grid and one full-screen gallery.
  const grid = tab === "Tagged" ? tagged : posts;
  for (const p of grid.data ?? []) {
    if (p.media_type === "video" && p.video_url) {
      galleryIndexByPost.set(p.id, galleryItems.length);
      galleryItems.push({
        id: p.id,
        type: "video",
        src: p.video_url,
        poster: p.thumbnail_url,
        caption: p.content,
      });
    } else if (p.image_url) {
      galleryIndexByPost.set(p.id, galleryItems.length);
      galleryItems.push({
        id: p.id,
        type: "image",
        src: p.image_url,
        caption: p.content,
      });
    }
  }

  const message = async () => {
    if (startingMessage) return;
    setStartingMessage(true);
    try {
      const id = await startConversation(profile.id);
      navigate({ to: "/chat/$id", params: { id } });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't start a conversation.",
      );
    } finally {
      setStartingMessage(false);
    }
  };

  const reelsContent = (
    <section aria-label="Videos" className="mt-3">
      {videos.isLoading && (
        <div className="grid grid-cols-3 gap-1.5" aria-label="Loading videos">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <div
              key={item}
              className="aspect-[9/16] animate-pulse rounded-lg bg-elevated"
            />
          ))}
        </div>
      )}
      {videos.isError && (
        <p className="glass-card p-6 text-center text-sm text-destructive">
          Couldn't load videos. Please try again.
        </p>
      )}
      {videos.isSuccess && videos.data.length === 0 && (
        <p className="glass-card p-6 text-center text-sm text-muted-foreground">
          {isMe
            ? "You haven't shared any videos yet."
            : "No videos to show yet."}
        </p>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        {videos.data?.map((video) => (
          <Link
            key={video.id}
            to="/videos"
            search={{ video: video.id }}
            aria-label={`Watch video${video.content ? `: ${video.content}` : ""}`}
            className="group relative aspect-[9/16] overflow-hidden rounded-lg bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {video.thumbnail_url ? (
              <img
                src={video.thumbnail_url}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-white">
                <Video className="h-8 w-8" aria-hidden="true" />
              </div>
            )}
            <span className="absolute bottom-2 right-2 rounded bg-black/65 px-1.5 py-0.5 text-xs text-white">
              {video.duration_seconds
                ? `${Math.ceil(video.duration_seconds)}s`
                : "Video"}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );

  return (
    <div className="mx-auto max-w-[1480px] app-page px-4 sm:px-6 pb-24 pt-0 sm:pt-5 sm:pb-28 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,680px)_300px] lg:justify-center 2xl:grid-cols-[240px_minmax(0,800px)_340px]">
      <SideNav />
      <main className="app-main min-w-0">
        <section className="glass-card overflow-hidden">
          <div className="relative px-4 pb-4 pt-5">
            <div className="flex items-center justify-between gap-3">
              {/* shrink-0 + aspect-square: the whole round photo is always shown, never squeezed or cut. */}
              <div className="aspect-square shrink-0 rounded-full bg-gradient-brand p-[3px]">
                {profile.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt={name}
                    className="block aspect-square h-20 w-20 shrink-0 rounded-full border-4 border-background object-cover md:h-24 md:w-24"
                  />
                ) : (
                  <div className="grid aspect-square h-20 w-20 shrink-0 place-items-center rounded-full border-4 border-background bg-elevated text-2xl font-bold md:h-24 md:w-24">
                    {name.slice(0, 1).toUpperCase() || "?"}
                  </div>
                )}
              </div>
              {isMe ? (
                <div className="flex items-center gap-2">
                  <Link
                    to="/settings"
                    className="rounded-full border border-primary px-3.5 py-1 text-xs font-semibold text-primary sm:px-5 sm:py-2 sm:text-sm"
                  >
                    Edit Profile
                  </Link>
                  <Link
                    to="/more"
                    aria-label="More profile options"
                    className="grid h-11 w-11 place-items-center rounded-full hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Settings className="h-5 w-5" />
                  </Link>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => follow.toggle(profile.id, following)}
                    disabled={
                      follow.isPending(profile.id) || followState.isLoading
                    }
                    className={`min-h-11 rounded-full px-5 py-2 text-sm font-semibold transition disabled:opacity-60 ${following || requested ? "bg-elevated text-muted-foreground" : "bg-gradient-brand text-primary-foreground"}`}
                  >
                    {followLabel(following, requested)}
                  </button>
                  <button
                    type="button"
                    onClick={() => void message()}
                    disabled={startingMessage}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    {startingMessage ? (
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <MessageSquare className="h-4 w-4" aria-hidden="true" />
                    )}
                    Message
                  </button>
                </div>
              )}
            </div>
            <h1 className="mt-3 flex items-center gap-1.5 text-xl font-bold">
              {name}
              {profile.is_private && (
                <span className="inline-flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  <Lock className="h-3 w-3" aria-hidden="true" />
                  Private
                </span>
              )}
              {profile.account_type === "business" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-xs font-medium text-primary">
                  <Building2 className="h-3 w-3" />
                  Business
                </span>
              )}
            </h1>
            <p className="text-sm text-muted-foreground">@{profile.username}</p>
            {profile.bio && (
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">
                {profile.bio}
              </p>
            )}
            {profile.location && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" />
                {profile.location}
              </p>
            )}
            {joined && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <CalendarDays className="h-4 w-4" />
                Joined {joined}
              </p>
            )}
            {profile.interests.length > 0 && (
              <ul
                className="mt-3 flex flex-wrap gap-1.5"
                aria-label="Interests"
              >
                {profile.interests.map((interest) => (
                  <li
                    key={interest}
                    className="rounded-full bg-elevated px-3 py-1 text-xs font-medium text-primary"
                  >
                    {interest}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 grid grid-cols-3 text-center">
              <Stat n={String(counts.data?.posts ?? 0)} l="Posts" />
              <Stat
                n={String(counts.data?.followers ?? 0)}
                l="Followers"
                {...(locked ? {} : { onClick: () => setList("followers") })}
              />
              <Stat
                n={String(counts.data?.following ?? 0)}
                l="Following"
                {...(locked ? {} : { onClick: () => setList("following") })}
              />
            </div>
          </div>
          <div
            className={`grid grid-cols-3 border-t border-border ${locked ? "hidden" : ""}`}
          >
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`py-3 text-sm font-semibold ${tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
              >
                {t}
              </button>
            ))}
          </div>
        </section>
        {!lockKnown ? (
          <div className="grid place-items-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : locked ? (
          <section
            aria-label="Private account"
            className="glass-card mt-3 flex flex-col items-center gap-2 p-8 text-center"
          >
            <span className="grid h-14 w-14 place-items-center rounded-full bg-elevated text-primary">
              <Lock className="h-6 w-6" aria-hidden="true" />
            </span>
            <h2 className="font-semibold">This account is private</h2>
            <p className="max-w-xs text-sm text-muted-foreground">
              {requested
                ? `Your request is waiting for ${name} to accept it. You'll see their posts and stories once they do.`
                : `Follow ${name} to see their posts, videos and stories. They'll need to accept your request first.`}
            </p>
          </section>
        ) : tab === "Reels" ? (
          reelsContent
        ) : (
          <>
            {grid.isLoading && (
              <div className="grid place-items-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            )}
            {grid.isError && (
              <p className="mt-3 text-center text-sm text-destructive">
                {tab === "Tagged"
                  ? "Couldn't load tagged posts."
                  : "Couldn't load posts."}
              </p>
            )}
            {grid.isSuccess && grid.data.length === 0 && (
              <p className="glass-card mt-3 p-6 text-center text-sm text-muted-foreground">
                {tab === "Tagged"
                  ? isMe
                    ? "Posts you're tagged in will appear here."
                    : "No tagged posts to show yet."
                  : isMe
                    ? "You haven't posted anything yet."
                    : "No posts to show yet."}
              </p>
            )}
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {grid.data?.map((p) =>
                p.media_type === "video" && p.video_url ? (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() =>
                      setGalleryIndex(galleryIndexByPost.get(p.id) ?? 0)
                    }
                    aria-label={`Play video${p.content ? `: ${p.content.slice(0, 60)}` : ""}`}
                    className="relative block aspect-square w-full overflow-hidden rounded-lg bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {p.thumbnail_url && (
                      <img
                        src={p.thumbnail_url}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    )}
                    <span className="absolute inset-0 grid place-items-center">
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-black/55">
                        <Play
                          className="h-5 w-5 fill-white text-white"
                          aria-hidden="true"
                        />
                      </span>
                    </span>
                  </button>
                ) : p.image_url ? (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() =>
                      setGalleryIndex(galleryIndexByPost.get(p.id) ?? 0)
                    }
                    aria-label={`Open photo${p.content ? `: ${p.content.slice(0, 60)}` : ""}`}
                    className="block aspect-square w-full overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <img
                      src={p.image_url}
                      alt={p.content.slice(0, 80)}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </button>
                ) : (
                  <div
                    key={p.id}
                    className="flex aspect-square items-center rounded-lg bg-elevated p-3"
                  >
                    <p className="line-clamp-5 break-words text-xs font-medium leading-snug">
                      {p.content}
                    </p>
                  </div>
                ),
              )}
            </div>
          </>
        )}
      </main>
      <BottomNav showCreate={isMe} />
      <Gallery
        items={galleryItems}
        startIndex={galleryIndex}
        onClose={() => setGalleryIndex(null)}
      />
      <FollowListDialog
        userId={profile.id}
        kind={list}
        onClose={() => setList(null)}
        meId={user?.id ?? ""}
      />
    </div>
  );
}

function Stat({
  n,
  l,
  onClick,
}: {
  n: string;
  l: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <p className="text-lg font-bold">{n}</p>
      <p className="text-xs text-muted-foreground">{l}</p>
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg py-1 hover:bg-elevated/60"
    >
      {body}
    </button>
  ) : (
    <div>{body}</div>
  );
}

/** Popup list of a profile's followers / following, each row linking to that person. */
function FollowListDialog({
  userId,
  kind,
  meId,
  onClose,
}: {
  userId: string;
  kind: "followers" | "following" | null;
  meId: string;
  onClose: () => void;
}) {
  const follow = useFollow();
  const people = useQuery({
    queryKey: ["follow-list", userId, kind],
    queryFn: () => fetchFollowList(userId, kind!),
    enabled: !!kind,
  });
  const mine = useQuery({
    queryKey: ["my-following", meId],
    queryFn: () => fetchFollowingIds(meId),
    enabled: !!kind && !!meId,
  });
  const mineSet = new Set(mine.data ?? []);

  return (
    <Dialog open={!!kind} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {kind === "followers" ? "Followers" : "Following"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {kind === "followers"
              ? "People who follow this profile"
              : "People this profile follows"}
          </DialogDescription>
        </DialogHeader>
        {people.isLoading && (
          <div className="grid place-items-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        )}
        {people.isError && (
          <p className="text-sm text-destructive">Couldn't load this list.</p>
        )}
        {people.isSuccess && people.data.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {kind === "followers"
              ? "No followers yet."
              : "Not following anyone yet."}
          </p>
        )}
        <div className="space-y-4">
          {people.data?.map((p) => {
            const isSelf = p.id === meId;
            const isFollowing = follow.isFollowing(p.id, mineSet.has(p.id));
            return (
              <div
                key={p.id}
                onClick={(e) => {
                  // Close the popup when a profile link is followed, but not for the Follow button.
                  if ((e.target as HTMLElement).closest("a")) onClose();
                }}
              >
                <UserRow
                  name={p.full_name || p.username}
                  username={p.username}
                  sub={`@${p.username}`}
                  img={p.avatar_url}
                  following={isFollowing}
                  requested={follow.isRequested(p.id)}
                  pending={follow.isPending(p.id)}
                  {...(isSelf
                    ? {}
                    : { onToggle: () => follow.toggle(p.id, isFollowing) })}
                />
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
