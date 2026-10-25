import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Drawer as DrawerPrimitive } from "vaul";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/lib/auth";
import { fetchFollowList } from "@/lib/social";
import { shareCountKey } from "@/lib/post-shares";
import { shareVideoWithUser } from "@/lib/video-share";

/**
 * "Send to…" picker for a video. It only lists people the current user follows, and the
 * server (share_post_to_user) enforces the same rule, so this is a convenience, not the
 * security boundary. Sending reuses the existing chat: the video arrives as a message.
 */
export function ShareVideoDialog({
  post,
  kind = "video",
  onClose,
}: {
  post: { id: string } | null;
  /** What is being sent; only changes the wording. Defaults to a video. */
  kind?: "video" | "post";
  onClose: () => void;
}) {
  const isMobile = useIsMobile();

  // Phones: a bottom sheet, the same style as the comments sheet. The title, search box and
  // Send button stay fixed; only the list of people scrolls.
  if (isMobile) {
    return (
      <DrawerPrimitive.Root
        open={!!post}
        onOpenChange={(open) => !open && onClose()}
        shouldScaleBackground={false}
      >
        <DrawerPrimitive.Portal>
          <DrawerPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/50" />
          <DrawerPrimitive.Content
            onOpenAutoFocus={(event) => event.preventDefault()}
            className="fixed inset-x-0 bottom-0 z-[60] flex h-[75dvh] max-h-[90dvh] flex-col rounded-t-[28px] bg-background text-foreground outline-none"
          >
            <div
              aria-hidden="true"
              className="mx-auto mt-2.5 h-[3px] w-9 shrink-0 rounded-full bg-muted-foreground/60"
            />
            <DrawerPrimitive.Title className="shrink-0 pt-3 text-center text-base font-medium">
              Share {kind}
            </DrawerPrimitive.Title>
            <DrawerPrimitive.Description className="shrink-0 px-4 pb-3 pt-1 text-center text-sm text-muted-foreground">
              Send this {kind} to someone you follow.
            </DrawerPrimitive.Description>
            <div className="flex min-h-0 flex-1 flex-col px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
              {post && <RecipientList postId={post.id} kind={kind} onDone={onClose} sheet />}
            </div>
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Portal>
      </DrawerPrimitive.Root>
    );
  }

  return (
    <Dialog open={!!post} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85dvh] grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden [&>button]:grid [&>button]:h-11 [&>button]:w-11 [&>button]:place-items-center">
        <DialogHeader>
          <DialogTitle>Share {kind}</DialogTitle>
          <DialogDescription>Send this {kind} to someone you follow.</DialogDescription>
        </DialogHeader>
        {/* Rendered only while open, so search text and "Sent" marks reset each time. */}
        {post && <RecipientList postId={post.id} kind={kind} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function RecipientList({
  postId,
  kind,
  onDone,
  sheet = false,
}: {
  postId: string;
  kind: "video" | "post";
  /** Phone bottom sheet: fill the sheet so only the list scrolls. */
  sheet?: boolean;
  /** Called after everything was sent, so the dialog closes by itself. */
  onDone: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const meId = user?.id ?? "";
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // A ref (not state) so a fast double click can't start two sends before a re-render.
  const inFlight = useRef(false);

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
  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  const toggle = (id: string) => {
    if (sending) return;
    setSelected((s) => ({ ...s, [id]: !s[id] }));
    setErrors((s) => {
      const { [id]: _removed, ...rest } = s;
      return rest;
    });
  };

  const sendAll = async () => {
    if (inFlight.current || selectedIds.length === 0) return;
    inFlight.current = true;
    setSending(true);
    setErrors({});
    try {
      const results = await Promise.allSettled(
        selectedIds.map((id) => shareVideoWithUser(postId, id)),
      );
      const failed: Record<string, string> = {};
      let okCount = 0;
      results.forEach((result, index) => {
        const id = selectedIds[index]!;
        if (result.status === "fulfilled") okCount += 1;
        else
          failed[id] =
            result.reason instanceof Error ? result.reason.message : `Couldn't share this ${kind}.`;
      });
      const label = kind === "video" ? "Video" : "Post";
      if (okCount > 0) {
        void qc.invalidateQueries({ queryKey: ["chat-conversations"] });
        // Every person it was sent to counts once: show the new number right away, then confirm.
        qc.setQueryData<number>(shareCountKey(postId), (n) => (n ?? 0) + okCount);
        void qc.invalidateQueries({ queryKey: shareCountKey(postId) });
        toast.success(okCount === 1 ? `${label} sent` : `${label} sent to ${okCount} people`);
      }
      if (Object.keys(failed).length === 0) {
        onDone(); // everything went through: close the box
        return;
      }
      // Keep the box open only for the people it failed for, so they can retry.
      setSelected(Object.fromEntries(Object.keys(failed).map((id) => [id, true])));
      setErrors(failed);
      toast.error(`Couldn't send to ${Object.keys(failed).length} of ${results.length}`);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  return (
    <div className={`flex min-h-0 flex-col gap-3 ${sheet ? "flex-1" : ""}`}>
      <label className="relative block shrink-0">
        <Search
          className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search people you follow"
          aria-label="Search people you follow"
          className="min-h-11 pl-10 placeholder:text-[13px]"
        />
      </label>

      <div className={`min-h-0 overflow-y-auto ${sheet ? "flex-1" : ""}`}>
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
              You're not following anyone yet. Follow people to share {kind}s with them.
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
            const isSelected = !!selected[person.id];
            const error = errors[person.id];
            return (
              <li key={person.id} className="py-1">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isSelected}
                  aria-label={`Select ${name}`}
                  disabled={sending}
                  onClick={() => toggle(person.id)}
                  className="flex min-h-[56px] w-full items-center gap-3 rounded-lg px-1 text-left hover:bg-elevated/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  <Avatar src={person.avatar_url} name={name} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{name}</p>
                    <p className="truncate text-sm text-muted-foreground">@{person.username}</p>
                  </div>
                  <span
                    aria-hidden="true"
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border"
                    }`}
                  >
                    {isSelected && <Check className="h-4 w-4" />}
                  </span>
                </button>
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

      <Button
        type="button"
        disabled={sending || selectedIds.length === 0}
        onClick={() => void sendAll()}
        className="min-h-11 w-full shrink-0 rounded-full"
      >
        {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Send"}
      </Button>
    </div>
  );
}
