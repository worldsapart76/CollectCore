PRAGMA foreign_keys = ON;

-- ============================================================
-- COLLECTCORE SCHEMA
-- Phase 1: Shared Core + Photocards + Books
-- ============================================================


-- ============================================================
-- SHARED LOOKUP TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS lkup_collection_types (
    collection_type_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_type_code TEXT NOT NULL UNIQUE,
    collection_type_name TEXT NOT NULL,
    sort_order           INTEGER NOT NULL DEFAULT 0,
    is_active            INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_ownership_statuses (
    ownership_status_id INTEGER PRIMARY KEY AUTOINCREMENT,
    status_code         TEXT NOT NULL UNIQUE,
    status_name         TEXT NOT NULL,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    is_active           INTEGER NOT NULL DEFAULT 1
);

-- Shared consumption/read statuses (Books, Graphic Novels, Video, Video Games)
-- Formerly named lkup_book_read_statuses; renamed as it now serves multiple modules.
CREATE TABLE IF NOT EXISTS lkup_consumption_statuses (
    read_status_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    status_name     TEXT NOT NULL UNIQUE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1
);

-- Module visibility for ownership statuses: controls which statuses appear in each module
CREATE TABLE IF NOT EXISTS xref_ownership_status_modules (
    ownership_status_id INTEGER NOT NULL,
    collection_type_id  INTEGER NOT NULL,
    PRIMARY KEY (ownership_status_id, collection_type_id),
    FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id),
    FOREIGN KEY (collection_type_id)  REFERENCES lkup_collection_types(collection_type_id)
);

-- Module visibility for consumption statuses: controls which statuses appear in each module
CREATE TABLE IF NOT EXISTS xref_consumption_status_modules (
    read_status_id     INTEGER NOT NULL,
    collection_type_id INTEGER NOT NULL,
    PRIMARY KEY (read_status_id, collection_type_id),
    FOREIGN KEY (read_status_id)       REFERENCES lkup_consumption_statuses(read_status_id),
    FOREIGN KEY (collection_type_id)   REFERENCES lkup_collection_types(collection_type_id)
);

CREATE TABLE IF NOT EXISTS lkup_top_level_categories (
    top_level_category_id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_type_id    INTEGER NOT NULL,
    category_name         TEXT NOT NULL,
    sort_order            INTEGER NOT NULL DEFAULT 0,
    is_active             INTEGER NOT NULL DEFAULT 1,

    FOREIGN KEY (collection_type_id) REFERENCES lkup_collection_types(collection_type_id)
);


-- ============================================================
-- SHARED CORE DATA TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS tbl_items (
    item_id               INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_type_id    INTEGER NOT NULL,
    top_level_category_id INTEGER NOT NULL,
    ownership_status_id   INTEGER,
    reading_status_id     INTEGER,
    notes                 TEXT,
    date_read             TEXT,
    catalog_item_id       TEXT,
    catalog_version       INTEGER,
    created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (collection_type_id) REFERENCES lkup_collection_types(collection_type_id),
    FOREIGN KEY (top_level_category_id) REFERENCES lkup_top_level_categories(top_level_category_id),
    FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id),
    FOREIGN KEY (reading_status_id) REFERENCES lkup_consumption_statuses(read_status_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tbl_items_catalog_item_id
    ON tbl_items(catalog_item_id) WHERE catalog_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tbl_attachments (
    attachment_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id         INTEGER NOT NULL,
    attachment_type TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    storage_type    TEXT NOT NULL DEFAULT 'local',
    mime_type       TEXT,
    display_order   INTEGER NOT NULL DEFAULT 1,
    image_version   INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id)
);

-- Tracks R2 keys whose attachment row has moved on to a newer version.
-- The publisher inserts a row here whenever it overwrites a URL with a
-- versioned successor; a startup sweeper deletes any row past its
-- scheduled_delete_at and removes the corresponding R2 object.
CREATE TABLE IF NOT EXISTS tbl_r2_orphans (
    key                   TEXT PRIMARY KEY,
    scheduled_delete_at   TEXT NOT NULL
);

-- Photocard trade pages — server-hosted shareable URLs at /trade/<slug>.
-- Created by admin (no expiry) or guest (30-day expiry). payload_json bakes
-- in the card image URLs + captions so the trade renders standalone; viewers
-- who happen to be logged-in admin or guest get ownership badges layered on
-- via a separate library lookup at view time.
CREATE TABLE IF NOT EXISTS tbl_trades (
    slug              TEXT PRIMARY KEY,
    created_by        TEXT NOT NULL,
    from_name         TEXT NOT NULL,
    to_name           TEXT,
    notes             TEXT,
    include_backs     INTEGER NOT NULL DEFAULT 0,
    payload_json      TEXT NOT NULL,
    created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_tbl_trades_expires
    ON tbl_trades(expires_at) WHERE expires_at IS NOT NULL;


-- ============================================================
-- BINDER DESIGNER  (dev-only feature)
-- ============================================================
-- Digital representation of a physical photocard binder: a named binder with
-- one pocket layout, an ordered list of sheets, and a card in each pocket.
-- The UI is gated behind import.meta.env.DEV and never reaches a production
-- bundle, so these tables exist but stay empty in prod. Design:
-- docs/photocard_binder_designer_plan.md
--
-- NOTE the FOREIGN KEY clauses below are documentation only. `PRAGMA
-- foreign_keys = ON` is issued on init_db's connection alone (db.py), never on
-- request sessions, so nothing cascades — every delete path cleans up
-- explicitly, the way bulk_delete_photocards already does.

CREATE TABLE IF NOT EXISTS tbl_binders (
    binder_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    binder_name  TEXT NOT NULL,
    layout_code  TEXT NOT NULL,              -- '2x2' | '2x3' | '3x3' | '3x4' (cols x rows)
    notes        TEXT,
    created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tbl_binder_pages (
    page_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    binder_id   INTEGER NOT NULL,
    page_index  INTEGER NOT NULL,            -- 0-based sheet order
    UNIQUE (binder_id, page_index),
    FOREIGN KEY (binder_id) REFERENCES tbl_binders(binder_id)
);

-- UNIQUE (item_id) is what enforces "a card lives in at most one pocket, in at
-- most one binder" — a physical card can only be in one place.
CREATE TABLE IF NOT EXISTS tbl_binder_slots (
    slot_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id     INTEGER NOT NULL,
    slot_index  INTEGER NOT NULL,            -- row-major within the page
    item_id     INTEGER NOT NULL,
    UNIQUE (page_id, slot_index),
    UNIQUE (item_id),
    FOREIGN KEY (page_id) REFERENCES tbl_binder_pages(page_id),
    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id)
);
CREATE INDEX IF NOT EXISTS idx_binder_pages_binder ON tbl_binder_pages(binder_id);
CREATE INDEX IF NOT EXISTS idx_binder_slots_page   ON tbl_binder_slots(page_id);


-- ============================================================
-- PHOTOCARD TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS lkup_photocard_groups (
    group_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    group_code  TEXT NOT NULL UNIQUE,
    group_name  TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_photocard_members (
    member_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id     INTEGER NOT NULL,
    member_code  TEXT NOT NULL,
    member_name  TEXT NOT NULL,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    is_active    INTEGER NOT NULL DEFAULT 1,

    FOREIGN KEY (group_id) REFERENCES lkup_photocard_groups(group_id),
    UNIQUE (group_id, member_code),
    UNIQUE (group_id, member_name)
);

CREATE TABLE IF NOT EXISTS lkup_photocard_source_origins (
    source_origin_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id             INTEGER NOT NULL,
    top_level_category_id INTEGER NOT NULL,
    source_origin_name   TEXT NOT NULL,
    sort_order           INTEGER NOT NULL DEFAULT 0,
    is_active            INTEGER NOT NULL DEFAULT 1,
    -- When this line STARTED SHIPPING (ISO 8601 'YYYY-MM-DD'), not a release
    -- date: tours, pop-ups and collab series span weeks or months, so this is
    -- the opening of the window. date_precision ('day'|'month'|'year') says how
    -- much of it to trust -- month is stored as the 1st, year as Jan 1. Both
    -- nullable; a new origin is dateless until someone fills it in.
    -- NOTE: this table is SELECT *'d by catalog.py and copied by seed_builder,
    -- so these columns ship to the catalog delta and the guest seed. That is
    -- intended here (a ship date is public fact, unlike pricing), but it means
    -- a seed regen + guest smoke test is part of changing them.
    start_date           TEXT,
    date_precision       TEXT,

    FOREIGN KEY (group_id) REFERENCES lkup_photocard_groups(group_id),
    FOREIGN KEY (top_level_category_id) REFERENCES lkup_top_level_categories(top_level_category_id),
    UNIQUE (group_id, top_level_category_id, source_origin_name)
);

CREATE TABLE IF NOT EXISTS tbl_photocard_details (
    item_id           INTEGER PRIMARY KEY,
    group_id          INTEGER NOT NULL,
    source_origin_id  INTEGER,
    version           TEXT,
    is_special        INTEGER NOT NULL DEFAULT 1,

    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id),
    FOREIGN KEY (group_id) REFERENCES lkup_photocard_groups(group_id),
    FOREIGN KEY (source_origin_id) REFERENCES lkup_photocard_source_origins(source_origin_id)
);

CREATE TABLE IF NOT EXISTS xref_photocard_members (
    item_id   INTEGER NOT NULL,
    member_id INTEGER NOT NULL,

    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id),
    FOREIGN KEY (member_id) REFERENCES lkup_photocard_members(member_id),
    UNIQUE (item_id, member_id)
);

-- Per-copy ownership for photocards (1:many with tbl_items).
-- Added by migrate_photocard_copies.py; codified here so fresh installs match.
CREATE TABLE IF NOT EXISTS tbl_photocard_copies (
    copy_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id             INTEGER NOT NULL,
    ownership_status_id INTEGER NOT NULL,
    notes               TEXT,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (item_id) REFERENCES tbl_photocard_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id)
);


-- ------------------------------------------------------------
-- Photocard pricing  (admin-only; design: docs/photocard_pricing_and_trade_export_plan.md)
-- ------------------------------------------------------------
-- Deliberately a SIDE TABLE rather than columns on tbl_photocard_details:
-- two guest-facing paths copy that table by reflection, not by an explicit
-- column list (catalog.py's `SELECT *` and seed_builder's PRAGMA-driven copy),
-- so anything added there ships to the catalog delta endpoint and the guest
-- seed automatically. A separate table is invisible to both by construction.
--
-- NOTE the FOREIGN KEY clauses below are documentation only — `PRAGMA
-- foreign_keys = ON` is issued on init_db's connection alone (db.py), so
-- nothing cascades; every delete path cleans up explicitly.

