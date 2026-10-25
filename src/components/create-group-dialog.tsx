import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Drawer as DrawerPrimitive } from "vaul";
import { Globe, Loader2, Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MemberPicker, type PickedPerson } from "@/components/member-picker";
import { useIsMobile } from "@/hooks/use-mobile";
import { createGroup } from "@/lib/social";

const NAME_MIN = 3;
const NAME_MAX = 50;
const DESC_MAX = 300;
const field =
  "w-full rounded-xl border border-border bg-elevated/40 px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary";

/** Name it, choose who can find it, pick people. They get an invitation and join once they accept. */
export function CreateGroupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [people, setPeople] = useState<PickedPerson[]>([]);

  const reset = () => {
    setName("");
    setDesc("");
    setIsPrivate(false);
    setPeople([]);
  };

  const create = useMutation({
    mutationFn: () =>
      createGroup(
        name,
        desc,
        isPrivate,
        people.map((p) => p.id),
      ),
    onSuccess: async (id) => {
      toast.success(
        people.length
          ? `Group created. ${people.length} ${people.length === 1 ? "invitation" : "invitations"} sent.`
          : "Group created",
      );
      reset();
      onOpenChange(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["groups"] }),
        qc.invalidateQueries({ queryKey: ["chat-conversations"] }),
      ]);
      navigate({ to: "/group/$id", params: { id } });
    },
    onError: (e) =>
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : `Couldn't create the group. Names must be ${NAME_MIN}–${NAME_MAX} characters.`,
      ),
  });

  const sheet = isMobile;
  const nameOk = name.trim().length >= NAME_MIN && name.trim().length <= NAME_MAX;
  const options = [
    { value: false, label: "Public", hint: "Anyone can find and join", icon: Globe },
    { value: true, label: "Private", hint: "Invite only", icon: Lock },
  ];

  const form = (
    <form
      className={sheet ? "flex min-h-0 flex-1 flex-col gap-3 px-4 pb-[max(env(safe-area-inset-bottom),1rem)]" : "space-y-4"}
      onSubmit={(e) => {
        e.preventDefault();
        if (nameOk && !create.isPending) create.mutate();
      }}
    >
      <div className={sheet ? "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" : "space-y-4"}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
          placeholder="Group name"
          aria-label="Group name"
          className={field}
        />
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value.slice(0, DESC_MAX))}
          placeholder="What is this group about? (optional)"
          aria-label="Group description"
          rows={2}
          className={`${field} resize-none`}
        />
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Who can join">
          {options.map(({ value, label, hint, icon: Icon }) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={isPrivate === value}
              onClick={() => setIsPrivate(value)}
              className={`rounded-xl border p-3 text-left transition ${isPrivate === value ? "border-primary bg-primary/10" : "border-border"}`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
            </button>
          ))}
        </div>
        <div className={sheet ? "flex min-h-[200px] flex-1 flex-col gap-2" : "space-y-2"}>
          <p className="shrink-0 text-sm font-semibold">Invite people</p>
          <MemberPicker selected={people} onChange={setPeople} fill={sheet} />
          <p className="shrink-0 text-xs text-muted-foreground">
            They'll get an invitation and can accept or decline. Only people who accept join the
            chat.
          </p>
        </div>
      </div>
      <button
        type="submit"
        disabled={!nameOk || create.isPending}
        className="flex w-full shrink-0 items-center justify-center gap-2 rounded-full bg-gradient-brand px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {people.length ? `Create and invite ${people.length}` : "Create group"}
      </button>
    </form>
  );

  // Phones: a bottom sheet, same style as the comments / share sheets. Title, fields and the
  // Create button stay put; only the list of people scrolls.
  if (isMobile) {
    return (
      <DrawerPrimitive.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
        <DrawerPrimitive.Portal>
          <DrawerPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/50" />
          <DrawerPrimitive.Content
            onOpenAutoFocus={(event) => event.preventDefault()}
            className="phone-compact-sheet fixed inset-x-0 bottom-0 z-[60] flex h-[92dvh] max-h-[92dvh] flex-col rounded-t-[28px] bg-background text-foreground outline-none"
          >
            <div
              aria-hidden="true"
              className="mx-auto mt-2.5 h-[3px] w-9 shrink-0 rounded-full bg-muted-foreground/60"
            />
            <DrawerPrimitive.Title className="shrink-0 pt-3 text-center text-base font-medium">
              New group
            </DrawerPrimitive.Title>
            <DrawerPrimitive.Description className="shrink-0 px-4 pb-3 pt-1 text-center text-sm text-muted-foreground">
              Everyone who joins can read and send messages in the group chat.
            </DrawerPrimitive.Description>
            {form}
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Portal>
      </DrawerPrimitive.Root>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="phone-compact-sheet max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
          <DialogDescription>
            Everyone who joins can read and send messages in the group chat.
          </DialogDescription>
        </DialogHeader>
        {form}
      </DialogContent>
    </Dialog>
  );
}
