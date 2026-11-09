import { Capacitor } from "@capacitor/core";

/** Links that bring the person back INTO the Android app (see AndroidManifest.xml). */
export const NATIVE_AUTH_REDIRECT = "sabzone://auth-callback";
export const NATIVE_RESET_REDIRECT = "sabzone://reset-password";

export const isNativeApp = (): boolean =>
  typeof window !== "undefined" && Capacitor.isNativePlatform();

/**
 * Where Supabase should send the person after an emailed link / Google sign-in.
 * In the Android app that is the app itself (no website needed); on the web it is the site.
 */
export function authRedirect(webPath: string, nativeUrl = NATIVE_AUTH_REDIRECT): string {
  return isNativeApp() ? nativeUrl : `${window.location.origin}${webPath}`;
}
