import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CommentBody, replyDraft } from "@/components/comments-sheet";

describe("comment replies", () => {
  it("starts a reply with the person's @name", () => {
    expect(replyDraft("", "priya.n")).toBe("@priya.n ");
  });

  it("swaps an earlier @name instead of stacking them", () => {
    expect(replyDraft("@asha_k hi", "priya.n")).toBe("@priya.n hi");
  });

  it("does not repeat the @name that is already there", () => {
    expect(replyDraft("@priya.n ", "priya.n")).toBe("@priya.n ");
  });

  it("leaves the draft alone when the author has no username", () => {
    expect(replyDraft("hello", null)).toBe("hello");
  });

  it("picks out a leading @name (dots and underscores included) as plain text, never HTML", () => {
    const { container } = render(<CommentBody text="@priya.n <b>thanks</b>" />);
    const mention = container.querySelector(".sz-mention");
    expect(mention?.textContent).toBe("@priya.n");
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toBe("@priya.n <b>thanks</b>");
  });

  it("shows ordinary comments untouched", () => {
    const { container } = render(<CommentBody text="Love this @ the park" />);
    expect(container.querySelector(".sz-mention")).toBeNull();
    expect(container.textContent).toBe("Love this @ the park");
  });
});
