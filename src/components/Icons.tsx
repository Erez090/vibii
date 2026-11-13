// Thin outline icons (1.5px stroke) matching the mockup.
import type { SVGProps } from "react";

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, ...p,
});

export const MusicNote = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>
);
export const Globe = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9.5" /><path d="M2.5 12h19M12 2.5c2.6 2.8 3.9 6 3.9 9.5S14.6 18.7 12 21.5M12 2.5C9.4 5.3 8.1 8.5 8.1 12s1.3 6.7 3.9 9.5" /></svg>
);
export const Plus = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 4v16M4 12h16" /></svg>;
export const User = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1H4z" /></svg>
);
export const Heart = ({ filled, ...p }: SVGProps<SVGSVGElement> & { filled?: boolean }) => (
  <svg {...base(p)} fill={filled ? "currentColor" : "none"}><path d="M12 20.5s-8-4.6-8-10.6A4.4 4.4 0 0 1 12 7.3a4.4 4.4 0 0 1 8 2.6c0 6-8 10.6-8 10.6z" /></svg>
);
export const More = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
);
export const Shuffle = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 7h3.5c3.5 0 4.5 10 8 10H21M3 17h3.5c1.6 0 2.6-2 3.5-4.2M14.5 7H21M18 4l3 3-3 3M18 14l3 3-3 3" /></svg>
);
export const Prev = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="currentColor" stroke="none"><rect x="4" y="5" width="2.6" height="14" rx="0.5" /><path d="M20 5.5v13L8 12z" /></svg>
);
export const Next = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="currentColor" stroke="none"><rect x="17.4" y="5" width="2.6" height="14" rx="0.5" /><path d="M4 5.5v13L16 12z" /></svg>
);
export const PlayIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="currentColor" stroke="none"><path d="M7 4.5v15l13-7.5z" /></svg>
);
export const PauseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="currentColor" stroke="none"><rect x="6" y="4.5" width="4" height="15" rx="1" /><rect x="14" y="4.5" width="4" height="15" rx="1" /></svg>
);
export const Repeat = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" /></svg>
);
export const QueueIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 6h13M8 12h13M8 18h13M3 4.5l2.5 1.5L3 7.5" /></svg>
);
export const ChevronBack = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M15 5l-7 7 7 7" /></svg>;
export const External = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
);
