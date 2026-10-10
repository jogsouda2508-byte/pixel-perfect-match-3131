import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "@/components/ediraa";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ediraa — Connect • Share • Grow" },
      { name: "description", content: "More than just social. Build your network, grow your business and join your local community." },
      { property: "og:title", content: "Ediraa — Connect • Share • Grow" },
      { property: "og:description", content: "Build your network, grow your business and be part of your local community." },
    ],
  }),
  component: Splash,
});

function Splash() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center">
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 400 800" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="c1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3B5BFF" stopOpacity=".55" /><stop offset="1" stopColor="#060B1F" stopOpacity="0" /></linearGradient>
          <linearGradient id="c2" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#7B3FF2" stopOpacity=".8" /><stop offset="1" stopColor="#3B5BFF" stopOpacity="0" /></linearGradient>
        </defs>
        <path d="M150 0C280 60 260 140 400 160V0Z" fill="url(#c1)" />
        <path d="M0 0h220C120 80 100 200 0 260Z" fill="url(#c1)" opacity=".5" />
        <path d="M0 800V640C140 760 300 700 400 520V800Z" fill="url(#c2)" />
      </svg>
      <div className="relative flex flex-col items-center">
        <Logo size={130} />
        <h1 className="mt-2 text-6xl font-bold tracking-tight">Ediraa</h1>
        <p className="mt-4 text-lg text-foreground/90">Connect <span className="mx-2">•</span> Share <span className="mx-2">•</span> Grow</p>
        <p className="mt-10 max-w-xs text-muted-foreground">More than just social. Build your network, grow your business and be part of your local community.</p>
        <div className="mt-14 flex gap-2">
          <span className="h-1.5 w-5 rounded-full bg-primary" />
          {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />)}
        </div>
        <Link to="/home" className="mt-10 w-64 rounded-full bg-gradient-brand py-3.5 font-semibold text-primary-foreground glow">Get Started</Link>
      </div>
    </main>
  );
}
