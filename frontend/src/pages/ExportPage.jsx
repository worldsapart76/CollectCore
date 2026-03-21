import { useEffect, useMemo, useState } from "react";
import PageContainer from "../components/layout/PageContainer";
import LibraryFilterSidebar from "../components/library/LibraryFilterSidebar";
import { getCards } from "../services/libraryApi";
import { filterCards } from "../utils/filterUtils";
import { sortCards } from "../utils/sortUtils";
import { getMembersForGroup } from "../utils/groupUtils";

const emptyFilters = {
  search: "",
  members: [],
  groupCodes: ["skz"],
  topLevelCategories: [],
  subCategories: [],
  version: "",
  ownershipStatus: ["For Trade"],
  backStatus: [],
};

export default function ExportPage() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [filters, setFilters] = useState(emptyFilters);
  const [sortMode, setSortMode] = useState("id-asc");

  const [includeCaptions, setIncludeCaptions] = useState(true);
  const [includeBacks, setIncludeBacks] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    async function loadCards() {
      try {
        setLoading(true);
        setError("");
        const data = await getCards();
        setCards(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error(err);
        setError("Failed to load cards for export.");
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

  async function handleExport() {
    if (sortedCards.length === 0) {
      setError("No cards match current export filters.");
      return;
    }

    setIsExporting(true);
    setError("");

    try {
      const response = await fetch("http://127.0.0.1:8000/export/pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          card_ids: sortedCards.map((card) => card.id),
          include_captions: includeCaptions,
          include_backs: includeBacks,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Export failed.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "photocard_export.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      setError("Failed to export PDF.");
    } finally {
      setIsExporting(false);
    }
  }

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
          <div
            style={{
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              alignItems: "flex-end",
              marginBottom: 16,
            }}
          >
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Sort</div>
              <select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
                <option value="id-asc">ID ↑</option>
                <option value="id-desc">ID ↓</option>
                <option value="member">Member</option>
                <option value="category">Category</option>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
              </select>
            </div>

            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={includeCaptions}
                onChange={(e) => setIncludeCaptions(e.target.checked)}
              />
              Include captions
            </label>

            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={includeBacks}
                onChange={(e) => setIncludeBacks(e.target.checked)}
              />
              Include backs
            </label>

            <button type="button" onClick={handleExport} disabled={isExporting || loading}>
              {isExporting ? "Exporting..." : "Export PDF"}
            </button>
          </div>

          <div style={{ marginBottom: 12 }}>
            <h2 style={{ margin: "0 0 6px 0" }}>Export PDF</h2>
            <p style={{ margin: 0 }}>
              Export the cards that match the current filters and sort order.
            </p>
          </div>

          {loading ? <div className="state-message">Loading cards...</div> : null}
          {error ? <div className="state-message error">{error}</div> : null}

          {!loading ? (
            <div
              style={{
                border: "1px solid #ddd",
                borderRadius: 8,
                padding: 12,
                background: "#fafafa",
                maxWidth: 520,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Export Summary</div>
              <div style={{ marginBottom: 4 }}>Matching cards: {sortedCards.length}</div>
              <div style={{ marginBottom: 4 }}>
                Ownership sections in result:{" "}
                {[
                  ...new Set(
                    sortedCards.map((card) => card.ownership_status).filter(Boolean)
                  ),
                ].join(", ") || "None"}
              </div>
              <div style={{ marginBottom: 4 }}>
                Backs included: {includeBacks ? "Yes" : "No"}
              </div>
              <div>Captions included: {includeCaptions ? "Yes" : "No"}</div>
            </div>
          ) : null}
        </div>
      </div>
    </PageContainer>
  );
}