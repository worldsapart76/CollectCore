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
    ownership_status_id   INTEGER NOT NULL,
    reading_status_id     INTEGER,
    notes                 TEXT,
    created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (collection_type_id) REFERENCES lkup_collection_types(collection_type_id),
    FOREIGN KEY (top_level_category_id) REFERENCES lkup_top_level_categories(top_level_category_id),
    FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id),
    FOREIGN KEY (reading_status_id) REFERENCES lkup_book_read_statuses(read_status_id)
);

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


-- ============================================================
-- BOOKS LOOKUP TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS lkup_book_read_statuses (
    read_status_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    status_name     TEXT NOT NULL UNIQUE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1
);

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
INSERT OR IGNORE INTO lkup_ownership_statuses (status_code, status_name, sort_order) VALUES ('pending',        'Pending',        5);
INSERT OR IGNORE INTO lkup_ownership_statuses (status_code, status_name, sort_order) VALUES ('borrowed',       'Borrowed',       6);


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

-- read statuses
INSERT OR IGNORE INTO lkup_book_read_statuses (status_name, sort_order) VALUES ('Read',              1);
INSERT OR IGNORE INTO lkup_book_read_statuses (status_name, sort_order) VALUES ('Currently Reading', 2);
INSERT OR IGNORE INTO lkup_book_read_statuses (status_name, sort_order) VALUES ('Want to Read',      3);
INSERT OR IGNORE INTO lkup_book_read_statuses (status_name, sort_order) VALUES ('DNF',               4);

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
INSERT OR IGNORE INTO lkup_graphicnovel_eras (era_name, era_years, sort_order) VALUES ('Copper Age', '1985–1991', 40);
INSERT OR IGNORE INTO lkup_graphicnovel_eras (era_name, era_years, sort_order) VALUES ('Modern Era', '1991+', 50);
INSERT OR IGNORE INTO lkup_graphicnovel_eras (era_name, era_years, sort_order) VALUES ('Multi-Era', NULL, 60);


-- ============================================================
-- APP SETTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS tbl_app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO tbl_app_settings (key, value)
VALUES ('modules_enabled', '["photocards","books","graphicnovels"]');