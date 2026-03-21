export default function LibraryPagination({
  currentPage,
  totalPages,
  totalCards,
  canPrev,
  canNext,
  onPrev,
  onNext,
}) {
  return (
    <div className="library-pagination">
      <div className="library-pagination-info">
        Results: {totalCards} cards
        <span className="library-pagination-page">
          Page {totalPages === 0 ? 0 : currentPage} of {totalPages}
        </span>
      </div>

      <div className="library-pagination-actions">
        <button type="button" onClick={onPrev} disabled={!canPrev}>
          Prev
        </button>
        <button type="button" onClick={onNext} disabled={!canNext}>
          Next
        </button>
      </div>
    </div>
  );
}