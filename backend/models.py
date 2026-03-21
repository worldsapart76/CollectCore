from sqlalchemy import Column, Integer, String, DateTime, UniqueConstraint
from sqlalchemy.sql import func
from db import Base


class Card(Base):
    __tablename__ = "cards"

    id = Column(Integer, primary_key=True, index=True)
    group_code = Column(String, nullable=False, default="skz")

    front_image_path = Column(String, nullable=False)
    back_image_path = Column(String, nullable=True)

    member = Column(String, nullable=True)

    top_level_category = Column(String, nullable=True)
    sub_category = Column(String, nullable=True)

    source = Column(String, nullable=True)
    ownership_status = Column(String, nullable=False, default="Owned")
    price = Column(Integer, nullable=True)

    notes = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class SubcategoryOption(Base):
    __tablename__ = "subcategory_options"

    id = Column(Integer, primary_key=True, index=True)
    group_code = Column(String, nullable=False, default="skz")
    top_level_category = Column(String, nullable=False)
    value = Column(String, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "group_code",
            "top_level_category",
            "value",
            name="uq_subcategory_group_top_level_value",
        ),
    )


class SourceOption(Base):
    __tablename__ = "source_options"

    id = Column(Integer, primary_key=True, index=True)
    group_code = Column(String, nullable=False, default="skz")
    top_level_category = Column(String, nullable=False)
    sub_category = Column(String, nullable=False)
    value = Column(String, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "group_code",
            "top_level_category",
            "sub_category",
            "value",
            name="uq_source_group_top_level_sub_value",
        ),
    )