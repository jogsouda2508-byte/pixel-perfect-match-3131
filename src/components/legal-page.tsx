import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { COMPANY_NAME, LEGAL_UPDATED, SUPPORT_EMAIL } from "@/lib/legal";

export type LegalSection = { title: string; body: ReactNode };

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
          <Link className="hover:underline" to="/terms">
            Terms
          </Link>
          <Link className="hover:underline" to="/privacy">
            Privacy
          </Link>
          <Link className="hover:underline" to="/guidelines">
            Community Guidelines
          </Link>
          <Link className="hover:underline" to="/delete-account">
            Delete account
          </Link>
        </nav>
        <p className="text-xs text-muted-foreground">© {COMPANY_NAME}</p>
      </footer>
    </main>
  );
}
