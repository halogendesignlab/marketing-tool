"""settings.py — App settings loaded from environment variables."""

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", env_ignore_empty=True)

    # Application
    APP_ENV: str = "development"
    SECRET_KEY: str
    ALLOWED_ORIGINS: str = "http://localhost:3000"

    # Database
    DATABASE_URL: str

    # AI
    ANTHROPIC_API_KEY: str = ""

    # Publer
    PUBLER_API_KEY: str = ""

    # Resend
    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = "notifications@halogendesignlab.com"

    # DataForSEO
    DATAFORSEO_LOGIN: str = ""
    DATAFORSEO_PASSWORD: str = ""

    # Google OAuth (GBP)
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = ""

    # Google Service Account (Drive + GA4)
    GOOGLE_SERVICE_ACCOUNT_FILE: str = "credentials/google-service-account.json"

    # Admin
    ADMIN_EMAIL: str = ""

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",")]


@lru_cache
def get_settings() -> Settings:
    return Settings()
