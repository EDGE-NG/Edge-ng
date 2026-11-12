/** Line icons (1.7 stroke, round caps), matching the homepage feature tiles. */
type P = { className?: string };
const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
  "aria-hidden": true,
};

export const IconMic = ({ className = "h-[18px] w-[18px]" }: P) => (
  <svg {...base} className={className}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </svg>
);
/** Checklist: the homepage "Built from your rules" tile icon. */
export const IconChecklist = ({ className = "h-[18px] w-[18px]" }: P) => (
  <svg {...base} className={className}>
    <path d="M3.5 7l1.8 1.8L9 5.2" />
    <path d="M3.5 16.5l1.8 1.8L9 14.7" />
    <path d="M13 7h7.5" />
    <path d="M13 16.5h7.5" />
  </svg>
);
export const IconArrowUp =({ className = "h-[18px] w-[18px]" }: P) => (
  <svg {...base} strokeWidth={2.2} className={className}>
    <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
  </svg>
);
export const IconStop = ({ className = "h-4 w-4" }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
  </svg>
);
export const IconX = ({ className = "h-4 w-4" }: P) => (
  <svg {...base} className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const IconPlus = ({ className = "h-4 w-4" }: P) => (
  <svg {...base} strokeWidth={2} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconChat = ({ className = "h-[18px] w-[18px]" }: P) => (
  <svg {...base} className={className}>
    <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.1A8 8 0 1 1 20 12Z" />
  </svg>
);
export const IconImages = ({ className = "h-[18px] w-[18px]" }: P) => (
  <svg {...base} className={className}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m3 16 5-5 4 4 3-3 6 6" />
    <circle cx="16.5" cy="9" r="1.5" />
  </svg>
);
export const IconCandles = ({ className = "h-[18px] w-[18px]" }: P) => (
  <svg {...base} className={className}>
    <path d="M7 3v18M17 3v18" />
    <rect x="4.5" y="7" width="5" height="8" rx="1" />
    <rect x="14.5" y="10" width="5" height="7" rx="1" />
  </svg>
);
export const IconBook = ({ className = "h-[18px] w-[18px]" }: P) => (
  <svg {...base} className={className}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />
  </svg>
);
export const IconGauge = ({ className = "h-[18px] w-[18px]" }: P) => (
  <svg {...base} className={className}>
    {/* dashboard: four panels */}
    <rect x="3.5" y="3.5" width="7" height="9" rx="1.8" />
    <rect x="13.5" y="3.5" width="7" height="5" rx="1.8" />
    <rect x="13.5" y="11.5" width="7" height="9" rx="1.8" />
    <rect x="3.5" y="15.5" width="7" height="5" rx="1.8" />
  </svg>
);
export const IconMenu = ({ className = "h-5 w-5" }: P) => (
  <svg {...base} className={className}>
    <path d="M4 7h16M4 12h16M4 17h10" />
  </svg>
);
export const IconPencil = ({ className = "h-[15px] w-[15px]" }: P) => (
  <svg {...base} className={className}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
  </svg>
);
export const IconTrash = ({ className = "h-[15px] w-[15px]" }: P) => (
  <svg {...base} className={className}>
    <path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13" />
  </svg>
);
export const IconLock = ({ className = "h-3 w-3" }: P) => (
  <svg {...base} strokeWidth={2} className={className}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);
export const IconCheck = ({ className = "h-4 w-4" }: P) => (
  <svg {...base} strokeWidth={2.2} className={className}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);
export const IconRetry = ({ className = "h-4 w-4" }: P) => (
  <svg {...base} className={className}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);
export const IconLogout = ({ className = "h-4 w-4" }: P) => (
  <svg {...base} className={className}>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" />
  </svg>
);
export const IconGear = ({ className = "h-4 w-4" }: P) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
);
