import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  ChevronRight,
  HelpCircle,
  Loader2,
  Settings,
  Star,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import { Avatar } from "@/components/ediraa";
import { PageShell } from "@/components/page-shell";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/more")({
  head: () => ({
    meta: [
      { title: "More — Gicco chat" },
      { name: "description", content: "Your profile, saved posts, settings and more." },
    ],
  }),
  component: MorePage,
});

const links = [
  { label: "My Profile", icon: User, to: "/profile" },
  { label: "Business Page", icon: Building2, to: "/business" },
  { label: "Saved Posts", icon: Star, to: "/saved" },
  { label: "Groups", icon: Users, to: "/groups" },
  { label: "Settings & Privacy", icon: Settings, to: "/settings" },
  { label: "Help & Support", icon: HelpCircle, to: "/help" },
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

  const invite = async () => {
    const url = `${window.location.origin}/signup`;
    const text = "Join me on Gicco chat — connect with people and businesses around you.";
    try {
      if (navigator.share) await navigator.share({ title: "Gicco chat", text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        toast.success("Invite link copied to clipboard");
      }
    } catch {
      /* user cancelled the share sheet */
    }
  };

  const name = profile?.full_name || profile?.username || "";

  return (
    <PageShell>
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
        {links.map((r) => (
          <Link
            key={r.label}
            to={r.to}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-sm"
          >
            <r.icon className="h-5 w-5" />
            {r.label}
            <ChevronRight className="ml-auto h-5 w-5 text-muted-foreground" />
          </Link>
        ))}
        <button
          type="button"
          onClick={invite}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm"
        >
          <UserPlus className="h-5 w-5" />
          Invite Friends
          <ChevronRight className="ml-auto h-5 w-5 text-muted-foreground" />
        </button>
      </section>
      <button
        type="button"
        onClick={logout}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-full border border-destructive py-3.5 font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-60"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}Log Out
      </button>
    </PageShell>
  );
}
