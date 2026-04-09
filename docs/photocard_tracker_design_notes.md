# Photocard Tracker --- Design & Architecture Notes

## 1. Key Design Decisions

### Local-first over cloud-first

The app was built as a local system (FastAPI + SQLite + local images) to
maximize speed, control, and low friction.

### Frontend controls filtering/sorting

Filtering and sorting are handled in the frontend and passed to the
backend as ordered IDs, ensuring consistency between views and export.

### Option tables are rebuilt, not incrementally updated

`subcategory_options` and `source_options` are derived from card data to
avoid constraint issues and stale entries.

### Backend field vs UI label

Database uses `source`, UI uses **Version** --- intentionally decoupled.

### Scoped metadata hierarchy

-   Subcategory → group + category
-   Version → group + category + subcategory

### Bulk edit is restrictive by design

Fields are enabled only when valid for the final state to prevent
invalid data combinations.

------------------------------------------------------------------------

## 2. Known Shortcuts

-   `source` not renamed to `version`
-   Local file storage instead of asset system
-   Export logic still photocard-specific
-   Option tables are derived, not authoritative
-   No virtualization/performance layer
-   Inline styling instead of design system

------------------------------------------------------------------------

## 3. UI Intent

### Inbox

Fast ingestion with minimal typing and persistent metadata.

### Library

Primary work surface for browsing, filtering, editing.

### Fronts view

Fast scanning mode.

### Fronts + Backs view

Verification/comparison mode.

### Bulk Edit

Safe batch updates with guardrails.

### Export

Filtered + sorted subset → PDF.

------------------------------------------------------------------------

## 4. Data Modeling Decisions

-   Card = single item with optional front/back images
-   Group code drives member ordering and filtering
-   Ownership affects filtering and export grouping
-   Option tables derived from card data
-   Filenames embed ID
-   Image versioning via file timestamp

------------------------------------------------------------------------

## 5. Photocard-Specific Logic

-   Front/back ingest workflow
-   Version = release concept
-   Missing back is meaningful
-   Trade export includes disclaimer
-   Caption format: subcategory \| version
-   Ownership badges (O/W/T)
-   Front image treated as primary

------------------------------------------------------------------------

## 6. Future Enhancements

-   Binder UI improvements
-   Web-viewable trade lists
-   Cloud hosting (Supabase)
-   Public sharing (Vercel)
-   Mobile scanning app
-   Advanced bulk editing
-   Performance scaling
-   Schema generalization

------------------------------------------------------------------------

## Summary

This app prioritizes: - speed - correctness - minimal friction -
practical workflows

It is a strong foundation for evolving into a generalized collection
system.
