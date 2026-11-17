import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Copy, Link2, Loader2, MessageCircle, Share2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ediraa";
import { PageHeader, PageShell } from "@/components/page-shell";
import { useAuth } from "@/lib/auth";
import { whatsappShareHref } from "@/lib/community-share";
import { nativeCopy, nativeShareLink, isNativeApp } from "@/lib/native-share";
import { fetchReferrals, inviteMessage, inviteUrl } from "@/lib/referral";

export const Route = createFileRoute("/invite")({
  head: () => ({
    meta: [
      { title: "Invite friends — SabZone" },
      { name: "description", content: "Invite your friends and neighbours to SabZone." },
    ],
  }),
  component: InvitePage,
});

async function copyText(text: string): Promise<boolean> {
  if (isNativeApp() && (await nativeCopy(text))) return true;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function InvitePage() {
  const { user, profile } = useAuth();
  const username = profile?.username ?? "";
  const url = username ? inviteUrl(username) : "";
  const name = profile?.full_name || username;
  const message = inviteMessage(name, url);

  const joined = useQuery({
    queryKey: ["referrals", user?.id],
    queryFn: () => fetchReferrals(user!.id),
    enabled: !!user,
    retry: false,
  });

  const copy = async () => {
    const ok = !!url && (await copyText(url));
    if (ok) toast.success("Invite link copied");
    else toast.error("Couldn't copy the link");
  };

  const share = async () => {
    if (await nativeShareLink({ title: "Join me on SabZone", text: message, url })) return;
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Join me on SabZone", text: message, url });
      } catch {
        /* closed without sharing */
      }
      return;
    }
    await copy();
  };

  const people = joined.data ?? [];

  return (
    <PageShell>
      <PageHeader title="Invite friends" />
      {!profile ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
        </div>
      ) : (
        <>
          <section className="glass-card space-y-4 p-5 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-gradient-brand text-primary-foreground">
              <UserPlus className="h-7 w-7" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-semibold">Bring your neighbours to SabZone</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Share your link. When someone joins with it, you'll get a notification and they'll
                show up below.
              </p>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-left">
              <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm" data-testid="invite-url">
                {url}
              </span>
              <button
                type="button"
                onClick={copy}
                aria-label="Copy invite link"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-elevated"
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <a
                href={whatsappShareHref(message)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#25D366] text-sm font-semibold text-white"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                WhatsApp
              </a>
              <button
                type="button"
                onClick={share}
                className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-gradient-brand text-sm font-semibold text-primary-foreground"
              >
                <Share2 className="h-4 w-4" aria-hidden="true" />
                Share
              </button>
            </div>
          </section>

          <section className="glass-card p-4">
            <h2 className="mb-2 text-sm font-semibold">
              Joined with your link{joined.data ? ` (${people.length})` : ""}
            </h2>
            {joined.isLoading ? (
              <div className="space-y-2" aria-hidden="true">
                {[0, 1].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-xl bg-elevated/60" />
                ))}
              </div>
            ) : joined.error ? (
              <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                {joined.error instanceof Error ? joined.error.message : "Couldn't load your invites."}
              </p>
            ) : people.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Nobody yet. Share your link to get started.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {people.map(({ person, created_at }) => {
                  const pn = person.full_name || person.username;
                  return (
                    <li key={person.id}>
                      <Link
                        to="/u/$username"
                        params={{ username: person.username }}
                        className="flex items-center gap-3 py-2.5"
                      >
                        <Avatar src={person.avatar_url} name={pn} size={40} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{pn}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            @{person.username} · joined {new Date(created_at).toLocaleDateString()}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </PageShell>
  );
}
