import { describe, expect, it } from "vitest";
import {
  buildHomeStrip,
  communityBadgeCount,
  communityBadgeText,
  getCommunitySeen,
  markCommunitySeen,
  parseCommunityHome,
  type CommunityHome,
} from "@/lib/community-home";

const base: CommunityHome = {
  new_alerts: 0,
  new_events: 0,
  active_alerts: 0,
  today_events: 0,
  weekend_events: 0,
  next_event: null,
  top_alert: null,
};
// Mon 9 Nov 2026, 10:00 IST
const NOW = new Date("2026-11-09T04:30:00Z");
const next = { id: "e1", title: "Weekend cricket", starts_at: "2026-11-10T13:30:00Z" }; // Tue 7 PM IST

describe("parseCommunityHome", () => {
  it("reads the database answer, turning strings into numbers", () => {
    const h = parseCommunityHome({
      new_alerts: "2",
      new_events: 1,
      active_alerts: 3,
      today_events: 0,
      weekend_events: 4,
      next_event: next,
      top_alert: { id: "a", kind: "power", title: "Power cut" },
    });
    expect(h.new_alerts).toBe(2);
    expect(h.weekend_events).toBe(4);
    expect(h.next_event?.title).toBe("Weekend cricket");
    expect(h.top_alert?.kind).toBe("power");
  });
  it("turns anything odd into zeros and nulls", () => {
    expect(parseCommunityHome(null)).toEqual(base);
    expect(parseCommunityHome("x")).toEqual(base);
    expect(
      parseCommunityHome({ new_alerts: -3, new_events: "abc", next_event: { title: 5 } }),
    ).toEqual(base);
  });
});

describe("badge", () => {
  it("adds new alerts and new events", () => {
    expect(communityBadgeCount({ ...base, new_alerts: 2, new_events: 3 })).toBe(5);
    expect(communityBadgeCount({ ...base, active_alerts: 9, weekend_events: 9 })).toBe(0);
    expect(communityBadgeCount(null)).toBe(0);
  });
  it("shows 9+ for big numbers", () => {
    expect(communityBadgeText(4)).toBe("4");
    expect(communityBadgeText(9)).toBe("9");
    expect(communityBadgeText(10)).toBe("9+");
  });
});

describe("buildHomeStrip", () => {
  it("puts new alerts first", () => {
    const s = buildHomeStrip(
      {
        ...base,
        new_alerts: 1,
        today_events: 2,
        top_alert: { id: "a", kind: "power", title: "Power cut" },
      },
      true,
      NOW,
    );
    expect(s).toMatchObject({
      tab: "alerts",
      kind: "alert",
      title: "1 new alert near you",
      sub: "Power cut",
    });
  });
  it("then events today, then this weekend", () => {
    expect(buildHomeStrip({ ...base, today_events: 2, next_event: next }, true, NOW).title).toBe(
      "2 events today near you",
    );
    const w = buildHomeStrip({ ...base, weekend_events: 2, next_event: next }, true, NOW);
    expect(w).toMatchObject({ tab: "events", title: "2 events this weekend near you" });
    expect(w.sub).toBe("Weekend cricket · Tomorrow, 7 PM");
  });
  it("uses singular for one", () => {
    expect(buildHomeStrip({ ...base, weekend_events: 1 }, true, NOW).title).toBe(
      "1 event this weekend near you",
    );
  });
  it("then alerts still active, then the next event", () => {
    expect(buildHomeStrip({ ...base, active_alerts: 3 }, true, NOW).title).toBe(
      "3 active alerts near you",
    );
    expect(buildHomeStrip({ ...base, next_event: next }, true, NOW).title).toBe(
      "Next event near you",
    );
  });
  it("never says near you when no area is picked", () => {
    expect(buildHomeStrip({ ...base, weekend_events: 2 }, false, NOW).title).toBe(
      "2 events this weekend on Community",
    );
    expect(buildHomeStrip(base, false, NOW).title).toBe("See what's happening on Community");
  });
  it("has a calm invite when nothing is going on", () => {
    expect(buildHomeStrip(base, true, NOW)).toMatchObject({ kind: "idle", tab: "events" });
  });
});

describe("last-seen time", () => {
  it("is remembered per person and ignores junk", () => {
    window.localStorage.clear();
    expect(getCommunitySeen("u1")).toBeNull();
    markCommunitySeen("u1");
    expect(Date.parse(getCommunitySeen("u1") ?? "")).not.toBeNaN();
    expect(getCommunitySeen("u2")).toBeNull();
    window.localStorage.setItem("ediraa.community-seen.u3", "not a date");
    expect(getCommunitySeen("u3")).toBeNull();
  });
  it("does nothing without a signed-in person", () => {
    window.localStorage.clear();
    markCommunitySeen("");
    expect(window.localStorage.length).toBe(0);
  });
});
