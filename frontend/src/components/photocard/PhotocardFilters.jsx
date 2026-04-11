/**
 * PhotocardFilters — left sidebar filter panel for the photocard library.
 *
 * Filter state shape (each multi-select uses emptySection() from FilterSidebar):
 *   notesSearch   — string
 *   group         — { mode, include, exclude }  (group_id as string IDs)
 *   member        — { mode, include, exclude }  (member name as ID)
 *   category      — { mode, include, exclude }  (top_level_category_id)
 *   sourceOrigin  — { mode, include, exclude }  (source_origin_id)
 *   version       — { mode, include, exclude }  (version string)
 *   ownership     — { mode, include, exclude }  (ownership_status_id)
 *   backImage     — { mode, include, exclude }  ("has_back" | "no_back")
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
}) {
  const hasFilters =
    filters.notesSearch?.trim() ||
    sectionActive(filters.group) ||
    sectionActive(filters.member) ||
    sectionActive(filters.category) ||
    sectionActive(filters.sourceOrigin) ||
    sectionActive(filters.version) ||
    sectionActive(filters.ownership) ||
    sectionActive(filters.backImage);

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
        title="Back Image"
        items={[
          { id: "has_back", label: "Has Back" },
          { id: "no_back", label: "Missing Back" },
        ]}
        section={filters.backImage}
        onChange={(s) => onSectionChange("backImage", s)}
      />
    </FilterSidebarShell>
  );
}
