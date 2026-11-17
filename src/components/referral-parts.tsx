import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar } from "@/components/ediraa";
import { useAuth } from "@/lib/auth";
import {
  captureReferralFromUrl,
  claimReferral,
  clearStoredRef,
  fetchReferrer,
  getStoredRef,
} from "@/lib/referral";

/**
 * Mounted once at the top of the app. It does two jobs:
 *  1. when the address has ?ref=<username>, remember it on this device;
 *  2. once the person has finished setting up their profile, tell the database who invited them.
 * A definite answer (done, already counted, not allowed) clears the code; a network problem
 * keeps it for the next try. It never shows anything and never blocks the app.
 */
export function ReferralClaimer() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const claiming = useRef(false);

  useEffect(() => {
    captureReferralFromUrl();
  }, []);

  const ready = !!profile?.onboarding_completed;
  useEffect(() => {
    if (!ready || claiming.current) return;
    const code = getStoredRef();
    if (!code) return;
    claiming.current = true;
    void claimReferral(code)
      .then((result) => {
        if (result !== null) clearStoredRef();
        if (result === "ok") void qc.invalidateQueries({ queryKey: ["referrals"] });
      })
      .finally(() => {
        claiming.current = false;
      });
  }, [ready, qc]);

  return null;
}

/** On the sign-up page: "Asha invited you", when the person arrived through an invite link. */
export function InvitedByBanner() {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    setCode(captureReferralFromUrl() ?? getStoredRef());
  }, []);

  const referrer = useQuery({
    queryKey: ["referrer", code],
    queryFn: () => fetchReferrer(code!),
    enabled: !!code,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const r = referrer.data;
  if (!r) return null;
  const name = r.full_name || r.username;
  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3"
    >
      <Avatar src={r.avatar_url} name={name} size={40} />
      <p className="text-sm">
        <span className="font-semibold">{name}</span> invited you to join SabZone.
      </p>
    </div>
  );
}
