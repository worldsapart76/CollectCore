from sqlalchemy import text
from db import engine, Base
from models import SubcategoryOption


def get_existing_columns(table_name: str) -> set[str]:
    with engine.connect() as conn:
        result = conn.execute(text(f"PRAGMA table_info({table_name})"))
        rows = result.fetchall()
        return {row[1] for row in rows}  # row[1] = column name


def add_column_if_missing(table_name: str, column_name: str, column_sql: str):
    existing = get_existing_columns(table_name)
    if column_name in existing:
        print(f"[OK] Column already exists: {table_name}.{column_name}")
        return

    with engine.begin() as conn:
        conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}"))
    print(f"[ADDED] Column added: {table_name}.{column_name}")


def main():
    print("Starting database migration...")

    # Add new columns to existing cards table
    add_column_if_missing("cards", "top_level_category", "TEXT")
    add_column_if_missing("cards", "sub_category", "TEXT")

    # Create any new tables that do not yet exist
    Base.metadata.create_all(bind=engine, tables=[SubcategoryOption.__table__])

    print("[OK] Ensured table exists: subcategory_options")
    print("Migration complete.")


if __name__ == "__main__":
    main()