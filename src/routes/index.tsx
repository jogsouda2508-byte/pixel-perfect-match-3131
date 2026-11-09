import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { BrandSplash } from "@/components/brand-splash";
import { resolveRedirect } from "@/components/auth-gate";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SabZone — Connect • Share • Grow" },
      {
        name: "description",
        content:
          "More than just social. Build your network, grow your business and join your local community.",
      },
      { property: "og:title", content: "SabZone — Connect • Share • Grow" },
      {
        property: "og:description",
        content: "Build your network, grow your business and be part of your local community.",
      },
    ],
  }),
  // Purple from the very first paint on this screen, so there is no white flash before the CSS loads.
  styles: [{ children: "html,body{background:#7c3aed !important}" }],
  links: [
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
    { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Pacifico&display=swap" },
  ],
  component: Splash,
});

// How long the animated brand screen stays up, at minimum (ms).
const SPLASH_MIN_MS = 2600;

function Splash() {
  const { session, profile, loading } = useAuth();
  const navigate = useNavigate();

  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (loading) return;
    const wait = Math.max(250, SPLASH_MIN_MS - (Date.now() - startedAt.current));
    const timer = window.setTimeout(() => {
      const target =
        resolveRedirect("/welcome", {
          session: !!session,
          onboardingDone: !!profile?.onboarding_completed,
        }) ?? "/welcome";
      navigate({ to: target, replace: true });
    }, wait);
    return () => window.clearTimeout(timer);
  }, [loading, navigate, profile?.onboarding_completed, session]);

  return <BrandSplash />;
}
