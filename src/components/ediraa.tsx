import { Link } from "@tanstack/react-router";
import logoUrl from "@/assets/logo.png";
import { Home, Search, MessageSquare, User, BadgeCheck, Video } from "lucide-react";
import type { ReactNode } from "react";
import { ComposerLauncher } from "@/components/composer";
import { UnreadBadge, useChatUnread } from "@/lib/use-chat-unread";

export function Logo({ size = 96, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      alt="Ediraa logo"
      decoding="async"
      className={`select-none object-contain dark:invert ${className}`}
      draggable={false}
    />
  );
}

export function Avatar({
  src,
  size = 40,
  ring = false,
  name,
}: {
  src?: string | null | undefined;
  size?: number;
  ring?: boolean;
  name?: string | undefined;
}) {
  const initials = (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <div
      className={ring ? "rounded-full bg-gradient-brand p-[2px]" : ""}
      style={{ width: size, height: size }}
    >
      {src ? (
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
      )}
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
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  /** Roomier size, used on the wide Discover page. */
  large?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full font-medium transition ${large ? "px-5 py-2.5 text-sm" : "px-4 py-2 text-sm"} ${active ? "bg-gradient-brand text-primary-foreground glow" : "border border-border bg-card text-foreground"}`}
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
  pending?: boolean;
  onToggle?: () => void;
  /** Roomier size, used on the wide Discover page. */
  large?: boolean;
}) {
  const identity = (
    <>
      <Avatar src={img} name={name} size={large ? 48 : 40} />
      <div className="min-w-0 flex-1">
        <p className={`truncate font-semibold ${large ? "text-base" : "text-sm"}`}>{name}</p>
        <p className={`truncate text-muted-foreground ${large ? "text-sm" : "text-xs"}`}>{sub}</p>
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
          className={`shrink-0 font-medium transition disabled:opacity-60 ${large ? "rounded-xl px-4 py-1.5 text-sm" : "rounded-lg px-3 py-1 text-xs"} ${following ? "bg-elevated text-muted-foreground" : "border border-primary text-primary"}`}
        >
          {following ? "Following" : "Follow"}
        </button>
      )}
    </div>
  );
}

const items = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/videos", label: "Videos", icon: Video },
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/discover", label: "Search", icon: Search },
  { to: "/profile", label: "Profile", icon: User },
] as const;

export function BottomNav() {
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-xl items-center justify-around px-1 py-1">
          {items.map((i) => (
            <NavItem key={i.label} {...i} />
          ))}
        </div>
      </nav>
      <ComposerLauncher variant="mobile" />
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
      <div className="mb-4 flex items-center gap-2 px-3">
        <Logo size={56} className="lg:h-16 lg:w-16 2xl:h-[4.5rem] 2xl:w-[4.5rem]" />
        <span className="text-2xl font-bold 2xl:text-3xl">Ediraa</span>
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
