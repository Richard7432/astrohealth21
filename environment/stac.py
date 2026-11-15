"""Microsoft Planetary Computer public STAC and small, on-demand previews."""
import re
from urllib.parse import parse_qs, quote, urlencode, urlsplit

from .fields import coordinate, dates, https_link, number, object_id, text, timestamp
from .transport import ProviderError

HOST = "planetarycomputer.microsoft.com"
ROOT = "https://" + HOST
STAC = ROOT + "/api/stac/v1"
COLLECTIONS = {
    "landsat-c2-l2": ("Landsat Collection 2 Level-2", "NASA e USGS · processamento USGS",
                      "https://www.usgs.gov/landsat-missions/landsat-collection-2-level-2-science-products"),
    "modis-09A1-061": ("MODIS Surface Reflectance 8-Day (500 m)", "NASA LP DAAC no USGS EROS",
                       "https://lpdaac.usgs.gov/products/mod09a1v061/"),
}
RASTER_EXTENSIONS = {".png", ".jpeg", ".jpg", ".webp"}
RASTER_MIMES = {"image/png", "image/jpeg", "image/webp"}


def validate(raw, now):
    collection = raw.get("collection")
    if not isinstance(collection, str) or collection not in COLLECTIONS:
        raise ValueError("Selecione uma coleção STAC suportada.")
    area = raw.get("bbox")
    if not isinstance(area, list) or len(area) != 4:
        raise ValueError("Informe oeste, sul, leste e norte.")
    west, south, east, north = [coordinate(value, limit) for value, limit in zip(area, (180, 90, 180, 90))]
    if not west < east or not south < north:
        raise ValueError("Oeste deve ser menor que leste e sul menor que norte. Use uma área sem cruzar o antimeridiano.")
    if east - west > 30 or north - south > 30:
        raise ValueError("Use uma região de até 30° de largura por 30° de altura.")
    start, end = dates(raw, days=93, today=now.date())
    return dict(collection=collection, bbox=[west, south, east, north], start=start, end=end)


def validate_preview(raw):
    collection = raw.get("collection")
    item = raw.get("item")
    if not isinstance(collection, str) or collection not in COLLECTIONS or not object_id(item):
        raise ValueError("Coleção ou item STAC inválido.")
    return dict(collection=collection, item=item)


def item_url(collection, item):
    return f"{STAC}/collections/{collection}/items/{quote(item, safe='')}"


def preview_asset(item, collection, item_id):
    assets = item.get("assets")
    if not isinstance(assets, dict):
        return None
    for key in ("rendered_preview", "thumbnail"):
        asset = assets.get(key)
        if not isinstance(asset, dict):
            continue
        url = asset.get("href")
        if not isinstance(url, str) or len(url) > 2048:
            continue
        direct = https_link(url, {HOST})
        if direct and direct.path in ("/api/data/v1/item/preview.png", "/api/data/v1/item/preview.jpeg",
                                      "/api/data/v1/item/preview.jpg", "/api/data/v1/item/preview.webp"):
            params = parse_qs(direct.query)
            if params.get("collection") == [collection] and params.get("item") == [item_id]:
                return url, None
        try:
            blob = urlsplit(url)
            host = re.fullmatch(r"([a-z0-9]{3,24})\.blob\.core\.windows\.net", blob.netloc)
            container = re.match(r"^/([a-z0-9][a-z0-9-]{1,61}[a-z0-9])/", blob.path)
            extension = "." + blob.path.rsplit(".", 1)[-1].lower()
            if blob.scheme == "https" and host and container and extension in RASTER_EXTENSIONS:
                return blob._replace(query="", fragment="").geturl(), (host[1], container[1])
        except ValueError:
            continue
    return None


