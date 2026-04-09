# Photocard Tracker --- UI Specification (Comprehensive)

## Overview

This document describes the full UI behavior of the Photocard Tracker
application, including: - All screens and panels - Fields and controls -
User interactions - Validation and logic rules enforced by the UI

This is intended as a complete reference for rebuilding or generalizing
the application UI.

------------------------------------------------------------------------

# 1. Global UI Structure

The application follows a two-panel layout pattern:

-   **Left Sidebar** → Filters (Library / Export)
-   **Main Content Area** → Grid, controls, or workflow UI

Shared characteristics: - Compact spacing - Minimal padding - Dense
information display - Button-driven interaction preferred over free
typing

------------------------------------------------------------------------

# 2. Inbox Manager (Ingest View)

## Purpose

Fast ingestion of new items with minimal repeated input.

## Layout

-   Left: Image preview
-   Right: Metadata input panel

## Fields

### Group

-   Dropdown
-   Default: `skz`
-   Affects available members and subcategories

### Member

-   Dropdown
-   Populated from group utility
-   Order is custom, not alphabetical

### Category (Top Level)

-   Dropdown
-   Values: `Album`, `Non-Album`

### Subcategory

-   Input with suggestions
-   Suggestions scoped to:
    -   group + category

### Version (UI label)

-   Input with suggestions
-   Suggestions scoped to:
    -   group + category + subcategory

### Ownership Status

-   Dropdown
-   Values:
    -   Owned
    -   Want
    -   For Trade

### Price

-   Numeric input
-   Optional

## Behavior

-   Field values persist across items
-   Temporary UI state resets:
    -   warnings
    -   candidate selections
-   Version suggestions dynamically update

------------------------------------------------------------------------

# 3. Library Page

## Purpose

Primary browsing, filtering, and editing interface.

## Layout

### Left Sidebar (Filters)

### Top Controls Bar

### Grid Display

### Pagination

------------------------------------------------------------------------

## 3.1 Filter Sidebar

### Search

-   Text input
-   Searches:
    -   notes
    -   member
    -   subcategory
    -   category
    -   group
    -   version

### Member Filter

-   Multi-select list
-   Non-alphabetical ordering

### Group Filter

-   Multi-select list
-   Uses display labels

### Category Filter

-   Multi-select

### Subcategory Filter

-   Multi-select
-   Searchable

### Version Filter

-   Search input
-   Single selection
-   Scoped to:
    -   group + category (not subcategory)

### Ownership Filter

-   Multi-select:
    -   Owned
    -   Want
    -   For Trade

### Back Status Filter

-   Options:
    -   Has Back
    -   Missing Back

------------------------------------------------------------------------

## 3.2 Controls Bar

### View Mode

-   Toggle:
    -   Fronts
    -   Fronts + Backs

### Size Mode

-   Options:
    -   S
    -   M
    -   L

### Sort Mode

-   Options:
    -   ID ↑
    -   ID ↓
    -   Member
    -   Category
    -   Newest
    -   Oldest

### Captions Toggle

-   On / Off

### Select Mode

-   Enables multi-select

------------------------------------------------------------------------

## 3.3 Grid Display

### Fronts Mode

-   One card per grid cell
-   Displays:
    -   front image
    -   optional caption
    -   ownership badge (bottom-left)

### Fronts + Backs Mode

-   Card spans two columns
-   Displays:
    -   front (left)
    -   back (right)
-   Treated as one unit

------------------------------------------------------------------------

## 3.4 Card Elements

### Ownership Badge

-   Bottom-left of front image
-   Style:
    -   black background
    -   colored text:
        -   O → green
        -   W → yellow
        -   T → red

### Missing Back Indicator

-   Text label below image

### Caption

-   Format:
    -   subcategory \| version

------------------------------------------------------------------------

## 3.5 Pagination

-   Page size: 30
-   Controls:
    -   Previous
    -   Next
-   Resets on:
    -   filter change
    -   sort change

------------------------------------------------------------------------

# 4. Selection & Bulk Edit

## Selection Mode

### Behavior

-   Clicking selects cards instead of opening modal
-   Selected cards:
    -   highlighted border
-   Toolbar shows:
    -   count
    -   actions

### Actions

-   Select All on Page
-   Clear Selection
-   Open Bulk Edit

------------------------------------------------------------------------

## 4.1 Bulk Edit Panel

### Fields

  Field         Actions
  ------------- ----------------------
  Member        set
  Category      set
  Subcategory   set / clear
  Version       set / clear
  Ownership     set
  Price         set / clear
  Notes         set / append / clear

------------------------------------------------------------------------

## 4.2 Compatibility Rules

### Always Enabled

-   Ownership
-   Price
-   Notes

### Conditional

  Field         Requirement
  ------------- --------------------------------
  Member        single group
  Subcategory   group + category
  Version       group + category + subcategory

### Dynamic Behavior

-   Setting Category unlocks Subcategory
-   Setting Subcategory unlocks Version
-   Invalid fields:
    -   disabled
    -   show explanation

------------------------------------------------------------------------

# 5. Card Detail Modal

## Purpose

Edit a single item.

## Features

-   Update metadata
-   Replace front/back images
-   Delete card

## Behavior

-   Opens on card click (non-select mode)
-   Updates reflected immediately

------------------------------------------------------------------------

# 6. Export Page

## Purpose

Generate PDF based on Library filters.

## Layout

-   Left: same filter sidebar
-   Right: controls + summary

## Controls

### Sort

-   Same options as Library

### Include Captions

-   Checkbox

### Include Backs

-   Checkbox

### Export Button

-   Disabled when:
    -   no matching cards
    -   export in progress

------------------------------------------------------------------------

## Behavior

-   Uses same filtering logic as Library
-   Uses same sorting logic
-   Sends ordered `card_ids` to backend
-   Backend preserves order

------------------------------------------------------------------------

## Export Summary Panel

Displays: - number of matching cards - ownership categories present -
include backs/captions status

------------------------------------------------------------------------

# 7. UI Design Principles

-   Compact and dense
-   Minimal whitespace
-   High efficiency for repeated actions
-   Prevent invalid input
-   Favor guided controls over free text

------------------------------------------------------------------------

# End of Document
