from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, scoped_session
from pathlib import Path

from app.core.settings import settings


def _resolve_database_url() -> str:
    if settings.database_url:
        return settings.database_url
    sqlite_path = Path(settings.sqlite_path)
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{sqlite_path.absolute()}"


database_url = _resolve_database_url()

engine = create_engine(database_url, connect_args={"check_same_thread": False} if database_url.startswith("sqlite") else {})

SessionLocal = scoped_session(sessionmaker(autocommit=False, autoflush=False, bind=engine))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
