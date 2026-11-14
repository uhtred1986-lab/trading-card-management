/** The few line icons of the Pokémon screens, as in the prototype: 24 px grid, 2 px round strokes. */
const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const HeartIcon = () => (
  <svg {...base}>
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />
  </svg>
);
export const CheckIcon = () => (
  <svg {...base}>
    <path d="m5 12 5 5 9-10" />
  </svg>
);
export const DeckIcon = () => (
  <svg {...base}>
    <path d="M4 7h16M4 12h16M4 17h10" />
  </svg>
);
export const SearchIcon = () => (
  <svg {...base} width="22" height="22">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4-4" />
  </svg>
);
export const MicIcon = () => (
  <svg {...base} width="22" height="22">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);
export const CloseIcon = () => (
  <svg {...base} width="20" height="20">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
