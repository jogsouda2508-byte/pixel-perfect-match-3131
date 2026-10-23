import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { nextFollowAction } from "@/lib/follow-state";
import {
  cancelFollowRequest,
  fetchMyPendingRequestIds,
  sendFollowRequest,
  setFollow,
} from "@/lib/social";

/**
 * Follow / unfollow with an optimistic UI, now aware of private accounts.
 *  - `isFollowing(id, serverValue)` prefers the local (optimistic) value.
 *  - `isRequested(id)` is true while a follow request to a private account is waiting.
 *  - `toggle(id, following)` follows (or sends a request), unfollows, or cancels a request,
 *    depending on the current state.
 */
export function useFollow() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const [localRequested, setLocalRequested] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const requests = useQuery({
    queryKey: ["my-follow-requests", user?.id],
    queryFn: () => fetchMyPendingRequestIds(user!.id),
    enabled: !!user,
    staleTime: 30_000,
  });
  const serverRequested = useMemo(() => new Set(requests.data ?? []), [requests.data]);

  const isFollowing = useCallback((id: string, server: boolean) => local[id] ?? server, [local]);
  const isRequested = useCallback(
    (id: string) => (local[id] ? false : (localRequested[id] ?? serverRequested.has(id))),
    [local, localRequested, serverRequested],
  );
  const isPending = useCallback((id: string) => !!pending[id], [pending]);

  const toggle = useCallback(
    async (id: string, current: boolean) => {
      if (!user || pending[id]) return;
      const requested = isRequested(id);
      const action = nextFollowAction(current, requested);
      setPending((s) => ({ ...s, [id]: true }));
      try {
        if (action === "unfollow") {
          setLocal((s) => ({ ...s, [id]: false }));
          await setFollow(user.id, id, false);
        } else if (action === "cancel") {
          setLocalRequested((s) => ({ ...s, [id]: false }));
          await cancelFollowRequest(id);
        } else {
          // The database decides: a public account is followed at once, a private one gets a request.
          const result = await sendFollowRequest(id);
          if (result === "following") {
            setLocal((s) => ({ ...s, [id]: true }));
            setLocalRequested((s) => ({ ...s, [id]: false }));
          } else {
            setLocal((s) => ({ ...s, [id]: false }));
            setLocalRequested((s) => ({ ...s, [id]: true }));
            toast.success("Follow request sent");
          }
        }
        // Things that depend on who I follow.
        void qc.invalidateQueries({ queryKey: ["feed"] });
        void qc.invalidateQueries({ queryKey: ["stories"] });
        void qc.invalidateQueries({ queryKey: ["follow-counts"] });
        void qc.invalidateQueries({ queryKey: ["my-following"] });
        void qc.invalidateQueries({ queryKey: ["follow-list"] });
        void qc.invalidateQueries({ queryKey: ["my-follow-requests"] });
        void qc.invalidateQueries({ queryKey: ["is-following"] });
        void qc.invalidateQueries({ queryKey: ["user-posts"] });
        void qc.invalidateQueries({ queryKey: ["user-tagged"] });
        void qc.invalidateQueries({ queryKey: ["user-videos"] });
      } catch {
        // Put the button back the way it was.
        setLocal((s) => ({ ...s, [id]: current }));
        setLocalRequested((s) => ({ ...s, [id]: requested }));
        toast.error("Couldn't update follow. Please try again.");
      } finally {
        setPending((s) => ({ ...s, [id]: false }));
      }
    },
    [user, pending, qc, isRequested],
  );

  return { isFollowing, isRequested, isPending, toggle };
}
