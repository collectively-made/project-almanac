import asyncio
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


class Database:
    """SQLite connection manager with thread-local connections and async executor."""

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._executor = ThreadPoolExecutor(max_workers=4)
        self._local = threading.local()

    def _get_connection(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn"):
            self._db_path.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(str(self._db_path))
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            # sqlite-vec extension loaded here when available
            self._local.conn = conn
        return self._local.conn

    async def execute(
        self, sql: str, params: tuple = ()
    ) -> list[sqlite3.Row]:
        def _run() -> list[sqlite3.Row]:
            conn = self._get_connection()
            cursor = conn.execute(sql, params)
            conn.commit()
            return cursor.fetchall()

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, _run)

    async def execute_many(
        self, sql: str, params_list: list[tuple]
    ) -> None:
        def _run() -> None:
            conn = self._get_connection()
            conn.executemany(sql, params_list)
            conn.commit()

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(self._executor, _run)

    async def init_schema(self) -> None:
        await self.execute("""
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY
            )
        """)
        await self.execute("""
            CREATE TABLE IF NOT EXISTS content_pack_index (
                pack_id TEXT PRIMARY KEY,
                directory_hash TEXT NOT NULL,
                chunk_count INTEGER NOT NULL DEFAULT 0,
                indexed_at TEXT NOT NULL
            )
        """)

    async def integrity_check(self) -> bool:
        rows = await self.execute("PRAGMA integrity_check")
        return len(rows) == 1 and rows[0][0] == "ok"

    def checkpoint_and_close(self) -> None:
        """WAL checkpoint and close — call during graceful shutdown."""
        if hasattr(self._local, "conn"):
            try:
                self._local.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                self._local.conn.close()
            except Exception:
                pass
            finally:
                del self._local.conn

    def close_all(self) -> None:
        self._executor.shutdown(wait=True)
