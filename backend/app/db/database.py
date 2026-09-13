"""
backend/app/db/database.py
Supabase (PostgreSQL) database connection
"""

import os
import psycopg2
import psycopg2.extras

DATABASE_URL = os.getenv("DATABASE_URL")


class DBWrapper:
    """
    Thin wrapper so route files can keep calling db.execute(...).fetchall()
    the same way they did with sqlite3, while running on psycopg2/Postgres
    underneath. Rows come back as dict-like objects (RealDictRow), so
    dict(row) and row["col"] both keep working exactly as before.
    """
    def __init__(self, conn):
        self._conn = conn

    def cursor(self):
        return self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    def execute(self, query, params=None):
        cur = self.cursor()
        cur.execute(query, params or ())
        return cur

    def commit(self):
        self._conn.commit()

    def close(self):
        self._conn.close()


def get_db():
    conn = psycopg2.connect(DATABASE_URL)
    return DBWrapper(conn)


def init_db():
    db = get_db()
    cur = db.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id            SERIAL PRIMARY KEY,
            name          TEXT NOT NULL,
            email         TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            country       TEXT DEFAULT '',
            role          TEXT DEFAULT 'user',
            created_at    TIMESTAMP DEFAULT NOW()
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS claims (
            id                    SERIAL PRIMARY KEY,
            user_id               INTEGER NOT NULL REFERENCES users(id),
            claim_type            TEXT,
            description           TEXT,
            incident_date         TEXT,
            location              TEXT,
            amount_estimated      TEXT,
            damage_severity       TEXT,
            affected_parts        TEXT,
            fraud_risk_score      REAL DEFAULT 0,
            fraud_label           TEXT DEFAULT 'genuine',
            settlement_predicted  TEXT DEFAULT 'pending',
            settlement_confidence REAL DEFAULT 0,
            status                TEXT DEFAULT 'pending',
            image_path            TEXT,
            created_at            TIMESTAMP DEFAULT NOW()
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS policies (
            id            SERIAL PRIMARY KEY,
            user_id       INTEGER NOT NULL REFERENCES users(id),
            filename      TEXT,
            summary       TEXT,
            analysis_json TEXT,
            uploaded_at   TIMESTAMP DEFAULT NOW()
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS chat_history (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id),
            session_id TEXT,
            role       TEXT,
            content    TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)

    db.commit()

    # ---- Seed / ensure default admin account ----
    admin_email = os.getenv("ADMIN_EMAIL")
    admin_password = os.getenv("ADMIN_PASSWORD")
    if admin_email and admin_password:
        from app.auth import hash_password
        cur.execute("SELECT id FROM users WHERE email = %s", (admin_email,))
        existing = cur.fetchone()
        if existing:
            cur.execute(
                "UPDATE users SET role = 'admin', password_hash = %s WHERE email = %s",
                (hash_password(admin_password), admin_email)
            )
        else:
            cur.execute(
                "INSERT INTO users (name, email, password_hash, country, role) VALUES (%s, %s, %s, %s, %s)",
                ("Admin", admin_email, hash_password(admin_password), "", "admin")
            )
        db.commit()
        print(f"[DB] Admin account ensured for {admin_email}")

    db.close()
    print("[DB] Initialized (Supabase/PostgreSQL)")


if __name__ == "__main__":
    init_db()
    print("[DB] All tables created successfully")