import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar } from "@/components/ediraa";

const arcs = (c: HTMLElement) => c.querySelectorAll("svg circle").length;

describe("story ring", () => {
  it("draws one arc per story", () => {
    for (const n of [2, 3, 5]) {
      const { container, unmount } = render(<Avatar name="Sam" ring segments={n} />);
      expect(arcs(container)).toBe(n);
      unmount();
    }
  });

  it("draws the same single unbroken ring for one story, and no ring when off", () => {
    const one = render(<Avatar name="Sam" ring segments={1} />);
    expect(arcs(one.container)).toBe(1);
    const off = render(<Avatar name="Sam" segments={4} />);
    expect(arcs(off.container)).toBe(0);
  });
});
