import { afterEach, describe, expect, it } from "vitest";
import { canGoBackInApp, decideBack } from "@/lib/native-back";

describe("Android back button", () => {
  afterEach(() => window.history.replaceState(null, ""));

  it("closes an open dialog first, then goes back, and only then leaves the app", () => {
    expect(decideBack({ dialogOpen: true, canGoBack: true })).toBe("close-dialog");
    expect(decideBack({ dialogOpen: false, canGoBack: true })).toBe("back");
    expect(decideBack({ dialogOpen: false, canGoBack: false })).toBe("leave-app");
  });

  it("uses the router's own history position when it has one", () => {
    window.history.replaceState({ __TSR_index: 0 }, "");
    expect(canGoBackInApp()).toBe(false);
    window.history.replaceState({ __TSR_index: 3 }, "");
    expect(canGoBackInApp()).toBe(true);
  });
});
