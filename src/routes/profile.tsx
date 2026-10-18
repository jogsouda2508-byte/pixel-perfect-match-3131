import { createFileRoute } from "@tanstack/react-router";
import { ProfileView } from "@/components/profile-view";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Gicco chat" },
      { name: "description", content: "Your posts, reels and tagged photos on Gicco chat." },
      { property: "og:title", content: "Profile — Gicco chat" },
      { property: "og:description", content: "Your posts, reels and tagged photos on Gicco chat." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { profile } = useAuth();
  if (!profile) return null;
  return <ProfileView profile={profile} isMe />;
}
