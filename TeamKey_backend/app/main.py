from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import accounts, admin, auth, audit, permissions, shares, teams
from app.core.settings import settings
from app.db.database import engine
from app.models import Base


def create_app() -> FastAPI:
    application = FastAPI(title=settings.app_name)

    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application.include_router(auth.router, prefix=settings.api_v1_prefix)
    application.include_router(teams.router, prefix=settings.api_v1_prefix)
    application.include_router(accounts.router, prefix=settings.api_v1_prefix)
    application.include_router(permissions.router, prefix=settings.api_v1_prefix)
    application.include_router(shares.router, prefix=settings.api_v1_prefix)
    application.include_router(audit.router, prefix=settings.api_v1_prefix)
    application.include_router(admin.router, prefix=settings.api_v1_prefix)

    @application.on_event("startup")
    def on_startup() -> None:
        Base.metadata.create_all(bind=engine)

    return application


app = create_app()


if __name__ == '__main__':
    import uvicorn
    uvicorn.run('app.main:app', host='0.0.0.0', port=8000, reload=True)
