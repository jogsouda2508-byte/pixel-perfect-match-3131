import { Link, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { COMPANY_NAME, LEGAL_UPDATED, SUPPORT_EMAIL } from "@/lib/legal";

export type LegalSection = { title: string; body: ReactNode };

/**
 * Back arrow for the legal pages. Same idea as the Android back button: go back to the page the
 * person came from (Welcome, More, Settings, Sign up...). Only when there is nothing to go back to
 * (the page was opened directly) does it go to Welcome.
 */
function LegalBackButton() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      aria-label="Back"
      onClick={() =>
        canGoBack ? router.history.back() : navigate({ to: "/welcome", replace: true })
      }
      className="mb-4 grid h-10 w-10 place-items-center rounded-full border border-border bg-card/70 transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="h-5 w-5" />
    </button>
  );
}

/** One plain, readable page for Privacy, Terms and Community Guidelines. No sign-in needed. */
export function LegalPage({
  title,
  intro,
  sections,
  showUpdated = true,
}: {
  title: string;
  intro: string;
  sections: LegalSection[];
  showUpdated?: boolean;
}) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <LegalBackButton />
      <h1 className="text-2xl font-bold">{title}</h1>
      {showUpdated && (
        <p className="mt-1 text-xs text-muted-foreground">Last updated {LEGAL_UPDATED}</p>
      )}
      <p className="mt-4 text-sm leading-relaxed">{intro}</p>
      <div className="mt-6 space-y-6">
        {sections.map((s, i) => (
          <section key={s.title} aria-labelledby={`sec-${i}`}>
            <h2 id={`sec-${i}`} className="text-base font-semibold">
              {i + 1}. {s.title}
            </h2>
            <div className="mt-2 space-y-2 text-sm leading-relaxed text-foreground/90">
              {s.body}
            </div>
          </section>
        ))}
      </div>
      <footer className="mt-10 space-y-3 border-t border-border pt-5 text-sm">
        <p>
          Questions? Write to{" "}
          <a className="font-medium text-primary" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
        <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
          <Link className="hover:underline" to="/terms" replace>
            Terms
          </Link>
          <Link className="hover:underline" to="/privacy" replace>
            Privacy
          </Link>
          <Link className="hover:underline" to="/guidelines" replace>
            Community Guidelines
          </Link>
          <Link className="hover:underline" to="/delete-account" replace>
            Delete account
          </Link>
        </nav>
        <p className="text-xs text-muted-foreground">© {COMPANY_NAME}</p>
      </footer>
    </main>
  );
}
