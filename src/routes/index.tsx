import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Logo } from "@/components/ediraa";
import { resolveRedirect } from "@/components/auth-gate";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ediraa — Connect • Share • Grow" },
      {
        name: "description",
        content:
          "More than just social. Build your network, grow your business and join your local community.",
      },
      { property: "og:title", content: "Ediraa — Connect • Share • Grow" },
      {
        property: "og:description",
        content: "Build your network, grow your business and be part of your local community.",
      },
    ],
  }),
  component: Splash,
});

function Splash() {
  const { session, profile, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    const timer = window.setTimeout(() => {
      const target =
        resolveRedirect("/welcome", {
          session: !!session,
          onboardingDone: !!profile?.onboarding_completed,
        }) ?? "/welcome";
      navigate({ to: target, replace: true });
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [loading, navigate, profile?.onboarding_completed, session]);

  return (
    <main
      className="grid min-h-screen place-items-center bg-background"
      aria-label="Loading Ediraa"
    >
      <Logo size={112} />
    </main>
  );
}
