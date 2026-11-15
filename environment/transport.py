"""Bounded HTTPS transport. Provider bodies and URLs never enter error messages."""
import json
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener


class ProviderError(Exception):
    def __init__(self, status, message=None, retry_after=None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.retry_after = retry_after


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


def cooldown(value):
    try:
        delay = int(value)
    except (TypeError, ValueError):
        try:
            delay = (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds()
        except (TypeError, ValueError, OverflowError):
            delay = 60
    return max(10, min(86400, int(delay)))


class Transport:
    def read(self, url, headers=None, *, limit=2_000_000):
        request = Request(url, headers={"User-Agent": "AstroHealth/0.5", **(headers or {})})
        try:
            with build_opener(NoRedirect()).open(request, timeout=8) as response:
                content = response.read(limit + 1)
                if len(content) > limit:
                    raise ProviderError("malformed", "A resposta ultrapassou o limite local de tamanho.")
                return response.status, response.headers.get_content_type(), content
        except HTTPError as exc:
            with exc:
                if exc.code == 429 or exc.headers.get("X-RateLimit-Remaining") == "0":
                    raise ProviderError("rate_limit", retry_after=cooldown(exc.headers.get("Retry-After"))) from None
                if exc.code in (401, 403):
                    raise ProviderError("denied") from None
                if exc.code == 410:
                    raise ProviderError("expired") from None
                if exc.code == 404:
                    raise ProviderError("service_error", "Recurso indisponível na origem (HTTP 404).") from None
                if exc.code in (408, 504):
                    raise ProviderError("offline", "A consulta excedeu o tempo limite.") from None
                raise ProviderError("service_error", f"O serviço respondeu com HTTP {exc.code}.") from None
        except (URLError, OSError, HTTPException):
            raise ProviderError("offline") from None

    def json(self, url, headers=None):
        status, mime, content = self.read(url, {"Accept": "application/json, application/geo+json", **(headers or {})})
        if status == 204:
            return []
        if mime != "application/json" and not mime.endswith("+json"):
            raise ProviderError("malformed")
        try:
            return json.loads(content, parse_constant=reject_constant)
        except (ValueError, UnicodeError):
            raise ProviderError("malformed") from None


def reject_constant(_value):
    raise ValueError("Invalid JSON number.")

