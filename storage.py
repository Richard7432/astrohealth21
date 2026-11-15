"""SQLite transaction and utility functions evolved from the v0.3 demonstrator."""
import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def encode(payload):
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, allow_nan=False, separators=(",", ":"))


def digest(payload):
    return hashlib.sha256(encode(payload).encode()).hexdigest()


@contextmanager
def connect(path, write=False):
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        with db:
            db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield db
    finally:
        db.close()


def initialize(local, remote):
    with connect(local) as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY, astronaut_id TEXT NOT NULL,
            activity TEXT NOT NULL, phase TEXT NOT NULL, started TEXT NOT NULL, ended TEXT,
            link INTEGER NOT NULL DEFAULT 1, step INTEGER, selected INTEGER NOT NULL DEFAULT 1,
            storage_fault INTEGER NOT NULL DEFAULT 0
        );
        CREATE UNIQUE INDEX IF NOT EXISTS selected_session ON sessions(astronaut_id) WHERE selected=1;
        CREATE TABLE IF NOT EXISTS devices (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
            type TEXT NOT NULL, battery INTEGER NOT NULL, connection TEXT NOT NULL DEFAULT 'online'
        );
        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
            kind TEXT NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS outbox (
            id TEXT PRIMARY KEY REFERENCES events(id), receiver TEXT NOT NULL,
            created TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'waiting',
            attempts INTEGER NOT NULL DEFAULT 0, ack_at TEXT, last_error TEXT
        );
        CREATE TABLE IF NOT EXISTS audit (
            seq INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
            at TEXT NOT NULL, action TEXT NOT NULL, event_id TEXT, detail TEXT NOT NULL
        );
        """)
    with connect(remote) as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS received (
            id TEXT PRIMARY KEY, receiver TEXT NOT NULL, hash TEXT NOT NULL,
            data TEXT NOT NULL, received_at TEXT NOT NULL
        );
        """)

