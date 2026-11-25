import { Link, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-shell";
import type { ReactNode } from "react";
import { COMPANY_NAME, LEGAL_UPDATED, SUPPORT_EMAIL } from "@/lib/legal";

export type LegalSection = { title: string; body: ReactNode };

/** Legal pages go back to where the person came from; opened directly, they go to Welcome. */
function useLegalBack() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();
  return () => (canGoBack ? router.history.back() : navigate({ to: "/welcome", replace: true }));
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
  const goBack = useLegalBack();
  return (
    <main className="mx-auto max-w-2xl px-4 pb-10 pt-3 sm:px-6 sm:pt-5">
      <PageHeader title={title} onBack={goBack} />
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
