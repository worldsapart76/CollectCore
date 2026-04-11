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
      { label: 'Add Book', to: '/books/add' },
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
};

// Derive active module from current pathname
export function getActiveModuleId(pathname) {
  if (pathname.startsWith('/books')) return 'books';
  if (pathname.startsWith('/graphicnovels')) return 'graphicnovels';
  if (['/inbox', '/library', '/export'].some(p => pathname.startsWith(p))) return 'photocards';
  return null;
}