CREATE TABLE IF NOT EXISTS lkup_photocard_price_tiers (
    tier_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    tier_code   TEXT NOT NULL UNIQUE,
    tier_name   TEXT NOT NULL,
    price_cents INTEGER NOT NULL,           -- money is INTEGER cents throughout
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1
);

-- Tier and custom price are mutually exclusive, not layered: editing a card's
-- price REMOVES it from its tier so a later tier sweep can't silently reset it.
-- The CHECK is what enforces the three legal states (no row = unpriced,
-- tier set = tiered, price_cents set = custom).
CREATE TABLE IF NOT EXISTS tbl_photocard_pricing (
    item_id       INTEGER PRIMARY KEY,
    price_tier_id INTEGER,
    price_cents   INTEGER,
    updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CHECK ((price_tier_id IS NULL) <> (price_cents IS NULL)),
    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id),
    FOREIGN KEY (price_tier_id) REFERENCES lkup_photocard_price_tiers(tier_id)
);

CREATE INDEX IF NOT EXISTS idx_photocard_pricing_tier
    ON tbl_photocard_pricing (price_tier_id);

INSERT OR IGNORE INTO lkup_photocard_price_tiers (tier_code, tier_name, price_cents, sort_order) VALUES ('t1', 'Tier 1',  400, 1);
INSERT OR IGNORE INTO lkup_photocard_price_tiers (tier_code, tier_name, price_cents, sort_order) VALUES ('t2', 'Tier 2',  600, 2);
INSERT OR IGNORE INTO lkup_photocard_price_tiers (tier_code, tier_name, price_cents, sort_order) VALUES ('t3', 'Tier 3',  900, 3);
INSERT OR IGNORE INTO lkup_photocard_price_tiers (tier_code, tier_name, price_cents, sort_order) VALUES ('t4', 'Tier 4', 1200, 4);


-- ============================================================
-- BOOKS LOOKUP TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS lkup_book_format_details (
    format_detail_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    format_name       TEXT NOT NULL UNIQUE,
    top_level_format  TEXT NOT NULL CHECK (top_level_format IN ('Physical', 'Digital', 'Audio')),
    sort_order        INTEGER NOT NULL DEFAULT 0,
    is_active         INTEGER NOT NULL DEFAULT 1
);

-- category_scope_id scopes each genre to Fiction or Non-Fiction for UI filtering.
-- Allows "Other" to exist independently under both categories.
CREATE TABLE IF NOT EXISTS lkup_book_top_level_genres (
    top_level_genre_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    category_scope_id   INTEGER NOT NULL,
    genre_name          TEXT NOT NULL,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    is_active           INTEGER NOT NULL DEFAULT 1,
    UNIQUE (genre_name, category_scope_id),
    FOREIGN KEY (category_scope_id) REFERENCES lkup_top_level_categories(top_level_category_id)
);

CREATE TABLE IF NOT EXISTS lkup_book_sub_genres (
    sub_genre_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    top_level_genre_id  INTEGER NOT NULL,
    sub_genre_name      TEXT NOT NULL,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    is_active           INTEGER NOT NULL DEFAULT 1,
    UNIQUE (sub_genre_name, top_level_genre_id),
    FOREIGN KEY (top_level_genre_id) REFERENCES lkup_book_top_level_genres(top_level_genre_id)
);

