"""NASA DONKI public events, through CCMC or the NASA Open APIs gateway."""
from urllib.parse import urlencode

from .fields import dates, https_link, number, text, timestamp
from .transport import ProviderError

CCMC = "https://ccmc.gsfc.nasa.gov"
EVENTS = {"FLR": "Erupção solar", "GST": "Tempestade geomagnética", "CME": "Ejeção de massa coronal"}


def configuration(config):
    if config.nasa_source not in ("ccmc", "open-api"):
        return "Selecione NASA_DONKI_SOURCE=ccmc ou open-api no servidor."
    if config.nasa_source == "open-api" and not config.nasa_api_key:
        return "NASA Open APIs não configurada. Defina NASA_API_KEY ou use a rota pública CCMC."
    return None


def validate(raw, now):
    event = raw.get("event")
    if not isinstance(event, str) or event not in EVENTS:
        raise ValueError("Selecione um tipo de evento DONKI.")
    start, end = dates(raw, days=31, today=now.date())
    return dict(event=event, start=start, end=end)


def normalize(row, event, selection):
    if not isinstance(row, dict):
        raise ProviderError("malformed")
    if event == "FLR":
        identifier, at = row.get("flrID"), row.get("beginTime")
    elif event == "GST":
        identifier, at = row.get("gstID"), row.get("startTime")
    else:
        identifier, at = row.get("activityID"), row.get("startTime")
    identifier, at = text(identifier, 100), timestamp(at)
    if not identifier or not at:
        raise ProviderError("malformed")
    entry = https_link(row.get("link"), {"ccmc.gsfc.nasa.gov", "kauai.ccmc.gsfc.nasa.gov"})
    if entry and entry.path.startswith("/DONKI/"):
        link = entry._replace(netloc="ccmc.gsfc.nasa.gov", query="", fragment="").geturl()
    else:
        link = CCMC + "/DONKI/events/?" + urlencode({
            "start": selection["start"] + "T00:00:00Z", "end": selection["end"] + "T23:59:59Z"})
    values = row.get("allKpIndex")
    kp = []
    if isinstance(values, list):
        for point in values[:24]:
            if isinstance(point, dict):
                value, valid = number(point.get("kpIndex")), timestamp(point.get("observedTime"))
                if value is not None and 0 <= value <= 9 and valid:
                    kp.append(dict(value=value, valid_at=valid, source=text(point.get("source"))))
    return dict(id=identifier, at=at, type=EVENTS[event], link=link, class_type=text(row.get("classType")),
                region=text(row.get("sourceLocation")), peak_at=timestamp(row.get("peakTime")),
                ended_at=timestamp(row.get("endTime")), note=text(row.get("note"), 500),
                geomagnetic=kp, submitted_at=timestamp(row.get("submissionTime")))


def query(selection, transport, config):
    message = configuration(config)
    if message:
        raise ProviderError("unconfigured", message)
    event = selection["event"]
    params = {"startDate": selection["start"], "endDate": selection["end"]}
    if config.nasa_source == "open-api":
        base = "https://api.nasa.gov/DONKI"
        params["api_key"] = config.nasa_api_key
        platform = "NASA Open APIs"
    else:
        base = CCMC + "/DONKI-API/get"
        platform = "NASA CCMC · serviço público"
    payload = transport.json(f"{base}/{event}?{urlencode(params)}")
    if not isinstance(payload, list):
        raise ProviderError("malformed")
    items = [normalize(row, event, selection) for row in payload]
    items.sort(key=lambda item: item["at"], reverse=True)
    return dict(items=items[:30], more=len(items) > 30, platform=platform,
                attribution="NASA DONKI · Community Coordinated Modeling Center")

