"""Loopback HTTP adapter for the AstroHealth synthetic demonstrator."""
import argparse
import json
import re
import sqlite3
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import parse_qs, urlsplit

from environment.service import Environment
from mission import Mission
from storage import encode

ROOT = Path(__file__).resolve().parent
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/panels.js": ("panels.js", "text/javascript; charset=utf-8"),
    "/ui.js": ("ui.js", "text/javascript; charset=utf-8"),
    "/environment.js": ("environment.js", "text/javascript; charset=utf-8"),
    "/earthrise.webp": ("earthrise.webp", "image/webp"),
}


def make_handler(mission, environment=None):
    climate = environment if environment is not None else Environment(mission.local.parent)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, status, data, content_type="application/json; charset=utf-8", attachment=False):
            payload = data if isinstance(data, bytes) else encode(data).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
            self.send_header("Referrer-Policy", "no-referrer")
            if isinstance(data, dict) and data.get("retry_after"):
                self.send_header("Retry-After", str(data["retry_after"]))
            if attachment:
                self.send_header("Content-Disposition", 'attachment; filename="astrohealth-sintetico.json"')
            self.end_headers()
            self.wfile.write(payload)

        def local_host(self):
            return re.fullmatch(r"(127\.0\.0\.1|localhost)(:\d{1,5})?", self.headers.get("Host", ""))

        def do_GET(self):
            if not self.local_host():
                return self.reply(403, {"error": "Endereço local obrigatório."})
            url = urlsplit(self.path)
            static = STATIC.get(url.path)
            if static:
                name, mime = static
                return self.reply(200, (ROOT / "web" / name).read_bytes(), mime)
            if url.path == "/api/environment/status":
                return self.reply(200, climate.statuses())
            if url.path not in ("/api/state", "/api/export"):
                return self.reply(404, {"error": "Página indisponível."})
            query = parse_qs(url.query)
            try:
                state = mission.view(query.get("crew", ["A12"])[0], query.get("session", [None])[0])
                self.reply(200, state, attachment=url.path == "/api/export")
            except (TypeError, ValueError) as exc:
                self.reply(400, {"error": str(exc)})
            except sqlite3.Error:
                self.reply(503, {"error": "Armazenamento local indisponível."})

        def do_POST(self):
            host = self.headers.get("Host")
            origin = self.headers.get("Origin")
            if not self.local_host() or (origin and origin != "http://" + host):
                return self.reply(403, {"error": "Origem local obrigatória."})
            path = urlsplit(self.path).path
            env_route = re.fullmatch(r"/api/environment/(stac|weather|kp|donki|preview)", path)
            if path != "/api/action" and not env_route:
                return self.reply(404, {"error": "Operação indisponível."})
            if self.headers.get_content_type() != "application/json":
                return self.reply(415, {"error": "Envie JSON."})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 16384:
                    raise ValueError("Tamanho da solicitação inválido.")
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict):
                    raise ValueError("Informe um objeto JSON.")
                if env_route:
                    kind = env_route[1]
                    result = climate.preview(data) if kind == "preview" else climate.get(kind, data)
                    if isinstance(result, tuple):
                        mime, body = result
                        return self.reply(200, body, mime)
                    status = {"invalid": 400, "rate_limit": 429}.get(result["status"], 200)
                    return self.reply(status, result)
                result, status = mission.action(data.get("crew"), data)
                self.reply(status, result)
            except (ValueError, TypeError) as exc:
                self.reply(400, {"error": str(exc)})
            except sqlite3.Error:
                self.reply(503, {"error": "Falha de armazenamento. Gravação local não confirmada."})

    return Handler


def main():
    parser = argparse.ArgumentParser(description="AstroHealth v0.5.1 · demonstrador local")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data")
    parser.add_argument("--open", action="store_true", help="Abre o painel no navegador padrão.")
    args = parser.parse_args()
    mission = Mission(args.data_dir)
    with ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(mission)) as server:
        url = f"http://127.0.0.1:{server.server_port}"
        print(f"AstroHealth: {url}", flush=True)
        if args.open:
            Thread(target=webbrowser.open, args=(url,), daemon=True).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()

