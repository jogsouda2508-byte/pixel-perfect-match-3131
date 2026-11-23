import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  ChevronRight,
  UsersRound,
  HelpCircle,
  Loader2,
  Settings,
  Share2,
  Star,
  User,
  Users,
} from "lucide-react";
import { DeleteAccountButton } from "@/components/delete-account";
import { Avatar } from "@/components/ediraa";
import { LocalTiles } from "@/components/local-tiles";
import { PageShell } from "@/components/page-shell";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/more")({
  head: () => ({
    meta: [
      { title: "More — SabZone" },
      { name: "description", content: "Your profile, saved posts, settings and more." },
    ],
  }),
  component: MorePage,
});

const links = [
  { label: "My Profile", icon: User, to: "/my-profile" },
  { label: "Community", icon: UsersRound, to: "/community" },
  { label: "Business Page", icon: Building2, to: "/business" },
  { label: "Saved Posts", icon: Star, to: "/saved" },
  { label: "Invite friends", icon: Share2, to: "/invite" },
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

  const name = profile?.full_name || profile?.username || "";

  return (
    <PageShell>
      <h1 className="text-xl font-bold">More</h1>
      <Link to="/profile" className="glass-card more-profile-card flex items-center gap-3 p-4">
        <Avatar src={profile?.avatar_url} name={name} size={48} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{name}</p>
          <p className="truncate text-sm text-muted-foreground">@{profile?.username}</p>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </Link>
      {/* The "Around you" shortcuts used to sit on the Home feed. */}
      <LocalTiles area={null} grid />
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
      </section>
      <button
        type="button"
        onClick={logout}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-full border border-destructive py-3.5 font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-60"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}Log Out
      </button>
      {/* Asks to type DELETE (and the password) before anything is removed. */}
      <DeleteAccountButton />
    </PageShell>
  );
}
