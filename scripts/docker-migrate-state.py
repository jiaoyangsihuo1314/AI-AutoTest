#!/usr/bin/env python3
"""Copy the current local state into the Docker bind-mount layout."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
from pathlib import Path, PurePosixPath
from typing import Any, Iterable


DEFAULT_LEGACY_ROOTS = ("/Users/syj/Documents/qa-project",)
COPY_DIRECTORIES = (
    ("artifacts", "artifacts"),
    ("playwright-report", "playwright-report"),
    ("test-results", "test-results"),
    ("tests/e2e/.draft-runs", "draft-runs"),
    ("tests/e2e/.live-runs", "live-runs"),
    ("tests/e2e/.execution-configs", "execution-configs"),
)


def quoted_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def is_path_column(name: str) -> bool:
    return name == "path" or name.endswith("_path")


def normalized_posix_root(value: str | Path) -> str:
    rendered = str(value).replace("\\", "/").rstrip("/")
    return rendered or "/"


def matching_root(value: str, roots: Iterable[str]) -> tuple[str, str] | None:
    normalized = value.replace("\\", "/")
    for root in sorted(set(roots), key=len, reverse=True):
        if normalized == root:
            return root, ""
        prefix = f"{root}/"
        if normalized.startswith(prefix):
            return root, normalized[len(prefix):]
    return None


def rewrite_path(
    value: str,
    *,
    column: str,
    source_roots: Iterable[str],
    container_root: str,
) -> tuple[str, bool, bool]:
    if not value.startswith("/"):
        return value, False, False
    matched = matching_root(value, source_roots)
    if matched is None:
        return value, False, True
    _, relative = matched
    if column == "repository_path":
        rewritten = container_root if not relative else f"{container_root}/{relative}"
    else:
        rewritten = relative or "."
    return str(PurePosixPath(rewritten)), rewritten != value, False


def database_path_columns(conn: sqlite3.Connection) -> list[tuple[str, str]]:
    columns: list[tuple[str, str]] = []
    tables = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    for (table,) in tables:
        table_sql = quoted_identifier(table)
        for row in conn.execute(f"PRAGMA table_info({table_sql})").fetchall():
            column = str(row[1])
            if is_path_column(column):
                columns.append((str(table), column))
    return columns


def rewrite_database_paths(
    database_path: Path,
    *,
    source_roots: Iterable[str],
    container_root: str,
) -> dict[str, Any]:
    rewritten_counts: dict[str, int] = {}
    unknown_paths: list[dict[str, Any]] = []
    with sqlite3.connect(database_path) as conn:
        for table, column in database_path_columns(conn):
            table_sql = quoted_identifier(table)
            column_sql = quoted_identifier(column)
            rows = conn.execute(
                f"SELECT rowid, {column_sql} FROM {table_sql} "
                f"WHERE {column_sql} IS NOT NULL AND TRIM({column_sql}) <> ''"
            ).fetchall()
            changed = 0
            for rowid, raw_value in rows:
                if not isinstance(raw_value, str):
                    continue
                rewritten, did_change, is_unknown = rewrite_path(
                    raw_value,
                    column=column,
                    source_roots=source_roots,
                    container_root=container_root,
                )
                if is_unknown:
                    unknown_paths.append({"table": table, "column": column, "rowid": rowid, "value": raw_value})
                elif did_change:
                    conn.execute(
                        f"UPDATE {table_sql} SET {column_sql} = ? WHERE rowid = ?",
                        (rewritten, rowid),
                    )
                    changed += 1
            if changed:
                rewritten_counts[f"{table}.{column}"] = changed
        conn.commit()
    return {
        "rewrittenCounts": rewritten_counts,
        "rewrittenTotal": sum(rewritten_counts.values()),
        "unknownPaths": unknown_paths,
        "unknownPathCount": len(unknown_paths),
    }


def backup_database(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    source_uri = f"{source.resolve().as_uri()}?mode=ro"
    with sqlite3.connect(source_uri, uri=True) as source_conn:
        with sqlite3.connect(destination) as destination_conn:
            source_conn.backup(destination_conn)


def directory_stats(root: Path) -> dict[str, int]:
    files = 0
    bytes_total = 0
    if not root.exists():
        return {"files": 0, "bytes": 0}
    for current_root, _, names in os.walk(root):
        current = Path(current_root)
        for name in names:
            path = current / name
            files += 1
            try:
                bytes_total += path.lstat().st_size
            except OSError:
                pass
    return {"files": files, "bytes": bytes_total}


def copy_directory(source: Path, destination: Path) -> dict[str, Any]:
    destination.mkdir(parents=True, exist_ok=True)
    if not source.exists():
        return {"source": str(source), "destination": str(destination), "files": 0, "bytes": 0, "missing": True}
    shutil.copytree(source, destination, dirs_exist_ok=True, symlinks=True)
    return {"source": str(source), "destination": str(destination), **directory_stats(destination), "missing": False}


def ensure_empty_destination(destination: Path) -> None:
    if destination.exists() and any(destination.iterdir()):
        raise ValueError(f"Destination must be empty: {destination}")
    destination.mkdir(parents=True, exist_ok=True)


def migrate_state(
    *,
    repo_root: Path,
    source_db: Path,
    destination: Path,
    legacy_roots: Iterable[str] = DEFAULT_LEGACY_ROOTS,
    container_root: str = "/app",
) -> dict[str, Any]:
    requested_repo_root = Path(repo_root).absolute()
    repo_root = repo_root.resolve()
    source_db = source_db.resolve()
    destination = destination.resolve()
    if not source_db.is_file():
        raise FileNotFoundError(f"Source database does not exist: {source_db}")
    ensure_empty_destination(destination)

    source_roots = [normalized_posix_root(requested_repo_root), normalized_posix_root(repo_root)]
    source_roots.extend(normalized_posix_root(root) for root in legacy_roots)
    source_roots = list(dict.fromkeys(source_roots))

    target_db = destination / "db" / "automation-platform.sqlite"
    backup_database(source_db, target_db)
    path_report = rewrite_database_paths(
        target_db,
        source_roots=source_roots,
        container_root=normalized_posix_root(container_root),
    )

    copied = []
    for source_relative, destination_relative in COPY_DIRECTORIES:
        copied.append(copy_directory(repo_root / source_relative, destination / destination_relative))

    secret_key = destination / "artifacts" / "automation-platform" / ".secret-key"
    report = {
        "status": "blocked" if path_report["unknownPathCount"] else "ready",
        "sourceRepo": str(repo_root),
        "sourceDatabase": str(source_db),
        "destination": str(destination),
        "containerRoot": normalized_posix_root(container_root),
        "recognizedSourceRoots": source_roots,
        "database": {
            "sourceBytes": source_db.stat().st_size,
            "destinationBytes": target_db.stat().st_size,
            "destinationPath": str(target_db),
        },
        "paths": path_report,
        "copiedDirectories": copied,
        "copiedFiles": sum(item["files"] for item in copied),
        "copiedBytes": sum(item["bytes"] for item in copied),
        "secretKeyCopied": secret_key.is_file(),
    }
    report_path = destination / "docker-migration-report.json"
    report["reportPath"] = str(report_path)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    default_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=default_root)
    parser.add_argument("--source-db", type=Path)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--legacy-root", action="append", default=[])
    parser.add_argument("--container-root", default="/app")
    parser.add_argument(
        "--confirm-source-stopped",
        action="store_true",
        help="Confirm that native application processes are stopped before copying file artifacts.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.confirm_source_stopped:
        print("Refusing migration without --confirm-source-stopped.", file=sys.stderr)
        return 2
    repo_root = args.repo_root.resolve()
    source_db = (args.source_db or repo_root / "backend" / "automation-platform.sqlite").resolve()
    destination = (args.destination or repo_root / "docker-data").resolve()
    legacy_roots = [*DEFAULT_LEGACY_ROOTS, *args.legacy_root]
    try:
        report = migrate_state(
            repo_root=repo_root,
            source_db=source_db,
            destination=destination,
            legacy_roots=legacy_roots,
            container_root=args.container_root,
        )
    except (FileNotFoundError, OSError, sqlite3.Error, ValueError) as exc:
        print(f"Migration failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["status"] != "ready":
        print("Migration copied the source state but found unknown absolute paths. Review the report before deployment.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
