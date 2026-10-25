import type { SVGProps } from "react";

/** Outline icons drawn in the current text colour, so they size/colour like the lucide icons. */
const base: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

/** Share: outlined paper plane. */
export function ShareIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M20.6 3.3 3.2 9.4l7.5 4 3.9 7.2L20.6 3.3Z" />
      <path d="M20.6 3.3 10.7 13.4" />
    </svg>
  );
}

/** Comment: round speech bubble with a small tail at the bottom right. */
export function CommentIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M18.78 17.61A9.5 9.5 0 1 0 14.75 20.43L21 21.5Z" />
    </svg>
  );
}

/** Reels: rounded square with a clapper top and a play triangle. */
export function ReelsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <path d="M3 8.5h18" />
      <path d="M7.2 8.5 10 3M13.2 8.5 16 3" />
      <path d="M10.5 12.2v5.6l4.8-2.8Z" fill="currentColor" />
    </svg>
  );
}

/**
 * Like: the heart shape with round lobes, a small notch and straight sides down to a point.
 * Outline by default; add `fill-red-500 text-red-500` (or any fill class) to fill it.
 */
export function HeartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} viewBox="-1 0 26 24" {...props}>
      <path d="M12 22.1 1.78 11.88A6.08 6.08 0 1 1 12 6.2a6.08 6.08 0 1 1 10.22 5.68Z" />
    </svg>
  );
}
