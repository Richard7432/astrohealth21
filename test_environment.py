"""Fixture tests for providers, plus a loopback HTTP regression. No external calls."""
import json
import tempfile
import threading
import unittest
from collections import deque
from datetime import datetime, timedelta, timezone
from email.message import Message
from http.server import ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen

from environment.config import Config
from environment.service import Environment
from environment.transport import ProviderError, Transport, cooldown
from mission import Mission
from server import make_handler

NOW = datetime(2026, 11, 15, 12, tzinfo=timezone.utc)
STAC = dict(collection="landsat-c2-l2", bbox=[-9.32, 38.65, -9, 38.87], start="2024-06-01", end="2024-06-30")
WEATHER = dict(lat=38.72, lon=-9.14, model="mix", horizon="6")
DONKI = dict(event="FLR", start="2024-05-10", end="2024-05-11")
AUTH = dict(meteomatics_username="fixture-account", meteomatics_password="fixture-password")
ITEM = "FAKE_LANDSAT_TEST_ONLY"
PNG = b"\x89PNG\r\n\x1a\nfixture-only"


def feature(collection="landsat-c2-l2", assets=None):
    return {
        "type": "Feature", "id": ITEM, "collection": collection,
        "bbox": STAC["bbox"], "properties": {
            "datetime": "2024-06-10T10:30:00Z", "platform": "landsat-9", "instruments": ["oli", "tirs"],
            "gsd": 30, "eo:cloud_cover": 7, "landsat:processing_level": "L2SP",
        }, "assets": assets if assets is not None else {
            "rendered_preview": {"href": "https://planetarycomputer.microsoft.com/api/data/v1/item/preview.png?"
                                f"collection={collection}&item={ITEM}"},
        },
    }


def collection(*features):
    return {"type": "FeatureCollection", "features": list(features), "links": []}


def weather(parameter="t_2m:C", when="2026-11-15T11:00:00Z", value=19.5):
    return {
        "status": "OK", "dateGenerated": "2026-11-15T11:59:00Z", "user": "fixture-account",
        "data": [{"parameter": parameter, "coordinates": [
            {"lat": 38.72, "lon": -9.14, "dates": [{"date": when, "value": value}]}]}],
    }


class FixtureTransport:
    def __init__(self, *responses):
        self.responses = deque(responses)
        self.requests = []

    def handle(self, operation, url, headers):
        self.requests.append((operation, url, headers or {}))
        result = self.responses.popleft()
        if isinstance(result, ProviderError):
            raise result
        return result

    def json(self, url, headers=None):
        return self.handle("json", url, headers)

    def read(self, url, headers=None):
        return self.handle("read", url, headers)


class TransportTests(unittest.TestCase):
    @patch("environment.transport.build_opener")
    def test_network_and_http_errors_hide_upstream_details(self, opener):
        url = "https://fixture.invalid/resource?api_key=fixture-secret"
        headers = Message()
        headers["Retry-After"] = "73"
        for failure, code, delay in (
            (URLError("socket blocked with fixture-secret"), "offline", None),
            (HTTPError(url, 401, "unauthorized", headers, BytesIO(b"fixture-secret")), "denied", None),
            (HTTPError(url, 429, "rate limit", headers, BytesIO(b"fixture-secret")), "rate_limit", 73),
        ):
            with self.subTest(code=code):
                opener.return_value.open.side_effect = failure
                with self.assertRaises(ProviderError) as error:
                    Transport().json(url)
                self.assertEqual((error.exception.status, error.exception.retry_after), (code, delay))
                self.assertNotIn("fixture-secret", str(error.exception))

    @patch.object(Transport, "read")
    def test_json_format_geojson_and_corrupt_body(self, read):
        url = "https://fixture.invalid"
        read.return_value = (200, "application/geo+json", b'{"type":"FeatureCollection","features":[]}')
        self.assertEqual(Transport().json(url)["features"], [])
        for mime, body in (("text/html", b"{}"), ("application/json", b"{"), ("application/json", b'{"value":NaN}')):
            with self.subTest(mime=mime, body=body):
                read.return_value = (200, mime, body)
                with self.assertRaises(ProviderError) as error:
                    Transport().json(url)
                self.assertEqual(error.exception.status, "malformed")


