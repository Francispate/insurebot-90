"""
backend/app/db/database.py
"""

import sqlite3
import os

# Use /data/ on Render, local path otherwise
if os.path.exists("/data"):
    DB_PATH = "/data/database.db"
else:
    DB_PATH = os.path.join(os.path.dirname(__file__), "database.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cur = conn.cursor()

    # Users table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT    NOT NULL,
            email         TEXT    NOT NULL UNIQUE,
            password_hash TEXT    NOT NULL,
            country       TEXT    DEFAULT '',
            role          TEXT    DEFAULT 'user',
            created_at    TEXT    DEFAULT (datetime('now'))
        )
    """)

    # Claims table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS claims (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id               INTEGER NOT NULL,
            claim_type            TEXT,
            description           TEXT,
            incident_date         TEXT,
            location              TEXT,
            amount_estimated      TEXT,
            damage_severity       TEXT,
            affected_parts        TEXT,
            fraud_risk_score      REAL    DEFAULT 0,
            fraud_label           TEXT    DEFAULT 'genuine',
            settlement_predicted  TEXT    DEFAULT 'pending',
            settlement_confidence REAL    DEFAULT 0,
            status                TEXT    DEFAULT 'pending',
            image_path            TEXT,
            created_at            TEXT    DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    # Policies table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS policies (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            filename      TEXT,
            summary       TEXT,
            analysis_json TEXT,
            uploaded_at   TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    # Chat history table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS chat_history (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            session_id TEXT,
            role       TEXT,
            content    TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    conn.commit()
    conn.close()
    print(f"[DB] Initialized at {DB_PATH}")


if __name__ == "__main__":
    init_db()
    print("[DB] All tables created successfully")

    # Quick test
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [row[0] for row in cur.fetchall()]
    print(f"[DB] Tables found: {tables}")
    conn.close()