CREATE TABLE IF NOT EXISTS lkup_book_age_levels (
    age_level_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    age_level_name  TEXT NOT NULL UNIQUE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_book_authors (
    author_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    author_name  TEXT NOT NULL UNIQUE,
    author_sort  TEXT,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    is_active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_book_tags (
    tag_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_name   TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tbl_book_series (
    series_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    series_name  TEXT NOT NULL UNIQUE,
    series_sort  TEXT,
    is_active    INTEGER NOT NULL DEFAULT 1
);


-- ============================================================
-- BOOKS CORE TABLES
-- ============================================================

-- Work-level metadata (1:1 with tbl_items)
CREATE TABLE IF NOT EXISTS tbl_book_details (
    item_id             INTEGER PRIMARY KEY,
    title               TEXT NOT NULL,
    title_sort          TEXT,
    description         TEXT,
    age_level_id        INTEGER,
    star_rating         REAL CHECK (star_rating BETWEEN 0.5 AND 5.0),
    review              TEXT,
    api_categories_raw  TEXT,
    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id) ON DELETE CASCADE,
    FOREIGN KEY (age_level_id) REFERENCES lkup_book_age_levels(age_level_id)
);

-- Copy/edition-level (1:many with tbl_items)
CREATE TABLE IF NOT EXISTS tbl_book_copies (
    copy_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id           INTEGER NOT NULL,
    format_detail_id  INTEGER NOT NULL,
    isbn_13           TEXT,
    isbn_10           TEXT,
    publisher         TEXT,
    published_date    TEXT,
    page_count        INTEGER,
    language          TEXT DEFAULT 'en',
    cover_image_url   TEXT,
    notes             TEXT,
    api_source        TEXT,
    external_work_id  TEXT,
    UNIQUE (item_id, format_detail_id),
    FOREIGN KEY (item_id) REFERENCES tbl_book_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (format_detail_id) REFERENCES lkup_book_format_details(format_detail_id)
);


-- ============================================================
-- BOOKS XREF TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS xref_book_item_authors (
    item_id       INTEGER NOT NULL,
    author_id     INTEGER NOT NULL,
    author_order  INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (item_id, author_id),
    FOREIGN KEY (item_id) REFERENCES tbl_book_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES lkup_book_authors(author_id)
);

CREATE TABLE IF NOT EXISTS xref_book_item_series (
    item_id        INTEGER NOT NULL,
    series_id      INTEGER NOT NULL,
    series_number  REAL,
    PRIMARY KEY (item_id, series_id),
    FOREIGN KEY (item_id) REFERENCES tbl_book_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (series_id) REFERENCES tbl_book_series(series_id)
);

-- Composite uniqueness with nullable sub_genre_id enforced via partial indexes (SQLite limitation)
CREATE TABLE IF NOT EXISTS xref_book_item_genres (
    xref_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id             INTEGER NOT NULL,
    top_level_genre_id  INTEGER NOT NULL,
    sub_genre_id        INTEGER,
    FOREIGN KEY (item_id) REFERENCES tbl_book_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (top_level_genre_id) REFERENCES lkup_book_top_level_genres(top_level_genre_id),
    FOREIGN KEY (sub_genre_id) REFERENCES lkup_book_sub_genres(sub_genre_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_book_item_genres_with_sub
ON xref_book_item_genres(item_id, top_level_genre_id, sub_genre_id)
WHERE sub_genre_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_book_item_genres_no_sub
ON xref_book_item_genres(item_id, top_level_genre_id)
WHERE sub_genre_id IS NULL;

CREATE TABLE IF NOT EXISTS xref_book_item_tags (
    item_id   INTEGER NOT NULL,
    tag_id    INTEGER NOT NULL,
    PRIMARY KEY (item_id, tag_id),
    FOREIGN KEY (item_id) REFERENCES tbl_book_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES lkup_book_tags(tag_id)
);


-- ============================================================
-- BOOKS INDEXES
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS ux_book_copies_isbn13
ON tbl_book_copies(isbn_13)
WHERE isbn_13 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_book_details_title
ON tbl_book_details(title);


-- ============================================================
-- GRAPHIC NOVELS LOOKUP TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS lkup_graphicnovel_publishers (
    publisher_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    publisher_name  TEXT NOT NULL UNIQUE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_graphicnovel_format_types (
    format_type_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    format_type_name  TEXT NOT NULL UNIQUE,
    sort_order        INTEGER NOT NULL DEFAULT 0,
    is_active         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_graphicnovel_eras (
    era_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    era_name    TEXT NOT NULL UNIQUE,
    era_years   TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_graphicnovel_writers (
    writer_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    writer_name  TEXT NOT NULL UNIQUE,
    is_active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_graphicnovel_artists (
    artist_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    artist_name  TEXT NOT NULL UNIQUE,
    is_active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_graphicnovel_tags (
    tag_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_name   TEXT NOT NULL UNIQUE,
    is_active  INTEGER NOT NULL DEFAULT 1
);


-- ============================================================
-- GRAPHIC NOVELS CORE TABLE
-- ============================================================

-- Work-level metadata (1:1 with tbl_items)
CREATE TABLE IF NOT EXISTS tbl_graphicnovel_details (
    item_id             INTEGER PRIMARY KEY,
    title               TEXT NOT NULL,
    title_sort          TEXT,
    description         TEXT,
    publisher_id        INTEGER,
    format_type_id      INTEGER,
    era_id              INTEGER,
    series_name         TEXT,
    series_number       REAL,
    series_sort         REAL,
    source_series_name  TEXT,
    start_issue         INTEGER,
    end_issue           INTEGER,
    issue_notes         TEXT,
    page_count          INTEGER,
    published_date      TEXT,
    isbn_13             TEXT,
    isbn_10             TEXT,
    cover_image_url     TEXT,
    edition_notes       TEXT,
    star_rating         REAL CHECK (star_rating BETWEEN 0.5 AND 5.0),
    review              TEXT,
    api_source          TEXT,
    external_work_id    TEXT,

    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id) ON DELETE CASCADE,
    FOREIGN KEY (publisher_id) REFERENCES lkup_graphicnovel_publishers(publisher_id),
    FOREIGN KEY (format_type_id) REFERENCES lkup_graphicnovel_format_types(format_type_id),
    FOREIGN KEY (era_id) REFERENCES lkup_graphicnovel_eras(era_id)
);


-- ============================================================
-- GRAPHIC NOVELS XREF TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS xref_graphicnovel_item_writers (
    xref_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id      INTEGER NOT NULL,
    writer_id    INTEGER NOT NULL,
    writer_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (item_id, writer_id),
    FOREIGN KEY (item_id) REFERENCES tbl_graphicnovel_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (writer_id) REFERENCES lkup_graphicnovel_writers(writer_id)
);

CREATE TABLE IF NOT EXISTS xref_graphicnovel_item_artists (
    xref_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id      INTEGER NOT NULL,
    artist_id    INTEGER NOT NULL,
    artist_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (item_id, artist_id),
    FOREIGN KEY (item_id) REFERENCES tbl_graphicnovel_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (artist_id) REFERENCES lkup_graphicnovel_artists(artist_id)
);

CREATE TABLE IF NOT EXISTS xref_graphicnovel_item_tags (
    xref_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id   INTEGER NOT NULL,
    tag_id    INTEGER NOT NULL,
    UNIQUE (item_id, tag_id),
    FOREIGN KEY (item_id) REFERENCES tbl_graphicnovel_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES lkup_graphicnovel_tags(tag_id)
);

CREATE TABLE IF NOT EXISTS xref_gn_source_series (
    xref_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id            INTEGER NOT NULL,
    source_series_name TEXT NOT NULL,
    start_issue        INTEGER,
    end_issue          INTEGER,
    sort_order         INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (item_id) REFERENCES tbl_graphicnovel_details(item_id) ON DELETE CASCADE
);


-- ============================================================
-- GRAPHIC NOVELS INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_graphicnovel_details_title
ON tbl_graphicnovel_details(title);

CREATE UNIQUE INDEX IF NOT EXISTS ux_graphicnovel_details_isbn13
ON tbl_graphicnovel_details(isbn_13)
WHERE isbn_13 IS NOT NULL;


-- ============================================================
-- SHARED SEED DATA
-- ============================================================

-- ownership statuses (shared across all modules)
INSERT OR IGNORE INTO lkup_ownership_statuses (status_code, status_name, sort_order) VALUES ('owned',          'Owned',          1);
INSERT OR IGNORE INTO lkup_ownership_statuses (status_code, status_name, sort_order) VALUES ('wanted',         'Wanted',         2);
INSERT OR IGNORE INTO lkup_ownership_statuses (status_code, status_name, sort_order) VALUES ('trade',          'Trade',          3);
INSERT OR IGNORE INTO lkup_ownership_statuses (status_code, status_name, sort_order) VALUES ('formerly_owned', 'Formerly Owned', 4);
INSERT OR IGNORE INTO lkup_ownership_statuses (status_code, status_name, sort_order) VALUES ('pending_outgoing', 'Pending - Outgoing', 5);
INSERT OR IGNORE INTO lkup_ownership_statuses (status_code, status_name, sort_order) VALUES ('borrowed',          'Borrowed',          6);
INSERT OR IGNORE INTO lkup_ownership_statuses (status_code, status_name, sort_order) VALUES ('pending_incoming',  'Pending - Incoming', 7);
-- Catalog status is scoped to photocards only (seeded below via targeted xref insert, not the cross-join).
INSERT OR IGNORE INTO lkup_ownership_statuses (status_code, status_name, sort_order) VALUES ('catalog',          'Catalog',          8);
-- Triage decisions: photocards only, same targeted-xref treatment as 'catalog'.
-- These record a standing decision about a CARD ("have I decided to collect it?"),
-- as opposed to a possession fact about a COPY. At most one per card; the decision
-- outlives the copies, so 'not_wanted' may co-exist with a 'trade' copy.
-- sort_order 9/10 deliberately places them last, behind the sidebar's "+N more"
-- fold — they are set once per card, unlike the frequently-changed statuses above.
INSERT OR IGNORE INTO lkup_ownership_statuses (status_code, status_name, sort_order) VALUES ('undecided',        'Undecided',        9);
INSERT OR IGNORE INTO lkup_ownership_statuses (status_code, status_name, sort_order) VALUES ('not_wanted',       'Not Wanted',      10);
-- Lomo / fanmade possession: a copy of an UNOFFICIAL card (fan-printed lomo
-- card), held instead of 'owned'. Photocards only, same targeted-xref treatment
-- as the rows above. No co-occurrence rules -- it is set by hand and carries no
-- derived behaviour: any status may co-exist with it, and it blocks none.
INSERT OR IGNORE INTO lkup_ownership_statuses (status_code, status_name, sort_order) VALUES ('lomo_fanmade',     'Lomo/Fanmade',    11);


-- ============================================================
-- PHOTOCARDS SEED DATA
-- ============================================================

-- collection type
INSERT OR IGNORE INTO lkup_collection_types (collection_type_code, collection_type_name, sort_order)
VALUES ('photocards', 'Photocards', 1);

-- top-level categories (scoped to photocards collection type)
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'photocards'), 'Album', 1
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'photocards' AND ltc.category_name = 'Album'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'photocards'), 'Non-Album', 2
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'photocards' AND ltc.category_name = 'Non-Album'
);


-- ============================================================
-- BOOKS SEED DATA
-- ============================================================

-- collection type
INSERT OR IGNORE INTO lkup_collection_types (collection_type_code, collection_type_name, sort_order)
VALUES ('books', 'Books', 2);

-- top-level categories (scoped to books collection type)
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'books'), 'Fiction', 1
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'books'), 'Non-Fiction', 2
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Non-Fiction'
);

-- consumption statuses (books)
INSERT OR IGNORE INTO lkup_consumption_statuses (status_name, sort_order) VALUES ('Read',              1);
INSERT OR IGNORE INTO lkup_consumption_statuses (status_name, sort_order) VALUES ('Currently Reading', 2);
INSERT OR IGNORE INTO lkup_consumption_statuses (status_name, sort_order) VALUES ('Want to Read',      3);
INSERT OR IGNORE INTO lkup_consumption_statuses (status_name, sort_order) VALUES ('DNF',               4);

-- format details
INSERT OR IGNORE INTO lkup_book_format_details (format_name, top_level_format, sort_order) VALUES ('Hardcover',             'Physical', 1);
INSERT OR IGNORE INTO lkup_book_format_details (format_name, top_level_format, sort_order) VALUES ('Paperback',             'Physical', 2);
INSERT OR IGNORE INTO lkup_book_format_details (format_name, top_level_format, sort_order) VALUES ('Mass Market Paperback', 'Physical', 3);
INSERT OR IGNORE INTO lkup_book_format_details (format_name, top_level_format, sort_order) VALUES ('Kindle',                'Digital',  4);
INSERT OR IGNORE INTO lkup_book_format_details (format_name, top_level_format, sort_order) VALUES ('Kobo',                  'Digital',  5);
INSERT OR IGNORE INTO lkup_book_format_details (format_name, top_level_format, sort_order) VALUES ('Other Ebook',           'Digital',  6);
INSERT OR IGNORE INTO lkup_book_format_details (format_name, top_level_format, sort_order) VALUES ('Audible',               'Audio',    7);
INSERT OR IGNORE INTO lkup_book_format_details (format_name, top_level_format, sort_order) VALUES ('Other Audio',           'Audio',    8);

-- age levels
INSERT OR IGNORE INTO lkup_book_age_levels (age_level_name, sort_order) VALUES ('Children''s',  1);
INSERT OR IGNORE INTO lkup_book_age_levels (age_level_name, sort_order) VALUES ('Middle Grade', 2);
INSERT OR IGNORE INTO lkup_book_age_levels (age_level_name, sort_order) VALUES ('Young Adult',  3);
INSERT OR IGNORE INTO lkup_book_age_levels (age_level_name, sort_order) VALUES ('New Adult',    4);
INSERT OR IGNORE INTO lkup_book_age_levels (age_level_name, sort_order) VALUES ('Adult',        5);

-- top-level genres (category_scope_id resolved by code+name lookup — no hardcoded IDs)
-- Fiction genres
INSERT OR IGNORE INTO lkup_book_top_level_genres (category_scope_id, genre_name, sort_order)
SELECT ltc.top_level_category_id, 'Fantasy', 1
FROM lkup_top_level_categories ltc JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction';

INSERT OR IGNORE INTO lkup_book_top_level_genres (category_scope_id, genre_name, sort_order)
SELECT ltc.top_level_category_id, 'Science Fiction', 2
FROM lkup_top_level_categories ltc JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction';

INSERT OR IGNORE INTO lkup_book_top_level_genres (category_scope_id, genre_name, sort_order)
SELECT ltc.top_level_category_id, 'Romance', 3
FROM lkup_top_level_categories ltc JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction';

INSERT OR IGNORE INTO lkup_book_top_level_genres (category_scope_id, genre_name, sort_order)
SELECT ltc.top_level_category_id, 'Crime', 4
FROM lkup_top_level_categories ltc JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction';

INSERT OR IGNORE INTO lkup_book_top_level_genres (category_scope_id, genre_name, sort_order)
SELECT ltc.top_level_category_id, 'Horror', 5
FROM lkup_top_level_categories ltc JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction';

INSERT OR IGNORE INTO lkup_book_top_level_genres (category_scope_id, genre_name, sort_order)
SELECT ltc.top_level_category_id, 'Other', 6
FROM lkup_top_level_categories ltc JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction';

-- Non-Fiction genres
INSERT OR IGNORE INTO lkup_book_top_level_genres (category_scope_id, genre_name, sort_order)
SELECT ltc.top_level_category_id, 'Biography', 1
FROM lkup_top_level_categories ltc JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Non-Fiction';

INSERT OR IGNORE INTO lkup_book_top_level_genres (category_scope_id, genre_name, sort_order)
SELECT ltc.top_level_category_id, 'History', 2
FROM lkup_top_level_categories ltc JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Non-Fiction';

INSERT OR IGNORE INTO lkup_book_top_level_genres (category_scope_id, genre_name, sort_order)
SELECT ltc.top_level_category_id, 'Learning', 3
FROM lkup_top_level_categories ltc JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Non-Fiction';

INSERT OR IGNORE INTO lkup_book_top_level_genres (category_scope_id, genre_name, sort_order)
SELECT ltc.top_level_category_id, 'True Crime', 4
FROM lkup_top_level_categories ltc JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Non-Fiction';

INSERT OR IGNORE INTO lkup_book_top_level_genres (category_scope_id, genre_name, sort_order)
SELECT ltc.top_level_category_id, 'Other', 5
FROM lkup_top_level_categories ltc JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Non-Fiction';

-- subgenres (top_level_genre_id resolved by scope+name lookup)
-- Fantasy subgenres
INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Epic Fantasy', 1 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Fantasy';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Urban Fantasy', 2 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Fantasy';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Fairy Tale', 3 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Fantasy';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Mythology', 4 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Fantasy';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Magical Realism', 5 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Fantasy';

-- Science Fiction subgenres
INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Hard SF', 1 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Science Fiction';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Soft SF', 2 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Science Fiction';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Space Opera', 3 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Science Fiction';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Dystopian', 4 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Science Fiction';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Steampunk', 5 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Science Fiction';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Time Travel', 6 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Science Fiction';

-- Romance subgenres
INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Contemporary', 1 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Romance';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Historical', 2 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Romance';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Paranormal', 3 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Romance';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Romantic Suspense', 4 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Romance';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Fantasy', 5 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Romance';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Dark', 6 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Romance';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Sci-Fi', 7 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Romance';

-- Crime subgenres
INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Mystery', 1 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Crime';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Suspense/Thriller', 2 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Crime';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Police Procedural', 3 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Crime';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Historical', 4 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Crime';

-- Horror subgenres
INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Paranormal', 1 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Horror';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Gothic', 2 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Horror';

-- Fiction Other subgenres
INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Contemporary', 1 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Other';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Historical Fiction', 2 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Fiction' AND g.genre_name = 'Other';

-- Learning subgenres
INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Writing', 1 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Non-Fiction' AND g.genre_name = 'Learning';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Filmmaking', 2 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Non-Fiction' AND g.genre_name = 'Learning';

-- Non-Fiction Other subgenres
INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Cookbook', 1 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Non-Fiction' AND g.genre_name = 'Other';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Art/Photography', 2 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Non-Fiction' AND g.genre_name = 'Other';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Religion', 3 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Non-Fiction' AND g.genre_name = 'Other';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Humor', 4 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Non-Fiction' AND g.genre_name = 'Other';

INSERT OR IGNORE INTO lkup_book_sub_genres (top_level_genre_id, sub_genre_name, sort_order)
SELECT g.top_level_genre_id, 'Reference', 5 FROM lkup_book_top_level_genres g
JOIN lkup_top_level_categories ltc ON g.category_scope_id = ltc.top_level_category_id
JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
WHERE lct.collection_type_code = 'books' AND ltc.category_name = 'Non-Fiction' AND g.genre_name = 'Other';


-- ============================================================
-- GRAPHIC NOVELS SEED DATA
-- ============================================================

-- collection type
INSERT OR IGNORE INTO lkup_collection_types (collection_type_code, collection_type_name, sort_order)
VALUES ('graphicnovels', 'Graphic Novels', 3);

-- top-level categories (scoped to graphicnovels collection type — looked up by code, not hardcoded ID)
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'graphicnovels'), 'Marvel', 10
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'graphicnovels' AND ltc.category_name = 'Marvel'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'graphicnovels'), 'DC', 20
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'graphicnovels' AND ltc.category_name = 'DC'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'graphicnovels'), 'Other', 30
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'graphicnovels' AND ltc.category_name = 'Other'
);

