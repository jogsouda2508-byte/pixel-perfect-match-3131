import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

/** Pages where pulling down refreshes. Not on reels (swipe = next video), chat rooms, forms. */
const ENABLED = [
  "/home",
  "/discover",
  "/profile",
  "/u/",
  "/notifications",
  "/more",
  "/saved",
  "/groups",
  "/business",
  "/post/",
];
const isEnabled = (path: string) =>
  path === "/chat" || ENABLED.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`));

const THRESHOLD = 64; // how far to pull (px) before letting go refreshes
const MAX_PULL = 110;
const HOLD = 56; // where the spinner rests while refreshing

/** True if the touch started inside something that scrolls by itself and is not at its top. */
function insideScrolledArea(start: EventTarget | null): boolean {
  let el = start instanceof Element ? start : null;
  while (el && el !== document.body && el !== document.documentElement) {
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight && el.scrollTop > 0)
      return true;
    if (/(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Pull down from the top of a page to refresh its data (like Instagram): a spinner follows
 * the finger, and on release every list on screen reloads. The page itself is not reloaded,
 * so nothing is lost. Touch screens only; laptops are untouched.
 */
export function PullToRefresh() {
  const qc = useQueryClient();
  const path = useRouterState({ select: (s) => s.location.pathname }).replace(/\/+$/, "") || "/";
  const enabled = isEnabled(path);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let startY = 0;
    let active = false;
    let current = 0;

    const onStart = (e: TouchEvent) => {
      active = false;
      current = 0;
      if (refreshingRef.current || e.touches.length !== 1) return;
      if (window.scrollY > 0) return;
      // a popup, story or sheet is open: leave the touch alone
      if (document.querySelector('[role="dialog"]')) return;
      if (insideScrolledArea(e.target)) return;
      startY = e.touches[0]!.clientY;
      active = true;
    };

    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const dy = e.touches[0]!.clientY - startY;
      if (dy <= 0 || window.scrollY > 0) {
        if (current > 0) {
          current = 0;
          setPull(0);
        }
        return;
      }
      if (dy > 10 && e.cancelable) e.preventDefault(); // we handle this pull, not the browser
      current = Math.min(MAX_PULL, dy * 0.5);
      setDragging(true);
      setPull(current);
    };

    const onEnd = async () => {
      if (!active) return;
      active = false;
      setDragging(false);
      if (current < THRESHOLD) {
        current = 0;
        setPull(0);
        return;
      }
      refreshingRef.current = true;
      setRefreshing(true);
      setPull(HOLD);
      const minShow = new Promise((r) => setTimeout(r, 700));
      const reload = Promise.race([
        qc.refetchQueries({ type: "active" }).catch(() => undefined),
        new Promise((r) => setTimeout(r, 10_000)),
      ]);
      await Promise.all([minShow, reload]);
      refreshingRef.current = false;
      setRefreshing(false);
      setPull(0);
      current = 0;
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled, qc]);

  if (!enabled || (pull === 0 && !refreshing)) return null;
  const progress = Math.min(1, pull / THRESHOLD);
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center"
      style={{
        transform: `translateY(${Math.max(0, pull - 36)}px)`,
        transition: dragging ? "none" : "transform 220ms ease",
        opacity: Math.max(0.25, progress),
      }}
    >
      <div className="mt-2 grid h-9 w-9 place-items-center rounded-full bg-card shadow-lg ring-1 ring-border">
        <Loader2
          className={`h-5 w-5 text-primary ${refreshing ? "animate-spin" : ""}`}
          style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
        />
      </div>
    </div>
  );
}
