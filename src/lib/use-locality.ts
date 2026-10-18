import { useEffect, useState } from "react";

const storageKey = (userId: string) => `ediraa.local-locality.${userId}`;

/**
 * The locality picked for the Local tab, remembered on this device only.
 * It is just text the person typed or chose: no GPS, no device location.
 */
export function useLocality(userId: string) {
  const [locality, setLocalityState] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    try {
      setLocalityState(window.localStorage.getItem(storageKey(userId)) || null);
    } catch {
      /* storage can be unavailable (private mode); the pick just won't persist */
    }
  }, [userId]);

  const setLocality = (value: string | null) => {
    const clean = value?.trim() || null;
    setLocalityState(clean);
    try {
      if (clean) window.localStorage.setItem(storageKey(userId), clean);
      else window.localStorage.removeItem(storageKey(userId));
    } catch {
      /* see above */
    }
  };
  return [locality, setLocality] as const;
}
