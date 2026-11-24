import { createFileRoute, Link } from "@tanstack/react-router";
import { LogIn, UserPlus } from "lucide-react";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: "Welcome to SabZone" },
      {
        name: "description",
        content: "Connect with your community, share moments, and grow together.",
      },
    ],
    links: [
      { rel: "preload", as: "image", href: "/welcome-logo.png" },
      { rel: "preload", as: "image", href: "/welcome-title.png" },
    ],
  }),
  component: WelcomePage,
});

/**
 * The welcome screen fills the whole phone screen: logo on top, the "Welcome to SabZone" title,
 * the two buttons, then the Terms / Privacy links. The spacing between them stretches with the
 * screen height, so there is no big empty band at the top or bottom on tall phones.
 *
 * public/welcome-logo.png and public/welcome-title.png have transparent backgrounds.
 */
function WelcomePage() {
  return (
    <main
      className="relative flex min-h-screen min-h-dvh justify-center overflow-hidden"
      style={{
        backgroundColor: "#05010f",
        backgroundImage:
          "radial-gradient(120% 55% at 0% 0%, rgba(124,58,237,0.28) 0%, rgba(124,58,237,0) 60%)," +
          "radial-gradient(90% 45% at 100% 100%, rgba(147,51,234,0.30) 0%, rgba(147,51,234,0) 65%)," +
          "radial-gradient(70% 35% at 50% 22%, rgba(109,40,217,0.22) 0%, rgba(109,40,217,0) 70%)",
      }}
    >
      <div
        className="flex w-full max-w-[460px] flex-col items-center justify-center px-6"
        style={{
          paddingTop: "max(1.75rem, env(safe-area-inset-top))",
          paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
        }}
      >
        {/* Logo */}
        <div className="flex w-full items-center justify-center">
          <img
            src="/welcome-logo.png"
            width={640}
            height={547}
            alt="SabZone logo"
            decoding="async"
            draggable={false}
            className="select-none object-contain"
            style={{ width: "min(46vw, 22dvh, 200px)", height: "auto" }}
          />
        </div>

        {/* Welcome to SabZone + tagline */}
        <img
          src="/welcome-title.png"
          width={810}
          height={410}
          alt="Welcome to SabZone. Connect, share, and grow together."
          decoding="async"
          draggable={false}
          className="mt-3 select-none"
          style={{ width: "min(92vw, 430px)", height: "auto" }}
        />

        {/* Buttons */}
        <div className="mt-8 w-full space-y-3.5">
          <Link
            to="/signup"
            preload="render"
            className="flex h-14 w-full items-center justify-center gap-3 rounded-full text-base font-semibold text-[#1a0a1f] shadow-[0_0_28px_rgba(255,120,80,0.35)] transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            style={{ backgroundImage: "linear-gradient(90deg,#ffb020 0%,#ff6b6b 55%,#c63cff 100%)" }}
          >
            <UserPlus className="h-5 w-5" aria-hidden="true" />
            Sign Up
          </Link>
          <Link
            to="/login"
            preload="render"
            className="flex h-14 w-full items-center justify-center gap-3 rounded-full border border-[#3b2a78] bg-[#07021a]/70 text-base font-semibold text-white transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <LogIn className="h-5 w-5" aria-hidden="true" />
            Log In
          </Link>
        </div>

        {/* Legal links */}
        <nav aria-label="Legal" className="mt-5 flex items-center gap-4 text-sm text-[#8c7fd0]">
          <Link to="/terms" preload="render" className="py-2 hover:underline">
            Terms of Service
          </Link>
          <span aria-hidden="true" className="h-4 w-px bg-[#3b2a78]" />
          <Link to="/privacy" preload="render" className="py-2 hover:underline">
            Privacy Policy
          </Link>
        </nav>
      </div>
    </main>
  );
}
