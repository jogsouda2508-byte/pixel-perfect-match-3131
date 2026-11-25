import { useEffect } from "react";
import { SplashScreen } from "@capacitor/splash-screen";

/**
 * First screen. Uses the exact same logo file as the Welcome / Login / Signup screens
 * (public/welcome-logo.png) on the same dark purple background, plus the "SabZone" wordmark
 * (public/splash-wordmark.png, transparent background).
 *
 * Animation: none besides a single "pop" where the logo and the word grow from small to full
 * size when the screen appears (styles: .sz-* in styles.css). Sizes are capped so nothing
 * gets too big on phones.
 */
export function BrandSplash() {
  // Hide the native launch screen only now, so only this splash is ever seen.
  useEffect(() => {
    SplashScreen.hide({ fadeOutDuration: 150 }).catch(() => {});
  }, []);

  return (
    <main className="sz-stage" aria-label="Loading SabZone">
      <div className="sz-c">
        <img
          className="sz-pop sz-logo"
          src="/welcome-logo.png"
          width={640}
          height={547}
          alt=""
          aria-hidden="true"
          decoding="async"
          draggable={false}
        />
        <img
          className="sz-pop sz-word"
          src="/splash-wordmark.png"
          width={756}
          height={244}
          alt="SabZone"
          translate="no"
          decoding="async"
          draggable={false}
        />
      </div>
    </main>
  );
}
