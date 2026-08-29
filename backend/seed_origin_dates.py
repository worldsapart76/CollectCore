"""Seed data: photocard source-origin start dates.

Dates were reconciled against the prod backup of 2026-08-28 from two
fan-maintained spreadsheets (an album release list and a photocard event
timeline), plus a handful supplied directly for the 2025-26 tail the sheets
do not reach. Coverage is 87/88 origins = 11,323/11,323 catalogued cards; the
only undated origin is `Merch`, which has no cards.

`start_date` means **when this line started shipping**, not a release date.
Tours, pop-ups and collab series span weeks or months, so the date is the
opening of the window and `date_precision` records how much of it to trust:

    day    an exact known date
    month  known to the month only (stored as the 1st)
    year   approximate, year only (stored as Jan 1)

Rows are keyed by (id, name) TOGETHER and applied only where start_date IS
NULL. Both halves matter:

  * id-and-name — source_origin_id is NOT stable across databases. In the
    2026-08 dev copy id 77 was "This & That"; in prod id 77 is "Season's
    Greetings 2025 (Japan) Your Hero". Seeding on id alone would have
    silently misdated it. A row whose name does not match is skipped and
    counted, never written.
  * NULL-only — a date corrected by hand in the admin UI must survive every
    subsequent restart.
"""

