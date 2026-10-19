import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  rows: {} as Record<string, unknown[]>,
  single: {} as Record<string, unknown>,
  navigate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

/** Chainable stand-in for supabase.from(table): any filter chain resolves to the table's rows. */
function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "neq", "order", "gt"]) b[m] = () => b;
  b["maybeSingle"] = () => Promise.resolve({ data: h.single[table] ?? null, error: null });
  b["then"] = (resolve: (v: unknown) => unknown) =>
    resolve({ data: h.rows[table] ?? [], error: null });
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: h.rpc,
    from: (t: string) => builder(t),
    auth: { getUser: async () => ({ data: { user: { id: "me" } }, error: null }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<object>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => h.navigate,
    Link: (p: { children: unknown }) => <a>{p.children as never}</a>,
  };
});
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "me" } }) }));

import {
  createGroup,
  fetchGroup,
  inviteToGroup,
  removeGroupMember,
  respondToGroupInvite,
  setGroupMembership,
} from "@/lib/social";
import { getConversation, listConversations } from "@/lib/chat";
import { GroupInvites } from "@/components/group-invites";

beforeEach(() => {
  vi.clearAllMocks();
  h.rows = {};
  h.single = {};
  h.rpc.mockResolvedValue({ data: null, error: null });
});

describe("group data layer", () => {
  it("creates a group with privacy and the people to invite", async () => {
    h.rpc.mockResolvedValue({ data: "g1", error: null });
    await expect(createGroup("  Crew ", " fun ", true, ["a", "b"])).resolves.toBe("g1");
    expect(h.rpc).toHaveBeenCalledWith("create_group", {
      p_name: "Crew",
      p_description: "fun",
      p_is_private: true,
      p_invitees: ["a", "b"],
    });
  });

  it("joins, leaves, invites, answers and removes via database functions", async () => {
    await setGroupMembership("g1", "me", true);
    expect(h.rpc).toHaveBeenLastCalledWith("join_group", { p_group: "g1" });
    await setGroupMembership("g1", "me", false);
    expect(h.rpc).toHaveBeenLastCalledWith("leave_group", { p_group: "g1" });
    h.rpc.mockResolvedValue({ data: 2, error: null });
    await expect(inviteToGroup("g1", ["a", "b"])).resolves.toBe(2);
    await respondToGroupInvite("g1", false);
    expect(h.rpc).toHaveBeenLastCalledWith("respond_group_invite", {
      p_group: "g1",
      p_accept: false,
    });
    await removeGroupMember("g1", "u9");
    expect(h.rpc).toHaveBeenLastCalledWith("remove_group_member", { p_group: "g1", p_user: "u9" });
    h.rpc.mockResolvedValue({ data: [{ id: "g1" }], error: null });
    await expect(fetchGroup("g1")).resolves.toMatchObject({ id: "g1" });
  });

  it("turns database error codes into plain words", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "private_group" } });
    await expect(setGroupMembership("g1", "me", true)).rejects.toThrow(/private/i);
  });
});

describe("chat shows group conversations", () => {
  const dm = {
    id: "c-dm",
    created_at: "2026-10-18T10:00:00Z",
    last_message_at: "2026-10-18T10:05:00Z",
    last_message_preview: "yo",
    group_id: null,
  };
  const grp = {
    id: "c-g",
    created_at: "2026-10-18T09:00:00Z",
    last_message_at: "2026-10-18T11:00:00Z",
    last_message_preview: "hi team",
    group_id: "g1",
  };

  it("lists a group by name with member count next to 1:1 chats", async () => {
    h.rows["conversation_participants"] = [
      { conversation_id: "c-dm", last_read_at: "2026-10-18T10:00:00Z", user_id: "bob" },
      { conversation_id: "c-g", last_read_at: "2026-10-18T09:00:00Z", user_id: "bob" },
      { conversation_id: "c-g", last_read_at: "2026-10-18T09:00:00Z", user_id: "carol" },
    ];
    h.rows["conversations"] = [dm, grp];
    h.rows["groups"] = [{ id: "g1", name: "Weekend Crew" }];
    h.rows["profiles"] = [{ id: "bob", full_name: "Bob B", username: "bobby", avatar_url: null }];
    const list = await listConversations("me");
    const g = list.find((c) => c.id === "c-g");
    expect(g?.group).toEqual({ id: "g1", name: "Weekend Crew", memberCount: 3 });
    expect(g?.otherParticipant.full_name).toBe("Weekend Crew");
    expect(list.find((c) => c.id === "c-dm")?.otherParticipant.username).toBe("bobby");
    expect(list[0]?.id).toBe("c-g");
  });

  it("opens a group conversation with all members", async () => {
    h.rows["conversation_participants"] = [
      { user_id: "me" },
      { user_id: "bob" },
      { user_id: "carol" },
    ];
    h.single["conversations"] = { group_id: "g1" };
    h.single["groups"] = { id: "g1", name: "Weekend Crew" };
    h.rows["profiles"] = [
      { id: "bob", full_name: "Bob B", username: "bobby", avatar_url: null },
      { id: "carol", full_name: "Carol C", username: "carol", avatar_url: null },
    ];
    const c = await getConversation("c-g", "me");
    expect(c.group).toEqual({ id: "g1", name: "Weekend Crew", memberCount: 3 });
    expect(c.members.map((m) => m.username)).toEqual(["bobby", "carol"]);
  });

  it("refuses a conversation I'm not part of", async () => {
    h.rows["conversation_participants"] = [{ user_id: "bob" }];
    await expect(getConversation("c-g", "me")).rejects.toThrow(/unavailable/);
  });
});

describe("<GroupInvites />", () => {
  const invite = {
    group_id: "g1",
    group_name: "Weekend Crew",
    description: "",
    is_private: false,
    member_count: 3,
    invited_by: "u2",
    inviter_name: "Alice A",
    inviter_username: "alice",
    inviter_avatar: null,
    created_at: new Date().toISOString(),
  };
  const wrap = () =>
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <GroupInvites />
      </QueryClientProvider>,
    );
  const mockInvites = (respond: unknown) =>
    h.rpc.mockImplementation(async (name: string) =>
      name === "get_my_group_invites" ? { data: [invite], error: null } : (respond as never),
    );

  it("renders nothing without invitations", async () => {
    h.rpc.mockResolvedValue({ data: [], error: null });
    const { container } = wrap();
    await waitFor(() => expect(h.rpc).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("Accept joins the group and opens it", async () => {
    mockInvites({ data: true, error: null });
    wrap();
    expect(await screen.findByText("Weekend Crew")).toBeInTheDocument();
    expect(screen.getByText(/Alice A invited you/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith("respond_group_invite", { p_group: "g1", p_accept: true }),
    );
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("You joined Weekend Crew"));
    expect(h.navigate).toHaveBeenCalledWith({ to: "/group/$id", params: { id: "g1" } });
  });

  it("Decline does not open the group", async () => {
    mockInvites({ data: false, error: null });
    wrap();
    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Invitation declined"));
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("says so when the invitation was withdrawn", async () => {
    mockInvites({ data: null, error: { message: "no_invite" } });
    wrap();
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(expect.stringMatching(/withdrawn/)),
    );
  });
});
