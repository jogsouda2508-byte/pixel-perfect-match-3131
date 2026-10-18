import { createFileRoute } from "@tanstack/react-router";
import { VideoViewer } from "@/components/video-viewer";

export const Route = createFileRoute("/videos")({
  validateSearch: (search: Record<string, unknown>): { video?: string | undefined } => {
    const video = search["video"];
    return { video: typeof video === "string" ? video : undefined };
  },
  head: () => ({
    meta: [
      { title: "Reels — Gicco chat" },
      { name: "description", content: "Watch short reels shared by your Gicco chat community." },
    ],
  }),
  component: VideosPage,
});

function VideosPage() {
  const { video } = Route.useSearch();
  return video ? <VideoViewer initialVideoId={video} /> : <VideoViewer />;
}
