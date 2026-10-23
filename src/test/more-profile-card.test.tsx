import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const css = read("../styles.css");

describe("More page profile box: rounded corners on phones", () => {
  it("the profile box (first card) carries the more-profile-card class, and the others don't", () => {
    const src = read("../routes/more.tsx");
    const withClass = [...src.matchAll(/className="[^"]*more-profile-card[^"]*"/g)];
    expect(withClass).toHaveLength(1);
    // it is the link to /profile, the box with the avatar and name
    expect(src).toMatch(/<Link to="\/profile" className="glass-card more-profile-card /);
  });

  it("is only styled inside the phone media query, with a clearly visible radius", () => {
    const rules = [...css.matchAll(/\.more-profile-card[^{]*\{([^}]*)\}/g)];
    expect(rules).toHaveLength(1);
    const rule = rules[0]!;
    const before = css.slice(0, rule.index);
    const lastMedia = before.lastIndexOf("@media");
    const between = before.slice(lastMedia);
    expect(between.startsWith("@media (max-width: 639.98px)")).toBe(true);
    const opens = (between.match(/\{/g) ?? []).length;
    const closes = (between.match(/\}/g) ?? []).length;
    expect(opens - closes).toBeGreaterThan(0); // still inside that media block
    const radius = rule[1]!.match(/border-radius:\s*([\d.]+)rem/);
    expect(radius).not.toBeNull();
    expect(parseFloat(radius![1]!)).toBeGreaterThanOrEqual(1.25); // was 0 on phones
  });

  it("is more specific than the square-corner phone rule, so it wins, and keeps the edge-to-edge margin", () => {
    // `.app-main > .glass-card` (2 classes) sets border-radius: 0 on phones; ours has 3 classes.
    expect(css).toMatch(/\.app-main > \.glass-card \{\s*margin-inline: -1rem;\s*border-radius: 0;/);
    expect(css).toMatch(/\.app-main > \.glass-card\.more-profile-card \{/);
    // the edge-to-edge margin is not overridden for this box
    const ours = css.match(/\.app-main > \.glass-card\.more-profile-card \{([^}]*)\}/)![1]!;
    expect(ours).not.toMatch(/margin/);
  });
});
