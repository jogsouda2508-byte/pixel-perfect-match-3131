import { describe, expect, it } from "vitest";
import {
  alertShareText,
  clip,
  eventShareText,
  pollShareText,
  questionShareText,
  whatsappShareHref,
} from "@/lib/community-share";

const LINK = "https://example.com/community?tab=events";

describe("clip", () => {
  it("leaves short text alone and flattens line breaks", () => {
    expect(clip("  hello\n\nworld  ", 50)).toBe("hello world");
  });
  it("cuts long text with an ellipsis and never goes over the limit", () => {
    const out = clip("a".repeat(200), 20);
    expect(out).toHaveLength(20);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("whatsappShareHref", () => {
  it("opens WhatsApp with the message encoded", () => {
    const href = whatsappShareHref("Hi there\nline 2 & more");
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(href.split("?text=")[1]!)).toBe("Hi there\nline 2 & more");
  });
});

describe("eventShareText", () => {
  it("has the title, time, place, going count and link", () => {
    const text = eventShareText(
      { title: "Weekend cricket", venue: "School ground", locality: "Whitefield", going_count: 12 },
      "Sat, 8 Nov, 7 PM",
      LINK,
    );
    expect(text).toBe(
      [
        "📅 Weekend cricket",
        "🕒 Sat, 8 Nov, 7 PM",
        "📍 School ground, Whitefield",
        "12 going. RSVP on SabZone:",
        LINK,
      ].join("\n"),
    );
  });
  it("skips the going count at zero and the place when there is none", () => {
    const text = eventShareText(
      { title: "Yoga", venue: null, locality: "", going_count: 0 },
      "Today, 6 AM",
      LINK,
    );
    expect(text).toBe(["📅 Yoga", "🕒 Today, 6 AM", "RSVP on SabZone:", LINK].join("\n"));
  });
});

describe("alertShareText", () => {
  it("leads with the kind's emoji and asks neighbours to confirm", () => {
    const text = alertShareText(
      { kind: "power", title: "Power cut", details: "Since 4 PM, whole street", locality: "Whitefield" },
      "Confirmed by 4 neighbours",
      LINK,
    );
    expect(text.split("\n")).toEqual([
      "⚡ Power cut",
      "📍 Whitefield",
      "Since 4 PM, whole street",
      "Confirmed by 4 neighbours",
      "Seen it too? Confirm or correct it on SabZone:",
      LINK,
    ]);
  });
  it("leaves out empty details", () => {
    const text = alertShareText(
      { kind: "water", title: "No water", details: null, locality: "Bidar" },
      "Waiting for neighbours to confirm",
      LINK,
    );
    expect(text).not.toContain("null");
    expect(text.startsWith("💧 No water")).toBe(true);
  });
});

describe("pollShareText", () => {
  const options = [
    { id: "b", label: "Sunday", position: 1, votes: 9 },
    { id: "a", label: "Saturday", position: 0, votes: 3 },
  ];
  it("lists the options in order and never shows votes", () => {
    const text = pollShareText({ kind: "poll", question: "Best day for the cleanup?", options }, LINK);
    expect(text.split("\n")).toEqual([
      "📊 Poll: Best day for the cleanup?",
      "1. Saturday",
      "2. Sunday",
      "Vote on SabZone:",
      LINK,
    ]);
  });
  it("does not give a quiz's right answer away", () => {
    const quiz = {
      kind: "quiz" as const,
      question: "Capital of Karnataka?",
      options: [
        { id: "x", label: "Mysuru", position: 0, votes: 0 },
        { id: "y", label: "Bengaluru", position: 1, votes: 0 },
      ],
      correct_option_id: "y",
    };
    const text = pollShareText(quiz, LINK);
    expect(text.startsWith("🧠 Quiz:")).toBe(true);
    expect(text).not.toContain("correct");
    expect(text).toContain("Try it on SabZone:");
  });
});

describe("questionShareText", () => {
  it("has the question, a short body, the area and a call to answer", () => {
    const text = questionShareText(
      { title: "Good plumber near the bus stand?", body: "Tap leaking since Monday.", locality: "Bidar" },
      LINK,
    );
    expect(text.split("\n")).toEqual([
      "❓ Good plumber near the bus stand?",
      "Tap leaking since Monday.",
      "📍 Bidar",
      "Know the answer? Help your neighbour on SabZone:",
      LINK,
    ]);
  });
});
