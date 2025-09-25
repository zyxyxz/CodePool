# TeamKey FastAPI Backend

Python FastAPI implementation powering TeamKey mini-program and admin portal.

## Features

- FastAPI + SQLAlchemy + SQLite for quick local setup
- JWT-based authentication with mockable WeChat login flow
- Team, member, account, permission, share, and audit management APIs
- AES-GCM encrypted TOTP secrets with server master key derivation
- Admin endpoints for bootstrap, settings, telemetry, and analytics

## Getting Started

### 1. Install dependencies

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and adjust values (`TEAMKEY_JWT_SECRET_KEY`, `TEAMKEY_SERVER_MASTER_KEY`, etc.).

### 3. Run the server

```bash
uvicorn app.main:app --reload
```

API available at `http://localhost:8000` (docs at `/docs`).

## Project Structure

```
app/
  api/v1/      # FastAPI routers
  core/        # Settings and security helpers
  db/          # Database session management
  models/      # SQLAlchemy models
  schemas/     # Pydantic schemas
  services/    # Domain services
  utils/       # Crypto/TOTP utilities
```

## Database

- Default: SQLite (`data/teamkey.db`)
- Override via `TEAMKEY_DATABASE_URL` (PostgreSQL/MySQL supported by SQLAlchemy)

Tables auto-created on startup (`Base.metadata.create_all`). Use Alembic for production migrations if needed.

## Admin Bootstrap Flow

1. `POST /api/v1/admin/login` with initial credentials (from `.env`) to obtain admin token
2. `POST /api/v1/admin/bootstrap` to set site info and admin account
3. Use admin token for `/api/v1/admin/settings`, `/stats`, `/users`, etc.

## Notes

- WeChat login defaults to mock mode (`TEAMKEY_WX_MOCK_MODE=true`); set real `TEAMKEY_WX_APP_ID` + `TEAMKEY_WX_APP_SECRET` to call official API
- Sharing "package" mode can be disabled via `TEAMKEY_ENABLE_PACKAGE_SHARE=false`
- Crypto utilities derive per-secret keys from `TEAMKEY_SERVER_MASTER_KEY`; keep this value safe and rotate carefully

Enjoy building with TeamKey!
