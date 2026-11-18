import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal-page";
import { APP_NAME, COMPANY_NAME, MIN_AGE, SUPPORT_EMAIL } from "@/lib/legal";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: `Privacy Policy — ${APP_NAME}` },
      { name: "description", content: `How ${APP_NAME} collects, uses and protects your data.` },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={`${APP_NAME} is run by ${COMPANY_NAME} ("we"). This page explains what we collect when you use ${APP_NAME}, why, who we share it with, and the choices you have.`}
      sections={[
        {
          title: "What we collect",
          body: (
            <>
              <p>
                <b>Account details:</b> your email address, username, name, password (stored in a
                protected form by our sign-in provider), profile photo, bio and the area you add to
                your profile.
              </p>
              <p>
                <b>What you share:</b> posts, photos, videos, stories, reels, comments, likes,
                messages and voice notes, groups, events, alerts, polls, questions, market listings,
                business pages, offers and booking requests, and the people you follow or block.
              </p>
              <p>
                <b>Phone numbers</b> only if you add one to a business page.
              </p>
              <p>
                <b>Device and notification data:</b> a token that lets us send push notifications to
                your phone or browser, and basic technical information needed to run the app.
              </p>
              <p>
                <b>Reports:</b> if you report something, we keep the report and the content it
                points to so we can review it.
              </p>
              <p>
                We do not ask for your precise GPS location. The area you choose is text you type.
              </p>
            </>
          ),
        },
        {
          title: "Why we use it",
          body: (
            <p>
              To create your account, show your content to the people you choose, deliver messages
              and notifications, show you things in your area, keep {APP_NAME} safe (reviewing
              reports, stopping spam and abuse), fix problems, and follow the law.
            </p>
          ),
        },
        {
          title: "Who can see what",
          body: (
            <p>
              Public profiles and posts can be seen by other {APP_NAME} users. If you make your
              account private, only people you approve can see your posts. Close Friends stories are
              shown only to the people on your list. Messages are visible to the people in the chat.
              Blocked people cannot see your posts or contact you.
            </p>
          ),
        },
        {
          title: "Who we share it with",
          body: (
            <>
              <p>
                We do not sell your personal data. We use these service providers to run the app:
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Supabase: database, sign-in and file storage.</li>
                <li>Google Firebase Cloud Messaging: delivering push notifications to Android.</li>
                <li>Our web hosting provider: serving the website and app files.</li>
              </ul>
              <p>
                We may share information when the law requires it, or to protect people from serious
                harm.
              </p>
            </>
          ),
        },
        {
          title: "How long we keep it",
          body: (
            <p>
              We keep your data while your account exists. When you delete your account, your
              profile, posts, stories, comments, messages you sent, followers, listings, bookings
              and uploaded files are removed. Reports about you may be kept without a link to a
              profile so we can stop abuse. Backups are removed on their normal cycle. Copies of
              messages that other people received may remain in their chats.
            </p>
          ),
        },
        {
          title: "Your choices",
          body: (
            <>
              <p>
                You can edit your profile, make your account private, block or mute people, turn
                notifications off, and delete your account in the app (More, then Settings, then
                Delete account) or through the Delete account page on our website.
              </p>
              <p>
                You can also ask to see, correct or remove your information by writing to us. We
                reply within 7 days.
              </p>
            </>
          ),
        },
        {
          title: "Security",
          body: (
            <p>
              We use access rules in our database so people can only read and change what they are
              allowed to, encrypted connections, and limits against spam. No system is perfectly
              safe. If something happens that affects your data, we will tell you as the law
              requires.
            </p>
          ),
        },
        {
          title: "Children",
          body: (
            <p>
              {APP_NAME} is for people aged {MIN_AGE} and over. If you believe a younger child has
              an account, write to us and we will remove it.
            </p>
          ),
        },
        {
          title: "Changes and contact",
          body: (
            <p>
              We will update this page when our practices change and show the new date above. For
              privacy questions or complaints, write to the Grievance Officer, {COMPANY_NAME}, at{" "}
              <a className="font-medium text-primary" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>
              . We acknowledge complaints within 24 hours and aim to resolve them within 15 days.
            </p>
          ),
        },
      ]}
    />
  );
}
