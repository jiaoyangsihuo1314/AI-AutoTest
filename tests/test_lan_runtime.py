import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend.app import main


class LanRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        main.BROWSER_RUNTIMES.clear()
        main.BROWSER_CAPACITY.active.clear()
        main.BROWSER_CAPACITY.waiting.clear()

    async def asyncTearDown(self):
        for runtime in list(main.BROWSER_RUNTIMES.values()):
            runtime.closed.set()
        main.BROWSER_RUNTIMES.clear()
        main.BROWSER_CAPACITY.active.clear()
        for _, future in main.BROWSER_CAPACITY.waiting:
            if not future.done():
                future.cancel()
        main.BROWSER_CAPACITY.waiting.clear()

    async def test_browser_capacity_queues_eleventh_session_fifo(self):
        runtimes = [
            main.BrowserRuntime(f"lan-session-{index}", f"work-{index}", None, "about:blank", None)
            for index in range(11)
        ]
        main.BROWSER_RUNTIMES.update({runtime.session_id: runtime for runtime in runtimes})
        with (
            patch.dict(os.environ, {"QA_MAX_ACTIVE_BROWSER_SESSIONS": "10"}),
            patch.object(main.platform, "system_memory_percent", return_value=40.0),
        ):
            for runtime in runtimes[:10]:
                self.assertTrue(await main.BROWSER_CAPACITY.reserve(runtime))
            waiting = asyncio.create_task(main.BROWSER_CAPACITY.reserve(runtimes[10]))
            await asyncio.sleep(0)
            self.assertFalse(waiting.done())
            self.assertEqual(main.BROWSER_CAPACITY.queue_position(runtimes[10].session_id), 1)
            await main.BROWSER_CAPACITY.release(runtimes[0].session_id)
            self.assertTrue(await asyncio.wait_for(waiting, timeout=1))
            self.assertIn(runtimes[10].session_id, main.BROWSER_CAPACITY.active)

    async def test_sqlite_uses_wal_and_busy_timeout(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "lan.sqlite"
            try:
                main.init_db()
                with main.get_db() as conn:
                    self.assertEqual(conn.execute("PRAGMA journal_mode").fetchone()[0], "wal")
                    self.assertEqual(conn.execute("PRAGMA busy_timeout").fetchone()[0], 5000)
            finally:
                main.DB_PATH = original_db_path

    async def test_run_preview_paths_are_isolated(self):
        original_artifact_dir = main.ARTIFACT_DIR
        original_screenshot_path = main.SCREENSHOT_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.ARTIFACT_DIR = Path(directory)
            main.SCREENSHOT_PATH = Path(directory) / "browser-preview.svg"
            try:
                main.render_preview("run-a", "running", "执行", 50, ["A"])
                main.render_preview("run-b", "running", "执行", 50, ["B"])
                self.assertTrue(main.run_preview_path("run-a").exists())
                self.assertTrue(main.run_preview_path("run-b").exists())
                self.assertNotEqual(main.run_preview_path("run-a"), main.run_preview_path("run-b"))
            finally:
                main.ARTIFACT_DIR = original_artifact_dir
                main.SCREENSHOT_PATH = original_screenshot_path

    async def test_websocket_origin_accepts_same_host_and_rejects_other_host(self):
        same_host = SimpleNamespace(headers={"origin": "http://192.168.1.50:8001", "host": "192.168.1.50:8001"})
        other_host = SimpleNamespace(headers={"origin": "http://untrusted.example", "host": "192.168.1.50:8001"})
        self.assertTrue(main.websocket_origin_allowed(same_host))
        self.assertFalse(main.websocket_origin_allowed(other_host))


if __name__ == "__main__":
    unittest.main()
