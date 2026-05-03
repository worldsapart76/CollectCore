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
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id)
);


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