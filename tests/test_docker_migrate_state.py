import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "docker-migrate-state.py"
SPEC = importlib.util.spec_from_file_location("docker_migrate_state", SCRIPT_PATH)
docker_migrate_state = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(docker_migrate_state)


class DockerStateMigrationTests(unittest.TestCase):
    def create_source(self, root: Path, *, unknown_path: str = "") -> Path:
        database = root / "backend" / "automation-platform.sqlite"
        database.parent.mkdir(parents=True)
        with sqlite3.connect(database) as conn:
            conn.executescript(
                """
                CREATE TABLE projects (id TEXT PRIMARY KEY, repository_path TEXT, test_dir TEXT);
                CREATE TABLE runs (id TEXT PRIMARY KEY, report_path TEXT, screenshot_path TEXT);
                CREATE TABLE deliverables (id TEXT PRIMARY KEY, file_path TEXT);
                """
            )
            conn.execute(
                "INSERT INTO projects VALUES (?, ?, ?)",
                ("project-1", "/Users/syj/Documents/qa-project", "tests/e2e"),
            )
            conn.execute(
                "INSERT INTO runs VALUES (?, ?, ?)",
                (
                    "run-1",
                    "artifacts/automation-platform/playwright-reports/runs/run-1/index.html",
                    f"{root.as_posix()}/artifacts/automation-platform/run-previews/run-1.svg",
                ),
            )
            if unknown_path:
                conn.execute("INSERT INTO deliverables VALUES (?, ?)", ("external-1", unknown_path))

        artifacts = root / "artifacts" / "automation-platform"
        artifacts.mkdir(parents=True)
        (artifacts / ".secret-key").write_text("test-secret-key\n", encoding="ascii")
        preview = artifacts / "run-previews" / "run-1.svg"
        preview.parent.mkdir(parents=True)
        preview.write_text("<svg/>\n", encoding="ascii")
        report = root / "playwright-report" / "index.html"
        report.parent.mkdir(parents=True)
        report.write_text("<html></html>\n", encoding="ascii")
        return database

    def test_migration_copies_state_and_rewrites_known_paths(self):
        with tempfile.TemporaryDirectory() as source_directory, tempfile.TemporaryDirectory() as target_parent:
            source = Path(source_directory)
            target = Path(target_parent) / "docker-data"
            database = self.create_source(source)

            report = docker_migrate_state.migrate_state(
                repo_root=source,
                source_db=database,
                destination=target,
            )

            self.assertEqual(report["status"], "ready")
            self.assertTrue(report["secretKeyCopied"])
            self.assertTrue((target / "playwright-report" / "index.html").is_file())
            self.assertTrue((target / "artifacts" / "automation-platform" / "run-previews" / "run-1.svg").is_file())
            with sqlite3.connect(target / "db" / "automation-platform.sqlite") as conn:
                self.assertEqual(conn.execute("SELECT repository_path FROM projects").fetchone()[0], "/app")
                self.assertEqual(
                    conn.execute("SELECT screenshot_path FROM runs").fetchone()[0],
                    "artifacts/automation-platform/run-previews/run-1.svg",
                )
            with sqlite3.connect(database) as conn:
                self.assertEqual(
                    conn.execute("SELECT repository_path FROM projects").fetchone()[0],
                    "/Users/syj/Documents/qa-project",
                )

    def test_unknown_absolute_path_blocks_migration(self):
        with tempfile.TemporaryDirectory() as source_directory, tempfile.TemporaryDirectory() as target_parent:
            source = Path(source_directory)
            target = Path(target_parent) / "docker-data"
            database = self.create_source(source, unknown_path="/external/project/report.html")

            report = docker_migrate_state.migrate_state(
                repo_root=source,
                source_db=database,
                destination=target,
            )

            self.assertEqual(report["status"], "blocked")
            self.assertEqual(report["paths"]["unknownPathCount"], 1)
            saved = json.loads((target / "docker-migration-report.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["paths"]["unknownPaths"][0]["value"], "/external/project/report.html")

    def test_nonempty_destination_is_rejected(self):
        with tempfile.TemporaryDirectory() as source_directory, tempfile.TemporaryDirectory() as target_parent:
            source = Path(source_directory)
            target = Path(target_parent) / "docker-data"
            database = self.create_source(source)
            target.mkdir()
            (target / "existing.txt").write_text("keep\n", encoding="ascii")

            with self.assertRaisesRegex(ValueError, "Destination must be empty"):
                docker_migrate_state.migrate_state(
                    repo_root=source,
                    source_db=database,
                    destination=target,
                )
            self.assertEqual((target / "existing.txt").read_text(encoding="ascii"), "keep\n")

    def test_cli_requires_source_stopped_confirmation(self):
        self.assertEqual(docker_migrate_state.main([]), 2)


if __name__ == "__main__":
    unittest.main()
