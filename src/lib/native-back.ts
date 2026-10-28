import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Android's back button inside the Capacitor app.
 *
 * Wanted behaviour: back goes to the page the person came from; if an open sheet / dialog is
 * showing, back closes it first; only on the first page does back leave the app (it is moved to
 * the background like WhatsApp, not killed).
 *
 * Like native-share.ts, the plugin is reached with registerPlugin from @capacitor/core, so the web
 * build needs no new package. The plugin only has to be in the APK:
 * `npm i @capacitor/app`, `npx cap sync android`, rebuild. In a browser, or in an old APK without
 * it, nothing here does anything and Android keeps its default behaviour.
 */

type AppPlugin = {
  addListener(
    event: "backButton",
    fn: (e: { canGoBack: boolean }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  minimizeApp?(): Promise<void>;
  exitApp(): Promise<void>;
};

const App = registerPlugin<AppPlugin>("App");

export type BackAction = "close-dialog" | "back" | "leave-app";

/** Pure decision, so it can be tested: what should the back button do right now? */
export function decideBack(state: { dialogOpen: boolean; canGoBack: boolean }): BackAction {
  if (state.dialogOpen) return "close-dialog";
  return state.canGoBack ? "back" : "leave-app";
}

/** True when the router has an earlier page in this app session to go back to. */
export function canGoBackInApp(): boolean {
  const index = (window.history.state as { __TSR_index?: unknown } | null)?.__TSR_index;
  if (typeof index === "number") return index > 0;
  return window.history.length > 1;
}

function dialogIsOpen(): boolean {
  return (
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    ) !== null
  );
}

function closeDialog() {
  // Radix dialogs / sheets / drawers close on Escape
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

async function leaveApp() {
  try {
    if (App.minimizeApp) await App.minimizeApp();
    else await App.exitApp();
  } catch {
    await App.exitApp().catch(() => {});
  }
}

/**
 * Takes over the Android back button. `goBack` should go one page back in the app's own history
 * (router.history.back). Returns a function that removes the listener. Never throws.
 */
export async function installNativeBackButton(goBack: () => void): Promise<() => void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("App")) return () => {};
  try {
    const handle = await App.addListener("backButton", () => {
      const action = decideBack({ dialogOpen: dialogIsOpen(), canGoBack: canGoBackInApp() });
      if (action === "close-dialog") closeDialog();
      else if (action === "back") goBack();
      else void leaveApp();
    });
    return () => void handle.remove().catch(() => {});
  } catch (e) {
    console.error("Setting up the Android back button failed", e);
    return () => {};
  }
}
