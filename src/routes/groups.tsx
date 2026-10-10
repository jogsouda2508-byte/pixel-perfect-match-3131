import { createFileRoute } from "@tanstack/react-router";
import { GroupsPanel } from "@/components/groups-panel";
import { PageHeader, PageShell } from "@/components/page-shell";

export const Route = createFileRoute("/groups")({
  head: () => ({
    meta: [
      { title: "Groups — Ediraa" },
      { name: "description", content: "Find, join and create groups on Ediraa." },
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