-- publishers
INSERT OR IGNORE INTO lkup_graphicnovel_publishers (publisher_name, sort_order) VALUES ('Marvel Comics', 10);
INSERT OR IGNORE INTO lkup_graphicnovel_publishers (publisher_name, sort_order) VALUES ('DC Comics', 20);
INSERT OR IGNORE INTO lkup_graphicnovel_publishers (publisher_name, sort_order) VALUES ('Image Comics', 30);
INSERT OR IGNORE INTO lkup_graphicnovel_publishers (publisher_name, sort_order) VALUES ('Dark Horse Comics', 40);
INSERT OR IGNORE INTO lkup_graphicnovel_publishers (publisher_name, sort_order) VALUES ('IDW Publishing', 50);
INSERT OR IGNORE INTO lkup_graphicnovel_publishers (publisher_name, sort_order) VALUES ('BOOM! Studios', 60);
INSERT OR IGNORE INTO lkup_graphicnovel_publishers (publisher_name, sort_order) VALUES ('Fantagraphics', 70);

-- format types
INSERT OR IGNORE INTO lkup_graphicnovel_format_types (format_type_name, sort_order) VALUES ('Omnibus', 10);
INSERT OR IGNORE INTO lkup_graphicnovel_format_types (format_type_name, sort_order) VALUES ('Graphic Novel', 20);
INSERT OR IGNORE INTO lkup_graphicnovel_format_types (format_type_name, sort_order) VALUES ('Trade Paperback', 30);

-- eras
INSERT OR IGNORE INTO lkup_graphicnovel_eras (era_name, era_years, sort_order) VALUES ('Golden Age', '1938–1956', 10);
INSERT OR IGNORE INTO lkup_graphicnovel_eras (era_name, era_years, sort_order) VALUES ('Silver Age', '1956–1970', 20);
INSERT OR IGNORE INTO lkup_graphicnovel_eras (era_name, era_years, sort_order) VALUES ('Bronze Age', '1970–1985', 30);
INSERT OR IGNORE INTO lkup_graphicnovel_eras (era_name, era_years, sort_order) VALUES ('Modern Era', '1991+', 50);
INSERT OR IGNORE INTO lkup_graphicnovel_eras (era_name, era_years, sort_order) VALUES ('Multi-Era', NULL, 60);


