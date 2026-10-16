import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ediraa";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { fetchFollowList } from "@/lib/social";
import { shareVideoWithUser } from "@/lib/video-share";

/**
 * "Send to…" picker for a video. It only lists people the current user follows, and the
 * server (share_post_to_user) enforces the same rule, so this is a convenience, not the
 * security boundary. Sending reuses the existing chat: the video arrives as a message.
 */
export function ShareVideoDialog({
  post,
  onClose,
}: {
  post: { id: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!post} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85dvh] grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden [&>button]:grid [&>button]:h-11 [&>button]:w-11 [&>button]:place-items-center">
        <DialogHeader>
          <DialogTitle>Share video</DialogTitle>
          <DialogDescription>Send this video to someone you follow.</DialogDescription>
        </DialogHeader>
        {/* Rendered only while open, so search text and "Sent" marks reset each time. */}
        {post && <RecipientList postId={post.id} />}
      </DialogContent>
    </Dialog>
  );
}

function RecipientList({ postId }: { postId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const meId = user?.id ?? "";
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  // A ref (not state) so a fast double click can't start two sends before a re-render.
  const inFlight = useRef(new Set<string>());

  // Same query key as the profile's "Following" list, so the cache is shared.
  const following = useQuery({
    queryKey: ["follow-list", meId, "following"],
    queryFn: () => fetchFollowList(meId, "following"),
    enabled: !!meId,
  });

  const term = search.trim().toLowerCase();
  const people = (following.data ?? []).filter(
    (p) =>
      !term || p.username.toLowerCase().includes(term) || p.full_name.toLowerCase().includes(term),
  );

  const send = async (recipientId: string, name: string) => {
    if (inFlight.current.has(recipientId) || sent[recipientId]) return;
    inFlight.current.add(recipientId);
    setBusy((s) => ({ ...s, [recipientId]: true }));
    setErrors((s) => {
      const { [recipientId]: _removed, ...rest } = s;
      return rest;
    });
    try {
      await shareVideoWithUser(postId, recipientId);
      setSent((s) => ({ ...s, [recipientId]: true }));
      toast.success(`Video sent to ${name}`);
      void qc.invalidateQueries({ queryKey: ["chat-conversations"] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn't share this video.";
      setErrors((s) => ({ ...s, [recipientId]: message }));
      toast.error(message);
    } finally {
      inFlight.current.delete(recipientId);
      setBusy((s) => ({ ...s, [recipientId]: false }));
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <label className="relative block">
        <Search
          className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search people you follow"
          aria-label="Search people you follow"
          className="min-h-11 pl-10"
        />
      </label>

      <div className="min-h-0 overflow-y-auto">
        {following.isLoading && (
          <div className="space-y-3 py-2" aria-label="Loading people">
            {[0, 1, 2].map((item) => (
              <div key={item} className="flex items-center gap-3">
                <Skeleton className="h-11 w-11 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        )}
        {following.isError && (
          <div className="space-y-3 py-4 text-center" role="alert">
            <p className="text-sm text-destructive">Couldn't load the people you follow.</p>
            <Button type="button" variant="outline" onClick={() => void following.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {following.isSuccess && following.data.length === 0 && (
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              You're not following anyone yet. Follow people to share videos with them.
            </p>
            <Link
              to="/discover"
              className="inline-block rounded-full border border-primary px-5 py-2 text-sm font-semibold text-primary"
            >
              Find people
            </Link>
          </div>
        )}
        {following.isSuccess && following.data.length > 0 && people.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No one you follow matches your search.
          </p>
        )}
        <ul className="divide-y divide-border">
          {people.map((person) => {
            const name = person.full_name || person.username;
            const isBusy = !!busy[person.id];
            const isSent = !!sent[person.id];
            const error = errors[person.id];
            return (
              <li key={person.id} className="py-2">
                <div className="flex min-h-[56px] items-center gap-3">
                  <Avatar src={person.avatar_url} name={name} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{name}</p>
                    <p className="truncate text-sm text-muted-foreground">@{person.username}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={isSent ? "secondary" : "default"}
                    disabled={isBusy || isSent}
                    onClick={() => void send(person.id, name)}
                    aria-label={isSent ? `Sent to ${name}` : `Send video to ${name}`}
                    className="min-h-11 min-w-[88px] shrink-0 rounded-full"
                  >
                    {isBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : isSent ? (
                      <>
                        <Check className="h-4 w-4" aria-hidden="true" />
                        Sent
                      </>
                    ) : error ? (
                      "Retry"
                    ) : (
                      "Send"
                    )}
                  </Button>
                </div>
                {error && (
                  <p className="pb-1 pl-14 text-xs text-destructive" role="alert">
                    {error}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
