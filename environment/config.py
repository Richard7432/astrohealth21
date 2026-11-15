"""Read process configuration only. No credentials are served to the browser."""
import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Config:
    meteomatics_username: str = field(default="", repr=False)
    meteomatics_password: str = field(default="", repr=False)
    nasa_api_key: str = field(default="", repr=False)
    nasa_source: str = "ccmc"
    landsat_cache: bool = True

    @classmethod
    def load(cls):
        return cls(
            meteomatics_username=os.getenv("METEOMATICS_USERNAME", ""),
            meteomatics_password=os.getenv("METEOMATICS_PASSWORD", ""),
            nasa_api_key=os.getenv("NASA_API_KEY", ""),
            nasa_source=os.getenv("NASA_DONKI_SOURCE", "ccmc").strip().lower(),
            landsat_cache=os.getenv("ASTRO_LANDSAT_CACHE", "1") == "1",
        )

