"""Validation shared by the independent environmental adaptors."""
import math
import re
from datetime import date, datetime, timezone
from urllib.parse import urlsplit

UTC = timezone.utc


def utc_now():
    return datetime.now(UTC)


def iso(value):
    return value.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt.astimezone(UTC).isoformat().replace("+00:00", "Z") if dt.utcoffset() is not None else None
    except (ValueError, OverflowError):
        return None


def number(value):
    if type(value) not in (int, float):
        return None
    try:
        return value if math.isfinite(value) else None
    except OverflowError:
        return None


def coordinate(value, limit):
    try:
        result = number(float(value)) if not isinstance(value, bool) else None
    except (ValueError, TypeError, OverflowError):
        result = None
    if result is None or not -limit <= result <= limit:
        raise ValueError(f"Informe uma coordenada válida entre {-limit} e {limit}.")
    return round(result, 5) or 0


def dates(raw, *, days, today):
    try:
        values = (raw["start"], raw["end"])
        if not all(isinstance(v, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", v) for v in values):
            raise ValueError()
        start, end = map(date.fromisoformat, values)
    except (TypeError, ValueError, KeyError):
        raise ValueError("Informe as duas datas no formato AAAA-MM-DD.") from None
    if start > end or end > today or (end - start).days >= days:
        raise ValueError(f"Use um intervalo de até {days} dias, em ordem e sem datas futuras.")
    return start.isoformat(), end.isoformat()


def text(value, size=200):
    return value.strip()[:size] or None if isinstance(value, str) else None


def object_id(value):
    return isinstance(value, str) and bool(re.fullmatch(r"[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,179}", value))


def https_link(value, hosts):
    if not isinstance(value, str) or len(value) > 2048:
        return None
    try:
        url = urlsplit(value)
        if url.scheme == "https" and url.netloc.lower() in hosts:
            return url
    except ValueError:
        pass
    return None