-- ============================================================
-- VIDEO GAMES LOOKUP TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS lkup_game_platforms (
    platform_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_name  TEXT NOT NULL UNIQUE,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_game_developers (
    developer_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    developer_name  TEXT NOT NULL UNIQUE,
    is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_game_publishers (
    publisher_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    publisher_name  TEXT NOT NULL UNIQUE,
    is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_game_top_genres (
    top_genre_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    genre_name    TEXT NOT NULL UNIQUE,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_game_sub_genres (
    sub_genre_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    top_genre_id   INTEGER NOT NULL,
    sub_genre_name TEXT NOT NULL,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_active      INTEGER NOT NULL DEFAULT 1,
    UNIQUE (sub_genre_name, top_genre_id),
    FOREIGN KEY (top_genre_id) REFERENCES lkup_game_top_genres(top_genre_id)
);


-- ============================================================
-- VIDEO GAMES CORE TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS tbl_game_details (
    item_id           INTEGER PRIMARY KEY,
    title             TEXT NOT NULL,
    title_sort        TEXT,
    description       TEXT,
    release_date      TEXT,
    cover_image_url   TEXT,
    api_source        TEXT,
    external_work_id  TEXT,
    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id) ON DELETE CASCADE
);

-- ============================================================
-- VIDEO GAMES COPIES (per-platform ownership)
-- ============================================================

CREATE TABLE IF NOT EXISTS tbl_game_copies (
    copy_id              INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id              INTEGER NOT NULL,
    platform_id          INTEGER,
    edition              TEXT,
    ownership_status_id  INTEGER,
    notes                TEXT,
    FOREIGN KEY (item_id) REFERENCES tbl_game_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (platform_id) REFERENCES lkup_game_platforms(platform_id),
    FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id)
);


-- ============================================================
-- VIDEO GAMES XREF TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS xref_game_developers (
    item_id       INTEGER NOT NULL,
    developer_id  INTEGER NOT NULL,
    PRIMARY KEY (item_id, developer_id),
    FOREIGN KEY (item_id) REFERENCES tbl_game_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (developer_id) REFERENCES lkup_game_developers(developer_id)
);

CREATE TABLE IF NOT EXISTS xref_game_publishers (
    item_id       INTEGER NOT NULL,
    publisher_id  INTEGER NOT NULL,
    PRIMARY KEY (item_id, publisher_id),
    FOREIGN KEY (item_id) REFERENCES tbl_game_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (publisher_id) REFERENCES lkup_game_publishers(publisher_id)
);

CREATE TABLE IF NOT EXISTS xref_game_genres (
    xref_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id       INTEGER NOT NULL,
    top_genre_id  INTEGER NOT NULL,
    sub_genre_id  INTEGER,
    FOREIGN KEY (item_id) REFERENCES tbl_game_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (top_genre_id) REFERENCES lkup_game_top_genres(top_genre_id),
    FOREIGN KEY (sub_genre_id) REFERENCES lkup_game_sub_genres(sub_genre_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_game_genres_with_sub
ON xref_game_genres(item_id, top_genre_id, sub_genre_id)
WHERE sub_genre_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_game_genres_no_sub
ON xref_game_genres(item_id, top_genre_id)
WHERE sub_genre_id IS NULL;


-- ============================================================
-- VIDEO GAMES INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_game_details_title
ON tbl_game_details(title);

CREATE INDEX IF NOT EXISTS idx_game_copies_item
ON tbl_game_copies(item_id);


-- ============================================================
-- VIDEO GAMES SEED DATA
-- ============================================================

-- platforms
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('Xbox',           1);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('Xbox Series X',  2);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('Xbox One',       3);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('PS5',            4);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('PS4',            5);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('Nintendo Switch',6);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('PC (Steam)',     7);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('PC (Epic)',      8);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('PC (GOG)',       9);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('PC (Game Pass)', 10);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('PC (Origin)',    11);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('Other',         12);

-- collection type
INSERT OR IGNORE INTO lkup_collection_types (collection_type_code, collection_type_name, sort_order)
VALUES ('videogames', 'Video Games', 4);

-- single catch-all top-level category (not surfaced in UI — platform + genre are the meaningful filters)
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'videogames'), 'Video Games', 1
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'videogames' AND ltc.category_name = 'Video Games'
);

-- consumption statuses (video games)
INSERT OR IGNORE INTO lkup_consumption_statuses (status_name, sort_order) VALUES ('Played',          10);
INSERT OR IGNORE INTO lkup_consumption_statuses (status_name, sort_order) VALUES ('Playing',         11);
INSERT OR IGNORE INTO lkup_consumption_statuses (status_name, sort_order) VALUES ('Want to Play',    12);
INSERT OR IGNORE INTO lkup_consumption_statuses (status_name, sort_order) VALUES ('Abandoned',       13);

-- top genres
INSERT OR IGNORE INTO lkup_game_top_genres (genre_name, sort_order) VALUES ('RPG',         1);
INSERT OR IGNORE INTO lkup_game_top_genres (genre_name, sort_order) VALUES ('Action',      2);
INSERT OR IGNORE INTO lkup_game_top_genres (genre_name, sort_order) VALUES ('Adventure',   3);
INSERT OR IGNORE INTO lkup_game_top_genres (genre_name, sort_order) VALUES ('Strategy',    4);
INSERT OR IGNORE INTO lkup_game_top_genres (genre_name, sort_order) VALUES ('Puzzle',      5);
INSERT OR IGNORE INTO lkup_game_top_genres (genre_name, sort_order) VALUES ('Simulation',  6);
INSERT OR IGNORE INTO lkup_game_top_genres (genre_name, sort_order) VALUES ('Sports',      7);
INSERT OR IGNORE INTO lkup_game_top_genres (genre_name, sort_order) VALUES ('Horror',      8);
INSERT OR IGNORE INTO lkup_game_top_genres (genre_name, sort_order) VALUES ('Other',       9);


-- ============================================================
-- MUSIC LOOKUP TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS lkup_music_format_types (
    format_type_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    format_name     TEXT NOT NULL UNIQUE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_music_artists (
    artist_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    artist_name  TEXT NOT NULL UNIQUE,
    artist_sort  TEXT,
    is_active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_music_top_genres (
    top_genre_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    genre_name    TEXT NOT NULL UNIQUE,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_music_sub_genres (
    sub_genre_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    top_genre_id   INTEGER NOT NULL,
    sub_genre_name TEXT NOT NULL,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_active      INTEGER NOT NULL DEFAULT 1,
    UNIQUE (sub_genre_name, top_genre_id),
    FOREIGN KEY (top_genre_id) REFERENCES lkup_music_top_genres(top_genre_id)
);


-- ============================================================
-- MUSIC CORE TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS tbl_music_release_details (
    item_id           INTEGER PRIMARY KEY,
    title             TEXT NOT NULL,
    title_sort        TEXT,
    description       TEXT,
    release_date      TEXT,
    cover_image_url   TEXT,
    api_source        TEXT,
    external_work_id  TEXT,
    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tbl_music_songs (
    song_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id           INTEGER NOT NULL,
    title             TEXT NOT NULL,
    duration_seconds  INTEGER,
    track_number      INTEGER,
    disc_number       INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (item_id) REFERENCES tbl_music_release_details(item_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tbl_music_editions (
    edition_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id             INTEGER NOT NULL,
    format_type_id      INTEGER,
    version_name        TEXT,
    label               TEXT,
    catalog_number      TEXT,
    barcode             TEXT,
    notes               TEXT,
    ownership_status_id INTEGER,
    FOREIGN KEY (item_id) REFERENCES tbl_music_release_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (format_type_id) REFERENCES lkup_music_format_types(format_type_id),
    FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id)
);


-- ============================================================
-- MUSIC XREF TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS xref_music_release_artists (
    xref_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id      INTEGER NOT NULL,
    artist_id    INTEGER NOT NULL,
    artist_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (item_id, artist_id),
    FOREIGN KEY (item_id) REFERENCES tbl_music_release_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (artist_id) REFERENCES lkup_music_artists(artist_id)
);

CREATE TABLE IF NOT EXISTS xref_music_release_genres (
    xref_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id       INTEGER NOT NULL,
    top_genre_id  INTEGER NOT NULL,
    sub_genre_id  INTEGER,
    FOREIGN KEY (item_id) REFERENCES tbl_music_release_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (top_genre_id) REFERENCES lkup_music_top_genres(top_genre_id),
    FOREIGN KEY (sub_genre_id) REFERENCES lkup_music_sub_genres(sub_genre_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_music_genres_with_sub
ON xref_music_release_genres(item_id, top_genre_id, sub_genre_id)
WHERE sub_genre_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_music_genres_no_sub
ON xref_music_release_genres(item_id, top_genre_id)
WHERE sub_genre_id IS NULL;


-- ============================================================
-- MUSIC INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_music_release_details_title
ON tbl_music_release_details(title);

CREATE INDEX IF NOT EXISTS idx_music_songs_item
ON tbl_music_songs(item_id);

CREATE INDEX IF NOT EXISTS idx_music_editions_item
ON tbl_music_editions(item_id);


-- ============================================================
-- MUSIC SEED DATA
-- ============================================================

-- format types
INSERT OR IGNORE INTO lkup_music_format_types (format_name, sort_order) VALUES ('CD',        1);
INSERT OR IGNORE INTO lkup_music_format_types (format_name, sort_order) VALUES ('Vinyl',     2);
INSERT OR IGNORE INTO lkup_music_format_types (format_name, sort_order) VALUES ('Cassette',  3);
INSERT OR IGNORE INTO lkup_music_format_types (format_name, sort_order) VALUES ('Digital',   4);
INSERT OR IGNORE INTO lkup_music_format_types (format_name, sort_order) VALUES ('Streaming', 5);
INSERT OR IGNORE INTO lkup_music_format_types (format_name, sort_order) VALUES ('Other',     6);

-- collection type
INSERT OR IGNORE INTO lkup_collection_types (collection_type_code, collection_type_name, sort_order)
VALUES ('music', 'Music', 5);

-- top-level categories (release types, scoped to music)
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'music'), 'Album', 1
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'music' AND ltc.category_name = 'Album'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'music'), 'EP', 2
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'music' AND ltc.category_name = 'EP'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'music'), 'Single', 3
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'music' AND ltc.category_name = 'Single'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'music'), 'Compilation', 4
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'music' AND ltc.category_name = 'Compilation'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'music'), 'Live', 5
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'music' AND ltc.category_name = 'Live'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'music'), 'Soundtrack', 6
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'music' AND ltc.category_name = 'Soundtrack'
);

-- top genres
INSERT OR IGNORE INTO lkup_music_top_genres (genre_name, sort_order) VALUES ('K-pop',       1);
INSERT OR IGNORE INTO lkup_music_top_genres (genre_name, sort_order) VALUES ('Pop',         2);
INSERT OR IGNORE INTO lkup_music_top_genres (genre_name, sort_order) VALUES ('Rock',        3);
INSERT OR IGNORE INTO lkup_music_top_genres (genre_name, sort_order) VALUES ('Electronic',  4);
INSERT OR IGNORE INTO lkup_music_top_genres (genre_name, sort_order) VALUES ('Hip-Hop',     5);
INSERT OR IGNORE INTO lkup_music_top_genres (genre_name, sort_order) VALUES ('R&B',         6);
INSERT OR IGNORE INTO lkup_music_top_genres (genre_name, sort_order) VALUES ('Jazz',        7);
INSERT OR IGNORE INTO lkup_music_top_genres (genre_name, sort_order) VALUES ('Classical',   8);
INSERT OR IGNORE INTO lkup_music_top_genres (genre_name, sort_order) VALUES ('Country',     9);
INSERT OR IGNORE INTO lkup_music_top_genres (genre_name, sort_order) VALUES ('Other',      10);


-- ============================================================
-- APP SETTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS tbl_app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO tbl_app_settings (key, value)
VALUES ('modules_enabled', '["photocards","books","graphicnovels","videogames","music","video","boardgames","ttrpg"]');

-- For existing installs: add any missing modules that were added after the initial seed.
-- Each UPDATE is a no-op if the module is already present.
UPDATE tbl_app_settings
SET value = (SELECT CASE WHEN value LIKE '%"music"%' THEN value ELSE REPLACE(value, ']', ',"music"]') END FROM tbl_app_settings WHERE key = 'modules_enabled')
WHERE key = 'modules_enabled';

UPDATE tbl_app_settings
SET value = (SELECT CASE WHEN value LIKE '%"video"%' THEN value ELSE REPLACE(value, ']', ',"video"]') END FROM tbl_app_settings WHERE key = 'modules_enabled')
WHERE key = 'modules_enabled';

UPDATE tbl_app_settings
SET value = (SELECT CASE WHEN value LIKE '%"boardgames"%' THEN value ELSE REPLACE(value, ']', ',"boardgames"]') END FROM tbl_app_settings WHERE key = 'modules_enabled')
WHERE key = 'modules_enabled';

UPDATE tbl_app_settings
SET value = (SELECT CASE WHEN value LIKE '%"ttrpg"%' THEN value ELSE REPLACE(value, ']', ',"ttrpg"]') END FROM tbl_app_settings WHERE key = 'modules_enabled')
WHERE key = 'modules_enabled';

-- Mercari listing-title templates for the trade CSV export. Settings rather
-- than code because listing conventions get tuned constantly once you are
-- actually selling, and a redeploy per tweak is not worth it.
--
-- Two keys, not one template with conditional-token syntax: 1,444 `version`
-- values already contain the word "Photocard" ("Photocard (Jewel Case
-- Version)", "Film Photocard Set (POB)"), so appending the phrase
-- unconditionally reads as redundant AND blows Mercari's 80-character title
-- cap. `_pc` is used when `version` already says photocard.
INSERT OR IGNORE INTO tbl_app_settings (key, value)
VALUES ('photocard_title_template', '{group} {member} {source} {version} Official Photocard');
INSERT OR IGNORE INTO tbl_app_settings (key, value)
VALUES ('photocard_title_template_pc', '{group} {member} {source} Official {version}');
INSERT OR IGNORE INTO tbl_app_settings (key, value)
VALUES ('photocard_description_template', '{title}. Ships in a toploader and sleeve inside a bubble mailer.');


-- ============================================================
-- VIDEO MODULE
-- ============================================================

CREATE TABLE IF NOT EXISTS lkup_video_format_types (
    format_type_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    format_name     TEXT NOT NULL UNIQUE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_video_directors (
    director_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    director_name  TEXT NOT NULL UNIQUE,
    is_active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_video_cast (
    cast_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    cast_name  TEXT NOT NULL UNIQUE,
    is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_video_top_genres (
    top_genre_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    genre_name    TEXT NOT NULL UNIQUE,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_video_sub_genres (
    sub_genre_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    top_genre_id   INTEGER NOT NULL,
    sub_genre_name TEXT NOT NULL,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_active      INTEGER NOT NULL DEFAULT 1,
    UNIQUE (sub_genre_name, top_genre_id),
    FOREIGN KEY (top_genre_id) REFERENCES lkup_video_top_genres(top_genre_id)
);

CREATE TABLE IF NOT EXISTS tbl_video_details (
    item_id           INTEGER PRIMARY KEY,
    title             TEXT NOT NULL,
    title_sort        TEXT,
    description       TEXT,
    release_date      TEXT,
    runtime_minutes   INTEGER,
    cover_image_url   TEXT,
    api_source        TEXT,
    external_work_id  TEXT,
    on_media_server   INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tbl_video_copies (
    copy_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id             INTEGER NOT NULL,
    format_type_id      INTEGER,
    ownership_status_id INTEGER,
    notes               TEXT,
    FOREIGN KEY (item_id) REFERENCES tbl_video_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (format_type_id) REFERENCES lkup_video_format_types(format_type_id),
    FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id)
);

CREATE TABLE IF NOT EXISTS tbl_video_seasons (
    season_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id             INTEGER NOT NULL,
    season_number       INTEGER NOT NULL,
    episode_count       INTEGER,
    format_type_id      INTEGER,
    ownership_status_id INTEGER,
    notes               TEXT,
    FOREIGN KEY (item_id) REFERENCES tbl_video_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (format_type_id) REFERENCES lkup_video_format_types(format_type_id),
    FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id)
);

-- Per-season copies (mirror of tbl_video_copies, keyed to a season).
-- Lets a TV season hold multiple format/ownership rows (e.g. own S1 on both DVD and Blu-ray).
CREATE TABLE IF NOT EXISTS tbl_video_season_copies (
    copy_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id           INTEGER NOT NULL,
    format_type_id      INTEGER,
    ownership_status_id INTEGER,
    notes               TEXT,
    FOREIGN KEY (season_id) REFERENCES tbl_video_seasons(season_id) ON DELETE CASCADE,
    FOREIGN KEY (format_type_id) REFERENCES lkup_video_format_types(format_type_id),
    FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id)
);

CREATE TABLE IF NOT EXISTS xref_video_directors (
    xref_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id        INTEGER NOT NULL,
    director_id    INTEGER NOT NULL,
    director_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (item_id, director_id),
    FOREIGN KEY (item_id) REFERENCES tbl_video_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (director_id) REFERENCES lkup_video_directors(director_id)
);

CREATE TABLE IF NOT EXISTS xref_video_cast (
    xref_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id    INTEGER NOT NULL,
    cast_id    INTEGER NOT NULL,
    cast_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (item_id, cast_id),
    FOREIGN KEY (item_id) REFERENCES tbl_video_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (cast_id) REFERENCES lkup_video_cast(cast_id)
);

CREATE TABLE IF NOT EXISTS xref_video_genres (
    xref_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id       INTEGER NOT NULL,
    top_genre_id  INTEGER NOT NULL,
    sub_genre_id  INTEGER,
    FOREIGN KEY (item_id) REFERENCES tbl_video_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (top_genre_id) REFERENCES lkup_video_top_genres(top_genre_id),
    FOREIGN KEY (sub_genre_id) REFERENCES lkup_video_sub_genres(sub_genre_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_video_genres_with_sub
ON xref_video_genres(item_id, top_genre_id, sub_genre_id)
WHERE sub_genre_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_video_genres_no_sub
ON xref_video_genres(item_id, top_genre_id)
WHERE sub_genre_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_video_details_title ON tbl_video_details(title);
CREATE INDEX IF NOT EXISTS idx_video_copies_item ON tbl_video_copies(item_id);
CREATE INDEX IF NOT EXISTS idx_video_seasons_item ON tbl_video_seasons(item_id);
CREATE INDEX IF NOT EXISTS idx_video_season_copies_season ON tbl_video_season_copies(season_id);

-- Video seed data
INSERT OR IGNORE INTO lkup_video_format_types (format_name, sort_order) VALUES ('Blu-ray',   1);
INSERT OR IGNORE INTO lkup_video_format_types (format_name, sort_order) VALUES ('4K UHD',    2);
INSERT OR IGNORE INTO lkup_video_format_types (format_name, sort_order) VALUES ('DVD',       3);
INSERT OR IGNORE INTO lkup_video_format_types (format_name, sort_order) VALUES ('Digital',   4);
INSERT OR IGNORE INTO lkup_video_format_types (format_name, sort_order) VALUES ('Streaming', 5);
INSERT OR IGNORE INTO lkup_video_format_types (format_name, sort_order) VALUES ('VHS',       6);
INSERT OR IGNORE INTO lkup_video_format_types (format_name, sort_order) VALUES ('Other',     7);

INSERT OR IGNORE INTO lkup_video_top_genres (genre_name, sort_order) VALUES ('Action',      1);
INSERT OR IGNORE INTO lkup_video_top_genres (genre_name, sort_order) VALUES ('Comedy',      2);
INSERT OR IGNORE INTO lkup_video_top_genres (genre_name, sort_order) VALUES ('Drama',       3);
INSERT OR IGNORE INTO lkup_video_top_genres (genre_name, sort_order) VALUES ('Sci-Fi',      4);
INSERT OR IGNORE INTO lkup_video_top_genres (genre_name, sort_order) VALUES ('Horror',      5);
INSERT OR IGNORE INTO lkup_video_top_genres (genre_name, sort_order) VALUES ('Romance',     6);
INSERT OR IGNORE INTO lkup_video_top_genres (genre_name, sort_order) VALUES ('Documentary', 7);
INSERT OR IGNORE INTO lkup_video_top_genres (genre_name, sort_order) VALUES ('Animation',   8);
INSERT OR IGNORE INTO lkup_video_top_genres (genre_name, sort_order) VALUES ('K-drama',     9);
INSERT OR IGNORE INTO lkup_video_top_genres (genre_name, sort_order) VALUES ('Other',      10);

-- consumption statuses (video)
INSERT OR IGNORE INTO lkup_consumption_statuses (status_name, sort_order) VALUES ('Watched',            20);
INSERT OR IGNORE INTO lkup_consumption_statuses (status_name, sort_order) VALUES ('Currently Watching', 21);
INSERT OR IGNORE INTO lkup_consumption_statuses (status_name, sort_order) VALUES ('Want to Watch',      22);

INSERT OR IGNORE INTO lkup_collection_types (collection_type_code, collection_type_name, sort_order)
VALUES ('video', 'Video', 6);

INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'video'), 'Movie', 1
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'video' AND ltc.category_name = 'Movie'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'video'), 'TV Series', 2
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'video' AND ltc.category_name = 'TV Series'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'video'), 'Miniseries', 3
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'video' AND ltc.category_name = 'Miniseries'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'video'), 'Concert/Live', 4
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'video' AND ltc.category_name = 'Concert/Live'
);


-- ============================================================
-- BOARD GAMES MODULE
-- ============================================================

CREATE TABLE IF NOT EXISTS lkup_boardgame_publishers (
    publisher_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    publisher_name  TEXT NOT NULL UNIQUE,
    is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_boardgame_designers (
    designer_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    designer_name  TEXT NOT NULL UNIQUE,
    is_active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tbl_boardgame_details (
    item_id           INTEGER PRIMARY KEY,
    title             TEXT NOT NULL,
    title_sort        TEXT,
    description       TEXT,
    year_published    INTEGER,
    min_players       INTEGER,
    max_players       INTEGER,
    publisher_id      INTEGER,
    cover_image_url   TEXT,
    api_source        TEXT,
    external_work_id  TEXT,
    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id) ON DELETE CASCADE,
    FOREIGN KEY (publisher_id) REFERENCES lkup_boardgame_publishers(publisher_id)
);

CREATE TABLE IF NOT EXISTS tbl_boardgame_expansions (
    expansion_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id             INTEGER NOT NULL,
    title               TEXT NOT NULL,
    year_published      INTEGER,
    ownership_status_id INTEGER,
    external_work_id    TEXT,
    FOREIGN KEY (item_id) REFERENCES tbl_boardgame_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id)
);

CREATE TABLE IF NOT EXISTS xref_boardgame_designers (
    xref_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id        INTEGER NOT NULL,
    designer_id    INTEGER NOT NULL,
    designer_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (item_id, designer_id),
    FOREIGN KEY (item_id) REFERENCES tbl_boardgame_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (designer_id) REFERENCES lkup_boardgame_designers(designer_id)
);

CREATE INDEX IF NOT EXISTS idx_boardgame_details_title ON tbl_boardgame_details(title);
CREATE INDEX IF NOT EXISTS idx_boardgame_expansions_item ON tbl_boardgame_expansions(item_id);

-- Board Games seed data
INSERT OR IGNORE INTO lkup_collection_types (collection_type_code, collection_type_name, sort_order)
VALUES ('boardgames', 'Board Games', 7);

-- top-level categories (player count, scoped to boardgames)
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'boardgames'), 'Solo (1 player)', 1
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'boardgames' AND ltc.category_name = 'Solo (1 player)'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'boardgames'), '2-Player', 2
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'boardgames' AND ltc.category_name = '2-Player'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'boardgames'), 'Small Group (3-4)', 3
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'boardgames' AND ltc.category_name = 'Small Group (3-4)'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'boardgames'), 'Large Group (5+)', 4
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'boardgames' AND ltc.category_name = 'Large Group (5+)'
);

