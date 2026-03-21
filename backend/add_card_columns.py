from db import engine
from sqlalchemy import text

STATEMENTS = [
    "ALTER TABLE cards ADD COLUMN source TEXT",
    "ALTER TABLE cards ADD COLUMN ownership_status TEXT NOT NULL DEFAULT 'Owned'",
    "ALTER TABLE cards ADD COLUMN price INTEGER",
]

with engine.connect() as conn:
    for sql in STATEMENTS:
        try:
            conn.execute(text(sql))
            print(f"Ran: {sql}")
        except Exception as e:
            print(f"Skipped or failed: {sql}")
            print(f"  Reason: {e}")
    conn.commit()

print("Done.")