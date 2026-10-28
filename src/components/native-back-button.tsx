import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { installNativeBackButton } from "@/lib/native-back";

/** Renders nothing. In the Android app, makes the back button go to the previous page. */
export function NativeBackButton() {
  const router = useRouter();
  useEffect(() => {
    let remove: (() => void) | null = null;
    let cancelled = false;
    void installNativeBackButton(() => router.history.back()).then((r) => {
      if (cancelled) r();
      else remove = r;
    });
    return () => {
      cancelled = true;
      remove?.();
    };
  }, [router]);
  return null;
}
