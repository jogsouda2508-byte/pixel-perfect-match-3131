import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal-page";
import { APP_NAME } from "@/lib/legal";

export const Route = createFileRoute("/guidelines")({
  head: () => ({
    meta: [
      { title: `Community Guidelines — ${APP_NAME}` },
      { name: "description", content: `What is and is not okay on ${APP_NAME}.` },
    ],
  }),
  component: GuidelinesPage,
});

function GuidelinesPage() {
  return (
    <LegalPage
      showUpdated={false}
      title="Community Guidelines"
      intro={`${APP_NAME} is a place for people in the same area to connect and help each other. Keep it friendly and safe. If something breaks these rules, report it, and we will review it.`}
      sections={[
        {
          title: "Be kind",
          body: (
            <p>
              No bullying, threats, or targeting someone for who they are (religion, caste, gender,
              disability, language, region and so on). Disagree without attacking people.
            </p>
          ),
        },
        {
          title: "Keep it safe for everyone",
          body: (
            <p>
              No nudity or sexual content. Anything that sexualises or endangers a child is removed
              immediately and may be reported to the authorities. No graphic violence, and no
              content that encourages self-harm. If you or someone you know is in danger, contact
              local emergency services.
            </p>
          ),
        },
        {
          title: "Be honest",
          body: (
            <p>
              No scams, fake offers, fake reviews, or pretending to be someone else. Do not spread
              false alerts about your area. Market listings must be real items you can hand over.
            </p>
          ),
        },
        {
          title: "Respect privacy and ownership",
          body: (
            <p>
              Do not share other people&apos;s private details, photos or messages without their
              consent. Post only content you made or have permission to use.
            </p>
          ),
        },
        {
          title: "No spam",
          body: <p>No repeated posts, mass messages, or buying or selling followers and likes.</p>,
        },
        {
          title: "What happens when rules are broken",
          body: (
            <p>
              We may remove the content, limit what an account can do, or suspend it. Serious or
              repeated cases can mean a permanent ban. Blocked and reported accounts can be reviewed
              by us.
            </p>
          ),
        },
        {
          title: "How to report",
          body: (
            <p>
              Open the menu on a post, comment, story, message or profile and choose Report. You can
              also block or mute people there. Reports are private.
            </p>
          ),
        },
      ]}
    />
  );
}
