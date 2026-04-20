import sqlite3

db_path = r"C:\Dev\CollectCore\data\collectcore.db"

conn = sqlite3.connect(db_path)
cur = conn.cursor()

cur.executemany(
    "INSERT INTO lkup_ownership_statuses (status_code, status_name, sort_order, is_active) VALUES (?, ?, ?, ?)",
    [
        ("O", "Owned", 1, 1),
        ("W", "Wanted", 2, 1),
        ("T", "Trade", 3, 1),
        ("F", "Formerly Owned", 4, 1),
        ("P", "Pending", 5, 1),
    ],
)

conn.commit()

cur.execute("SELECT * FROM lkup_ownership_statuses ORDER BY ownership_status_id")
print(cur.fetchall())

conn.close()