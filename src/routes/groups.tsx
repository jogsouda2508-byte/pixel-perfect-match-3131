import { createFileRoute } from "@tanstack/react-router";
import { GroupsPanel } from "@/components/groups-panel";
import { PageHeader, PageShell } from "@/components/page-shell";

export const Route = createFileRoute("/groups")({
  head: () => ({
    meta: [
      { title: "Groups — Gicco chat" },
      { name: "description", content: "Find, join and create groups on Gicco chat." },
    ],
  }),
  component: GroupsPage,
});

function GroupsPage() {
  return (
    <PageShell>
      <PageHeader title="Groups" />
      <GroupsPanel />
    </PageShell>
  );
}
