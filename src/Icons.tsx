import type { ReactNode } from 'react'

type IconName = 'plus' | 'chevron' | 'folder' | 'tasks' | 'download' | 'expand' | 'grip' |
  'shrink' | 'close' | 'trash' | 'menu' | 'arrowUp' | 'arrowDown' | 'calendar' | 'link' | 'check' |
  'sidebarOpen' | 'sidebarClose'

const shapes: Record<IconName, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10H3V7Z" />,
  tasks: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="m2 6 1.5 1.5L6 4M2 12l1.5 1.5L6 10M2 18l1.5 1.5L6 16" /></>,
  download: <><path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3" /></>,
  expand: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /></>,
  shrink: <><path d="M3 9h6V3m12 6h-6V3M3 15h6v6m12-6h-6v6" /></>,
  close: <path d="M5 5 19 19M19 5 5 19" />,
  trash: <><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7M10 11v5m4-5v5" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  arrowUp: <path d="m6 15 6-6 6 6" />,
  arrowDown: <path d="m6 9 6 6 6-6" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1 1" /><path d="M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1-1" /></>,
  check: <path d="m4 12 5 5L20 6" />,
  grip: <><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></>,
  sidebarOpen: <><rect x="2" y="4" width="20" height="16" rx="3" /><path d="M9 4v16m4-11 3 3-3 3" /></>,
  sidebarClose: <><rect x="2" y="4" width="20" height="16" rx="3" /><path d="M9 4v16m8-11-3 3 3 3" /></>,
}

export function Icon({ name, size = 18, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {shapes[name]}
    </svg>
  )
}
