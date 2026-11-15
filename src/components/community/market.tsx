import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Check,
  ImagePlus,
  Loader2,
  MapPin,
  MessageCircle,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import { BottomSheet } from "@/components/bottom-sheet";
import { startConversation } from "@/lib/chat";
import {
  categoryLabel,
  conditionLabel,
  createListing,
  deleteListing,
  fetchListings,
  formatPrice,
  MARKET_CATEGORIES,
  MARKET_CONDITIONS,
  MAX_PHOTOS,
  parsePrice,
  setListingSold,
  uploadListingPhoto,
  validateListing,
  type Listing,
  type MarketCategory,
  type MarketCondition,
} from "@/lib/market";
import { validateImage } from "@/lib/social";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  Field,
  FormSheet,
  GhostButton,
  inputCls,
  PersonLine,
  PrimaryButton,
  SkeletonList,
} from "./shared";

export function MarketTab({ locality, meId }: { locality: string | null; meId: string }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MarketCategory | null>(null);
  const [sheet, setSheet] = useState(false);
  const [open, setOpen] = useState<Listing | null>(null);

  // Search as the person types, but only ask the server once they pause.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const q = useQuery({
    queryKey: ["community", "market", locality, query, category],
    queryFn: () => fetchListings({ locality, query, category }),
    staleTime: 15_000,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["community", "market"] });

  const items = q.data ?? [];
  const filtering = query !== "" || category !== null;

  return (
    <div className="space-y-4">
      <div className="glass-card flex items-center gap-3 p-3.5">
        <span className="grid h-11 w-11 max-md:h-9 max-md:w-9 shrink-0 place-items-center rounded-full bg-elevated text-primary">
          <ShoppingBag className="h-5 w-5 max-md:h-4 max-md:w-4" />
        </span>
        <p className="min-w-0 flex-1 text-sm max-md:text-xs text-muted-foreground">
          Buy, sell or give away things nearby.{" "}
          <span className="text-foreground">Chat with the seller</span> to agree a price and meet.
        </p>
        <PrimaryButton onClick={() => setSheet(true)} className="shrink-0 !px-4">
          <Plus className="h-4 w-4 max-md:h-3.5 max-md:w-3.5" /> Sell
        </PrimaryButton>
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          className={cn(inputCls, "pl-10")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search the Market"
          aria-label="Search the Market"
          maxLength={60}
        />
      </div>

      <ChipRow>
        <Chip active={category === null} onClick={() => setCategory(null)}>
          All
        </Chip>
        {MARKET_CATEGORIES.map((c) => (
          <Chip
            key={c.key}
            active={category === c.key}
            onClick={() => setCategory(category === c.key ? null : c.key)}
          >
            {c.label}
          </Chip>
        ))}
      </ChipRow>

      {q.isLoading ? (
        <SkeletonList tall />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag className="h-7 w-7" />}
          title={filtering ? "Nothing matches that" : "No items here yet"}
          text={
            filtering
              ? "Try another word or category, or look in Everywhere."
              : "Moving, decluttering or have something to give away? Be the first to list it."
          }
          action={
            filtering ? undefined : (
              <PrimaryButton onClick={() => setSheet(true)}>Sell something</PrimaryButton>
            )
          }
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((l) => (
            <li key={l.id}>
              <ListingCard l={l} onOpen={() => setOpen(l)} />
            </li>
          ))}
        </ul>
      )}

      <ListingSheet
        listing={open}
        onClose={() => setOpen(null)}
        onChanged={() => {
          setOpen(null);
          refresh();
        }}
      />
      <SellSheet
        open={sheet}
        onOpenChange={setSheet}
        locality={locality}
        meId={meId}
        onDone={refresh}
      />
    </div>
  );
}

function ListingCard({ l, onOpen }: { l: Listing; onOpen: () => void }) {
  const sold = l.sold_at !== null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="glass-card block w-full overflow-hidden text-left transition active:scale-[0.98]"
    >
      <div className="relative aspect-square bg-muted">
        {l.image_urls[0] ? (
          <img
            src={l.image_urls[0]}
            alt=""
            loading="lazy"
            className={cn("h-full w-full object-cover", sold && "opacity-50")}
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-muted-foreground">
            <ShoppingBag className="h-8 w-8" aria-hidden="true" />
          </div>
        )}
        {sold && (
          <span className="absolute left-2 top-2 rounded-full bg-foreground px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-background">
            Sold
          </span>
        )}
      </div>
      <div className="space-y-0.5 p-2.5">
        <p className="text-base max-md:text-sm font-bold">{formatPrice(l.price)}</p>
        <p className="truncate text-sm max-md:text-xs">{l.title}</p>
        <p className="flex items-center gap-1 truncate text-xs max-md:text-[11px] text-muted-foreground">
          <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{l.locality}</span>
        </p>
      </div>
    </button>
  );
}

