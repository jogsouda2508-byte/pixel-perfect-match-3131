import { createFileRoute } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { PageHeader, PageShell } from "@/components/page-shell";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// TODO: replace with your real support address.
const SUPPORT_EMAIL = "support@example.com";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Help & Support — Gicco chat" },
      { name: "description", content: "Answers to common questions about using Gicco chat." },
    ],
  }),
  component: HelpPage,
});

const FAQ: { q: string; a: string }[] = [
  {
    q: "How do I edit my profile or change my photo?",
    a: "Open More → Settings & Privacy (or tap Edit Profile on your profile). You can change your photo, name, bio and location there.",
  },
  {
    q: "How do I follow someone?",
    a: "Tap a person's name or photo anywhere in the app to open their profile, then tap Follow. You can also find people in Discover.",
  },
  {
    q: "Who can see my posts?",
    a: "That depends on the audience you pick when posting. Public posts are visible to every Gicco chat user. Friends posts are visible to people you follow who also follow you. Local Community posts are visible to people whose profile location matches yours.",
  },
  {
    q: "How long do stories last?",
    a: "Stories disappear after 24 hours. They're visible to you and the people who follow you.",
  },
  {
    q: "How do I save a post for later?",
    a: "Tap the bookmark icon on a post. Everything you save is private and appears under More → Saved Posts.",
  },
  {
    q: "How do I get a Business page?",
    a: "Open More → Business Page and switch to a Business account. Your profile gets a business badge and your posts appear in the Business feed. You can switch back any time.",
  },
  {
    q: "I forgot my password.",
    a: "On the login screen choose Forgot password and we'll email you a reset link. If you're already logged in you can change it under Settings & Privacy.",
  },
];

function HelpPage() {
  return (
    <PageShell>
      <PageHeader title="Help & Support" />
      <section className="glass-card px-4">
        <Accordion type="single" collapsible>
          {FAQ.map((f, i) => (
            <AccordionItem key={f.q} value={`q${i}`} className="border-border last:border-b-0">
              <AccordionTrigger>{f.q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>
      <section className="glass-card space-y-3 p-5 text-center">
        <h2 className="font-semibold">Still need help?</h2>
        <p className="text-sm text-muted-foreground">
          Tell us what's going wrong and we'll get back to you.
        </p>
        <a
          href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Gicco chat support request")}`}
          className="mx-auto inline-flex items-center gap-2 rounded-full bg-gradient-brand px-6 py-3 text-sm font-semibold text-primary-foreground"
        >
          <Mail className="h-4 w-4" />
          Contact support
        </a>
      </section>
    </PageShell>
  );
}
