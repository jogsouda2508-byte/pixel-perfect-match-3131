import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal-page";
import { APP_NAME, COMPANY_NAME, MIN_AGE, SUPPORT_EMAIL } from "@/lib/legal";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: `Terms of Service — ${APP_NAME}` },
      { name: "description", content: `The rules for using ${APP_NAME}.` },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro={`These terms are the agreement between you and ${COMPANY_NAME} for using ${APP_NAME}. By creating an account or using the app, you accept them.`}
      sections={[
        {
          title: "Who can use SabZone",
          body: (
            <p>
              You must be at least {MIN_AGE} years old, give accurate information, and keep your
              password safe. You are responsible for what happens under your account. One person,
              one account, and no impersonating others.
            </p>
          ),
        },
        {
          title: "Your content",
          body: (
            <p>
              You own what you post. By posting, you let us store, show and deliver it to the
              audience you choose, so the app can work. Only post things you have the right to
              share. Do not post other people&apos;s photos, videos, music or writing without
              permission.
            </p>
          ),
        },
        {
          title: "Rules",
          body: (
            <>
              <p>You agree to follow our Community Guidelines. In short, do not:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>harass, threaten, or bully anyone, or share hateful content;</li>
                <li>
                  post nudity, sexual content, or anything that exploits or endangers a child;
                </li>
                <li>scam, spam, or mislead people, or run fake accounts;</li>
                <li>share violent or illegal content, or help others break the law;</li>
                <li>
                  break or bypass the app&apos;s security, or collect other people&apos;s data.
                </li>
              </ul>
            </>
          ),
        },
        {
          title: "Market, businesses and bookings",
          body: (
            <p>
              The Market, Business pages, offers and bookings connect people. {APP_NAME} is not a
              party to any sale, service or booking, and does not handle payments. Meet in public
              places, check items before you pay, and never pay in advance to someone you do not
              know. Business owners are responsible for the accuracy of their pages, prices and
              offers.
            </p>
          ),
        },
        {
          title: "Reports, removal and suspension",
          body: (
            <p>
              You can report content and block people. We may remove content, limit features, or
              suspend or close accounts that break these terms or the law, with or without notice
              when safety requires it. If you think we made a mistake, write to us.
            </p>
          ),
        },
        {
          title: "Copyright",
          body: (
            <p>
              If you believe something on {APP_NAME} copies your work, send us the link, what was
              copied, and proof that you own it, at the email below. We review such complaints and
              may remove the content. Repeat infringers may lose their accounts.
            </p>
          ),
        },
        {
          title: "Ending your account",
          body: (
            <p>
              You can stop using {APP_NAME} and delete your account at any time from Settings or the
              Delete account page. Deleting removes your data as explained in the Privacy Policy.
            </p>
          ),
        },
        {
          title: "Our responsibility",
          body: (
            <p>
              We work to keep {APP_NAME} available and safe, but it is provided &quot;as is&quot;.
              To the extent the law allows, we are not responsible for what users post, for dealings
              between users, or for losses from outages or events outside our control. Nothing here
              limits rights you have under Indian consumer law.
            </p>
          ),
        },
        {
          title: "Changes, law and contact",
          body: (
            <p>
              We may update these terms and will show the new date above; continuing to use the app
              means you accept them. These terms follow the laws of India. Write to{" "}
              <a className="font-medium text-primary" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>{" "}
              for any question or complaint.
            </p>
          ),
        },
      ]}
    />
  );
}
