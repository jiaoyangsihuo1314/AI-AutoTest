import tempfile
import unittest
from pathlib import Path

from backend.app import main


class DashboardSummaryTests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = main.DB_PATH
        self.tempdir = tempfile.TemporaryDirectory()
        main.DB_PATH = Path(self.tempdir.name) / "dashboard-summary.sqlite"
        main.init_db()

    def tearDown(self):
        main.DB_PATH = self.original_db_path
        self.tempdir.cleanup()

    def test_recent_runs_only_include_latest_suite_runs_for_scope(self):
        with main.get_db() as conn:
            for index in range(10):
                conn.execute(
                    """
                    INSERT INTO suite_runs (
                        id, suite_id, project_id, name, status, progress, total_cases,
                        passed_cases, failed_cases, skipped_cases, started_at, ended_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        f"suite-a-{index:02d}",
                        "suite-a",
                        "project-a",
                        f"Project A Run {index}",
                        "passed",
                        100,
                        6,
                        5,
                        1,
                        0,
                        f"2026-07-{index + 1:02d}T08:00:00+00:00",
                        f"2026-07-{index + 1:02d}T08:05:00+00:00",
                    ),
                )
            conn.execute(
                """
                INSERT INTO suite_runs (
                    id, suite_id, project_id, name, status, progress, total_cases,
                    passed_cases, failed_cases, skipped_cases, started_at, ended_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "suite-b-00",
                    "suite-b",
                    "project-b",
                    "Project B Run",
                    "running",
                    50,
                    4,
                    2,
                    0,
                    0,
                    "2026-07-11T08:00:00+00:00",
                    None,
                ),
            )
            conn.execute(
                """
                INSERT INTO runs (
                    id, suite_id, suite_name, spec, status, stage_key, stage_label,
                    progress, started_at, ended_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "single-newer-than-suites",
                    "single-suite",
                    "Single Run",
                    "tests/e2e/single.spec.ts",
                    "passed",
                    "complete",
                    "完成",
                    100,
                    "2026-07-14T08:00:00+00:00",
                    "2026-07-14T08:01:00+00:00",
                ),
            )

        all_summary = main.dashboard_summary_payload("all")
        self.assertEqual(len(all_summary["recentRuns"]), 8)
        self.assertEqual(all_summary["recentRuns"][0]["id"], "suite-b-00")
        self.assertTrue(all(item["type"] == "suite" for item in all_summary["recentRuns"]))
        self.assertNotIn("single-newer-than-suites", {item["id"] for item in all_summary["recentRuns"]})

        project_summary = main.dashboard_summary_payload("project-a")
        self.assertEqual([item["id"] for item in project_summary["recentRuns"]], [f"suite-a-{index:02d}" for index in range(9, 1, -1)])
        latest = project_summary["recentRuns"][0]
        self.assertEqual(latest["projectId"], "project-a")
        self.assertEqual(latest["totalCases"], 6)
        self.assertEqual(latest["passedCases"], 5)
        self.assertEqual(latest["failedCases"], 1)
        self.assertEqual(latest["skippedCases"], 0)


if __name__ == "__main__":
    unittest.main()
