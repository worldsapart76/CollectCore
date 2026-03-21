import { useEffect, useMemo, useState } from "react";
import PageContainer from "../components/layout/PageContainer";
import LibraryFilterSidebar from "../components/library/LibraryFilterSidebar";
import LibraryControls from "../components/library/LibraryControls";
import LibraryPagination from "../components/library/LibraryPagination";
import LibraryGrid from "../components/library/LibraryGrid";
import CardDetailModal from "../components/library/CardDetailModal";
import BulkEditPanel from "../components/library/BulkEditPanel";
import { getCards } from "../services/libraryApi";
import { buildDisplayItems } from "../utils/libraryTransforms";
import { filterCards } from "../utils/filterUtils";
import { sortCards } from "../utils/sortUtils";
import { useLibraryPagination } from "../hooks/useLibraryPagination";
import { getMembersForGroup } from "../utils/groupUtils";

const emptyFilters = {
  search: "",
  members: [],
  groupCodes: ["skz"],
  topLevelCategories: [],
  subCategories: [],
  version: "",
  ownershipStatus: [],
  backStatus: [],
};

export default function LibraryPage() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedCard, setSelectedCard] = useState(null);

  const [viewMode, setViewMode] = useState("fronts");
  const [sizeMode, setSizeMode] = useState("M");
  const [sortMode, setSortMode] = useState("id-asc");
  const [captionsEnabled, setCaptionsEnabled] = useState(false);

  const [filters, setFilters] = useState(emptyFilters);

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState([]);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [isApplyingBulkEdit, setIsApplyingBulkEdit] = useState(false);

  useEffect(() => {
    async function loadCards() {
      try {
        setLoading(true);
        setError("");
        const data = await getCards();
        setCards(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error(err);
        setError("Failed to load library.");
      } finally {
        setLoading(false);
      }
    }

    loadCards();
  }, []);

  const availableOptions = useMemo(() => {
    const uniqueGroupCodes = [...new Set(cards.map((c) => c.group_code).filter(Boolean))].sort();

    const activeGroupCodes =
      filters.groupCodes.length > 0 ? filters.groupCodes : uniqueGroupCodes;

    const activeTopLevelCategories =
      filters.topLevelCategories.length > 0
        ? filters.topLevelCategories
        : [...new Set(cards.map((c) => c.top_level_category).filter(Boolean))].sort();

    const cardsForMemberOptions = cards.filter((c) => activeGroupCodes.includes(c.group_code));

    const availableMemberSet = new Set(
      cardsForMemberOptions.map((c) => c.member).filter(Boolean)
    );

    const orderedMembers = [];
    const seenMembers = new Set();

    activeGroupCodes.forEach((groupCode) => {
      const groupMembers = getMembersForGroup(groupCode) || [];
      groupMembers.forEach((member) => {
        if (availableMemberSet.has(member) && !seenMembers.has(member)) {
          orderedMembers.push(member);
          seenMembers.add(member);
        }
      });
    });

    const remainingMembers = [...availableMemberSet]
      .filter((member) => !seenMembers.has(member))
      .sort((a, b) => a.localeCompare(b));

    const uniqueTopLevelCategories = [
      ...new Set(
        cards
          .filter((c) => activeGroupCodes.includes(c.group_code))
          .map((c) => c.top_level_category)
          .filter(Boolean)
      ),
    ].sort();

    const uniqueSubCategories = [
      ...new Set(
        cards
          .filter((c) => activeGroupCodes.includes(c.group_code))
          .filter(
            (c) =>
              activeTopLevelCategories.length === 0 ||
              activeTopLevelCategories.includes(c.top_level_category)
          )
          .map((c) => c.sub_category)
          .filter(Boolean)
      ),
    ].sort();

    const uniqueVersions = [
      ...new Set(
        cards
          .filter((c) => activeGroupCodes.includes(c.group_code))
          .filter(
            (c) =>
              activeTopLevelCategories.length === 0 ||
              activeTopLevelCategories.includes(c.top_level_category)
          )
          .map((c) => c.source)
          .filter(Boolean)
      ),
    ].sort((a, b) => a.localeCompare(b));

    return {
      members: [...orderedMembers, ...remainingMembers],
      groupCodes: uniqueGroupCodes,
      topLevelCategories: uniqueTopLevelCategories,
      subCategories: uniqueSubCategories,
      versions: uniqueVersions,
    };
  }, [cards, filters.groupCodes, filters.topLevelCategories]);

  const filteredCards = useMemo(() => {
    return filterCards(cards, filters);
  }, [cards, filters]);

  const sortedCards = useMemo(() => {
    return sortCards(filteredCards, sortMode);
  }, [filteredCards, sortMode]);

  const displayItems = useMemo(() => {
    return buildDisplayItems(sortedCards, viewMode);
  }, [sortedCards, viewMode]);

  const {
    currentPage,
    totalPages,
    pageItems,
    canPrev,
    canNext,
    goPrev,
    goNext,
    resetToFirstPage,
  } = useLibraryPagination(displayItems, 30);

  useEffect(() => {
    resetToFirstPage();
  }, [filters, sortMode, viewMode, resetToFirstPage]);

  function toggleInArray(key, value) {
    setFilters((prev) => {
      const arr = prev[key];
      const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
      return { ...prev, [key]: next };
    });
  }

  function clearAllFilters() {
    setFilters(emptyFilters);
  }

  function toggleSelectMode() {
    setIsSelectMode((prev) => {
      const next = !prev;
      if (!next) {
        setSelectedCardIds([]);
        setIsBulkEditOpen(false);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedCardIds([]);
    setIsBulkEditOpen(false);
  }

  function selectAllOnPage() {
    const pageCardIds = pageItems.map((item) => item.card.id);
    setSelectedCardIds((prev) => {
      const merged = new Set([...prev, ...pageCardIds]);
      return [...merged];
    });
  }

  function handleSelectItem(item) {
    if (isSelectMode) {
      const cardId = item.card.id;
      setSelectedCardIds((prev) =>
        prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId]
      );
      return;
    }

    setSelectedCard(item.card);
  }

  function handleCloseModal() {
    setSelectedCard(null);
  }

  function handleSavedCard(updatedCard) {
    const stampedCard = {
      ...updatedCard,
      _imageVersion: Date.now(),
    };

    setCards((prev) =>
      prev.map((existing) => (existing.id === updatedCard.id ? stampedCard : existing))
    );
  }

  function handleDeletedCard(deletedId) {
    setCards((prev) => prev.filter((existing) => existing.id !== deletedId));
    setSelectedCardIds((prev) => prev.filter((id) => id !== deletedId));
  }

  async function handleApplyBulkEdit(fieldPayload) {
    if (selectedCardIds.length === 0) return;

    setIsApplyingBulkEdit(true);
    setError("");

    try {
      const response = await fetch("http://127.0.0.1:8000/cards/bulk-update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          card_ids: selectedCardIds,
          ...fieldPayload,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Bulk update failed.");
      }

      const result = await response.json();
      const updatedCards = Array.isArray(result.cards) ? result.cards : [];

      setCards((prev) =>
        prev.map((existing) => {
          const match = updatedCards.find((updated) => updated.id === existing.id);
          return match ? { ...match, _imageVersion: Date.now() } : existing;
        })
      );

      setSelectedCardIds([]);
      setIsBulkEditOpen(false);
    } catch (err) {
      console.error(err);
      setError("Failed to apply bulk changes.");
    } finally {
      setIsApplyingBulkEdit(false);
    }
  }

  const selectedCards = useMemo(() => {
    return cards.filter((card) => selectedCardIds.includes(card.id));
  }, [cards, selectedCardIds]);

  return (
    <PageContainer className="library-page">
      <div className="library-layout">
        <LibraryFilterSidebar
          filters={filters}
          availableOptions={availableOptions}
          onSearchChange={(value) => setFilters((prev) => ({ ...prev, search: value }))}
          onToggleMember={(value) => toggleInArray("members", value)}
          onToggleGroupCode={(value) => toggleInArray("groupCodes", value)}
          onToggleTopLevelCategory={(value) => toggleInArray("topLevelCategories", value)}
          onToggleSubCategory={(value) => toggleInArray("subCategories", value)}
          onVersionChange={(value) => setFilters((prev) => ({ ...prev, version: value }))}
          onToggleOwnershipStatus={(value) => toggleInArray("ownershipStatus", value)}
          onToggleBackStatus={(value) => toggleInArray("backStatus", value)}
          onClearAll={clearAllFilters}
        />

        <div className="library-content">
          <LibraryControls
            viewMode={viewMode}
            sizeMode={sizeMode}
            sortMode={sortMode}
            captionsEnabled={captionsEnabled}
            onViewModeChange={setViewMode}
            onSizeModeChange={setSizeMode}
            onSortModeChange={setSortMode}
            onCaptionsToggle={setCaptionsEnabled}
            isSelectMode={isSelectMode}
            onToggleSelectMode={toggleSelectMode}
          />

          {isSelectMode ? (
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
                marginBottom: 10,
                padding: "8px 10px",
                border: "1px solid #ccc",
                borderRadius: 8,
                background: "#f7f7f7",
              }}
            >
              <strong>{selectedCardIds.length} selected</strong>

              <button
                type="button"
                onClick={selectAllOnPage}
                disabled={pageItems.length === 0}
              >
                Select All on Page
              </button>

              <button
                type="button"
                onClick={clearSelection}
                disabled={selectedCardIds.length === 0}
              >
                Clear Selection
              </button>

              <button
                type="button"
                onClick={() => setIsBulkEditOpen(true)}
                disabled={selectedCardIds.length === 0}
              >
                Bulk Edit
              </button>
            </div>
          ) : null}

          <LibraryPagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalCards={displayItems.length}
            canPrev={canPrev}
            canNext={canNext}
            onPrev={goPrev}
            onNext={goNext}
          />

          {loading ? <div className="state-message">Loading library...</div> : null}
          {error ? <div className="state-message error">{error}</div> : null}

          {pageItems.length === 0 ? (
            <div className="state-message">No cards match your filters.</div>
          ) : (
            <LibraryGrid
              items={pageItems}
              sizeMode={sizeMode}
              captionsEnabled={captionsEnabled}
              onSelectItem={handleSelectItem}
              isSelectMode={isSelectMode}
              selectedCardIds={selectedCardIds}
            />
          )}
        </div>

        <BulkEditPanel
          isOpen={isBulkEditOpen}
          selectedCount={selectedCardIds.length}
          selectedCards={selectedCards}
          allCards={cards}
          onClose={() => setIsBulkEditOpen(false)}
          onApply={handleApplyBulkEdit}
          isApplying={isApplyingBulkEdit}
        />
      </div>

      <CardDetailModal
        card={selectedCard}
        isOpen={Boolean(selectedCard)}
        onClose={handleCloseModal}
        onSaved={handleSavedCard}
        onDeleted={handleDeletedCard}
      />
    </PageContainer>
  );
}