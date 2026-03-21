from db import engine
from models import SourceOption

SourceOption.__table__.create(bind=engine, checkfirst=True)

print("source_options table checked/created.")