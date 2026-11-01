import type { ReactNode } from 'react';

const I = (d: ReactNode) => () => (
  <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

export const Icon = {
  today: I(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  plan: I(<><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4M7 13h4M7 17h7" /></>),
  calendar: I(<><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /><path d="M7.5 13h.01M12 13h.01M16.5 13h.01M7.5 17h.01M12 17h.01" strokeWidth={2.6} /></>),
  compare: I(<><path d="M8 3v18M16 3v18" /><path d="M3 7h5M3 12h5M16 9h5M16 15h5M16 19h3" /></>),
  tasks: I(<><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11" /><circle cx="5" cy="18" r="1.2" /></>),
  rank: I(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>),
  goals: I(<><path d="m3 20 6-11 4 6 3-4 5 9z" /><path d="M9 9V3l4 2-4 2" /></>),
  routine: I(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  review: I(<><path d="M4 4h12l4 4v12H4z" /><path d="M8 12l2.5 2.5L16 9" /></>),
  data: I(<><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>),
  plus: I(<path d="M12 5v14M5 12h14" />),
  x: I(<path d="M6 6l12 12M18 6 6 18" />),
  check: I(<path d="m5 12 4.5 4.5L19 7" />),
  lock: I(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>),
  refresh: I(<><path d="M20 11a8 8 0 0 0-14.7-4.3L4 8" /><path d="M4 3v5h5M4 13a8 8 0 0 0 14.7 4.3L20 16" /><path d="M20 21v-5h-5" /></>),
  swap: I(<><path d="M7 4 3 8l4 4" /><path d="M3 8h14M17 20l4-4-4-4" /><path d="M21 16H7" /></>),
  alert: I(<><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17.5v.5" /></>),
  info: I(<><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></>),
  up: I(<path d="m6 15 6-6 6 6" />),
  down: I(<path d="m6 9 6 6 6-6" />),
  trash: I(<><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>),
  spark: I(<><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></>),
  arrow: I(<path d="M5 12h14M13 6l6 6-6 6" />),
  download: I(<><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></>),
  upload: I(<><path d="M12 20V9M7 14l5-5 5 5M5 4h14" /></>),
  flag: I(<><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></>),
};

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M5 24 12 12l4 6 3-4 8 10z" fill="var(--accent-ink)" opacity=".95" />
      <circle cx="23" cy="9" r="3" fill="var(--glow)" />
    </svg>
  );
}
