"""Coordinates independent provider queries, cache, status and quota protection."""
from threading import Lock
from time import monotonic

from . import donki, meteomatics, stac
from .cache import Cache, FRESH_SECONDS
from .config import Config
from .fields import iso, utc_now
from .transport import ProviderError, Transport

LABELS = {
    "stac": "Microsoft Planetary Computer / STAC",
    "weather": "Meteomatics · clima terrestre",
    "kp": "Meteomatics · índice Kp da NOAA",
    "donki": "NASA DONKI",
    "preview": "Microsoft Planetary Computer / miniatura",
}
MESSAGES = {
    "untested": "Teste real não executado nesta sessão.",
    "connected": "Conectado e consulta bem-sucedida.",
    "empty": "Sem dados para a seleção.",
    "offline": "Sem conexão com o serviço. Dados externos indisponíveis.",
    "denied": "Credenciais inválidas ou acesso negado pelo serviço.",
    "rate_limit": "Limite de uso atingido ou pausa entre consultas ativa. Aguarde antes de tentar de novo.",
    "malformed": "O serviço retornou uma resposta malformada ou em formato inesperado.",
    "service_error": "Erro do serviço. Dados externos indisponíveis.",
    "expired": "Acesso temporário expirado ou indisponível.",
    "invalid": "Seleção inválida.",
    "coverage": "Ponto fora da cobertura aproximada.",
    "busy": "Uma consulta a este provedor está em andamento.",
    "cache": "Resultado anterior em cache.",
}


class Environment:
    def __init__(self, directory, *, config=None, transport=None, clock=utc_now, timer=monotonic):
        self.config = config if config is not None else Config.load()
        self.transport = transport if transport is not None else Transport()
        self.cache = Cache(directory / "environment-cache.sqlite") if self.config.landsat_cache else None
        self.clock, self.timer = clock, timer
        self.lock = Lock()
        self.provider_locks = {key: Lock() for key in ("planetary", "meteomatics", "nasa")}
        self.attempts = {}
        self.cooldowns = {}
        self.latest = {}

    def initial(self, kind):
        message = None
        if kind in ("weather", "kp") and not meteomatics.configured(self.config):
            message = "Meteomatics não configurada."
        elif kind == "donki":
            message = donki.configuration(self.config)
        return self.envelope(kind, "unconfigured" if message else "untested", message=message)

    def envelope(self, kind, status, *, message=None, checked_at=None, **details):
        return dict(source=kind, name=LABELS[kind], status=status, message=message or MESSAGES.get(status),
                    checked_at=checked_at, **details)

    def statuses(self):
        with self.lock:
            return dict(nasa_route=self.config.nasa_source,
                        landsat_cache=bool(self.cache),
                        services={k: self.latest.get(k) or self.initial(k) for k in LABELS})

    def mark(self, result):
        with self.lock:
            self.latest[result["source"]] = {key: result[key] for key in (
                "source", "name", "status", "message", "checked_at")}
            if result["status"] == "cache":
                self.latest[result["source"]]["upstream_status"] = result.get("upstream_status")
                self.latest[result["source"]]["fetched_at"] = result.get("fetched_at")

    def access(self, kind, call):
        group = ("planetary" if kind in ("stac", "preview") else
                 "meteomatics" if kind in ("weather", "kp") else "nasa")
        lock = self.provider_locks[group]
        if not lock.acquire(blocking=False):
            raise ProviderError("busy")
        try:
            current = self.timer()
            ready = max(self.attempts.get(kind, current), self.cooldowns.get(group, current))
            if ready > current:
                raise ProviderError("rate_limit", retry_after=1 + int(ready - current))
            self.attempts[kind] = current + 4
            try:
                return call()
            except ProviderError as error:
                if error.status == "rate_limit":
                    self.cooldowns[group] = self.timer() + (error.retry_after or 60)
                raise
        finally:
            lock.release()

    def get(self, kind, raw):
        if kind not in ("stac", "weather", "kp", "donki"):
            raise ValueError("Consulta ambiental inválida.")
        now = self.clock()
        selection = {}
        try:
            if kind == "stac":
                selection = stac.validate(raw, now)
                fetch = lambda: stac.search(selection, self.transport)
            elif kind == "weather":
                selection = meteomatics.validate(raw, now)
                fetch = lambda: meteomatics.query(selection, self.transport, self.config, now)
            elif kind == "kp":
                fetch = lambda: meteomatics.query(selection, self.transport, self.config, now, space=True)
            else:
                selection = donki.validate(raw, now)
                fetch = lambda: donki.query(selection, self.transport, self.config)
        except ValueError as error:
            return self.envelope(kind, "invalid", message=str(error))
        except ProviderError as error:
            return self.envelope(kind, error.status, message=error.message)
        state = self.initial(kind)
        if state["status"] == "unconfigured":
            return state
        cache = self.cache if selection.get("collection") == "landsat-c2-l2" else None
        cached = cache.get(selection, now) if cache else None
        if cached and cached[1] <= FRESH_SECONDS and raw.get("refresh") is not True:
            result = self.cached(cached, checked_at=None)
        else:
            try:
                payload = self.access(kind, fetch)
                fetched = self.clock()
                result = self.envelope(kind, "connected" if payload["items"] else "empty",
                                       checked_at=iso(fetched), fetched_at=iso(fetched),
                                       classification="external", selection=selection, **payload)
                if cache and payload["items"]:
                    cache.put(selection, result, fetched)
                elif cache:
                    cache.remove(selection)
            except ProviderError as error:
                checked_at = iso(self.clock())
                if cached and error.status in ("offline", "rate_limit", "service_error", "busy", "malformed"):
                    result = self.cached(cached, checked_at=checked_at, upstream=error)
                else:
                    result = self.envelope(kind, error.status, message=error.message,
                                           checked_at=checked_at, retry_after=error.retry_after,
                                           classification="unavailable", selection=selection)
        self.mark(result)
        return result

    def cached(self, cached, *, checked_at, upstream=None):
        previous, age = cached
        return dict(previous, status="cache", message=MESSAGES["cache"], checked_at=checked_at,
                    age_seconds=age, cache_fresh=age <= FRESH_SECONDS,
                    upstream_status=upstream.status if upstream else None,
                    upstream_message=(upstream.message or MESSAGES[upstream.status]) if upstream else None,
                    retry_after=upstream.retry_after if upstream else None)

    def preview(self, raw):
        selection = stac.validate_preview(raw)
        try:
            image = self.access("preview", lambda: stac.preview(selection, self.transport))
        except ProviderError as error:
            result = self.envelope("preview", error.status, message=error.message,
                                   checked_at=iso(self.clock()), retry_after=error.retry_after)
            self.mark(result)
            return result
        self.mark(self.envelope("preview", "connected", checked_at=iso(self.clock())))
        return image

