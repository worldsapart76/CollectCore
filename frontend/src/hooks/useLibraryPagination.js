import { useCallback, useMemo, useState } from "react";

export function useLibraryPagination(items, itemsPerPage = 30) {
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.ceil(items.length / itemsPerPage);

  const safePage = totalPages === 0 ? 1 : Math.min(currentPage, totalPages);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * itemsPerPage;
    return items.slice(start, start + itemsPerPage);
  }, [items, itemsPerPage, safePage]);

  const goPrev = useCallback(() => {
    setCurrentPage((prev) => Math.max(1, prev - 1));
  }, []);

  const goNext = useCallback(() => {
    setCurrentPage((prev) => Math.min(totalPages || 1, prev + 1));
  }, [totalPages]);

  const resetToFirstPage = useCallback(() => {
    setCurrentPage(1);
  }, []);

  return {
    currentPage: safePage,
    totalPages,
    pageItems,
    canPrev: safePage > 1,
    canNext: safePage < totalPages,
    goPrev,
    goNext,
    resetToFirstPage,
  };
}