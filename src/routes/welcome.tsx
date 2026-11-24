import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: "Welcome to SabZone" },
      {
        name: "description",
        content: "Connect with your community, share moments, and grow together.",
      },
    ],
    links: [{ rel: "preload", as: "image", href: "/welcome-screen.png" }],
  }),
  component: WelcomePage,
});

/** The welcome screen is the exact design image (public/welcome-screen.png), 1145 x 1374 px. */
const IMG_W = 1145;
const IMG_H = 1374;

/** Tap areas laid over the buttons / links that are drawn inside the image (pixel box in the image). */
const HOTSPOTS = [
  { to: "/signup", label: "Sign Up", x: 153, y: 928, w: 838, h: 117, round: true },
  { to: "/login", label: "Log In", x: 153, y: 1076, w: 838, h: 116, round: true },
  { to: "/terms", label: "Terms of Service", x: 305, y: 1248, w: 255, h: 50, round: false },
  { to: "/privacy", label: "Privacy Policy", x: 628, y: 1248, w: 212, h: 50, round: false },
] as const;

function WelcomePage() {
  return (
    <main
      className="flex min-h-screen min-h-dvh items-center justify-center"
      style={{ backgroundColor: "#05010f" }}
    >
      <div className="relative w-full max-w-[560px]" style={{ aspectRatio: `${IMG_W} / ${IMG_H}` }}>
        <img
          src="/welcome-screen.png"
          width={IMG_W}
          height={IMG_H}
          alt="Welcome to SabZone. Connect, share, and grow together."
          decoding="async"
          draggable={false}
          className="block h-full w-full select-none"
        />
        {HOTSPOTS.map((h) => (
          <Link
            key={h.to}
            to={h.to}
            preload="render"
            aria-label={h.label}
            className={`absolute focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
              h.round ? "rounded-full" : "rounded-md"
            }`}
            style={{
              left: `${(h.x / IMG_W) * 100}%`,
              top: `${(h.y / IMG_H) * 100}%`,
              width: `${(h.w / IMG_W) * 100}%`,
              height: `${(h.h / IMG_H) * 100}%`,
            }}
          />
        ))}
      </div>
    </main>
  );
}
