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
};

// Derive active module from current pathname
export function getActiveModuleId(pathname) {
  if (pathname.startsWith('/books')) return 'books';
  if (['/inbox', '/library', '/export'].some(p => pathname.startsWith(p))) return 'photocards';
  return null;
}
