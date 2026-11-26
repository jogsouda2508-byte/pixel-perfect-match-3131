import { APP_NAME, COMPANY_NAME, SUPPORT_EMAIL } from "@/lib/legal";
import {
  createFileRoute,
  Link,
  useCanGoBack,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { PageHeader } from "@/components/page-shell";
import { DeleteAccountButton } from "@/components/delete-account";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/delete-account")({
  head: () => ({
    meta: [
      { title: `Delete your ${APP_NAME} account` },
      {
        name: "description",
        content: `How to delete your ${APP_NAME} account and what happens to your data.`,
      },
    ],
  }),
  component: DeleteAccountPage,
});

/** Public page. Use its web address as the "account deletion link" in Google Play Console. */
function DeleteAccountPage() {
  const { user } = useAuth();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();
  return (
    <main className="mx-auto max-w-xl space-y-5 px-4 pb-10 pt-3 sm:px-6 sm:pt-5">
      <PageHeader
        title={`Delete your ${APP_NAME} account`}
        onBack={() =>
          canGoBack ? router.history.back() : navigate({ to: "/welcome", replace: true })
        }
      />
      <p className="text-sm text-muted-foreground">
        {APP_NAME} is run by {COMPANY_NAME}. You can delete your account whenever you like. It
        takes about a minute.
      </p>

      <section className="space-y-2">
        <h2 className="font-semibold">In the app</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Open More.</li>
          <li>Scroll to the bottom, below Log Out, and tap Delete my account.</li>
          <li>
            Type DELETE and enter your password to confirm. If you signed in with Google, you will
            be asked to confirm with Google first.
          </li>
        </ol>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Delete some data without deleting your account</h2>
        <p className="text-sm">
          You can also remove individual posts, stories, comments and messages inside the app.
          Your account stays active.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Posts and videos: tap the menu (three dots) on your post, then Delete post.</li>
          <li>Stories: open your story, tap the bin icon, then confirm Delete.</li>
          <li>Comments: tap the bin icon next to your comment.</li>
          <li>Messages: press and hold your message, tap Delete, then confirm.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">What is deleted</h2>
        <p className="text-sm">
          Your profile, posts, stories, comments, followers, messages you sent, market listings,
          bookings and offers, blocks and Close Friends list, notification settings, and the photos,
          videos and voice notes you uploaded. This happens right away and cannot be undone. If you
          created a group that other people are in, it passes to another member so they keep it; a
          group with nobody else in it is deleted.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">What may be kept</h2>
        <p className="text-sm">
          Reports other people made about you may be kept, without linking them to a profile, so
          that we can stop abuse. Backups are removed on their normal cycle. Copies of your messages
          that other people received may remain in their chats.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Can&apos;t sign in?</h2>
        <p className="text-sm">
          Email{" "}
          <a className="font-medium text-primary" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>{" "}
          from the address you signed up with and ask us to delete your account. We reply within 7
          days.
        </p>
      </section>

      {user ? (
        <DeleteAccountButton />
      ) : (
        <Link
          to="/login"
          className="block w-full rounded-full bg-primary py-3 text-center text-sm font-semibold text-primary-foreground"
        >
          Sign in to delete my account
        </Link>
      )}
    </main>
  );
}
