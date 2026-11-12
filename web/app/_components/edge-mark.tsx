import { useId } from "react";

/**
 * The Edge mark (three tilted bars, lime → emerald), identical to the
 * homepage's #edge-mark symbol. Gradient ids are unique per instance so
 * several marks can share a page.
 */
export default function EdgeMark({ className = "h-7 w-8" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  const stops = (
    <>
      <stop offset="0" stopColor="#e6ff5a" />
      <stop offset=".45" stopColor="#5ef088" />
      <stop offset="1" stopColor="#0a5c3e" />
    </>
  );
  return (
    <svg viewBox="16.5 -16.8 265.5 217.5" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}a`} gradientUnits="userSpaceOnUse" x1="264" y1="0" x2="84" y2="0">
          {stops}
        </linearGradient>
        <linearGradient id={`${id}b`} gradientUnits="userSpaceOnUse" x1="224" y1="0" x2="50" y2="0">
          {stops}
        </linearGradient>
        <linearGradient id={`${id}c`} gradientUnits="userSpaceOnUse" x1="264" y1="0" x2="16" y2="0">
          {stops}
        </linearGradient>
      </defs>
      <g transform="rotate(-9 140 92)">
        <rect x="84" y="8" width="180" height="50" rx="25" fill={`url(#${id}a)`} />
        <rect x="50" y="67" width="174" height="50" rx="25" fill={`url(#${id}b)`} />
        <rect x="16" y="126" width="248" height="50" rx="25" fill={`url(#${id}c)`} />
      </g>
    </svg>
  );
}
