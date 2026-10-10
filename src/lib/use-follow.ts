import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { setFollow } from "@/lib/social";

/**
 * Follow / unfollow with an optimistic UI. `isFollowing(id, serverValue)` prefers the
 * local (optimistic) value, so rows don't jump around while the lists refetch.
 */
export function useFollow() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const isFollowing = useCallback((id: string, server: boolean) => local[id] ?? server, [local]);
  const isPending = useCallback((id: string) => !!pending[id], [pending]);

  const toggle = useCallback(
    async (id: string, current: boolean) => {
      if (!user || pending[id]) return;
      setLocal((s) => ({ ...s, [id]: !current }));
      setPending((s) => ({ ...s, [id]: true }));
      try {
        await setFollow(user.id, id, !current);
        // Things that depend on who I follow.
        void qc.invalidateQueries({ queryKey: ["feed"] });
        void qc.invalidateQueries({ queryKey: ["stories"] });
        void qc.invalidateQueries({ queryKey: ["follow-counts"] });
        void qc.invalidateQueries({ queryKey: ["my-following"] });
        void qc.invalidateQueries({ queryKey: ["follow-list"] });
      } catch {
        setLocal((s) => ({ ...s, [id]: current }));
        toast.error("Couldn't update follow. Please try again.");
      } finally {
        setPending((s) => ({ ...s, [id]: false }));
      }
    },
    [user, pending, qc],
  );

  return { isFollowing, isPending, toggle };
}
