import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters")
  .max(20, "Username can be at most 20 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "Only letters, numbers and underscores");

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .email("Enter a valid email address");

export const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "Use international format, e.g. +919876543210");

export type Strength = { score: 0 | 1 | 2 | 3; label: "Too short" | "Weak" | "Medium" | "Strong" };

export function passwordStrength(pw: string): Strength {
  if (pw.length < 8) return { score: 0, label: "Too short" };
  let points = 0;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) points++;
  if (/\d/.test(pw)) points++;
  if (/[^A-Za-z0-9]/.test(pw)) points++;
  if (pw.length >= 12) points++;
  if (points <= 1) return { score: 1, label: "Weak" };
  if (points === 2) return { score: 2, label: "Medium" };
  return { score: 3, label: "Strong" };
}

export type SignUpFields = {
  fullName: string;
  username: string;
  email: string;
  password: string;
  confirm: string;
  terms: boolean;
};

export type SignUpErrors = Partial<Record<keyof SignUpFields, string | undefined>>;

export function validateSignUp(v: SignUpFields): SignUpErrors {
  const e: SignUpErrors = {};
  if (v.fullName.trim().length < 2) e.fullName = "Enter your full name";
  const u = usernameSchema.safeParse(v.username);
  if (!u.success) e.username = u.error.issues[0]?.message ?? "Invalid username";
  const em = emailSchema.safeParse(v.email);
  if (!em.success) e.email = em.error.issues[0]?.message ?? "Invalid email";
  const p = passwordSchema.safeParse(v.password);
  if (!p.success) e.password = p.error.issues[0]?.message ?? "Invalid password";
  if (v.confirm !== v.password) e.confirm = "Passwords do not match";
  if (!v.terms) e.terms = "You must accept the terms to continue";
  return e;
}
