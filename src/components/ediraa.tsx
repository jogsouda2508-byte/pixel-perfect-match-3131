import { Link } from "@tanstack/react-router";
import logoUrl from "@/assets/logo.png";
import {
  Home,
  Search,
  MessageSquare,
  User,
  BadgeCheck,
  Video,
} from "lucide-react";
import { useId, type ReactNode } from "react";
import { ComposerLauncher } from "@/components/composer";
import { UnreadBadge, useChatUnread } from "@/lib/use-chat-unread";
import { followLabel } from "@/lib/follow-state";

export function Logo({
  size = 96,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
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

/**
 * Story ring split into one arc per story (like Instagram): 2 stories = 2 arcs with a small gap
 * between them. The photo sits inside the ring.
 */
function SegmentedRing({
  segments,
  size,
  children,
}: {
  segments: number;
  size: number;
  children: ReactNode;
}) {
  const id = useId();
  const r = 48.2;
  const circumference = 2 * Math.PI * r;
  const gap = Math.min(4, (circumference / segments) * 0.3);
  const arc = circumference / segments - gap;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--primary)" }} />
            <stop offset="100%" style={{ stopColor: "var(--violet)" }} />
          </linearGradient>
        </defs>
        {Array.from({ length: segments }, (_, i) => (
          <circle
            key={i}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={`url(#${id})`}
            strokeWidth="3.2"
            strokeDasharray={`${arc} ${circumference - arc}`}
            transform={`rotate(${-90 + (i * 360) / segments + (gap / circumference) * 180} 50 50)`}
          />
        ))}
      </svg>
      <div className="absolute inset-[6%]">{children}</div>
    </div>
  );
}

export function Avatar({
  src,
  size = 40,
  ring = false,
  segments = 1,
  name,
}: {
  src?: string | null | undefined;
  size?: number;
  ring?: boolean;
  /** With `ring`: how many stories there are. The ring is split into that many arcs. */
  segments?: number;
  name?: string | undefined;
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
      className="h-full w-full rounded-full border-2 border-background object-cover"
    />
  ) : (
    <div
      className="grid h-full w-full place-items-center rounded-full border-2 border-background bg-gradient-brand font-semibold text-primary-foreground"
      style={{ fontSize: Math.max(10, size * 0.38) }}
    >
      {initials || "?"}
    </div>
  );
  if (ring && segments > 1) {
    return (
      <SegmentedRing segments={segments} size={size}>
        {photo}
      </SegmentedRing>
    );
  }
  return (
    <div
      className={ring ? "rounded-full bg-gradient-brand p-[2px]" : ""}
      style={{ width: size, height: size }}
    >
      {photo}
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
      className={`shrink-0 rounded-full font-medium transition ${large ? "px-5 py-2.5 text-sm" : compact ? "px-4 py-2 text-[11px]" : "px-4 py-2 text-sm"} ${active ? "bg-gradient-brand text-primary-foreground glow" : "border border-border bg-card text-foreground"}`}
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
        <p
          className={`truncate font-semibold ${large ? "text-base" : "text-sm"}`}
        >
          {name}
        </p>
        <p
          className={`truncate text-muted-foreground ${large ? "text-sm" : "text-xs"}`}
        >
          {sub}
        </p>
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
          className={`shrink-0 font-medium transition disabled:opacity-60 ${large ? "rounded-xl px-4 py-1.5 text-sm" : "rounded-lg px-3 py-1 text-xs"} ${following || requested ? "bg-elevated text-muted-foreground" : "border border-primary text-primary"}`}
        >
          {followLabel(following, requested)}
        </button>
      )}
    </div>
  );
}

const items = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/videos", label: "Reels", icon: Video },
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

function NavItem({
  to,
  label,
  icon: Icon,
}: {
  to: "/home" | "/videos" | "/chat" | "/discover" | "/profile";
  label: string;
  icon: typeof Home;
}) {
  const chatUnread = useChatUnread();
  const count = to === "/chat" ? chatUnread : 0;
  return (
    <Link
      to={to}
      activeOptions={{ exact: true }}
      activeProps={{
        className:
          "relative flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-primary after:absolute after:left-1/2 after:top-0.5 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        "aria-current": "page",
      }}
      inactiveProps={{
        className:
          "relative flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      }}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      <UnreadBadge count={count} className="absolute right-1/4 top-0.5" />
      <span className="text-[11px] leading-tight">{label}</span>
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
            className:
              "flex items-center gap-3 rounded-xl px-3 py-2.5 bg-elevated text-primary",
          }}
          inactiveProps={{
            className:
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-muted-foreground hover:bg-card",
          }}
        >
          <i.icon className="h-5 w-5" />
          {i.label}
          {i.to === "/chat" && (
            <UnreadBadge count={chatUnread} className="ml-auto" />
          )}
        </Link>
      ))}
      <ComposerLauncher variant="sidebar" />
    </aside>
  );
}