-- ============================================================
-- TTRPG MODULE
-- ============================================================

CREATE TABLE IF NOT EXISTS lkup_ttrpg_system_editions (
    edition_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    system_category_id INTEGER NOT NULL,
    edition_name       TEXT NOT NULL,
    sort_order         INTEGER NOT NULL DEFAULT 0,
    is_active          INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (system_category_id) REFERENCES lkup_top_level_categories(top_level_category_id),
    UNIQUE (system_category_id, edition_name)
);

CREATE TABLE IF NOT EXISTS lkup_ttrpg_lines (
    line_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    system_category_id INTEGER NOT NULL,
    line_name          TEXT NOT NULL,
    sort_order         INTEGER NOT NULL DEFAULT 0,
    is_active          INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (system_category_id) REFERENCES lkup_top_level_categories(top_level_category_id),
    UNIQUE (system_category_id, line_name)
);

CREATE TABLE IF NOT EXISTS lkup_ttrpg_book_types (
    book_type_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    book_type_name TEXT NOT NULL UNIQUE,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_ttrpg_format_types (
    format_type_id INTEGER PRIMARY KEY AUTOINCREMENT,
    format_name    TEXT NOT NULL UNIQUE,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_ttrpg_publishers (
    publisher_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    publisher_name TEXT NOT NULL UNIQUE,
    is_active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_ttrpg_authors (
    author_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    author_name TEXT NOT NULL UNIQUE,
    is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tbl_ttrpg_details (
    item_id           INTEGER PRIMARY KEY,
    title             TEXT NOT NULL,
    title_sort        TEXT,
    description       TEXT,
    system_edition_id INTEGER,
    line_id           INTEGER,
    book_type_id      INTEGER,
    publisher_id      INTEGER,
    release_date      TEXT,
    cover_image_url   TEXT,
    api_source        TEXT,
    external_work_id  TEXT,
    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id) ON DELETE CASCADE,
    FOREIGN KEY (system_edition_id) REFERENCES lkup_ttrpg_system_editions(edition_id),
    FOREIGN KEY (line_id) REFERENCES lkup_ttrpg_lines(line_id),
    FOREIGN KEY (book_type_id) REFERENCES lkup_ttrpg_book_types(book_type_id),
    FOREIGN KEY (publisher_id) REFERENCES lkup_ttrpg_publishers(publisher_id)
);

CREATE TABLE IF NOT EXISTS tbl_ttrpg_copies (
    copy_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id             INTEGER NOT NULL,
    format_type_id      INTEGER,
    isbn_13             TEXT,
    isbn_10             TEXT,
    ownership_status_id INTEGER,
    notes               TEXT,
    FOREIGN KEY (item_id) REFERENCES tbl_ttrpg_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (format_type_id) REFERENCES lkup_ttrpg_format_types(format_type_id),
    FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id)
);

CREATE TABLE IF NOT EXISTS xref_ttrpg_book_authors (
    xref_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id      INTEGER NOT NULL,
    author_id    INTEGER NOT NULL,
    author_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (item_id, author_id),
    FOREIGN KEY (item_id) REFERENCES tbl_ttrpg_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES lkup_ttrpg_authors(author_id)
);

CREATE INDEX IF NOT EXISTS idx_ttrpg_details_title ON tbl_ttrpg_details(title);
CREATE INDEX IF NOT EXISTS idx_ttrpg_copies_item ON tbl_ttrpg_copies(item_id);
CREATE INDEX IF NOT EXISTS idx_ttrpg_system_editions_system ON lkup_ttrpg_system_editions(system_category_id);
CREATE INDEX IF NOT EXISTS idx_ttrpg_lines_system ON lkup_ttrpg_lines(system_category_id);

-- TTRPG seed data
INSERT OR IGNORE INTO lkup_collection_types (collection_type_code, collection_type_name, sort_order)
VALUES ('ttrpg', 'TTRPG', 8);

-- Top-level categories (game systems)
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'ttrpg'), 'Dungeons & Dragons', 1
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'ttrpg' AND ltc.category_name = 'Dungeons & Dragons'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'ttrpg'), 'Pathfinder', 2
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'ttrpg' AND ltc.category_name = 'Pathfinder'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'ttrpg'), 'Blades in the Dark', 3
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'ttrpg' AND ltc.category_name = 'Blades in the Dark'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'ttrpg'), 'Call of Cthulhu', 4
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'ttrpg' AND ltc.category_name = 'Call of Cthulhu'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'ttrpg'), 'Shadowrun', 5
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'ttrpg' AND ltc.category_name = 'Shadowrun'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'ttrpg'), 'Other', 99
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'ttrpg' AND ltc.category_name = 'Other'
);

