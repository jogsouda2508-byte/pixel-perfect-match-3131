import { Link } from "@tanstack/react-router";
import { Home, Search, Plus, MessageSquare, User, BadgeCheck } from "lucide-react";
import type { ReactNode } from "react";

export const avatar = (g: "men" | "women", n: number) => `https://randomuser.me/api/portraits/${g}/${n}.jpg`;

export function Logo({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label="Ediraa logo">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3B5BFF" />
          <stop offset="1" stopColor="#7B3FF2" />
        </linearGradient>
      </defs>
      <path d="M22 58h52c1-22-13-36-31-36-19 0-31 14-31 33 0 20 14 33 33 33 12 0 22-5 28-14l-12-6c-4 5-9 8-16 8-10 0-18-6-20-18Zm1-12c2-9 10-14 19-14s16 5 18 14Z" fill="url(#lg)" />
      <path d="M62 30 88 8M74 7h15v15" stroke="#3BB0FF" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Avatar({ src, size = 40, ring = false }: { src: string; size?: number; ring?: boolean }) {
  return (
    <div className={ring ? "rounded-full bg-gradient-brand p-[2px]" : ""} style={{ width: size, height: size }}>
      <img src={src} alt="" className="h-full w-full rounded-full border-2 border-background object-cover" />
    </div>
  );
}

export const Verified = () => <BadgeCheck className="inline h-4 w-4 fill-primary text-background" />;

export function Pill({ active, children, onClick }: { active?: boolean; children: ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${active ? "bg-gradient-brand text-primary-foreground glow" : "border border-border bg-card text-foreground"}`}>
      {children}
    </button>
  );
}

export function UserRow({ name, sub, img }: { name: string; sub: string; img: string }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar src={img} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{sub}</p>
      </div>
      <button className="shrink-0 rounded-lg border border-primary px-3 py-1 text-xs font-medium text-primary">Follow</button>
    </div>
  );
}

const items = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/home", label: "Discover", icon: Search },
  { to: "/home", label: "Messages", icon: MessageSquare },
  { to: "/home", label: "Profile", icon: User },
] as const;

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-xl items-center justify-around px-2 py-2">
        {items.slice(0, 2).map((i, k) => <NavItem key={i.label} {...i} active={k === 0} />)}
        <button aria-label="Create" className="-mt-6 grid h-14 w-14 place-items-center rounded-full bg-gradient-brand text-primary-foreground glow">
          <Plus className="h-7 w-7" />
        </button>
        {items.slice(2).map((i) => <NavItem key={i.label} {...i} />)}
      </div>
    </nav>
  );
}

function NavItem({ to, label, icon: Icon, active }: { to: "/home"; label: string; icon: typeof Home; active?: boolean }) {
  return (
    <Link to={to} className={`flex flex-col items-center gap-1 text-xs ${active ? "text-primary" : "text-muted-foreground"}`}>
      <Icon className={`h-6 w-6 ${active ? "fill-primary" : ""}`} />
      {label}
    </Link>
  );
}

export function SideNav() {
  return (
    <aside className="sticky top-6 hidden h-fit flex-col gap-2 md:flex">
      <div className="mb-4 flex items-center gap-2 px-3"><Logo size={36} /><span className="text-xl font-bold">Ediraa</span></div>
      {items.map((i, k) => (
        <Link key={i.label} to={i.to} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${k === 0 ? "bg-elevated text-primary" : "text-muted-foreground hover:bg-card"}`}>
          <i.icon className="h-5 w-5" />{i.label}
        </Link>
      ))}
      <button className="mt-3 flex items-center justify-center gap-2 rounded-full bg-gradient-brand py-3 font-semibold text-primary-foreground glow"><Plus className="h-5 w-5" />Create</button>
    </aside>
  );
}
