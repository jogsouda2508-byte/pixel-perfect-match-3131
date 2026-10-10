import { Link } from "@tanstack/react-router";
import { Home, Search, Plus, MessageSquare, User, BadgeCheck, MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

export function Logo({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label="Ediraa logo">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3B5BFF" />
          <stop offset="1" stopColor="#7B3FF2" />
        </linearGradient>
      </defs>
      <path
        d="M22 58h52c1-22-13-36-31-36-19 0-31 14-31 33 0 20 14 33 33 33 12 0 22-5 28-14l-12-6c-4 5-9 8-16 8-10 0-18-6-20-18Zm1-12c2-9 10-14 19-14s16 5 18 14Z"
        fill="url(#lg)"
      />
      <path
        d="M62 30 88 8M74 7h15v15"
        stroke="#3BB0FF"
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${active ? "bg-gradient-brand text-primary-foreground glow" : "border border-border bg-card text-foreground"}`}
    >
      {children}
    </button>
  );
}

export function UserRow({
  name,
  sub,
  img,
  following = false,
  pending = false,
  onToggle,
}: {
  name: string;
  sub: string;
  img?: string | null;
  following?: boolean;
  pending?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Avatar src={img} name={name} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{sub}</p>
      </div>
      <button
        onClick={onToggle}
        disabled={pending}
        className={`shrink-0 rounded-lg px-3 py-1 text-xs font-medium transition disabled:opacity-60 ${following ? "bg-elevated text-muted-foreground" : "border border-primary text-primary"}`}
      >
        {following ? "Following" : "Follow"}
      </button>
    </div>
  );
}

const items = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/discover", label: "Discover", icon: Search },
  { to: "/home", label: "Messages", icon: MessageSquare },
  { to: "/profile", label: "Profile", icon: User },
] as const;

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-xl items-center justify-around px-2 py-2">
        {items.slice(0, 2).map((i) => (
          <NavItem key={i.label} {...i} />
        ))}
        <Link
          to="/create"
          aria-label="Create"
          className="-mt-6 grid h-14 w-14 place-items-center rounded-full bg-gradient-brand text-primary-foreground glow"
        >
          <Plus className="h-7 w-7" />
        </Link>
        {items.slice(2).map((i) => (
          <NavItem key={i.label} {...i} />
        ))}
      </div>
    </nav>
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
}: {
  to: "/home" | "/profile" | "/discover";
  label: string;
  icon: typeof Home;
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: true }}
      activeProps={{ className: "flex flex-col items-center gap-1 text-xs text-primary" }}
      inactiveProps={{
        className: "flex flex-col items-center gap-1 text-xs text-muted-foreground",
      }}
    >
      <Icon className="h-6 w-6" />
      {label}
    </Link>
  );
}

export function SideNav() {
  return (
    <aside className="sticky top-6 hidden h-fit flex-col gap-2 md:flex">
      <div className="mb-4 flex items-center gap-2 px-3">
        <Logo size={36} />
        <span className="text-xl font-bold">Ediraa</span>
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
        </Link>
      ))}
      <Link
        to="/more"
        activeProps={{
          className: "flex items-center gap-3 rounded-xl px-3 py-2.5 bg-elevated text-primary",
        }}
        inactiveProps={{
          className:
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-muted-foreground hover:bg-card",
        }}
      >
        <MoreHorizontal className="h-5 w-5" />
        More
      </Link>
      <Link
        to="/create"
        className="mt-3 flex items-center justify-center gap-2 rounded-full bg-gradient-brand py-3 font-semibold text-primary-foreground glow"
      >
        <Plus className="h-5 w-5" />
        Create
      </Link>
    </aside>
  );
}
