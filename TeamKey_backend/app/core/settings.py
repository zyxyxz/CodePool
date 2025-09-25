from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "TeamKey API"
    environment: str = "development"
    api_v1_prefix: str = "/api/v1"

    sqlite_path: str = "data/teamkey.db"
    database_url: str | None = None

    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60 * 24 * 7

    server_master_key: str

    wx_app_id: str | None = None
    wx_app_secret: str | None = None
    wx_mock_mode: bool = True

    admin_initial_email: str = "admin@teamkey.local"
    admin_initial_password: str = "ChangeMe123!"

    enable_package_share: bool = True

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", env_prefix="TEAMKEY_", case_sensitive=False)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
