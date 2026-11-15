"""Bounded local cache for normalized Landsat metadata."""
import json
import sqlite3
from datetime import datetime

from storage import connect, encode

FRESH_SECONDS = 6 * 3600
RETAIN_SECONDS = 7 * 86400
LIMIT = 96


class Cache:
    def __init__(self, path):
        self.path = path

    def prepare(self, db):
        db.execute("CREATE TABLE IF NOT EXISTS landsat_cache (selection TEXT PRIMARY KEY, fetched REAL, payload TEXT)")

    def key(self, selection):
        return encode({"schema": 1, **selection})

    def get(self, selection, now):
        try:
            with connect(self.path, write=True) as db:
                self.prepare(db)
                db.execute("DELETE FROM landsat_cache WHERE fetched < ?", (now.timestamp() - RETAIN_SECONDS,))
                row = db.execute("SELECT fetched,payload FROM landsat_cache WHERE selection=?", (self.key(selection),)).fetchone()
            if row:
                return json.loads(row["payload"]), max(0, int(now.timestamp() - row["fetched"]))
        except (sqlite3.Error, ValueError):
            return None
        return None

    def put(self, selection, result, now: datetime):
        try:
            with connect(self.path, write=True) as db:
                self.prepare(db)
                db.execute("INSERT OR REPLACE INTO landsat_cache VALUES (?,?,?)",
                           (self.key(selection), now.timestamp(), encode(result)))
                db.execute("DELETE FROM landsat_cache WHERE selection IN (SELECT selection FROM landsat_cache ORDER BY fetched DESC LIMIT -1 OFFSET ?)", (LIMIT,))
        except sqlite3.Error:
            pass

    def remove(self, selection):
        try:
            with connect(self.path, write=True) as db:
                self.prepare(db)
                db.execute("DELETE FROM landsat_cache WHERE selection=?", (self.key(selection),))
        except sqlite3.Error:
            pass