-- Book types
INSERT OR IGNORE INTO lkup_ttrpg_book_types (book_type_name, sort_order) VALUES ('Core Rulebook', 1);
INSERT OR IGNORE INTO lkup_ttrpg_book_types (book_type_name, sort_order) VALUES ('Adventure Module', 2);
INSERT OR IGNORE INTO lkup_ttrpg_book_types (book_type_name, sort_order) VALUES ('Sourcebook', 3);
INSERT OR IGNORE INTO lkup_ttrpg_book_types (book_type_name, sort_order) VALUES ('Supplement', 4);
INSERT OR IGNORE INTO lkup_ttrpg_book_types (book_type_name, sort_order) VALUES ('Campaign Setting', 5);
INSERT OR IGNORE INTO lkup_ttrpg_book_types (book_type_name, sort_order) VALUES ('Other', 99);

-- Format types
INSERT OR IGNORE INTO lkup_ttrpg_format_types (format_name, sort_order) VALUES ('Physical', 1);
INSERT OR IGNORE INTO lkup_ttrpg_format_types (format_name, sort_order) VALUES ('PDF', 2);
INSERT OR IGNORE INTO lkup_ttrpg_format_types (format_name, sort_order) VALUES ('Other', 99);


-- ============================================================
-- STATUS VISIBILITY xref tables
-- Seeding moved to backend/db.py _seed_status_visibility_xref().
-- Reason: re-running the seed on every startup overwrote user toggles
-- made via Admin > Status Visibility (INSERT OR IGNORE re-added rows
-- the user had explicitly deleted). The Python seed only runs on a
-- truly fresh DB and also cleans up orphan collection_type_id rows.
-- ============================================================

-- ============================================================
-- AUTHENTICATED GUEST TIER (`/pcs/`)
-- Server-stored per-user photocard annotations over the shared catalog,
-- replacing the deprecated browser-local `/guest/` WASM tier. Keyed by the
-- stable catalog_item_id contract ({group_code}_{id:06d}) so rows survive a
-- catalog rebuild. No FK on catalog_item_id (its parent unique index is
-- partial, which SQLite won't accept as an FK target — validated in the API
-- layer instead). See docs/guest_cloud_accounts_plan.md.
-- ============================================================

CREATE TABLE IF NOT EXISTS pcs_users (
    user_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    email        TEXT NOT NULL UNIQUE,          -- verified Cloudflare Access identity
    display_name TEXT,
    created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS pcs_card_copies (
    copy_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER NOT NULL,
    catalog_item_id     TEXT NOT NULL,
    ownership_status_id INTEGER NOT NULL,
    notes               TEXT,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES pcs_users(user_id),
    FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id)
);

CREATE INDEX IF NOT EXISTS idx_pcs_card_copies_user
    ON pcs_card_copies(user_id);
CREATE INDEX IF NOT EXISTS idx_pcs_card_copies_user_card
    ON pcs_card_copies(user_id, catalog_item_id);

