import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { fetchSavedIds, setSaved } from "@/lib/social";

/**
 * Which posts the logged-in user has bookmarked, plus an optimistic toggle.
 * One shared query, so every PostCard on screen agrees.
 */
export function useSaved() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const meId = user?.id ?? "";
  const key = useMemo(() => ["saved-ids", meId], [meId]);

  const ids = useQuery({
    queryKey: key,
    queryFn: () => fetchSavedIds(meId),
    enabled: !!meId,
    staleTime: 60_000,
  });
  const set = useMemo(() => new Set(ids.data ?? []), [ids.data]);
  // One request per post at a time: a ref blocks a fast double click before any re-render,
  // the state is what lets buttons show a disabled look while the request runs.
  const inFlight = useRef(new Set<string>());
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const toggle = useCallback(
    async (postId: string) => {
      if (!meId || inFlight.current.has(postId)) return;
      inFlight.current.add(postId);
      setPending((p) => ({ ...p, [postId]: true }));
      // Read the live cache, not a render-time snapshot, so the direction is always right.
      const was = (qc.getQueryData<string[]>(key) ?? []).includes(postId);
      const apply = (add: boolean) =>
        qc.setQueryData<string[]>(key, (old = []) =>
          add ? (old.includes(postId) ? old : [...old, postId]) : old.filter((i) => i !== postId),
        );
      apply(!was);
      try {
        await setSaved(meId, postId, !was);
        toast.success(was ? "Removed from saved" : "Saved");
        void qc.invalidateQueries({ queryKey: ["saved-posts"] });
      } catch {
        apply(was);
        toast.error("Couldn't update your saved posts. Please try again.");
      } finally {
        inFlight.current.delete(postId);
        setPending((p) => ({ ...p, [postId]: false }));
      }
    },
    [meId, qc, key],
  );

  return {
    isSaved: (postId: string) => set.has(postId),
    isPending: (postId: string) => !!pending[postId],
    toggle,
  };
}
