import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal-page";
import {
  APP_NAME,
  CHILD_SAFETY_EMAIL,
  CHILD_SAFETY_UPDATED,
  COMPANY_NAME,
  MIN_AGE,
} from "@/lib/legal";

export const Route = createFileRoute("/child-safety")({
  head: () => ({
    meta: [
      { title: `Child Safety Standards — ${APP_NAME}` },
      {
        name: "description",
        content: `${APP_NAME}'s published standards against child sexual abuse and exploitation (CSAE): what is banned, how to report it, and how we act on reports.`,
      },
    ],
  }),
  component: ChildSafetyPage,
});

function Mail() {
  return (
    <a className="font-medium text-primary" href={`mailto:${CHILD_SAFETY_EMAIL}`}>
      {CHILD_SAFETY_EMAIL}
    </a>
  );
}

/**
 * Public page linked from Google Play Console → App content → Child safety standards.
 * Must stay reachable without an account (it is not in auth-gate's PROTECTED list), and what it
 * says must stay true: the Report menu, the admin review queue and the contact below.
 */
function ChildSafetyPage() {
  return (
    <LegalPage
      title="Child Safety Standards"
      updated={CHILD_SAFETY_UPDATED}
      intro={`${APP_NAME}, run by ${COMPANY_NAME}, has zero tolerance for child sexual abuse and exploitation (CSAE), including child sexual abuse material (CSAM). This page explains what is banned, how to report it, and what we do when we receive a report.`}
      sections={[
        {
          title: "In short",
          body: (
            <div className="rounded-2xl border border-primary/30 bg-primary/10 p-4">
              <ul className="list-disc space-y-1 pl-5">
                <li>Any sexual content involving a child is banned and removed immediately.</li>
                <li>
                  Anyone can report it in the app: open the menu on a post, comment, story, message
                  or profile, choose Report, then <strong>Child safety concern</strong>.
                </li>
                <li>
                  Every report goes to our official admins, who review it and decide what happens
                  to the post or the account. Child safety reports are looked at first.
                </li>
                <li>
                  Confirmed cases are reported to the authorities as the law requires. Accounts
                  involved are permanently banned.
                </li>
              </ul>
            </div>
          ),
        },
        {
          title: "What is not allowed",
          body: (
            <>
              <p>
                The following is banned everywhere on {APP_NAME}: posts, stories, videos, comments,
                chats, group chats, profiles, usernames, bios, Market listings and Business pages.
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  Child sexual abuse material (CSAM): any photo, video, drawing, text or link that
                  shows or sexualises a person under 18.
                </li>
                <li>
                  Grooming: building trust with a child to sexually exploit or abuse them, or
                  asking a child for sexual content, photos or meetings.
                </li>
                <li>
                  Sexualising a minor in any way, including sexual comments about a child and
                  sexual or &quot;dirty&quot; talk with a child.
                </li>
                <li>
                  Sextortion: threatening or pressuring a child to send or keep sending sexual
                  content.
                </li>
                <li>
                  Trafficking or selling a child, or arranging the sexual exploitation of a child.
                </li>
                <li>
                  Asking for, offering, trading or linking to any of the above, on or off{" "}
                  {APP_NAME}.
                </li>
              </ul>
            </>
          ),
        },
        {
          title: "How to report in the app",
          body: (
            <>
              <p>
                Reporting is built into {APP_NAME} and works for signed-in users on the app and the
                website.
              </p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  Open the menu on a post, comment, story, message or profile and tap{" "}
                  <strong>Report</strong>.
                </li>
                <li>
                  Choose <strong>Child safety concern</strong>. You can add a short note (up to 500
                  characters) to help us.
                </li>
                <li>Tap Send report. The person you reported is never told it was you.</li>
              </ol>
              <p>
                You can also <strong>block</strong> or <strong>mute</strong> any account from the
                same menu. Blocking stops them from seeing you or messaging you.
              </p>
              <p>
                You do not need an account to tell us about a problem. Email <Mail /> with a link
                to the content or the username, and we will treat it the same way.
              </p>
            </>
          ),
        },
        {
          title: "How we review reports",
          body: (
            <>
              <p>
                Reports are stored privately and are visible only to our official admins, who use a
                separate admin dashboard that normal users cannot open. Nobody else, including the
                person who is reported, can see who made a report.
              </p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  <strong>Received.</strong> The report arrives in the admin queue marked{" "}
                  <em>open</em>, with the reason, your note, and a link to the post, comment,
                  story, message or account.
                </li>
                <li>
                  <strong>Reviewed.</strong> An admin opens the content and checks it carefully.
                  Child safety reports are reviewed first, ahead of other reports.
                </li>
                <li>
                  <strong>Decided.</strong> The admin either takes action, or closes the report as
                  not a violation. The decision is recorded on the report.
                </li>
              </ol>
              <p>Depending on what the admin finds, we can:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>remove the post, comment, story, message, listing or page;</li>
                <li>limit what the account can do;</li>
                <li>suspend the account, or ban it permanently.</li>
              </ul>
              <p>
                Content or accounts that sexualise or endanger a child are removed immediately and
                the account is banned permanently. We do not give a second chance in these cases.
              </p>
            </>
          ),
        },
        {
          title: "Reporting to the authorities",
          body: (
            <>
              <p>
                When we confirm CSAM or other child sexual abuse or exploitation on {APP_NAME}, we
                report it to the relevant authorities as the law requires, including Indian law
                enforcement and, where applicable, the National Center for Missing &amp; Exploited
                Children (NCMEC). We keep the information the law requires us to keep and share it
                with law enforcement when they lawfully ask.
              </p>
              <p>
                We follow the laws that protect children, including India&apos;s Protection of
                Children from Sexual Offences (POCSO) Act, 2012 and the Information Technology Act,
                2000 and its rules, and the child safety laws of any other place where{" "}
                {APP_NAME} is used.
              </p>
            </>
          ),
        },
        {
          title: "Age and keeping children safe",
          body: (
            <>
              <p>
                You must be at least {MIN_AGE} years old to create a {APP_NAME} account. If we find
                an account that belongs to a younger child, we close it.
              </p>
              <p>
                Parents and guardians: if you think your child is being targeted on {APP_NAME},
                block and report the account, keep screenshots, and write to us at <Mail />. You can
                also report to the National Cyber Crime Reporting Portal (cybercrime.gov.in) or
                call Childline on 1098 in India.
              </p>
            </>
          ),
        },
        {
          title: "Our contact for child safety",
          body: (
            <>
              <p>
                Our designated point of contact for child safety is <Mail />. It is monitored by
                people who are ready to talk about our CSAM prevention practices and compliance, and
                to work with Google Play, regulators and law enforcement.
              </p>
              <p>
                For other help, see our{" "}
                <Link className="font-medium text-primary" to="/guidelines">
                  Community Guidelines
                </Link>{" "}
                and{" "}
                <Link className="font-medium text-primary" to="/terms">
                  Terms of Service
                </Link>
                .
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