/** One item in full: all photos, details and the Message seller button (or sold / remove for the seller). */
function ListingSheet({
  listing,
  onClose,
  onChanged,
}: {
  listing: Listing | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  // Keep the last item while the sheet slides closed, so it doesn't go blank mid-animation.
  const last = useRef<Listing | null>(null);
  if (listing) last.current = listing;
  const l = listing ?? last.current;

  const chat = useMutation({
    mutationFn: (sellerId: string) => startConversation(sellerId),
    onSuccess: (id) => navigate({ to: "/chat/$id", params: { id } }),
    onError: () => toast.error("Couldn't open the chat. Please try again."),
  });
  const sold = useMutation({
    mutationFn: (v: { id: string; sold: boolean }) => setListingSold(v.id, v.sold),
    onSuccess: (_d, v) => {
      toast.success(v.sold ? "Marked as sold" : "Back on sale");
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't update the item."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteListing(id),
    onSuccess: () => {
      toast.success("Item removed");
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't remove the item."),
  });
  const busy = chat.isPending || sold.isPending || remove.isPending;

  return (
    <BottomSheet
      open={listing !== null}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={l ? formatPrice(l.price) : "Item"}
      description={l ? l.title : ""}
      compact
      footer={
        l?.is_mine ? (
          <>
            <GhostButton
              className="flex-1 !text-destructive"
              disabled={busy}
              onClick={() => remove.mutate(l.id)}
            >
              <Trash2 className="h-4 w-4" /> Remove
            </GhostButton>
            <PrimaryButton
              className="flex-[2]"
              busy={sold.isPending}
              disabled={busy}
              onClick={() => sold.mutate({ id: l.id, sold: l.sold_at === null })}
            >
              <Check className="h-4 w-4" /> {l.sold_at === null ? "Mark as sold" : "Back on sale"}
            </PrimaryButton>
          </>
        ) : l ? (
          <PrimaryButton
            className="w-full"
            busy={chat.isPending}
            disabled={l.sold_at !== null}
            onClick={() => chat.mutate(l.seller.id)}
          >
            {!chat.isPending && <MessageCircle className="h-4 w-4" />}{" "}
            {l.sold_at !== null ? "Already sold" : "Message seller"}
          </PrimaryButton>
        ) : (
          <span />
        )
      }
    >
      {l && (
        <div className="space-y-3 pb-2">
          {l.image_urls.length > 0 && (
            <div className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {l.image_urls.map((src, i) => (
                <img
                  key={src}
                  src={src}
                  alt={`${l.title}, photo ${i + 1} of ${l.image_urls.length}`}
                  className={cn(
                    "aspect-square w-full shrink-0 snap-center rounded-2xl bg-muted object-cover",
                    l.sold_at !== null && "opacity-60",
                  )}
                />
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5 text-xs max-md:text-[11px] font-medium">
            <span className="rounded-full bg-elevated px-2.5 py-1">
              {categoryLabel(l.category)}
            </span>
            <span className="rounded-full bg-elevated px-2.5 py-1">
              {conditionLabel(l.condition)}
            </span>
            {l.sold_at !== null && (
              <span className="rounded-full bg-foreground px-2.5 py-1 text-background">Sold</span>
            )}
          </div>
          {l.description && (
            <p className="whitespace-pre-line text-sm max-md:text-xs text-foreground/90">
              {l.description}
            </p>
          )}
          <p className="flex items-center gap-1 text-xs max-md:text-[11px] text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> {l.locality} ·{" "}
            {timeAgo(l.created_at)}
          </p>
          <div className="border-t border-border pt-3">
            <PersonLine
              person={l.seller}
              sub={l.is_mine ? "You are selling this" : "Seller"}
              size={36}
            />
          </div>
          {!l.is_mine && (
            <p className="rounded-xl bg-elevated p-3 text-xs max-md:text-[11px] text-muted-foreground">
              Meet in a public place and check the item before you pay. Never send money in advance.
            </p>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

function SellSheet({
  open,
  onOpenChange,
  locality,
  meId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  locality: string | null;
  meId: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState<MarketCategory>("other");
  const [condition, setCondition] = useState<MarketCondition>("used");
  const [area, setArea] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [tried, setTried] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const place = area || locality || "";

  // Preview URLs for the chosen photos; freed when they change or the sheet unmounts.
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const errors = validateListing({
    title,
    description,
    price,
    category,
    condition,
    locality: place,
    photos: files.length,
  });

  const reset = () => {
    setTitle("");
    setDescription("");
    setPrice("");
    setCategory("other");
    setCondition("used");
    setArea("");
    setFiles([]);
    setTried(false);
  };

  const m = useMutation({
    mutationFn: async () => {
      const urls: string[] = [];
      for (const f of files) urls.push(await uploadListingPhoto(meId, f));
      await createListing(meId, {
        title,
        description,
        price: parsePrice(price) ?? 0,
        category,
        condition,
        locality: place,
        imageUrls: urls,
      });
    },
    onSuccess: () => {
      toast.success("Your item is on the Market");
      reset();
      onDone();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't post your item."),
  });

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= MAX_PHOTOS) {
        toast.error(`You can add up to ${MAX_PHOTOS} photos.`);
        break;
      }
      const problem = validateImage(f);
      if (problem) {
        toast.error(problem);
        continue;
      }
      next.push(f);
    }
    setFiles(next);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = () => {
    setTried(true);
    if (Object.keys(errors).length > 0) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    m.mutate();
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Sell something"
      description="It stays on the Market for 30 days, or until you mark it sold."
      submitLabel="Post item"
      busy={m.isPending}
      onSubmit={submit}
    >
      <div>
        <p className="mb-1.5 text-sm max-md:text-xs font-semibold">Photos</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {previews.map((src, i) => (
            <div key={src} className="relative h-20 w-20 shrink-0">
              <img
                src={src}
                alt={`Photo ${i + 1}`}
                className="h-full w-full rounded-xl object-cover"
              />
              <button
                type="button"
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
                className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-foreground text-background"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {files.length < MAX_PHOTOS && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="grid h-20 w-20 shrink-0 place-items-center rounded-xl border border-dashed border-border bg-card text-muted-foreground"
            >
              <span className="flex flex-col items-center gap-1 text-[11px] font-medium">
                <ImagePlus className="h-5 w-5" aria-hidden="true" /> Add
              </span>
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(e) => addFiles(e.target.files)}
        />
        {tried && errors.photos && (
          <p role="alert" className="mt-1 text-xs max-md:text-[11px] font-medium text-destructive">
            {errors.photos}
          </p>
        )}
      </div>

      <Field label="What are you selling?" error={tried ? errors.title : undefined}>
        <input
          className={inputCls}
          value={title}
          maxLength={80}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Wooden study table"
        />
      </Field>
      <Field
        label="Price (₹)"
        error={tried ? errors.price : undefined}
        hint="Leave empty to give it away for free."
      >
        <input
          className={inputCls}
          inputMode="decimal"
          value={price}
          maxLength={12}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="1500"
        />
      </Field>
      <div>
        <p className="mb-1.5 text-sm max-md:text-xs font-semibold">Category</p>
        <ChipRow>
          {MARKET_CATEGORIES.map((c) => (
            <Chip key={c.key} active={category === c.key} onClick={() => setCategory(c.key)}>
              {c.label}
            </Chip>
          ))}
        </ChipRow>
      </div>
      <div>
        <p className="mb-1.5 text-sm max-md:text-xs font-semibold">Condition</p>
        <ChipRow>
          {MARKET_CONDITIONS.map((c) => (
            <Chip key={c.key} active={condition === c.key} onClick={() => setCondition(c.key)}>
              {c.label}
            </Chip>
          ))}
        </ChipRow>
      </div>
      <Field label="Details (optional)">
        <textarea
          className={cn(inputCls, "min-h-20 resize-none")}
          value={description}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Size, age, any scratches, why you are selling"
        />
      </Field>
      <Field label="Area" error={tried ? errors.locality : undefined}>
        <input
          className={inputCls}
          value={place}
          maxLength={60}
          onChange={(e) => setArea(e.target.value)}
          placeholder="Whitefield"
        />
      </Field>
      {m.isPending && (
        <p className="flex items-center gap-2 text-xs max-md:text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Uploading your photos…
        </p>
      )}
    </FormSheet>
  );
}
