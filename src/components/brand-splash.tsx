import { useEffect } from "react";
import { SplashScreen } from "@capacitor/splash-screen";
import logoUrl from "@/assets/logo.png";

const SPARKS: [number, number][] = [
  [12, 18], [80, 12], [20, 70], [85, 62], [50, 8],
  [8, 44], [90, 38], [35, 88], [70, 90], [60, 30],
];

/**
 * First screen: purple gradient, glossy 3D logo card and a cursive "SabZone" whose
 * letters drop in one by one. Pure CSS animation (styles: .sz-* in styles.css).
 */
export function BrandSplash() {
  // Hide the native purple launch screen only now, so only the animated one is ever seen.
  useEffect(() => {
    SplashScreen.hide({ fadeOutDuration: 150 }).catch(() => {});
  }, []);

  return (
    <main
      className="sz-stage"
      aria-label="Loading SabZone"
      style={{ ["--m" as string]: `url(${logoUrl})` }}
    >
      <div className="sz-mesh" aria-hidden="true" />
      {SPARKS.map(([x, y], i) => (
        <i
          key={i}
          className="sz-spark"
          aria-hidden="true"
          style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 0.35}s` }}
        />
      ))}
      <div className="sz-c">
        <div className="sz-card" aria-hidden="true">
          <div className="sz-glass">
            <div className="sz-logo" />
          </div>
        </div>
        <h1 className="sz-name" translate="no" aria-label="SabZone">
          {"SabZone".split("").map((ch, i) => (
            <span key={i} aria-hidden="true" style={{ ["--i" as string]: i }}>
              {ch}
            </span>
          ))}
        </h1>
        <div className="sz-line" aria-hidden="true" />
      </div>
    </main>
  );
}
