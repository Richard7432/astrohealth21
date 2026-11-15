"""Server-side Meteomatics Weather API, including NOAA Kp through Meteomatics."""
from base64 import b64encode
from datetime import datetime, timedelta
from urllib.parse import urlencode

from .fields import coordinate, iso, number, text, timestamp
from .transport import ProviderError

ROOT = "https://api.meteomatics.com"
WEATHER = {
    "t_2m:C": ("Temperatura do ar", "°C"),
    "relative_humidity_2m:p": ("Umidade relativa", "%"),
    "msl_pressure:hPa": ("Pressão ao nível do mar", "hPa"),
    "wind_speed_10m:ms": ("Velocidade do vento a 10 m", "m/s"),
    "wind_dir_10m:d": ("Direção do vento a 10 m", "°"),
    "precip_1h:mm": ("Precipitação em 1 h", "mm"),
    "total_cloud_cover:p": ("Cobertura de nuvens", "%"),
}
KP = {"kp:idx": ("Índice planetário Kp", "índice 0–9")}
MODELS = {"mix": "Meteomatics Mix", "mm-euro1k": "EURO1k · Meteomatics"}


def configured(config):
    return bool(config.meteomatics_username and config.meteomatics_password)


def validate(raw, _now):
    lat, lon = coordinate(raw.get("lat"), 90), coordinate(raw.get("lon"), 180)
    model = raw.get("model")
    if not isinstance(model, str) or model not in MODELS:
        raise ValueError("Selecione um modelo disponível no painel.")
    horizon = raw.get("horizon", "0")
    if horizon not in ("0", "6", "24"):
        raise ValueError("Escolha agora, +6 h ou +24 h.")
    if model == "mm-euro1k" and not (24 <= lat <= 73 and -32 <= lon <= 50):
        raise ProviderError("coverage", "O ponto está fora da área regional aproximada do EURO1k. Selecione outro modelo manualmente.")
    return dict(lat=lat, lon=lon, model=model, horizon=int(horizon))


def authorization(config):
    if not configured(config):
        raise ProviderError("unconfigured", "Meteomatics não configurada.")
    secret = f"{config.meteomatics_username}:{config.meteomatics_password}"
    return {"Authorization": "Basic " + b64encode(secret.encode()).decode("ascii")}


def normalize(payload, parameters, now, expected_model, *, stale_hours):
    if not isinstance(payload, dict) or payload.get("status") != "OK" or not isinstance(payload.get("data"), list):
        raise ProviderError("malformed")
    items = []
    seen = set()
    reported_model = text(payload.get("model") or payload.get("source"), 80)
    if expected_model == "mm-euro1k" and reported_model and reported_model.lower() not in ("mm-euro1k", "euro1k"):
        raise ProviderError("service_error", "A resposta identificou um modelo diferente do EURO1k solicitado.")
    for dataset in payload["data"]:
        if not isinstance(dataset, dict) or not isinstance(dataset.get("parameter"), str):
            raise ProviderError("malformed")
        parameter = dataset["parameter"]
        if parameter not in parameters:
            continue
        coordinates = dataset.get("coordinates")
        if not isinstance(coordinates, list) or (coordinates and not isinstance(coordinates[0], dict)):
            raise ProviderError("malformed")
        if not coordinates:
            continue
        points = coordinates[0].get("dates")
        if not isinstance(points, list):
            raise ProviderError("malformed")
        for row in points[:1]:
            if not isinstance(row, dict):
                raise ProviderError("malformed")
            value, valid = number(row.get("value")), timestamp(row.get("date"))
            if value is None or value == -999:
                continue
            if not valid:
                raise ProviderError("malformed", "O provedor devolveu um valor sem horário válido.")
            if parameter in seen:
                raise ProviderError("malformed")
            seen.add(parameter)
            if parameter == "kp:idx" and not 0 <= value <= 9:
                raise ProviderError("malformed")
            label, unit = parameters[parameter]
            age = (now - datetime.fromisoformat(valid.replace("Z", "+00:00"))).total_seconds()
            kind = text(row.get("dataType") or payload.get("dataType"), 80)
            kind = {"observation":"Observação", "observed":"Observação", "forecast":"Previsão",
                    "analysis":"Análise"}.get((kind or "").lower())
            if expected_model == "mm-euro1k":
                kind = "Previsão de modelo regional"
            items.append(dict(parameter=parameter, label=label, unit=unit, value=value, valid_at=valid,
                              kind=kind, update="Validade futura" if age < 0 else
                              "Valor anterior · desatualizado" if age > stale_hours * 3600 else
                              "Dentro da janela de validade usada pelo painel"))
    return dict(items=items, reported_model=reported_model, missing=[parameters[p][0] for p in parameters if p not in seen],
                generated_at=timestamp(payload.get("dateGenerated")),
                initialized_at=timestamp(payload.get("dateInitialized") or payload.get("initDate")))


def query(selection, transport, config, now, *, space=False):
    headers = authorization(config)
    if space:
        requested = now.replace(hour=now.hour - now.hour % 3, minute=0, second=0, microsecond=0)
        model, location, parameters = "noaa-swpc", "0.00,0.00", KP
    else:
        requested = now.replace(minute=now.minute - now.minute % 15, second=0, microsecond=0) + timedelta(hours=selection["horizon"])
        model, location, parameters = selection["model"], f"{selection['lat']},{selection['lon']}", WEATHER
    url = f"{ROOT}/{iso(requested)}/{','.join(parameters)}/{location}/json?{urlencode({'source': model})}"
    result = normalize(transport.json(url, headers), parameters, now, model, stale_hours=4 if space else 1)
    return dict(**result, requested_at=iso(requested), requested_model=model, platform="Meteomatics Weather API",
                attribution="NOAA Space Weather Prediction Center" if space else MODELS[model])