def normalize_item(item, collection):
    if not isinstance(item, dict) or item.get("collection") != collection or not object_id(item.get("id")):
        raise ProviderError("malformed")
    props = item.get("properties")
    if not isinstance(props, dict):
        raise ProviderError("malformed")
    item_id = item["id"]
    bbox = item.get("bbox")
    valid_bbox = isinstance(bbox, list) and len(bbox) == 4 and all(number(v) is not None for v in bbox)
    instruments = props.get("instruments", [])
    if not isinstance(instruments, list):
        instruments = []
    return dict(
        id=item_id, acquired_at=timestamp(props.get("datetime")),
        start_at=timestamp(props.get("start_datetime")), end_at=timestamp(props.get("end_datetime")),
        bbox=bbox if valid_bbox else None, platform=text(props.get("platform")),
        instruments=" · ".join(filter(None, (text(i, 50) for i in instruments[:8]))) or None,
        resolution_m=number(props.get("gsd")), cloud_percent=number(props.get("eo:cloud_cover")),
        processing=text(props.get("landsat:correction") or props.get("landsat:processing_level") or props.get("processing:level")),
        product=text(props.get("modis:product") or props.get("landsat:product_id") or props.get("landsat:scene_id")),
        link=item_url(collection, item_id), preview=preview_asset(item, collection, item_id) is not None,
    )


def search(selection, transport):
    collection = selection["collection"]
    name, producer, documentation = COLLECTIONS[collection]
    query = urlencode({
        "collections": collection, "bbox": ",".join(map(str, selection["bbox"])),
        "datetime": f"{selection['start']}T00:00:00Z/{selection['end']}T23:59:59.999Z",
        "limit": 8,
    })
    result = transport.json(f"{STAC}/search?{query}")
    if not isinstance(result, dict) or result.get("type") != "FeatureCollection" or not isinstance(result.get("features"), list):
        raise ProviderError("malformed")
    links = result.get("links")
    more = isinstance(links, list) and any(isinstance(link, dict) and link.get("rel") == "next" for link in links)
    return dict(items=[normalize_item(item, collection) for item in result["features"][:8]],
                more=more or len(result["features"]) > 8,
                attribution=producer, platform="Microsoft Planetary Computer · STAC",
                collection_name=name, documentation=documentation, catalogue=f"{ROOT}/dataset/{collection}",
                nominal_resolution_m=500 if collection == "modis-09A1-061" else None)


def signed_url(asset, location, transport):
    account, container = location
    result = transport.json(f"{ROOT}/api/sas/v1/token/{account}/{container}")
    if not isinstance(result, dict):
        raise ProviderError("malformed")
    token = result.get("token")
    if (not isinstance(token, str) or not 1 <= len(token) <= 4096
            or "\n" in token or "\r" in token or not parse_qs(token.lstrip("?")).get("sig")):
        raise ProviderError("malformed", "A origem retornou uma assinatura SAS inválida.")
    return asset + "?" + token.lstrip("?")


def preview(selection, transport):
    collection, item = selection["collection"], selection["item"]
    feature = transport.json(item_url(collection, item))
    if not isinstance(feature, dict) or feature.get("id") != item or feature.get("collection") != collection:
        raise ProviderError("malformed")
    asset = preview_asset(feature, collection, item)
    if asset is None:
        raise ProviderError("empty", "A origem não disponibilizou uma miniatura compatível para esta cena.")
    url, location = asset
    try:
        target = signed_url(url, location, transport) if location else url
        _, mime, content = transport.read(target, {"Accept": "image/png, image/jpeg, image/webp"})
    except ProviderError as error:
        if error.status not in ("denied", "expired"):
            raise
        if location is None:
            raise ProviderError("expired", "A renderização da origem perdeu acesso ao arquivo. Tente novamente.") from None
        try:
            _, mime, content = transport.read(signed_url(url, location, transport), {"Accept": "image/png, image/jpeg, image/webp"})
        except ProviderError as retry:
            if retry.status in ("denied", "expired"):
                raise ProviderError("expired", "A origem recusou a assinatura temporária renovada.") from None
            raise
    if (mime not in RASTER_MIMES or not (content.startswith(b"\x89PNG\r\n\x1a\n")
            or content.startswith(b"\xff\xd8\xff") or (content[:4] == b"RIFF" and content[8:12] == b"WEBP"))):
        raise ProviderError("malformed", "A origem não devolveu uma imagem PNG, JPEG ou WebP válida.")
    return mime, content

