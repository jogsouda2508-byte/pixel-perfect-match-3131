import { createFileRoute } from "@tanstack/react-router";
import { ProfileView } from "@/components/profile-view";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Ediraa" },
      { name: "description", content: "Your posts, reels and tagged photos on Ediraa." },
      { property: "og:title", content: "Profile — Ediraa" },
      { property: "og:description", content: "Your posts, reels and tagged photos on Ediraa." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { profile } = useAuth();
  if (!profile) return null;
  return <ProfileView profile={profile} isMe />;
}
