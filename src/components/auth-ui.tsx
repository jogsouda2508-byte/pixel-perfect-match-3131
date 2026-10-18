import { forwardRef, useState, type ComponentProps, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Logo } from "@/components/ediraa";
import { passwordStrength } from "@/lib/validation";

/** Full-screen centered layout used by every auth screen. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="relative flex min-h-screen flex-col items-center overflow-hidden px-5 py-10">
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 400 800"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="a1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8EA2FF" stopOpacity=".55" />
            <stop offset="1" stopColor="#C9B8FF" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="a2" x1="1" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#B79CFF" stopOpacity=".6" />
            <stop offset="1" stopColor="#9FD3FF" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M150 0C280 60 260 140 400 160V0Z" fill="url(#a1)" />
        <path d="M0 800V680C140 780 300 730 400 580V800Z" fill="url(#a2)" />
      </svg>
      <div className="relative w-full max-w-md">
        <Link to="/" className="mx-auto flex w-fit items-center gap-2" aria-label="Gicco chat home">
          <Logo size={56} className="lg:h-16 lg:w-16" />
          <span className="text-2xl font-bold">Gicco chat</span>
        </Link>
        <div className="glass-card mt-6 p-6">
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {footer && <div className="mt-5 text-center text-sm text-muted-foreground">{footer}</div>}
      </div>
    </main>
  );
}

export const inputClass =
  "w-full rounded-[14px] border bg-elevated/40 px-4 py-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary";

type FieldProps = Omit<ComponentProps<"input">, "className"> & {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
};

export const TextField = forwardRef<HTMLInputElement, FieldProps>(function TextField(
  { label, error, hint, id, ...rest },
  ref,
) {
  const fid = id ?? `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <label htmlFor={fid} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        ref={ref}
        id={fid}
        aria-invalid={!!error}
        aria-describedby={error ? `${fid}-err` : undefined}
        className={`${inputClass} ${error ? "border-destructive" : "border-border"}`}
        {...rest}
      />
      {hint && !error && <div className="mt-1 text-xs">{hint}</div>}
      {error && (
        <p id={`${fid}-err`} role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
});

export function PasswordField({
  label,
  error,
  showStrength = false,
  value,
  ...rest
}: Omit<FieldProps, "type" | "hint"> & { showStrength?: boolean; value: string }) {
  const [show, setShow] = useState(false);
  const strength = passwordStrength(value);
  const colors = ["bg-destructive", "bg-destructive", "bg-yellow-500", "bg-success"];
  return (
    <div>
      <label htmlFor={`pw-${label}`} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          id={`pw-${label}`}
          type={show ? "text" : "password"}
          value={value}
          aria-invalid={!!error}
          className={`${inputClass} pr-11 ${error ? "border-destructive" : "border-border"}`}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
      {showStrength && value.length > 0 && (
        <div className="mt-2" aria-live="polite">
          <div className="flex gap-1.5">
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                className={`h-1.5 flex-1 rounded-full ${strength.score >= n ? colors[strength.score] : "bg-elevated"}`}
              />
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Password strength: {strength.label}</p>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function PrimaryButton({
  loading,
  children,
  disabled,
  ...rest
}: ComponentProps<"button"> & { loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-brand py-3.5 font-semibold text-primary-foreground glow transition disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function OutlineButton({
  loading,
  children,
  disabled,
  ...rest
}: ComponentProps<"button"> & { loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className="flex w-full items-center justify-center gap-2 rounded-full border border-primary py-3.5 font-semibold text-foreground transition hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function OrDivider() {
  return (
    <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"
      />
    </svg>
  );
}
