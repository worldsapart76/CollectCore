/**
 * PhotocardFilters — left sidebar filter panel for the photocard library.
 *
 * Filter state shape (each multi-select uses emptySection() from FilterSidebar):
 *   notesSearch   — string
 *   group         — { mode, include, exclude }  (group_id as string IDs)
 *   member        — { mode, include, exclude }  (member name as ID)
 *   category      — { mode, include, exclude }  (top_level_category_id)
 *   sourceOrigin  — { mode, include, exclude }  (source_origin_id)
 *   cardType      — { mode, include, exclude }  ("special" | "regular")
 *   version       — { mode, include, exclude }  (version string)
 *   ownership     — { mode, include, exclude }  (ownership_status_id)
 *   imageStatus   — { mode, include, exclude }  ("missing_front" | "missing_back")
 *   triage        — { mode, include, exclude }  ("tracked" | "untracked")
 *   market        — { mode, include, exclude }  ("has_comps" | "no_comps")
 *
 * Props:
 *   groups            — array of { group_id, group_name }
 *   members           — array of { member_id, member_name }
 *   categories        — array of { top_level_category_id, category_name }
 *   sourceOrigins     — array of { source_origin_id, source_origin_name }
 *   versions          — array of { id, label }
 *   ownershipStatuses — array of { ownership_status_id, status_name }
 *   filters           — current filter state object
 *   onSectionChange   — callback(filterKey, value)
 *   onClearAll        — callback to reset all filters
 *   showMarket        — render the Market section (admin only; /market/summary
 *                       never loads on guest builds, so every card would read
 *                       as "no comps" and the filter would empty the library)
 *   showTriage        — render the Triage section (admin only; the triage
 *                       statuses don't exist on /pcs/)
 */
import {
  FilterSidebarShell,
  TriStateFilterSection,
  SearchableTriStateSection,
  sectionActive,
} from "../library/FilterSidebar";

export default function PhotocardFilters({
  groups,
  members,
  categories,
  sourceOrigins,
  versions,
  ownershipStatuses,
  filters,
  onSectionChange,
  onClearAll,
  showTriage = false,
  showMarket = false,
}) {
  const hasFilters =
    filters.notesSearch?.trim() ||
    sectionActive(filters.group) ||
    sectionActive(filters.member) ||
    sectionActive(filters.category) ||
    sectionActive(filters.sourceOrigin) ||
    sectionActive(filters.cardType) ||
    sectionActive(filters.version) ||
    sectionActive(filters.ownership) ||
    sectionActive(filters.imageStatus) ||
    sectionActive(filters.triage) ||
    sectionActive(filters.market);

  return (
    <FilterSidebarShell
      hasFilters={!!hasFilters}
      onClearAll={onClearAll}
      searchValue={filters.notesSearch}
      onSearch={(v) => onSectionChange("notesSearch", v)}
      searchPlaceholder="Search notes..."
    >
      <TriStateFilterSection
        title="Group"
        items={groups.map((g) => ({ id: String(g.group_id), label: g.group_name }))}
        section={filters.group}
        onChange={(s) => onSectionChange("group", s)}
      />

      <TriStateFilterSection
        title="Member"
        items={members.map((m) => ({ id: m.member_id, label: m.member_name }))}
        section={filters.member}
        onChange={(s) => onSectionChange("member", s)}
        defaultShown={10}
      />

      <TriStateFilterSection
        title="Category"
        items={categories.map((c) => ({
          id: String(c.top_level_category_id),
          label: c.category_name,
        }))}
        section={filters.category}
        onChange={(s) => onSectionChange("category", s)}
      />

      {sourceOrigins.length > 0 && (
        <SearchableTriStateSection
          title="Source Origin"
          items={sourceOrigins.map((o) => ({
            id: String(o.source_origin_id),
            label: o.source_origin_name,
          }))}
          section={filters.sourceOrigin}
          onChange={(s) => onSectionChange("sourceOrigin", s)}
          selectedOnly
        />
      )}

      <TriStateFilterSection
        title="Card Type"
        items={[
          { id: "special", label: "★ Special" },
          { id: "regular", label: "Regular" },
        ]}
        section={filters.cardType}
        onChange={(s) => onSectionChange("cardType", s)}
      />

      {versions.length > 0 && (
        <SearchableTriStateSection
          title="Version"
          items={versions}
          section={filters.version}
          onChange={(s) => onSectionChange("version", s)}
          selectedOnly
        />
      )}

      <TriStateFilterSection
        title="Ownership"
        items={ownershipStatuses.map((s) => ({
          id: String(s.ownership_status_id),
          label: s.status_name,
        }))}
        section={filters.ownership}
        onChange={(s) => onSectionChange("ownership", s)}
      />

      <TriStateFilterSection
        title="Image"
        items={[
          { id: "missing_front", label: "Missing Front" },
          { id: "missing_back", label: "Missing Back" },
        ]}
        section={filters.imageStatus}
        onChange={(s) => onSectionChange("imageStatus", s)}
      />

      {/* Card-level triage state. Separate from Ownership on purpose: a
          {Not Wanted + Trade} card is Tracked (you hold a copy), which an
          Ownership exclusion could not express — applySection's exclude is
          card-wide and would hide it. "Untracked" is the triage queue. */}
      {/* Market data. The verb behind "show me what I have comps on" -- a
          badge alone would be a needle hunt across 11,000 thumbnails, and the
          header's count is half the answer. */}
      {showMarket && (
        <TriStateFilterSection
          title="Market"
          items={[
            { id: "has_comps", label: "Has comps" },
            { id: "no_comps", label: "No comps" },
          ]}
          section={filters.market}
          onChange={(s) => onSectionChange("market", s)}
        />
      )}

      {showTriage && (
        <TriStateFilterSection
          title="Triage"
          items={[
            { id: "tracked", label: "Tracked" },
            { id: "untracked", label: "Untracked" },
          ]}
          section={filters.triage}
          onChange={(s) => onSectionChange("triage", s)}
        />
      )}
    </FilterSidebarShell>
  );
}
