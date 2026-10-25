import { Link } from "@tanstack/react-router";
import logoUrl from "@/assets/logo.png";
import { Home, Search, MessageSquare, User, BadgeCheck } from "lucide-react";
import { useId, type ComponentType, type ReactNode } from "react";
import { ComposerLauncher } from "@/components/composer";
import { ReelsIcon } from "@/components/icons";
import { UnreadBadge, useChatUnread } from "@/lib/use-chat-unread";
import { followLabel } from "@/lib/follow-state";
import { useAuth } from "@/lib/auth";

export function Logo({ size = 96, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      alt="Gicco chat logo"
      decoding="async"
      className={`select-none object-contain dark:invert ${className}`}
      draggable={false}
    />
  );
}

/**
 * "Gicco" on the first line, "chat" directly underneath. Text only: the Logo
 * component above is deliberately not touched.
 */
export function BrandName({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex min-w-0 flex-col items-start" translate="no">
      <span
        className={`bg-gradient-to-r from-[#2B1B8F] via-[#4F36D6] to-[#6A33E0] bg-clip-text font-extrabold leading-[0.95] tracking-tight text-transparent dark:from-[#B9C0FF] dark:via-[#B79CFF] dark:to-[#D2B4FF] ${compact ? "text-[19px]" : "text-[26px]"}`}
      >
        Gicco
      </span>
      <span
        className={`font-semibold leading-none tracking-[0.2em] text-[#5B3FD9] dark:text-[#C9B8FF] ${compact ? "mt-0.5 text-[10px]" : "mt-1 text-xs"}`}
      >
        chat
      </span>
    </span>
  );
}

/** The existing logo next to the name, on a soft lavender surface. */
export function BrandLockup({
  compact = false,
  fill = false,
}: {
  compact?: boolean;
  fill?: boolean;
}) {
  return (
    <span
      className={`${fill ? "flex w-full justify-center" : "inline-flex"} items-center rounded-2xl bg-gradient-to-br from-[#F3EFFF] to-[#E6E0FF] ring-1 ring-[#D9D0FF]/70 dark:from-[#2A2150] dark:to-[#1F1A42] dark:ring-white/10 ${compact ? "gap-2 px-2.5 py-1.5" : "gap-3 px-3 py-2.5"}`}
    >
      <span aria-hidden="true" className="shrink-0">
        <Logo size={compact ? 28 : 40} />
      </span>
      <BrandName compact={compact} />
    </span>
  );
}

/** Premium multi-colour story ring: amber -> pink -> violet -> blue -> cyan. */
const STORY_RING_STOPS: [string, string][] = [
  ["0%", "#fbbf24"],
  ["28%", "#f43f5e"],
  ["52%", "#d946ef"],
  ["76%", "#6366f1"],
  ["100%", "#22d3ee"],
];
const STORY_RING_CSS = `linear-gradient(45deg, ${STORY_RING_STOPS.map(([o, c]) => `${c} ${o}`).join(", ")})`;

/**
 * Story ring split into one arc per story (like Instagram): 2 stories = 2 arcs with a small gap
 * between them. The photo sits inside the ring.
 */
function SegmentedRing({
  segments,
  size,
  seen,
  loading = false,
  children,
}: {
  segments: number;
  size: number;
  /** one flag per story: true = already watched (grey arc) */
  seen?: boolean[] | undefined;
  loading?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const r = 48.6;
  const circumference = 2 * Math.PI * r;
  // No gaps: the arcs touch, so several stories still look like ONE unbroken ring.
  const arc = circumference / segments;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="100" x2="100" y2="0">
            {STORY_RING_STOPS.map(([offset, color]) => (
              <stop key={offset} offset={offset} stopColor={color} />
            ))}
          </linearGradient>
        </defs>
        <g transform="rotate(-90 50 50)">
          {Array.from({ length: segments }, (_, i) => {
            const isSeen = !!seen?.[i];
            return (
              <circle
                key={i}
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke={isSeen ? undefined : `url(#${id})`}
                className={isSeen ? "stroke-neutral-300 dark:stroke-neutral-600" : undefined}
                strokeWidth="2.6"
                // a hair of overlap hides the seam between neighbouring arcs
                strokeDasharray={`${Math.min(circumference, arc + 0.4)} ${circumference}`}
                strokeDashoffset={-(i * arc)}
              />
            );
          })}
        </g>
      </svg>
      {loading && <RingLoader />}
      <div className="absolute inset-[3%]">{children}</div>
    </div>
  );
}