-- Attribution for /pcs-contributed catalog images (a friend filling an empty
-- front/back on a catalog card — the upload becomes THE shared catalog image).
-- One row per successful upload; the image itself lives in tbl_attachments.
CREATE TABLE IF NOT EXISTS pcs_image_contributions (
    contribution_id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id         INTEGER NOT NULL,
    catalog_item_id TEXT NOT NULL,
    side            TEXT NOT NULL,          -- 'front' | 'back'
    user_id         INTEGER NOT NULL,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES pcs_users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_pcs_image_contributions_item
    ON pcs_image_contributions(item_id);

-- Ownership map for /pcs-created trade pages. tbl_trades itself stays
-- owner-agnostic (admin + legacy guest rows have no owner); this table records
-- which authenticated /pcs user created a slug so they can list/delete their
-- own. Additive — the public /trade/<slug> view is unchanged.
CREATE TABLE IF NOT EXISTS pcs_trades (
    user_id    INTEGER NOT NULL,
    slug       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (user_id, slug),
    FOREIGN KEY (user_id) REFERENCES pcs_users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_pcs_trades_slug ON pcs_trades(slug);

-- Per-user key/value settings for the /pcs tier (server-side counterpart to the
-- deprecated guest tier's browser-local guest_meta). First use: trade default
-- fields stored under key 'trade_defaults' as JSON.
CREATE TABLE IF NOT EXISTS pcs_user_meta (
    user_id INTEGER NOT NULL,
    key     TEXT NOT NULL,
    value   TEXT,

    PRIMARY KEY (user_id, key),
    FOREIGN KEY (user_id) REFERENCES pcs_users(user_id)
);

-- ============================================================================
-- Market intel — captures from the browser extension (admin only)
--
-- Design: docs/photocard_market_intel_plan.md
--
-- Split three ways rather than the plan's two, because a listing is seen more
-- than once. Identity and contents belong to the LISTING; price and state
-- belong to each SIGHTING. Folding them together would duplicate a listing's
-- title, thumbnail, and card lines on every re-capture and make "which lines
-- does this listing have" ambiguous.
--
-- Nothing here touches tbl_photocard_details, the catalog, or /pcs/. The link
-- to the library is a NULLABLE item_id — most captured listings are not cards
-- in the library, and that is a normal state.
-- ============================================================================

-- Sources captures can come from. Currency lives here so it is declared per
-- marketplace rather than guessed per row; a listing may still override it.
CREATE TABLE IF NOT EXISTS lkup_mkt_marketplaces (
    marketplace_code TEXT PRIMARY KEY,
    marketplace_name TEXT NOT NULL,
    currency         TEXT NOT NULL,
    side             TEXT,              -- 'buy' | 'sell' | 'both'
    sort_order       INTEGER NOT NULL DEFAULT 0,
    is_active        INTEGER NOT NULL DEFAULT 1,

    -- What a sale actually nets, and what a purchase actually costs. Every
    -- figure in the comp view was GROSS without these: a $13.00 sold median
    -- against a $2.50 basis read as $10.50 of margin, before the platform's
    -- cut and before any shipping absorbed.
    --
    -- All default to 0, which reproduces the old gross behaviour exactly. They
    -- are deliberately NOT pre-filled with real fee schedules -- those change,
    -- differ per seller, and a wrong number confidently displayed is worse
    -- than an obviously unset one. The UI says when they are unset.
    -- Amounts are in the marketplace's OWN currency, in MINOR units -- not
    -- cents, and not USD. Neokyo charges ¥350, and JPY has no subdivision, so
    -- that is stored as 350. Calling the column _cents implied an exponent of
    -- 2 for every currency, which is exactly the assumption that turned ¥2500
    -- into $0.17 earlier in this module's life.
    fee_pct              REAL NOT NULL DEFAULT 0,  -- 0.10 = 10% of sale price
    fee_fixed_minor      INTEGER NOT NULL DEFAULT 0,
    ship_absorbed_minor  INTEGER NOT NULL DEFAULT 0,  -- typical, when seller pays
    -- How far below the ask buyers typically settle. Sold prices are already
    -- net of this (they are accepted offers), so it does NOT come off a sold
    -- comp -- it is what a LIST price has to be padded by to clear a target.
    offer_discount_pct   REAL NOT NULL DEFAULT 0,
    -- How many cards a typical shipment CONTAINS. Divides the per_shipment
    -- cost lines into a per-card estimate.
    --
    -- Sometimes the fee's capacity, sometimes nothing like it, and what decides
    -- is whether a STORAGE CLOCK forces the box out before it is full:
    --
    --   Pocamarket stores cards indefinitely and you choose when to ship, so
    --   boxes go out full: 40 against its "$12 up to 40 items" is honest, and
    --   the per-card share really is $0.30.
    --
    --   Neokyo holds for 45 days and then ships whatever has accumulated, so
    --   its capacity is a fiction -- six cards paying a forty-card fee is
    --   $2.00 each, not $0.30.
    --
    -- Getting this backwards is a ~7x error in landed cost, in the direction
    -- that talks you into a bad buy.
    --
    -- NULL means unknown, and the per_shipment lines are then left OUT and
    -- flagged rather than guessed at.
    typical_items_per_shipment INTEGER
);

INSERT OR IGNORE INTO lkup_mkt_marketplaces
    (marketplace_code, marketplace_name, currency, side, sort_order) VALUES
    ('mercari_us', 'Mercari US',  'USD', 'both', 10),
    ('neokyo',     'Neokyo',      'JPY', 'buy',  20),
    -- USD, not KRW: the site quotes a US buyer in dollars throughout --
    -- price, shipping and duties -- so that is the currency its fee
    -- amounts are entered in and the one it actually charges. A capture
    -- still records KRW correctly if the display is ever switched, since
    -- the currency follows the page rather than the marketplace row.
    ('pocamarket', 'Pocamarket',  'USD', 'both', 30),
    ('ebay',       'eBay',        'USD', 'both', 40);

-- USD conversion rates, by currency and effective date.
--
-- The NATIVE amount is always the record; USD is derived and labelled. Storing
-- only USD would destroy the ability to re-derive when the question changes:
-- "what would this have cost me then" wants the rate at observation, while
-- "what should I pay now" wants today's rate over native prices. Both are
-- legitimate and they disagree whenever a currency moves.
-- Named cost components, per marketplace and per SIDE.
--
-- Replaces a fixed fee_pct/fee_fixed/shipping trio on the marketplace row,
-- which was wrong twice over: it was implicitly SELLER-side with nothing
-- saying so, and its three slots could not hold the real buy-side costs --
-- PayPal, import duty, proxy service fees, consolidated shipping.
--
-- A marketplace is not a side (Mercari US is both bought and sold on), so the
-- side lives here rather than forcing two marketplace rows and breaking the
-- identity that listings reference.
--
-- Each component contributes  price * pct + fixed_minor.  fixed_minor is in
-- the MARKETPLACE's currency, in minor units -- ¥350 is 350, JPY having no
-- subdivision.
CREATE TABLE IF NOT EXISTS mkt_fee_component (
    component_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    marketplace_code TEXT NOT NULL,
    side             TEXT NOT NULL,          -- 'buy' | 'sell'
    label            TEXT NOT NULL,
    -- Costs arrive at different granularities and cannot all be charged per
    -- card. A real Neokyo box: ¥350 per LISTING, PayPal 3.6% proportional to
    -- price, import tax 23.65% also proportional, but shipping ¥6,700 +
    -- handling ¥500 + wire fees ¥839 land ONCE ON THE BOX regardless of how
    -- many cards are in it. Charging that per card would inflate a 40-card
    -- box eightfold.
    --   per_item      applies to each listing (a pct here is proportional to
    --                 price, so it is per-item and per-box equivalently)
    --   per_shipment  lands once per consolidated box; divided by
    --                 lkup_mkt_marketplaces.typical_items_per_shipment to
    --                 estimate a per-card share
    scope            TEXT NOT NULL DEFAULT 'per_item',  -- per_item|per_shipment
    pct              REAL NOT NULL DEFAULT 0,
    fixed_minor      INTEGER NOT NULL DEFAULT 0,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    is_active        INTEGER NOT NULL DEFAULT 1,

    -- Stable identity for a SEEDED line, independent of its display label.
    -- Seeding keyed on the label meant every rename created a duplicate row
    -- instead of renaming the existing one, and three rounds of relabelling
    -- stacked three generations of the same cost line on top of each other.
    -- NULL for user-created lines, which have no seed to track.
    seed_key         TEXT,

    UNIQUE (marketplace_code, side, label),
    FOREIGN KEY (marketplace_code) REFERENCES lkup_mkt_marketplaces(marketplace_code)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mkt_fee_component_seed
    ON mkt_fee_component(marketplace_code, side, seed_key) WHERE seed_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mkt_fee_component_lookup
    ON mkt_fee_component(marketplace_code, side, is_active);

CREATE TABLE IF NOT EXISTS mkt_fx_rate (
    currency      TEXT NOT NULL,
    as_of_date    TEXT NOT NULL,         -- ISO date the rate takes effect
    usd_per_unit  REAL NOT NULL,         -- 1 unit of `currency` in USD
    source        TEXT,                  -- 'manual' | 'marketplace' | ...
    note          TEXT,

    PRIMARY KEY (currency, as_of_date)
);

CREATE TABLE IF NOT EXISTS mkt_listing (
    listing_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    marketplace     TEXT NOT NULL,          -- 'mercari_us', later 'neokyo'
    external_id     TEXT NOT NULL,          -- native listing id from the URL
    listing_url     TEXT,
    title_raw       TEXT,                   -- original, untranslated
    item_condition  TEXT,
    category        TEXT,
    category_id     INTEGER,
    brand           TEXT,
    thumbnail_url   TEXT,
    search_query    TEXT,                   -- what was being searched
    -- Explicit, never derived from line count: the common case is one
    -- identified card and N unknowns never entered, which looks single.
    is_lot          INTEGER NOT NULL DEFAULT 0,
    suspected_lot   INTEGER NOT NULL DEFAULT 0,
    -- True when the page-world fiber read failed and the DOM scrape carried
    -- the capture, so degraded rows are auditable rather than silent.
    via_fallback    INTEGER NOT NULL DEFAULT 0,
    -- Detail-page capture only. All three are null or empty in search tiles,
    -- so on a capture_tier='sweep' row a NULL here means "not looked at yet",
    -- NOT "no shipping" — the fee model must not read it as free shipping.
    capture_tier    TEXT NOT NULL DEFAULT 'sweep',   -- sweep|detail
    shipping_payer  TEXT,
    description     TEXT,
    seller_id       TEXT,
    -- Date-ish fields found on the marketplace's own item object, kept as a
    -- JSON map under their ORIGINAL keys. Mercari shows both "Posted" and
    -- "Sold" on a listing, but which field carries which is not yet known, and
    -- guessing wrong fails silently. Stored raw so the semantics can be read
    -- off real captures; promote to proper posted_at / sold_at columns once
    -- confirmed, backfilling from here.
    source_dates    TEXT,
    -- No longer purchasable, price UNKNOWN. Deliberately not a sighting:
    -- "sold at a known price" is a new comp and free price discovery, while
    -- "gone" is only the absence of an option. A proxy listing that vanishes
    -- says nothing about what it fetched, so letting gone mean sold-at-the-ask
    -- would inflate the sold median with every disappearance.
    delisted_at     TEXT,
    first_seen_at   TEXT NOT NULL,
    last_seen_at    TEXT NOT NULL,

    UNIQUE (marketplace, external_id)
);

-- Contents of a listing: catalog cards, non-card items, unidentified cards.
-- This is also the lot decomposition.
CREATE TABLE IF NOT EXISTS mkt_listing_line (
    line_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id         INTEGER NOT NULL,
    line_type          TEXT NOT NULL DEFAULT 'card',  -- card|non_card|unidentified
    -- Nullable on purpose. LEFT JOIN it, and scope by collection_type_id:
    -- item ids are global across all 8 modules.
    item_id            INTEGER,
    collection_type_id INTEGER,
    label              TEXT,
    qty                INTEGER NOT NULL DEFAULT 1,
    notes              TEXT,
    -- Per-unit resale value, USD cents, NET of selling fees. Manual only, and
    -- an override: the lot analyzer otherwise derives a card's value from its
    -- own sold comps, then from its era's median. Non-card lines have no
    -- ladder to fall back on, so this is the only way an album or a keychain
    -- ever carries value -- and a lot line left unvalued makes the identified
    -- cards absorb its share of the cost, which the analyzer says out loud
    -- rather than quietly writing off.
    value_cents        INTEGER,
    -- keep | flip, for the lot analyzer's residual. NULL means "derive from
    -- the library": a card marked Wanted is a keep. The standing decision is
    -- already recorded there, so most lots should need no toggling at all.
    disposition        TEXT,

    FOREIGN KEY (listing_id) REFERENCES mkt_listing(listing_id)
);

-- One row per time a listing was seen. Price history accrues from ordinary
-- browsing rather than from a scheduled refresh.
CREATE TABLE IF NOT EXISTS mkt_sighting (
    sighting_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id    INTEGER NOT NULL,
    observed_at   TEXT NOT NULL,
    -- Derived from the item's own `status` field, NEVER from which search
    -- filter was running: Mercari's default search mixes sold rows in with
    -- on-sale ones, so inferring from context corrupts the active series.
    listing_state TEXT NOT NULL,           -- active | sold
    raw_status    TEXT,                    -- on_sale | trading | sold_out
    -- MINOR units of `currency`, not literally cents. USD 36.00 -> 3600;
    -- JPY has no subdivision, so 4000 yen -> 4000. Dividing by 100 to
    -- display is a USD assumption and will be wrong for Neokyo.
    price_cents   INTEGER,
    currency      TEXT NOT NULL DEFAULT 'USD',
    -- What the page said SHIPPING costs, in the same currency and the same
    -- minor units as price_cents. NULL means "not read", never "free" --
    -- 0 is free, and conflating the two understates a listing's real cost.
    --
    -- Per LISTING rather than per marketplace, because on eBay it is: a $6
    -- card with $5.48 postage costs nearly twice a $6 card with free postage,
    -- and a standing per-marketplace estimate cannot tell them apart. Where it
    -- is known it REPLACES the fee model's shipping line rather than adding to
    -- it; see landed_cost().
    shipping_cents INTEGER,
    shipping_usd   INTEGER,
    -- USD at the time of observation. Nullable: a JPY sighting captured with
    -- no rate on file is still a valid record of the native price.
    price_usd     INTEGER,
    fx_rate       REAL,
    -- 'marketplace' when the site did the conversion itself (Neokyo shows a
    -- USD figure, and it is the one actually charged, so it beats any rate we
    -- would look up), 'table' when derived from mkt_fx_rate.
    fx_source     TEXT,

    UNIQUE (listing_id, observed_at),
    FOREIGN KEY (listing_id) REFERENCES mkt_listing(listing_id)
);

CREATE INDEX IF NOT EXISTS idx_mkt_line_listing ON mkt_listing_line(listing_id);
CREATE INDEX IF NOT EXISTS idx_mkt_line_item    ON mkt_listing_line(item_id);
CREATE INDEX IF NOT EXISTS idx_mkt_sighting_lst ON mkt_sighting(listing_id, observed_at);

-- ── Photocard cost basis (admin-only, market intel) ──────────────────────────
-- What a card COST, as opposed to tbl_photocard_pricing which is what it is
-- offered at. Deliberately separate from the price tiers: a price tier is a
-- selling opinion that gets revised, and letting cost ride on it would silently
-- rewrite cost history. The two share a ranking shape and nothing else.
--
-- mkt_* prefix, not tbl_photocard_*, so these never drift into the catalog or
-- guest paths -- cost is an admin fact and must not ship to /pcs/.
CREATE TABLE IF NOT EXISTS mkt_cost_tier (
    cost_tier_id INTEGER PRIMARY KEY AUTOINCREMENT,
    tier_code    TEXT NOT NULL UNIQUE,
    tier_name    TEXT NOT NULL,
    cost_cents   INTEGER NOT NULL,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    is_active    INTEGER NOT NULL DEFAULT 1
);

-- Per-card basis. Tier XOR explicit amount, the same CHECK pattern used by
-- tbl_photocard_pricing -- the effective figure is derived on read and never
-- denormalized, so editing a tier reprices every card sitting on it.
-- A row here is an ESTIMATE for the backlog; a real logged purchase outranks it
-- and is resolved at read time, never written back over this.
CREATE TABLE IF NOT EXISTS mkt_item_cost (
    item_id      INTEGER PRIMARY KEY,
    cost_tier_id INTEGER,
    cost_cents   INTEGER,
    source       TEXT NOT NULL DEFAULT 'rule',   -- rule|manual
    updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CHECK ((cost_tier_id IS NULL) <> (cost_cents IS NULL)),
    FOREIGN KEY (item_id)      REFERENCES tbl_items(item_id),
    FOREIGN KEY (cost_tier_id) REFERENCES mkt_cost_tier(cost_tier_id)
);
CREATE INDEX IF NOT EXISTS idx_mkt_item_cost_tier ON mkt_item_cost(cost_tier_id);
