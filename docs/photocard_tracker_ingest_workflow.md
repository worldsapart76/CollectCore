# Photocard Tracker --- Image Ingest Workflow Specification

## Overview

This document describes the complete image ingest workflow used in the
Photocard Tracker application. It covers:

-   Front image ingest (record creation)
-   Back image attachment flow
-   Filename structure
-   Candidate matching logic
-   Handling missing backs
-   Image replacement behavior
-   Image versioning via file timestamps

This is intended as a precise reference for rebuilding or generalizing
the system.

------------------------------------------------------------------------

# 1. Core Mental Model

The ingest system is built on a two-phase model:

> **Front images create records. Back images attach to records.**

This is not symmetrical.

-   Front image = new item
-   Back image = attachment to existing item

------------------------------------------------------------------------

# 2. Front Image Ingest Flow

## Step 1: Image enters inbox

Temporary storage location:

    images/inbox/

This acts as a staging area before permanent storage.

------------------------------------------------------------------------

## Step 2: Metadata is assigned (UI)

User selects:

-   group_code
-   member
-   top_level_category
-   sub_category
-   version (source)
-   ownership_status
-   price (optional)

### Behavior

-   Values persist across multiple items
-   Enables fast batch ingest

------------------------------------------------------------------------

## Step 3: Backend ingest call

Endpoint:

    POST /ingest/front

### Actions performed:

1.  Create database row
2.  Generate permanent filename
3.  Move file from inbox to library
4.  Update database with file path

------------------------------------------------------------------------

## Step 4: File moved to permanent storage

From:

    images/inbox/file.jpg

To:

    images/library/skz_000123_f.jpg

------------------------------------------------------------------------

# 3. Filename Structure

    {group_code}_{id:06d}_{side}.{ext}

Examples:

    skz_000123_f.jpg
    skz_000123_b.jpg

### Components

-   group_code → collection identifier
-   id → database ID (zero-padded)
-   side → f (front) or b (back)
-   extension → preserved

### Design Intent

-   Deterministic naming
-   Stable mapping between DB and filesystem
-   Easy manual inspection/debugging

------------------------------------------------------------------------

# 4. Back Image Attachment Flow

Back images do NOT create new records.

------------------------------------------------------------------------

## Step 1: Back image enters inbox

Same as front:

    images/inbox/

------------------------------------------------------------------------

## Step 2: Candidate matching

Endpoint:

    GET /card-candidates

### Matching Criteria

-   group_code
-   member
-   category
-   subcategory
-   optionally exclude cards that already have backs

### Output

List of candidate cards with front images.

------------------------------------------------------------------------

## Step 3: User selects correct card

UI presents: - thumbnails of candidate fronts

User manually selects match.

------------------------------------------------------------------------

## Step 4: Attach back

Endpoint:

    POST /attach-back

### Actions performed:

1.  Validate card exists

2.  Check if back already exists

3.  Optionally allow override

4.  Move file to permanent location:

        skz_000123_b.jpg

5.  Update database:

        back_image_path

------------------------------------------------------------------------

# 5. Missing Back Behavior

Cards can exist without backs.

### Database representation

    back_image_path = NULL

------------------------------------------------------------------------

## UI Behavior

### Library

-   Filter options:
    -   Has Back
    -   Missing Back

### Display

-   "Missing back" indicator shown

------------------------------------------------------------------------

## Design Intent

Supports real-world workflow: - front scanned first - back added later

------------------------------------------------------------------------

# 6. Adding Back Later

Workflow:

1.  Upload back images to inbox
2.  Use candidate matching
3.  Attach to existing records

### Key Benefit

-   No duplication
-   No re-ingest
-   Metadata remains intact

------------------------------------------------------------------------

# 7. Image Replacement

Endpoints:

    POST /cards/{id}/replace-front
    POST /cards/{id}/replace-back

### Behavior

-   Old file removed
-   New file saved with same naming convention
-   Record identity preserved

------------------------------------------------------------------------

# 8. Image Versioning (Cache Busting)

## Problem

Browsers cache images aggressively.

------------------------------------------------------------------------

## Solution

Use file modification time:

    stat().st_mtime_ns

------------------------------------------------------------------------

## Implementation

Frontend uses:

    /images/library/skz_000123_f.jpg?v=timestamp

When file changes: - timestamp changes - URL changes - browser reloads
image

------------------------------------------------------------------------

## Advantages

-   No schema changes required
-   No version tracking fields
-   Uses filesystem as source of truth

------------------------------------------------------------------------

# 9. Design Principles

### 1. Front-first identity

Front image defines the record.

### 2. Stable filenames

Deterministic naming prevents orphaned files.

### 3. Inbox staging

Separates temporary and permanent files.

### 4. Human-in-the-loop matching

Prevents incorrect associations.

### 5. Incomplete states allowed

Missing backs are normal.

------------------------------------------------------------------------

# 10. Non-Obvious Behaviors

-   Matching is metadata-based (no image recognition)
-   Back images cannot exist independently
-   Filename structure encodes identity
-   Versioning depends on filesystem

------------------------------------------------------------------------

# 11. Considerations for Rebuild

## Keep

-   Two-phase ingest model
-   Inbox staging
-   Deterministic identity

## Re-evaluate

-   Strict front/back model
-   Path-based storage
-   Filesystem-based versioning

## Potential Improvements

-   Multi-asset support (beyond front/back)
-   Asset table abstraction
-   Cloud storage support
-   Smarter matching

------------------------------------------------------------------------

# Summary

The ingest system is:

> **A two-phase, front-first, human-confirmed attachment pipeline with
> deterministic file identity and filesystem-based versioning.**

------------------------------------------------------------------------

# End of Document
