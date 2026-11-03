import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowLeft, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { useAuth } from "@/lib/auth";
import {
  BUSINESS_CATEGORIES,
  DAY_NAMES,
  formFromPage,
  newServiceDraft,
  sanitizeIndianMobile,
  sanitizePriceInput,
  saveBusinessInfo,
  useBusinessPage,
  validateBusinessForm,
  type BusinessForm,
  type HourDraft,
  type ServiceDraft,
} from "@/lib/business";

export const Route = createFileRoute("/business-edit")({
  head: () => ({
    meta: [{ title: "Edit business info — Gicco chat" }],
  }),
  component: BusinessEditPage,
});

const inputCls =
  "w-full rounded-xl border border-border bg-card px-3 py-3 text-base outline-none focus:ring-2 focus:ring-ring aria-[invalid=true]:border-destructive";

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function PhoneInput({
  id,
  value,
  onChange,
  error,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  placeholder?: string;
}) {
  return (
    <div
      className={`flex items-center overflow-hidden rounded-xl border bg-card focus-within:ring-2 focus-within:ring-ring ${error ? "border-destructive" : "border-border"}`}
    >
      <span className="select-none border-r border-border px-3 py-3 text-base text-muted-foreground">
        +91
      </span>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        value={value}
        onChange={(e) => onChange(sanitizeIndianMobile(e.target.value))}
        placeholder={placeholder ?? "98765 43210"}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        className="min-w-0 flex-1 bg-transparent px-3 py-3 text-base outline-none"
      />
    </div>
  );
}

function Switch({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  id: string;
}) {
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 shrink-0 accent-[var(--primary)]"
      />
      <span>{label}</span>
    </label>
  );
}

