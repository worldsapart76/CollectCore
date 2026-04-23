export const MODULE_DEFS = {
  photocards: {
    id: 'photocards',
    label: 'Photocards',
    primaryPath: '/library',
    description: 'Track your photocard collection',
    links: [
      { label: 'Inbox',   to: '/inbox' },
      { label: 'Library', to: '/library' },
      { label: 'Export',  to: '/export' },
    ],
  },
  books: {
    id: 'books',
    label: 'Books',
    primaryPath: '/books/library',
    description: 'Track your book collection',
    links: [
      { label: 'Add', to: '/books/add' },
      { label: 'Library',  to: '/books/library' },
    ],
  },
  graphicnovels: {
    id: 'graphicnovels',
    label: 'Graphic Novels',
    primaryPath: '/graphicnovels/library',
    description: 'Track your graphic novel and omnibus collection',
    links: [
      { label: 'Add',     to: '/graphicnovels/add' },
      { label: 'Library', to: '/graphicnovels/library' },
    ],
  },
  videogames: {
    id: 'videogames',
    label: 'Video Games',
    primaryPath: '/videogames/library',
    description: 'Track your video game collection',
    links: [
      { label: 'Add',     to: '/videogames/add' },
      { label: 'Library', to: '/videogames/library' },
    ],
  },
  music: {
    id: 'music',
    label: 'Music',
    primaryPath: '/music/library',
    description: 'Track your music collection',
    links: [
      { label: 'Add',     to: '/music/add' },
      { label: 'Library', to: '/music/library' },
    ],
  },
  video: {
    id: 'video',
    label: 'Video',
    primaryPath: '/video/library',
    description: 'Track your movie and TV collection',
    links: [
      { label: 'Add',     to: '/video/add' },
      { label: 'Library', to: '/video/library' },
    ],
  },
  boardgames: {
    id: 'boardgames',
    label: 'Board Games',
    primaryPath: '/boardgames/library',
    description: 'Track your board game collection',
    links: [
      { label: 'Add',     to: '/boardgames/add' },
      { label: 'Library', to: '/boardgames/library' },
    ],
  },
  ttrpg: {
    id: 'ttrpg',
    label: 'TTRPG',
    primaryPath: '/ttrpg/library',
    description: 'Track your tabletop RPG collection',
    links: [
      { label: 'Add',     to: '/ttrpg/add' },
      { label: 'Library', to: '/ttrpg/library' },
    ],
  },
};

// Active modules — filtered by VITE_ENABLED_MODULES if set.
// Desktop: env var unset → all modules shown (no change).
// Mobile v1: VITE_ENABLED_MODULES=photocards → only photocards shown.
const _ENABLED = (import.meta.env.VITE_ENABLED_MODULES ?? 'all').split(',').map(s => s.trim());
export const activeModules = _ENABLED[0] === 'all'
  ? Object.values(MODULE_DEFS).sort((a, b) => a.label.localeCompare(b.label))
  : Object.values(MODULE_DEFS)
      .filter(m => _ENABLED.includes(m.id))
      .sort((a, b) => a.label.localeCompare(b.label));

// Derive active module from current pathname
export function getActiveModuleId(pathname) {
  if (pathname.startsWith('/books')) return 'books';
  if (pathname.startsWith('/graphicnovels')) return 'graphicnovels';
  if (pathname.startsWith('/videogames')) return 'videogames';
  if (pathname.startsWith('/music')) return 'music';
  if (pathname.startsWith('/video')) return 'video';
  if (pathname.startsWith('/boardgames')) return 'boardgames';
  if (pathname.startsWith('/ttrpg')) return 'ttrpg';
  if (['/inbox', '/library', '/export'].some(p => pathname.startsWith(p))) return 'photocards';
  return null;
}
