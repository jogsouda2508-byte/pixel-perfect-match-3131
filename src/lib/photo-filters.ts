/**
 * Photo filters for stories (Instagram-style looks). Each one is a CSS `filter` string, so the same
 * text drives the live preview (<img style="filter">) and the exported picture (canvas ctx.filter).
 */
export type PhotoFilter = { key: string; label: string; css: string };

export const PHOTO_FILTERS: readonly PhotoFilter[] = [
  { key: "none", label: "Normal", css: "none" },
  { key: "clarendon", label: "Clarendon", css: "contrast(1.2) saturate(1.35) brightness(1.05)" },
  { key: "gingham", label: "Gingham", css: "brightness(1.05) hue-rotate(-10deg) saturate(0.9) contrast(0.95)" },
  { key: "moon", label: "Moon", css: "grayscale(1) contrast(1.1) brightness(1.1)" },
  { key: "lark", label: "Lark", css: "brightness(1.1) contrast(0.9) saturate(1.25)" },
  { key: "reyes", label: "Reyes", css: "sepia(0.22) brightness(1.1) contrast(0.85) saturate(0.75)" },
  { key: "juno", label: "Juno", css: "contrast(1.1) saturate(1.5) sepia(0.08) brightness(1.02)" },
  { key: "slumber", label: "Slumber", css: "saturate(0.66) brightness(1.05) sepia(0.15)" },
  { key: "crema", label: "Crema", css: "sepia(0.2) contrast(0.95) brightness(1.05) saturate(0.9)" },
  { key: "ludwig", label: "Ludwig", css: "contrast(1.05) brightness(1.05) saturate(1.2) sepia(0.05)" },
  { key: "aden", label: "Aden", css: "hue-rotate(-20deg) contrast(0.9) saturate(0.85) brightness(1.2)" },
  { key: "noir", label: "Noir", css: "grayscale(1) contrast(1.3) brightness(0.9)" },
];

/** The CSS filter for a key ("none" for Normal or anything unknown). */
export function filterCss(key: string): string {
  return PHOTO_FILTERS.find((f) => f.key === key)?.css ?? "none";
}

/**
 * True when this browser can apply a filter while drawing on a canvas. Without it a filtered
 * story would be saved WITHOUT the filter, so the filter button is hidden instead.
 */
export function canvasFilterSupported(): boolean {
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    return !!ctx && "filter" in ctx;
  } catch {
    return false;
  }
}