/**
 * Smooth, thin, multi-colour spinner drawn on top of a story ring while a story is loading.
 * A soft comet tail (transparent -> cyan -> violet -> pink -> amber) rotates around the photo.
 * Pure CSS (see .story-ring-loader in styles.css); never takes taps.
 */
function RingLoader() {
  return (
    <span
      aria-hidden="true"
      data-testid="story-ring-loader"
      className="story-ring-loader pointer-events-none absolute inset-0 rounded-full"
    />
  );
}

export function Avatar({
  src,
  size = 40,
  ring = false,
  segments = 1,
  name,
  seen,
  loading = false,
}: {
  src?: string | null | undefined;
  size?: number;
  ring?: boolean;
  /** With `ring`: how many stories there are. The ring is split into that many arcs. */
  segments?: number;
  name?: string | undefined;
  /** With `ring`: one flag per story; true = already watched, so that arc is grey. */
  seen?: boolean[] | undefined;
  /** With `ring`: show the smooth multi-colour loading animation on the ring. */
  loading?: boolean;
}) {
  const initials = (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const photo = src ? (
    <img
      src={src}
      alt=""
      className="aspect-square h-full w-full shrink-0 rounded-full border-2 border-background object-cover"
    />
  ) : (
    <div
      className="grid h-full w-full place-items-center rounded-full border-2 border-background bg-gradient-brand font-semibold text-primary-foreground"
      style={{ fontSize: Math.max(10, size * 0.38) }}
    >
      {initials || "?"}
    </div>
  );
  // every ring (1 story or many) is drawn the same way, so all story circles look identical
  if (ring) {
    return (
      <SegmentedRing segments={segments} size={size} seen={seen} loading={loading}>
        {photo}
      </SegmentedRing>
    );
  }
  const ringClass = !ring
    ? ""
    : seen?.[0]
      ? "rounded-full bg-neutral-300 p-[2px] dark:bg-neutral-600"
      : "rounded-full bg-gradient-brand p-[2px]";
  return (
    <div
      className={`relative shrink-0 ${ringClass}`}
      style={{
        width: size,
        height: size,
        ...(ring && !seen?.[0] ? { backgroundImage: STORY_RING_CSS } : {}),
      }}
    >
      {photo}
      {loading && <RingLoader />}
    </div>
  );
}

export const Verified = () => (
  <BadgeCheck className="inline h-4 w-4 fill-primary text-background" />
);

export function Pill({
  active,
  children,
  onClick,
  large = false,
  compact = false,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  /** Roomier size, used on the wide Discover page. */
  large?: boolean;
  /** Smaller size, used on the Home feed tabs. */
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full font-medium transition ${large ? "px-4 py-2 text-[11px] sm:px-5 sm:py-2.5 sm:text-sm" : compact ? "px-4 py-2 text-[11px]" : "px-4 py-2 text-sm"} ${active ? "bg-gradient-brand text-primary-foreground glow" : "border border-border bg-card text-foreground"}`}
    >
      {children}
    </button>
  );
}

export function UserRow({
  name,
  username,
  sub,
  img,
  following = false,
  requested = false,
  pending = false,
  onToggle,
  large = false,
}: {
  name: string;
  /** when given, the avatar and name link to that user's profile */
  username?: string;
  sub: string;
  img?: string | null;
  following?: boolean;
  /** A follow request to a private account is waiting for approval. */
  requested?: boolean;
  pending?: boolean;
  onToggle?: () => void;
  /** Roomier size, used on the wide Discover page. */
  large?: boolean;
}) {
  const identity = (
    <>
      <Avatar src={img} name={name} size={large ? 48 : 40} />
      <div className="min-w-0 flex-1">
        <p className={`truncate font-semibold ${large ? "text-[13px] sm:text-base" : "text-sm"}`}>{name}</p>
        <p className={`truncate text-muted-foreground ${large ? "text-[11px] sm:text-sm" : "text-xs"}`}>{sub}</p>
      </div>
    </>
  );
  return (
    <div className="flex items-center gap-3">
      {username ? (
        <Link
          to="/u/$username"
          params={{ username }}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          {identity}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{identity}</div>
      )}
      {onToggle && (
        <button
          onClick={onToggle}
          disabled={pending}
          className={`shrink-0 font-medium transition disabled:opacity-60 ${large ? "rounded-xl px-3 py-1 text-[11px] sm:px-4 sm:py-1.5 sm:text-sm" : "rounded-lg px-3 py-1 text-xs"} ${following || requested ? "bg-elevated text-muted-foreground" : "border border-primary text-primary"}`}
        >
          {followLabel(following, requested)}
        </button>
      )}
    </div>
  );
}

type NavIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

const items = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/videos", label: "Reels", icon: ReelsIcon },
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/discover", label: "Search", icon: Search },
  { to: "/profile", label: "Profile", icon: User },
] as const;

/**
 * Mobile bottom bar. The round "+" create button is opt-in (`showCreate`) and only the
 * Home page turns it on, so every other page stays clean.
 */
export function BottomNav({ showCreate = false }: { showCreate?: boolean }) {
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-xl items-center justify-around px-1 py-1">
          {items.map((i) => (
            <NavItem key={i.label} {...i} />
          ))}
        </div>
      </nav>
      {showCreate && <ComposerLauncher variant="mobile" />}
    </>
  );
}

/** Selected Home: solid rounded house with a small arched door cut out (Instagram style). */
function HomeSelectedIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10.7 2.9a2 2 0 0 1 2.6 0l7 5.8a2 2 0 0 1 .7 1.5v9.3a2.5 2.5 0 0 1-2.5 2.5H4.5A2.5 2.5 0 0 1 2 19.5v-9.3a2 2 0 0 1 .7-1.5ZM9.5 22v-5.5a2.5 2.5 0 0 1 5 0V22Z"
      />
    </svg>
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
}: {
  to: "/home" | "/videos" | "/chat" | "/discover" | "/profile";
  label: string;
  icon: NavIcon;
}) {
  const chatUnread = useChatUnread();
  const { profile } = useAuth();
  const count = to === "/chat" ? chatUnread : 0;
  const isProfile = to === "/profile";
  const avatar = isProfile ? profile?.avatar_url : null;
  const base =
    "relative flex min-h-12 min-w-0 flex-1 items-center justify-center px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";
  // Icon-only: no text, no dot, no background. Selected = stronger colour / filled Home.
  return (
    <Link
      to={to}
      aria-label={label}
      activeOptions={{ exact: true }}
      activeProps={{ className: `${base} text-foreground`, "aria-current": "page" }}
      inactiveProps={{ className: `${base} text-muted-foreground` }}
    >
      {({ isActive }: { isActive: boolean }) => (
        <>
          <span className="grid h-9 w-14 place-items-center">
            {avatar ? (
              <img
                src={avatar}
                alt=""
                aria-hidden="true"
                className={`h-7 w-7 rounded-full object-cover ${isActive ? "ring-2 ring-primary" : ""}`}
              />
            ) : isActive && to === "/home" ? (
              <HomeSelectedIcon />
            ) : (
              <Icon
                  className="h-6 w-6"
                  strokeWidth={isActive ? 2.6 : 2}
                  aria-hidden="true"
                />
            )}
          </span>
          <UnreadBadge count={count} className="absolute right-1/4 top-0.5" />
        </>
      )}
    </Link>
  );
}

export function SideNav() {
  const chatUnread = useChatUnread();
  return (
    <aside className="sticky top-6 hidden h-fit flex-col gap-2 md:flex">
      <div className="mb-4">
        <BrandLockup fill />
      </div>
      {items.map((i) => (
        <Link
          key={i.label}
          to={i.to}
          activeOptions={{ exact: true }}
          activeProps={{
            className: "flex items-center gap-3 rounded-xl px-3 py-2.5 bg-elevated text-primary",
          }}
          inactiveProps={{
            className:
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-muted-foreground hover:bg-card",
          }}
        >
          <i.icon className="h-5 w-5" />
          {i.label}
          {i.to === "/chat" && <UnreadBadge count={chatUnread} className="ml-auto" />}
        </Link>
      ))}
      <ComposerLauncher variant="sidebar" />
    </aside>
  );
}
