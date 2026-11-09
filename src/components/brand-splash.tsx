import logoUrl from "@/assets/logo.png";

/**
 * Premium first screen: 3D floating gradient logo + cursive gradient "SabZone" wordmark.
 * Pure CSS animation (styles live in styles.css under .sz-*), so it is light on Android.
 */
export function BrandSplash() {
  return (
    <main className="sz-stage" aria-label="Loading SabZone">
      <div className="sz-center">
        <div className="sz-logo-scene" aria-hidden="true">
          <div className="sz-logo-3d">
            {/* back layers give the logo real 3D depth */}
            <span className="sz-logo-layer sz-depth-3" style={{ ["--m" as string]: `url(${logoUrl})` }} />
            <span className="sz-logo-layer sz-depth-2" style={{ ["--m" as string]: `url(${logoUrl})` }} />
            <span className="sz-logo-layer sz-depth-1" style={{ ["--m" as string]: `url(${logoUrl})` }} />
            <span className="sz-logo-layer sz-front" style={{ ["--m" as string]: `url(${logoUrl})` }} />
            <span className="sz-shine" style={{ ["--m" as string]: `url(${logoUrl})` }} />
          </div>
        </div>

        <h1 className="sz-name" translate="no">
          <span className="sz-name-text" data-text="SabZone">
            SabZone
          </span>
        </h1>
      </div>
    </main>
  );
}
