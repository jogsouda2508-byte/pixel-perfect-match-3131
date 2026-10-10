import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Bookmark,
  Building2,
  ChevronRight,
  HelpCircle,
  Loader2,
  Settings,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import { Avatar, BottomNav, SideNav } from "@/components/ediraa";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/more")({
  head: () => ({
    meta: [
      { title: "More — Ediraa" },
      { name: "description", content: "Your profile, saved posts, settings and more." },
    ],
  }),
  component: MorePage,
});

const rows = [
  { label: "Business Page", icon: Building2 },
  { label: "Saved Posts", icon: Bookmark },
  { label: "Groups", icon: Users },
  { label: "Settings & Privacy", icon: Settings },
  { label: "Help & Support", icon: HelpCircle },
  { label: "Invite Friends", icon: UserPlus },
] as const;

function MorePage() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    setBusy(true);
    try {
      await signOut();
      navigate({ to: "/login", replace: true });
    } catch {
      setBusy(false);
      toast.error("Couldn't log out. Please try again.");
    }
  };

  const name = profile?.full_name || profile?.username || "";

  return (
    <div className="mx-auto max-w-6xl px-4 pb-28 pt-5 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,640px)] lg:justify-center">
      <SideNav />
      <main className="min-w-0 space-y-4">
        <h1 className="text-xl font-bold">More</h1>
        <Link to="/profile" className="glass-card flex items-center gap-3 p-4">
          <Avatar src={profile?.avatar_url} name={name} size={48} ring />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{name}</p>
            <p className="truncate text-sm text-muted-foreground">@{profile?.username}</p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </Link>
        <section className="glass-card divide-y divide-border">
          <Link to="/profile" className="flex w-full items-center gap-3 px-4 py-3.5 text-sm">
            <User className="h-5 w-5" />
            My Profile
            <ChevronRight className="ml-auto h-5 w-5 text-muted-foreground" />
          </Link>
          {rows.map((r) => (
            <button
              key={r.label}
              type="button"
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm"
            >
              <r.icon className="h-5 w-5" />
              {r.label}
              <ChevronRight className="ml-auto h-5 w-5 text-muted-foreground" />
            </button>
          ))}
        </section>
        <button
          type="button"
          onClick={logout}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-destructive py-3.5 font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}Log Out
        </button>
      </main>
      <BottomNav />
    </div>
  );
}