function BusinessEditPage() {
  const { user, profile } = useAuth();
  const meId = user?.id ?? "";
  const isBusiness = profile?.account_type === "business";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const biz = useBusinessPage(meId, isBusiness);

  const [form, setForm] = useState<BusinessForm | null>(null);
  const baseline = useRef<string>("");
  const [showErrors, setShowErrors] = useState(false);

  // Fill the form once, when the saved info has loaded.
  useEffect(() => {
    if (form || !isBusiness || biz.isLoading) return;
    const initial = formFromPage(biz.data);
    baseline.current = JSON.stringify(initial);
    setForm(initial);
  }, [form, isBusiness, biz.isLoading, biz.data]);

  // Arriving from the checklist ("#hours", "#prices", "#category"): scroll to that part.
  useEffect(() => {
    if (!form) return;
    const id = window.location.hash.replace("#", "");
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
    // only on first render of the form
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form === null]);

  const dirty = !!form && JSON.stringify(form) !== baseline.current;
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const errors = useMemo(() => (form ? validateBusinessForm(form) : null), [form]);

  const save = useMutation({
    mutationFn: (f: BusinessForm) => saveBusinessInfo(meId, f),
    onSuccess: async () => {
      baseline.current = JSON.stringify(form);
      await qc.invalidateQueries({ queryKey: ["business-page"] });
      void qc.invalidateQueries({ queryKey: ["business-directory"] });
      toast.success("Business info saved");
      void navigate({ to: "/business" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = (patch: Partial<BusinessForm>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const setHour = (dow: number, patch: Partial<HourDraft>) =>
    setForm((f) =>
      f ? { ...f, hours: f.hours.map((h) => (h.dow === dow ? { ...h, ...patch } : h)) } : f,
    );
  const setService = (key: string, patch: Partial<ServiceDraft>) =>
    setForm((f) =>
      f ? { ...f, services: f.services.map((s) => (s.key === key ? { ...s, ...patch } : s)) } : f,
    );
  const moveService = (key: string, dir: -1 | 1) =>
    setForm((f) => {
      if (!f) return f;
      const i = f.services.findIndex((s) => s.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= f.services.length) return f;
      const next = [...f.services];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return { ...f, services: next };
    });

  const onBack = (e: React.MouseEvent) => {
    if (dirty && !window.confirm("Discard your changes?")) e.preventDefault();
  };

  const submit = () => {
    if (!form || !errors) return;
    setShowErrors(true);
    if (errors.count > 0) {
      toast.error(
        errors.count === 1
          ? "Please fix 1 thing to save"
          : `Please fix ${errors.count} things to save`,
      );
      const first = document.querySelector('[aria-invalid="true"], [role="alert"]');
      first?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    save.mutate(form);
  };

  const err = (k: "category" | "phone" | "whatsapp" | "hours") =>
    showErrors ? errors?.[k] : undefined;

  if (profile && !isBusiness) {
    return (
      <PageShell>
        <div className="glass-card space-y-3 p-5 text-center">
          <h1 className="text-lg font-bold">Business account needed</h1>
          <p className="text-sm text-muted-foreground">
            Switch to a Business account first, then you can add your hours, phone and price list.
          </p>
          <Link
            to="/business"
            className="mx-auto inline-flex min-h-11 items-center rounded-full bg-gradient-brand px-6 text-sm font-semibold text-primary-foreground"
          >
            Go to Business page
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell showBottomNav={false}>
      <header className="flex items-center gap-3">
        <Link
          to="/business"
          onClick={onBack}
          aria-label="Back"
          className="grid h-11 w-11 place-items-center rounded-full hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">Edit business info</h1>
      </header>

      {!form || !errors ? (
        <div className="grid place-items-center py-16" role="status" aria-label="Loading">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4 pb-28">
          <section id="category" className="glass-card scroll-mt-20 space-y-4 p-4">
            <h2 className="font-bold">Contact</h2>
            <Field id="biz-category" label="Category" error={err("category")}>
              <select
                id="biz-category"
                value={form.category}
                onChange={(e) => set({ category: e.target.value })}
                aria-invalid={!!err("category")}
                className={inputCls}
              >
                <option value="">Choose a category</option>
                {BUSINESS_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id="biz-phone"
              label="Phone number"
              hint="Customers tap Call to dial this number"
              error={err("phone")}
            >
              <PhoneInput
                id="biz-phone"
                value={form.phone}
                onChange={(v) => set({ phone: v })}
                error={err("phone")}
              />
            </Field>
            <div>
              <Switch
                id="biz-wa-same"
                checked={form.whatsappSame}
                onChange={(v) => set({ whatsappSame: v })}
                label="WhatsApp is the same number"
              />
              {!form.whatsappSame && (
                <Field
                  id="biz-whatsapp"
                  label="WhatsApp number"
                  hint="Leave empty to hide the WhatsApp button"
                  error={err("whatsapp")}
                >
                  <PhoneInput
                    id="biz-whatsapp"
                    value={form.whatsapp}
                    onChange={(v) => set({ whatsapp: v })}
                    error={err("whatsapp")}
                  />
                </Field>
              )}
            </div>
            <Field
              id="biz-address"
              label="Address or area"
              hint="For example: Whitefield, Bengaluru"
            >
              <input
                id="biz-address"
                value={form.address}
                maxLength={200}
                onChange={(e) => set({ address: e.target.value })}
                placeholder="Area, city"
                className={inputCls}
              />
            </Field>
          </section>

          <section id="hours" className="glass-card scroll-mt-20 space-y-2 p-4">
            <h2 className="font-bold">Opening hours</h2>
            <Switch
              id="biz-hours-on"
              checked={form.hoursEnabled}
              onChange={(v) => set({ hoursEnabled: v })}
              label='Show opening hours and "Open now"'
            />
            {form.hoursEnabled && (
              <>
                <ul className="divide-y divide-border">
                  {form.hours.map((h) => (
                    <li key={h.dow} className="space-y-2 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold">{DAY_NAMES[h.dow]}</span>
                        <div className="flex items-center gap-4">
                          {!h.closed && (
                            <label className="flex min-h-9 items-center gap-1.5 text-xs">
                              <input
                                type="checkbox"
                                checked={h.allDay}
                                onChange={(e) => setHour(h.dow, { allDay: e.target.checked })}
                                className="h-4 w-4 accent-[var(--primary)]"
                              />
                              24 hours
                            </label>
                          )}
                          <label className="flex min-h-9 items-center gap-1.5 text-xs">
                            <input
                              type="checkbox"
                              checked={h.closed}
                              onChange={(e) => setHour(h.dow, { closed: e.target.checked })}
                              className="h-4 w-4 accent-[var(--primary)]"
                            />
                            Closed
                          </label>
                        </div>
                      </div>
                      {!h.closed && !h.allDay && (
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-xs text-muted-foreground">
                            Opens
                            <input
                              type="time"
                              value={h.open}
                              onChange={(e) => setHour(h.dow, { open: e.target.value })}
                              className={`${inputCls} mt-1`}
                            />
                          </label>
                          <label className="text-xs text-muted-foreground">
                            Closes
                            <input
                              type="time"
                              value={h.close}
                              onChange={(e) => setHour(h.dow, { close: e.target.value })}
                              className={`${inputCls} mt-1`}
                            />
                          </label>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => {
                    const mon = form.hours[0]!;
                    set({ hours: form.hours.map((h) => ({ ...mon, dow: h.dow })) });
                    toast.success("Monday's hours copied to every day");
                  }}
                  className="min-h-11 text-sm font-semibold text-primary"
                >
                  Copy Monday to all days
                </button>
                {err("hours") && (
                  <p role="alert" className="text-sm text-destructive">
                    {err("hours")}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Times are in Indian time. A closing time earlier than the opening time (for
                  example 6 PM to 2 AM) means you close after midnight.
                </p>
              </>
            )}
          </section>

          <section id="prices" className="glass-card scroll-mt-20 space-y-3 p-4">
            <div>
              <h2 className="font-bold">Price list</h2>
              <p className="text-xs text-muted-foreground">Prices are in rupees (₹)</p>
            </div>
            {form.services.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No items yet. Add what you sell, like "Haircut ₹200".
              </p>
            )}
            <ul className="space-y-3">
              {form.services.map((s, i) => {
                const e = showErrors ? errors.services?.[s.key] : undefined;
                return (
                  <li key={s.key} className="space-y-2 rounded-2xl border border-border p-3">
                    <div className="grid grid-cols-[1fr_130px] gap-2">
                      <div>
                        <label htmlFor={`svc-name-${s.key}`} className="sr-only">
                          Item name
                        </label>
                        <input
                          id={`svc-name-${s.key}`}
                          value={s.name}
                          maxLength={60}
                          onChange={(ev) => setService(s.key, { name: ev.target.value })}
                          placeholder="Item name"
                          aria-invalid={!!e?.name}
                          className={inputCls}
                        />
                        {e?.name && (
                          <p role="alert" className="mt-1 text-xs text-destructive">
                            {e.name}
                          </p>
                        )}
                      </div>
                      <div>
                        <label htmlFor={`svc-price-${s.key}`} className="sr-only">
                          Price in rupees
                        </label>
                        <div
                          className={`flex items-center overflow-hidden rounded-xl border bg-card focus-within:ring-2 focus-within:ring-ring ${e?.price ? "border-destructive" : "border-border"}`}
                        >
                          <span className="pl-3 text-base text-muted-foreground">₹</span>
                          <input
                            id={`svc-price-${s.key}`}
                            inputMode="decimal"
                            value={s.price}
                            onChange={(ev) =>
                              setService(s.key, { price: sanitizePriceInput(ev.target.value) })
                            }
                            placeholder="0"
                            aria-invalid={!!e?.price}
                            className="min-w-0 flex-1 bg-transparent px-2 py-3 text-base outline-none"
                          />
                        </div>
                        {e?.price && (
                          <p role="alert" className="mt-1 text-xs text-destructive">
                            {e.price}
                          </p>
                        )}
                      </div>
                    </div>
                    <label htmlFor={`svc-desc-${s.key}`} className="sr-only">
                      Short note (optional)
                    </label>
                    <input
                      id={`svc-desc-${s.key}`}
                      value={s.description}
                      maxLength={120}
                      onChange={(ev) => setService(s.key, { description: ev.target.value })}
                      placeholder="Short note (optional)"
                      className={`${inputCls} text-sm`}
                    />
                    <div className="flex items-center justify-between">
                      <label className="flex min-h-10 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={s.priceFrom}
                          onChange={(ev) => setService(s.key, { priceFrom: ev.target.checked })}
                          className="h-4 w-4 accent-[var(--primary)]"
                        />
                        Starting price ("From")
                      </label>
                      <div className="flex items-center">
                        <button
                          type="button"
                          aria-label={`Move ${s.name || "item"} up`}
                          disabled={i === 0}
                          onClick={() => moveService(s.key, -1)}
                          className="grid h-10 w-10 place-items-center rounded-full disabled:opacity-30"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${s.name || "item"} down`}
                          disabled={i === form.services.length - 1}
                          onClick={() => moveService(s.key, 1)}
                          className="grid h-10 w-10 place-items-center rounded-full disabled:opacity-30"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${s.name || "item"}`}
                          onClick={() =>
                            set({ services: form.services.filter((x) => x.key !== s.key) })
                          }
                          className="grid h-10 w-10 place-items-center rounded-full text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              disabled={form.services.length >= 50}
              onClick={() => set({ services: [...form.services, newServiceDraft()] })}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-primary text-sm font-semibold text-primary disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add item
            </button>
          </section>

          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
            <div className="mx-auto flex max-w-lg gap-3">
              <button
                type="button"
                disabled={save.isPending}
                onClick={submit}
                className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-gradient-brand text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
