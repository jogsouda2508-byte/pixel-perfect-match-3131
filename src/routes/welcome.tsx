import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "@/components/ediraa";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: "Welcome to Gicco chat" },
      {
        name: "description",
        content: "Connect with your community, share moments, and grow together.",
      },
    ],
  }),
  component: WelcomePage,
});

function WelcomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex w-full max-w-sm flex-col items-center">
        <Logo size={104} />
        <h1 className="mt-3 text-4xl font-bold tracking-tight">Welcome to Gicco chat</h1>
        <p className="mt-3 text-sm text-muted-foreground">Connect, share, and grow together.</p>
        <div className="mt-9 flex w-full flex-col gap-3">
          <Button asChild size="lg" className="min-h-12 rounded-full">
            <Link to="/signup" preload="render">Sign Up</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="min-h-12 rounded-full">
            <Link to="/login" preload="render">Log In</Link>
          </Button>
        </div>
        <nav
          aria-label="Legal"
          className="mt-8 flex items-center gap-4 text-xs text-muted-foreground"
        >
          <a
            className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="#terms"
          >
            Terms of Service
          </a>
          <a
            className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="#privacy"
          >
            Privacy Policy
          </a>
        </nav>
      </div>
    </main>
  );
}