# (source_origin_id, source_origin_name, start_date, date_precision)
ORIGIN_START_DATES: tuple[tuple[int, str, str, str], ...] = (
    (1, "I am NOT", "2018-03-26", "day"),
    (2, "I am WHO", "2018-08-06", "day"),
    (3, "I am YOU", "2018-10-22", "day"),
    (4, "Cle: MIROH", "2019-03-25", "day"),
    (5, "Cle: Yellow Wood", "2019-06-19", "day"),
    (6, "Cle: Levanter", "2019-12-09", "day"),
    (7, "Go Live", "2020-06-17", "day"),
    (8, "In Life", "2020-09-14", "day"),
    (9, "NOEASY", "2021-08-23", "day"),
    (10, "Christmas EveL", "2021-11-29", "day"),
    (11, "Oddinary", "2022-03-18", "day"),
    (12, "Collab: Nacific", "2021-09-01", "month"),
    (13, "Maxident", "2022-10-07", "day"),
    (14, "5 Star", "2023-06-02", "day"),
    (15, "KARMA", "2025-08-22", "day"),
    (16, "Rock Star", "2023-11-10", "day"),
    (17, "Social Path", "2023-09-06", "day"),
    (18, "All In", "2020-11-04", "day"),
    (19, "SKZ2020", "2020-03-18", "day"),
    (20, "The Sound", "2023-02-22", "day"),
    (21, "Circus", "2022-06-22", "day"),
    (22, "Scars", "2021-10-13", "day"),
    (23, "Top", "2020-06-03", "day"),
    (24, "Hollow", "2025-06-18", "day"),
    (25, "Giant", "2024-11-13", "day"),
    (26, "Dominate", "2024-08-23", "day"),
    (27, "Maniac World Tour", "2022-04-29", "day"),
    (28, "5-Star Dome Tour", "2023-08-16", "day"),
    (30, "Dicon", "2022-10-01", "month"),
    (31, "3rd Fan Meeting", "2023-07-01", "day"),
    (32, "ATE", "2024-07-19", "day"),
    (33, "HOP", "2024-12-13", "day"),
    (34, "DO IT", "2025-11-21", "day"),
    (36, "Mixtape", "2018-01-08", "day"),
    (37, "Fan Club Gen 0", "2017-12-29", "day"),
    (38, "I am... Unveil Tour", "2019-01-19", "day"),
    (40, "District 9 Unlock Tour", "2019-11-23", "day"),
    (41, "Hi-Stay Tour", "2019-04-20", "day"),
    (43, "Stay in London", "2019-11-30", "day"),
    (44, "Hi-Stay Japan Showcase", "2019-12-03", "day"),
    (45, "Stay in Playground", "2020-08-31", "day"),
    (46, "Fan Club Gen 2 You make Stray Kids STAY", "2020-10-25", "day"),
    (47, "Fan Club Gen 1", "2019-03-26", "day"),
    (48, "Season's Greetings 2021", "2020-12-29", "day"),
    (49, "Unlock: Go Live In Life", "2020-11-22", "day"),
    (51, "Collab: CLIO", "2021-03-15", "day"),
    (52, "Season's Greetings 2022 Room mates", "2022-01-25", "day"),
    (54, "Fan Meeting 1 #LoveSTAY SKZ-X", "2021-02-20", "day"),
    (55, "Fan Meeting 2 SKZ's Chocolate Factory", "2022-02-12", "day"),
    (56, "Fan Meeting 3 PILOT: FOR 5-Star", "2023-07-01", "day"),
    (57, "The Victory", "2022-05-30", "day"),
    (58, "Collab: FamilyMart", "2022-06-07", "day"),
    (59, "Season's Greetings 2023 (Japan) S-318", "2022-09-28", "day"),
    (60, "FuRyu", "2022-07-01", "day"),
    (61, "Season's Greetings 2023 Mini World", "2023-01-09", "day"),
    (62, "Fan Club Gen 3 Home Sweet Home", "2022-10-27", "day"),
    (63, "Stay in STAY", "2022-11-25", "day"),
    (64, "Collab: Bench/", "2023-01-20", "day"),
    (65, "Collab: SHIBUYA109", "2023-02-10", "day"),
    (66, "The Sound", "2023-02-22", "day"),
    (67, "Green Project", "2023-06-27", "day"),
    (68, "JYP Japan Pop-Up Store 2023", "2023-07-15", "day"),
    (69, "Collab: SLBS", "2023-07-31", "day"),
    (70, "Season's Greetings 2024 (Japan) Air-ful", "2023-10-10", "day"),
    (71, "Fan Club Gen 4 STAY HIDEOUT", "2024-01-15", "day"),
    (72, "Xmas Pop-Up Store 2023", "2023-12-01", "day"),
    (73, "Season's Greetings 2024 Perfect Day", "2023-11-20", "day"),
    (74, "Fan Meeting 4 SKZ's Magic School", "2024-03-29", "day"),
    (75, "Fan Meeting 2024 (Japan) SKZ Toy World", "2024-04-06", "day"),
    (76, "JYP Japan Pop-Up Store 2024", "2024-08-01", "day"),
    (77, "Season's Greetings 2025 (Japan) Your Hero", "2024-10-24", "day"),
    (78, "Xmas Pop-Up Store 2024", "2024-12-01", "day"),
    (79, "Fan Meeting 5 SKZ 5'Clock", "2025-02-14", "day"),
    (80, "Collab: Ultra Milk", "2024-01-16", "day"),
    (81, "This & That", "2026-08-07", "day"),
    (82, "Season's Greetings 2025 Street Kids", "2024-12-20", "day"),
    (83, "Season's Greetings 2026 Starlight Supper Club", "2025-10-23", "day"),
    (84, "Fan Club Gen 5 Stay Over the Rain", "2025-01-06", "day"),
    (85, "Season's Greetings 2026 (Japan) FORCE", "2025-09-08", "day"),
    (86, "Collab: Zootopia 2", "2025-11-26", "day"),
    (87, "Fan Meeting 6 STAY in Our Little House", "2026-03-28", "day"),
    (88, "Fan Club Gen 6 Stay with Your Wings", "2026-01-26", "day"),
    (89, "Fan Club 2026 (Japan)", "2026-01-01", "year"),
    (90, "Collab: Mahagrid", "2022-04-05", "day"),
    (91, "Collab: Shinhan", "2022-10-20", "day"),
    (92, "Fan Club 2025 (Japan)", "2025-01-01", "year"),
    (93, "Collab: Gong cha (Felix)", "2026-01-01", "year"),
)