class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        self.now = NOW
        self.mono = 100.0

    def advance(self, seconds):
        self.now += timedelta(seconds=seconds)
        self.mono += seconds

    def environment(self, *fixtures, **config):
        self.transport = FixtureTransport(*fixtures)
        return Environment(self.directory, config=Config(**config), transport=self.transport,
                           clock=lambda: self.now, timer=lambda: self.mono)

    def test_stac_query_normalization_and_attribution(self):
        env = self.environment(collection(feature()))
        result = env.get("stac", STAC)
        self.assertEqual(result["status"], "connected")
        self.assertEqual(result["classification"], "external")
        self.assertEqual(result["attribution"], "NASA e USGS · processamento USGS")
        item = result["items"][0]
        self.assertEqual((item["id"], item["resolution_m"], item["cloud_percent"]), (ITEM, 30, 7))
        self.assertNotEqual(item["acquired_at"], result["fetched_at"])
        self.assertTrue(item["preview"])
        request = urlsplit(self.transport.requests[0][1])
        self.assertEqual(request.netloc, "planetarycomputer.microsoft.com")
        query = parse_qs(request.query)
        self.assertEqual(query["limit"], ["8"])
        self.assertEqual(query["bbox"], ["-9.32,38.65,-9.0,38.87"])
        self.assertEqual(query["datetime"], ["2024-06-01T00:00:00Z/2024-06-30T23:59:59.999Z"])

    def test_stac_invalid_interval_region_and_collection(self):
        env = self.environment()
        for filters in (
            {"bbox": [170, 38, -170, 39]}, {"bbox": [True, 0, 1, 1]}, {"bbox": ["NaN", 0, 1, 1]},
            {"start": "2024-12-01"}, {"end": "2027-01-01"}, {"collection": "https://example.org/"},
        ):
            with self.subTest(filters=filters):
                self.assertEqual(env.get("stac", dict(STAC, **filters))["status"], "invalid")
        self.assertEqual(self.transport.requests, [])
        self.assertEqual(env.statuses()["services"]["stac"]["status"], "untested")

    def test_stac_legit_empty_and_unexpected_json(self):
        env = self.environment(collection(), {"features": "invalid"})
        self.assertEqual(env.get("stac", STAC)["status"], "empty")
        self.advance(5)
        self.assertEqual(env.get("stac", STAC)["status"], "malformed")

    def test_stac_offline_without_cache(self):
        env = self.environment(ProviderError("offline"))
        result = env.get("stac", STAC)
        self.assertEqual(result["status"], "offline")
        self.assertEqual(result["classification"], "unavailable")
        self.assertNotIn("items", result)

    def test_cache_survives_restart_and_marks_stale(self):
        env = self.environment(collection(feature()))
        valid = env.get("stac", STAC)
        self.advance(300)
        env = self.environment()
        fresh = env.get("stac", STAC)
        self.assertEqual((fresh["status"], fresh["age_seconds"]), ("cache", 300))
        self.assertEqual(fresh["fetched_at"], valid["fetched_at"])
        self.assertEqual(self.transport.requests, [])
        self.advance(7 * 3600)
        env = self.environment(ProviderError("offline"))
        stale = env.get("stac", STAC)
        self.assertEqual((stale["status"], stale["upstream_status"]), ("cache", "offline"))
        self.assertFalse(stale["cache_fresh"])
        self.advance(8 * 86400)
        env = self.environment(ProviderError("offline"))
        self.assertEqual(env.get("stac", STAC)["status"], "offline")

    def test_cache_is_selection_specific_and_successful_empty_replaces_old(self):
        env = self.environment(collection(feature()), ProviderError("offline"), collection())
        self.assertEqual(env.get("stac", STAC)["status"], "connected")
        self.advance(5)
        self.assertEqual(env.get("stac", dict(STAC, start="2024-06-02"))["status"], "offline")
        self.advance(5)
        self.assertEqual(env.get("stac", dict(STAC, refresh=True))["status"], "empty")
        env = self.environment(ProviderError("offline"))
        self.assertEqual(env.get("stac", STAC)["status"], "offline")

    def test_modis_attribution_does_not_use_landsat_cache(self):
        name = "modis-09A1-061"
        selection = dict(STAC, collection=name)
        env = self.environment(collection(feature(name)))
        result = env.get("stac", selection)
        self.assertIn("NASA LP DAAC", result["attribution"])
        self.assertFalse((self.directory / "environment-cache.sqlite").exists())

    def test_preview_uses_catalog_link_not_client_url(self):
        env = self.environment(feature(), (200, "image/png", PNG))
        result = env.preview(dict(collection=STAC["collection"], item=ITEM, url="https://fixture.invalid/"))
        self.assertEqual(result, ("image/png", PNG))
        self.assertEqual(self.transport.requests[1][0], "read")
        self.assertIn("/api/data/v1/item/preview.png?", self.transport.requests[1][1])
        self.assertFalse(any("fixture.invalid" in req[1] for req in self.transport.requests))

    def test_preview_refreshes_an_expired_sas_without_returning_token(self):
        asset = {"thumbnail": {"href": "https://landsatfixture.blob.core.windows.net/preview/scene.jpg"}}
        env = self.environment(feature(assets=asset), {"token": "sig=old"}, ProviderError("denied"),
                               {"token": "sig=new"}, (200, "image/jpeg", b"\xff\xd8\xfffixture"))
        mime, content = env.preview(dict(collection=STAC["collection"], item=ITEM))
        self.assertEqual(mime, "image/jpeg")
        self.assertNotIn(b"sig=", content)
        self.assertIn("/api/sas/v1/token/landsatfixture/preview", self.transport.requests[3][1])
        self.assertTrue(self.transport.requests[4][1].endswith("?sig=new"))
        self.assertNotIn("sig=", json.dumps(env.statuses()))

    def test_preview_rejects_unsupported_assets_and_reports_failed_renewal(self):
        env = self.environment(feature(assets={"thumbnail": {"href": "https://fixture.invalid/image.png"}}))
        self.assertEqual(env.preview(dict(collection=STAC["collection"], item=ITEM))["status"], "empty")
        asset = {"thumbnail": {"href": "https://landsatfixture.blob.core.windows.net/preview/scene.jpg"}}
        env = self.environment(feature(assets=asset), {"token": "sig=old"}, ProviderError("denied"),
                               {"token": "sig=new"}, ProviderError("denied"))
        self.assertEqual(env.preview(dict(collection=STAC["collection"], item=ITEM))["status"], "expired")

    def test_missing_meteomatics_credentials_are_reported(self):
        env = self.environment()
        for kind, filters in (("weather", WEATHER), ("kp", {})):
            result = env.get(kind, filters)
            self.assertEqual(result["status"], "unconfigured")
            self.assertEqual(result["message"], "Meteomatics não configurada.")
        self.assertEqual(self.transport.requests, [])

    def test_meteomatics_denied_does_not_expose_credentials(self):
        env = self.environment(ProviderError("denied"), **AUTH)
        self.assertEqual(env.get("weather", WEATHER)["status"], "denied")
        self.assertTrue(self.transport.requests[0][2]["Authorization"].startswith("Basic "))
        self.assertNotIn("fixture", json.dumps(env.statuses()))

    def test_weather_valid_time_staleness_and_source(self):
        env = self.environment(weather(when="2026-11-15T09:30:00Z"), **AUTH)
        result = env.get("weather", WEATHER)
        self.assertEqual(result["items"][0]["update"], "Valor anterior · desatualizado")
        self.assertEqual(result["items"][0]["valid_at"], "2026-11-15T09:30:00Z")
        self.assertIsNone(result["items"][0]["kind"])
        self.assertIn("2026-11-15T18:00:00Z", self.transport.requests[0][1])
        self.assertEqual(result["requested_model"], "mix")
        self.assertNotIn("fixture-account", json.dumps(result))

    def test_euro1k_outside_and_forecast_inside(self):
        env = self.environment(weather(when="2026-11-15T18:00:00Z"), **AUTH)
        outside = dict(WEATHER, lat=-23.55, lon=-46.63, model="mm-euro1k")
        self.assertEqual(env.get("weather", outside)["status"], "coverage")
        self.assertFalse(self.transport.requests)
        result = env.get("weather", dict(WEATHER, model="mm-euro1k"))
        self.assertEqual(result["items"][0]["kind"], "Previsão de modelo regional")
        self.assertTrue(self.transport.requests[0][1].endswith("source=mm-euro1k"))

    def test_kp_uses_noaa_source_and_times_without_crew_location(self):
        env = self.environment(weather("kp:idx", value=3), **AUTH)
        result = env.get("kp", {"lat": -23.55, "lon": -46.63})
        self.assertEqual(result["attribution"], "NOAA Space Weather Prediction Center")
        self.assertEqual(result["requested_model"], "noaa-swpc")
        self.assertIn("/kp:idx/0.00,0.00/json", self.transport.requests[0][1])
        self.assertNotIn("-23.55", self.transport.requests[0][1])

    def test_rate_limit_is_shared_per_provider_and_recovers(self):
        env = self.environment(ProviderError("rate_limit", retry_after=52), weather("kp:idx", value=2), **AUTH)
        self.assertEqual(env.get("weather", WEATHER)["status"], "rate_limit")
        self.advance(20)
        self.assertEqual(env.get("kp", {})["status"], "rate_limit")
        self.assertEqual(len(self.transport.requests), 1)
        self.advance(33)
        self.assertEqual(env.get("kp", {})["status"], "connected")
        self.assertEqual(cooldown("not a header"), 60)
        self.assertEqual(cooldown("100000"), 86400)

    def test_donki_empty_is_a_successful_public_query(self):
        env = self.environment([])
        result = env.get("donki", DONKI)
        self.assertEqual(result["status"], "empty")
        self.assertEqual(result["items"], [])
        href = urlsplit(self.transport.requests[0][1])
        self.assertEqual(href.netloc, "ccmc.gsfc.nasa.gov")
        self.assertEqual(href.path, "/DONKI-API/get/FLR")

    def test_donki_key_only_used_upstream_and_link_is_official(self):
        row = {"flrID": "FIXTURE-NOT-REAL", "beginTime": "2024-05-10T01:39Z", "classType": "X1.0",
               "link": "https://kauai.ccmc.gsfc.nasa.gov/DONKI/view/Flare/123/1?private=ignore"}
        env = self.environment([row], nasa_source="open-api", nasa_api_key="fixture-nasa-key")
        result = env.get("donki", DONKI)
        self.assertIn("api_key=fixture-nasa-key", self.transport.requests[0][1])
        self.assertNotIn("fixture-nasa-key", json.dumps(result))
        self.assertEqual(result["items"][0]["link"], "https://ccmc.gsfc.nasa.gov/DONKI/view/Flare/123/1")
        env = self.environment(nasa_source="open-api")
        self.assertEqual(env.get("donki", DONKI)["status"], "unconfigured")

    def test_malformed_providers_remain_independent(self):
        env = self.environment({"unexpected": "STAC"}, [], {"status": "OK", "data": []}, **AUTH)
        self.assertEqual(env.get("stac", STAC)["status"], "malformed")
        self.assertEqual(env.get("donki", DONKI)["status"], "empty")
        self.assertEqual(env.get("weather", WEATHER)["status"], "empty")

    def test_loopback_routes_and_mission_work_after_outage(self):
        env = self.environment(ProviderError("offline"))
        mission = Mission(self.directory)
        with ThreadingHTTPServer(("127.0.0.1", 0), make_handler(mission, env)) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                base = f"http://127.0.0.1:{server.server_port}"
                def get(path, data=None):
                    request = Request(base + path, json.dumps(data).encode() if data else None,
                                      {"Content-Type":"application/json"} if data else {})
                    with urlopen(request, timeout=5) as response:
                        return json.load(response)
                self.assertEqual(get("/api/environment/status")["services"]["kp"]["status"], "unconfigured")
                self.assertEqual(get("/api/environment/stac", STAC)["status"], "offline")
                started = get("/api/action", {"op":"guide_start", "crew":"A12"})
                self.assertTrue(started["saved"])
                self.assertEqual(get("/api/state")["session"]["step"], 0)
            finally:
                server.shutdown()
                thread.join()


if __name__ == "__main__":
    unittest.main()

