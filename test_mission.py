"""Integration tests through the local HTTP server with isolated SQLite files."""
import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from mission import Mission
from server import make_handler
from storage import connect
from telemetry import packet


class MissionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.start_server()
        self.addCleanup(self.stop_server)

    def start_server(self):
        self.mission = Mission(self.directory)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.mission))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def get(self, path):
        return self.request(path)[1]

    def request(self, path, body=None):
        headers = {"Content-Type": "application/json"} if body else {}
        request = Request(
            f"http://127.0.0.1:{self.server.server_port}{path}",
            json.dumps(body).encode() if body else None, headers,
        )
        try:
            with urlopen(request, timeout=8) as response:
                return response.status, json.load(response)
        except HTTPError as response:
            with response:
                return response.code, json.load(response)

    def state(self, crew="A12", session=None):
        return self.get("/api/state?crew=" + crew + ("&session=" + session if session else ""))

    def action(self, op, crew="A12", **kwargs):
        return self.request("/api/action", dict(crew=crew, op=op, **kwargs))

    def reading(self, crew="A12"):
        state = self.state(crew)
        device = next(d for d in state["devices"] if d["type"] == "shirt" and d["connection"] != "revoked")
        return packet(state["session"], device, "thermal", 37.16, datetime.now(timezone.utc).isoformat())

    def count_remote(self):
        with connect(self.mission.remote) as db:
            return db.execute("SELECT count(*) FROM received").fetchone()[0]

    def records(self, kind=None):
        return [r for r in self.state()["records"] if not kind or r["kind"] == kind]

    def test_T01_missing_samples_make_explicit_gap(self):
        points = [r for r in self.records() if r.get("metric_code") == "thermal"]
        self.assertEqual(len(points), 18)
        self.assertIsNone(points[10]["value"])
        self.assertIsNone(points[11]["value"])
        self.assertEqual(points[10]["quality"], "disconnected")
        self.assertNotEqual(points[9]["value"], 0)
        self.assertNotEqual(points[12]["value"], 0)

    def test_T02_incompatible_unit_is_rejected(self):
        before = len(self.records())
        code, _ = self.action("ingest", reading={**self.reading(), "unit": "°F"})
        self.assertEqual(code, 422)
        self.assertEqual(len(self.records()), before)
        self.assertIn("Unidade", self.state()["audit"][0]["detail"])

    def test_T03_invalid_timestamp_is_rejected(self):
        raw = self.reading()
        for capture in ("sem fuso", "2026-11-15T00:00:00", "2099-12-01T00:00:00+00:00"):
            with self.subTest(capture=capture):
                code, _ = self.action("ingest", reading={**raw, "captured_at": capture})
                self.assertEqual(code, 422)

    def test_T04_parallel_ingestion_is_isolated(self):
        batch = [("A12" if i % 2 else "B07") for i in range(16)]
        requests = [(crew, self.reading(crew)) for crew in batch]
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda req: self.action("ingest", req[0], reading=req[1]), requests))
        self.assertTrue(all(code == 200 for code, _ in results))
        for crew in ("A12", "B07"):
            visible = {r["event_id"] for r in self.state(crew)["records"]}
            for origin, raw in requests:
                self.assertEqual(raw["event_id"] in visible, origin == crew)

    def test_T05_foreign_device_rejected(self):
        raw = self.reading()
        raw["device_id"] = self.reading("B07")["device_id"]
        code, _ = self.action("ingest", reading=raw)
        self.assertEqual(code, 422)
        self.assertIn("Dispositivo", self.state()["audit"][0]["detail"])

    def test_T06_interruption_keeps_queue(self):
        before = len(self.records())
        self.assertEqual(self.action("sync", mode="interrupt")[0], 200)
        self.assertEqual(self.state()["session"]["link"], 0)
        self.assertEqual(self.count_remote(), 0)
        self.assertEqual(len(self.records()), before)
        self.assertTrue(all(r["state"] == "error" and not r["ack_at"] for r in self.records()))

    def test_T07_lost_ack_retries_without_duplicate(self):
        self.action("sync", mode="lose_ack")
        before = self.count_remote()
        self.assertGreater(before, 0)
        self.assertTrue(all(r["state"] == "sent" and r["attempts"] == 1 for r in self.records()))
        self.action("sync", mode="send")
        self.action("sync", mode="ack")
        self.assertEqual(self.count_remote(), before)
        self.assertTrue(all(r["state"] == "confirmed" and r["attempts"] == 2 for r in self.records()))

    def test_T08_conflicts_preserve_original_content(self):
        raw = self.reading()
        self.assertEqual(self.action("ingest", reading=raw)[0], 200)
        self.assertEqual(self.action("ingest", reading=raw)[0], 200)
        self.assertEqual(self.action("ingest", reading={**raw, "value": 38})[0], 409)
        source = [r for r in self.records() if r["event_id"] == raw["event_id"]]
        self.assertEqual(len(source), 1)
        self.assertEqual(source[0]["value"], raw["value"])
        self.action("sync", mode="remote_conflict")
        self.action("sync", mode="ack")
        self.assertEqual(sum(r["state"] == "conflict" and not r["ack_at"] for r in self.records()), 1)

    def test_T09_restart_preserves_delivery_and_prepared_state(self):
        self.action("sync", mode="send")
        self.action("sync", mode="ack")
        self.action("checkin", label="Dentro do esperado", authorized=True, text="Teste sintético")
        self.action("sync", mode="prepare")
        before = self.records()
        self.stop_server()
        self.start_server()
        self.assertEqual(before, self.records())
        checkin = self.records("checkin")[0]
        self.assertEqual(checkin["state"], "sending")
        self.action("sync", mode="send")
        self.action("sync", mode="ack")
        self.assertEqual(self.records("checkin")[0]["state"], "confirmed")

    def test_T10_storage_failure_makes_no_false_commit(self):
        self.action("storage")
        before = self.records()
        code, result = self.action("checkin", label="Dentro do esperado", authorized=True, text="Falha fictícia")
        self.assertEqual(code, 503)
        self.assertFalse(result["saved"])
        self.assertEqual(before, self.records())
        self.assertEqual("Escrita simulada bloqueada", self.state()["audit"][0]["action"])

    def test_T11_offline_survives_and_authorization_routes_destinations(self):
        self.action("link")
        self.action("checkin", label="Quero revisar a sessão", authorized=True, text="Enlace interrompido")
        self.action("checkin", label="Dentro do esperado", authorized=False, text="Somente local")
        self.action("review", label="Revisão técnica", authorized=True, text="Histórico")
        self.action("sync", mode="send")
        first, second = self.records("checkin")
        self.assertEqual((first["state"], first["receiver"]), ("waiting", "Apoio de bordo"))
        self.assertIsNone(second["state"])
        self.assertEqual(self.records("review")[0]["receiver"], "Controle de missão")
        self.assertEqual(self.count_remote(), 0)

    def test_T12_support_protocol_is_empty(self):
        self.assertIsNone(self.state()["protocol"])
        panel_code = (Path(__file__).parent / "web" / "panels.js").read_text(encoding="utf-8")
        self.assertIn("Protocolo não disponível.", panel_code)

    def test_T13_profile_switch_and_export(self):
        a, b, again = self.state(), self.state("B07"), self.state()
        self.assertNotEqual(a["session"]["id"], b["session"]["id"])
        self.assertEqual(a["records"], again["records"])
        for s, crew in ((a, "A12"), (b, "B07")):
            self.assertTrue(all(r["astronaut_id"] == crew for r in s["records"]))
            self.assertEqual(s["records"], self.get(f"/api/export?crew={crew}")["records"])
        code, _ = self.request("/api/state?crew=B07&session=" + a["session"]["id"])
        self.assertEqual(code, 400)

    def test_T14_confirmation_requires_real_matching_local_receipt(self):
        self.action("sync", mode="prepare")
        self.action("sync", mode="ack")
        self.assertTrue(all(r["state"] == "sending" and not r["ack_at"] for r in self.records()))
        self.action("sync", mode="send")
        self.assertTrue(all(r["state"] == "sent" and not r["ack_at"] for r in self.records()))
        self.action("sync", mode="ack")
        self.assertTrue(all(r["state"] == "confirmed" and r["ack_at"] for r in self.records()))

    def test_T15_disconnect_only_one_insole(self):
        uid = next(d["id"] for d in self.state()["devices"] if d["type"] == "left")
        self.action("device", device=uid, mode="offline")
        last = {r["metric_code"]: r for r in self.records("reading")}
        self.assertIsNone(last["left_force"]["value"])
        self.assertIsNone(last["left_steps"]["value"])
        self.assertEqual(last["left_force"]["quality"], "disconnected")
        self.assertIsNotNone(last["right_force"]["value"])

    def test_guided_run_and_safe_restart(self):
        original = self.state()["session"]["id"]
        code, data = self.action("guide_start")
        self.assertEqual(code, 200)
        new = data["session_id"]
        self.assertNotEqual(new, original)
        for step in range(7):
            self.assertEqual(self.action("guide_next", session_id=new, expected_step=step)[0], 200)
            snapshot = self.state(session=new)
            self.assertEqual(snapshot["session"]["step"], step + 1)
            if step == 3:
                self.assertFalse(snapshot["session"]["link"])
            if step == 4:
                self.assertTrue(all(r["state"] == "sent" for r in snapshot["records"]))
            if step == 5:
                self.assertTrue(all(r["state"] == "confirmed" for r in snapshot["records"]))
        s = self.state(session=new)
        self.assertEqual(s["session"]["phase"], "recuperação")
        thermal = [r for r in s["records"] if r.get("metric_code") == "thermal"]
        self.assertEqual([r["sequence"] for r in thermal if r["value"] is None], [10, 11])
        self.assertEqual(len([r for r in s["records"] if r["kind"] == "checkin"]), 1)
        self.assertEqual(len([r for r in s["records"] if r["kind"] == "review"]), 1)
        self.assertNotEqual(self.action("guide_start")[1]["session_id"], new)
        self.assertEqual(self.state(session=original)["session"]["id"], original)
        self.assertEqual(self.state(session=new)["session"]["step"], 7)

    def test_replace_revokes_old_device(self):
        original = self.reading()
        code, _ = self.action("device", device=original["device_id"], mode="replace")
        self.assertEqual(code, 200)
        updated = self.reading()
        self.assertNotEqual(updated["device_id"], original["device_id"])
        self.assertEqual(self.action("ingest", reading=original)[0], 422)
        self.assertEqual(self.action("ingest", reading=updated)[0], 200)


if __name__ == "__main__":
    unittest.main()

