import { createFileRoute } from "@tanstack/react-router";
import { VideoViewer } from "@/components/video-viewer";

export const Route = createFileRoute("/videos")({
  validateSearch: (search: Record<string, unknown>): { video?: string } => ({
    video: typeof search.video === "string" ? search.video : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Videos — Ediraa" },
      { name: "description", content: "Watch short videos shared by your Ediraa community." },
    ],
  }),
  component: VideosPage,
});

function VideosPage() {
  const { video } = Route.useSearch();
  return <VideoViewer initialVideoId={video} />;
}
