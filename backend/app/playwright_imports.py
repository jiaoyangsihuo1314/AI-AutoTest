"""Pure helpers for validating and discovering uploaded Playwright specs."""

from __future__ import annotations

import json
import hashlib
import os
import re
import subprocess
from pathlib import Path
from typing import Any


MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024
ALLOWED_PLAYWRIGHT_IMPORTS = {"@playwright/test", "playwright/test"}
ENV_NAME_PATTERN = re.compile(r"^[A-Z_][A-Z0-9_]*$")
RESERVED_ENV_NAMES = {
    "PLAYWRIGHT_HTML_OPEN",
    "PWTEST_BLOB_DO_NOT_REMOVE",
    "QA_LIVE_SESSION_ID",
    "QA_TARGET_URL",
}
DEPENDENCY_ANALYZER_PATH = Path(__file__).with_name("playwright_dependency_analyzer.cjs")


def imported_modules(source: str) -> list[str]:
    modules = re.findall(
        r"(?:\bimport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?|\brequire\s*\()"
        r"['\"]([^'\"]+)['\"]",
        source,
    )
    return list(dict.fromkeys(modules))


def unsupported_imports(source: str) -> list[str]:
    return [name for name in imported_modules(source) if name not in ALLOWED_PLAYWRIGHT_IMPORTS]


def required_environment_names(source: str) -> list[str]:
    names = set(re.findall(r"\bprocess\s*\.\s*env\s*\.\s*([A-Z_][A-Z0-9_]*)", source))
    names.update(re.findall(r"\bprocess\s*\.\s*env\s*\[\s*['\"]([A-Z_][A-Z0-9_]*)['\"]\s*\]", source))

    dynamic_functions = set()
    for match in re.finditer(
        r"function\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*:\s*[^{]+\{([\s\S]*?)\n\}",
        source,
    ):
        function_name, parameter, body = match.groups()
        if re.search(rf"\bprocess\s*\.\s*env\s*\[\s*{re.escape(parameter)}\s*\]", body):
            dynamic_functions.add(function_name)
    for function_name in dynamic_functions:
        names.update(
            re.findall(rf"\b{re.escape(function_name)}\s*\(\s*['\"]([A-Z_][A-Z0-9_]*)['\"]", source)
        )
    return sorted(name for name in names if name not in RESERVED_ENV_NAMES)


def flatten_discovered_specs(suites: list[dict[str, Any]], parents: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for suite in suites:
        title = str(suite.get("title") or "").strip()
        next_parents = (*parents, title) if title else parents
        for spec in suite.get("specs") or []:
            spec_title = str(spec.get("title") or "").strip()
            items.append({
                "title": spec_title,
                "fullTitle": " › ".join((*next_parents, spec_title)),
                "file": str(spec.get("file") or suite.get("file") or ""),
                "line": int(spec.get("line") or 0),
                "column": int(spec.get("column") or 0),
            })
        items.extend(flatten_discovered_specs(suite.get("suites") or [], next_parents))
    return items


def discover_playwright_tests(root_dir: Path, spec_path: Path, config_path: Path, timeout: int = 30) -> dict[str, Any]:
    node_modules = str(root_dir / "node_modules")
    node_path = os.pathsep.join(value for value in (node_modules, os.environ.get("NODE_PATH", "")) if value)
    result = subprocess.run(
        ["npx", "playwright", "test", str(spec_path), "--config", str(config_path), "--list", "--reporter=json"],
        cwd=root_dir,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
        env={**os.environ, "NODE_PATH": node_path},
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "Playwright 测试发现失败").strip()
        raise ValueError(detail[-4000:])
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ValueError("Playwright 测试发现未返回有效 JSON") from exc
    errors = payload.get("errors") or []
    if errors:
        messages = [str(item.get("message") or item) if isinstance(item, dict) else str(item) for item in errors]
        raise ValueError("；".join(messages))
    return {
        "playwrightVersion": str((payload.get("config") or {}).get("version") or ""),
        "tests": flatten_discovered_specs(payload.get("suites") or []),
    }


def match_cases_to_tests(
    cases: list[dict[str, str]],
    tests: list[dict[str, Any]],
    *,
    require_complete_coverage: bool = True,
) -> list[dict[str, Any]]:
    bindings: list[dict[str, Any]] = []
    matched_test_indexes: set[int] = set()
    errors: list[str] = []
    for case in cases:
        external_id = case["external_id"]
        pattern = re.compile(rf"(?<![A-Za-z0-9_-]){re.escape(external_id)}(?![A-Za-z0-9_-])", re.IGNORECASE)
        matches = [(index, item) for index, item in enumerate(tests) if pattern.search(str(item.get("title") or ""))]
        if not matches and not require_complete_coverage:
            continue
        if len(matches) != 1:
            errors.append(f"用例 {external_id} 应匹配 1 条测试，实际匹配 {len(matches)} 条")
            continue
        index, test_item = matches[0]
        if index in matched_test_indexes:
            errors.append(f"测试“{test_item['title']}”被多个用例 ID 匹配")
            continue
        matched_test_indexes.add(index)
        bindings.append({
            "externalId": external_id,
            "caseTitle": case["title"],
            "testTitle": test_item["title"],
            "fullTitle": test_item["fullTitle"],
            "grepPattern": rf"(?<![A-Za-z0-9_-]){re.escape(external_id)}(?![A-Za-z0-9_-])",
            "line": test_item["line"],
        })
    if require_complete_coverage:
        for index, test_item in enumerate(tests):
            if index not in matched_test_indexes:
                errors.append(f"测试“{test_item['title']}”未匹配任何 Markdown 用例 ID")
    if errors:
        raise ValueError("；".join(errors))
    return bindings


def analyze_playwright_dependencies(
    source: str,
    tests: list[dict[str, Any]],
    bindings: list[dict[str, Any]],
) -> dict[str, Any]:
    try:
        result = subprocess.run(
            ["node", str(DEPENDENCY_ANALYZER_PATH)],
            input=json.dumps({"source": source}, ensure_ascii=False),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=20,
            check=False,
        )
        if result.returncode != 0:
            raise ValueError((result.stderr or "依赖分析失败").strip())
        ast_analysis = json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError, ValueError) as exc:
        reason = {"code": "analysis-unavailable", "message": f"依赖分析不可用：{exc}", "line": 0}
        all_case_ids = [str(item.get("externalId") or "") for item in bindings if item.get("externalId")]
        all_titles = [str(item.get("testTitle") or "") for item in bindings if item.get("testTitle")]
        return {
            "version": 1,
            "status": "review-required",
            "groups": [{"id": "review-spec", "title": "整个 spec", "externalIds": all_case_ids, "testTitles": all_titles, "reasons": [reason]}],
            "cases": {
                external_id: {
                    "recommendation": "review",
                    "groupId": "review-spec",
                    "externalIds": all_case_ids,
                    "testTitles": all_titles,
                    "reasons": [reason],
                    "manualChoiceRequired": True,
                }
                for external_id in all_case_ids
            },
        }

    flat_scopes: list[dict[str, Any]] = []

    def flatten(scope: dict[str, Any]) -> None:
        flat_scopes.append(scope)
        for child in scope.get("children") or []:
            flatten(child)

    root_scope = ast_analysis.get("scopes") or {}
    flatten(root_scope)
    tests_by_title = {str(item.get("title") or ""): item for item in tests}
    bindings_by_title = {str(item.get("testTitle") or ""): item for item in bindings}
    groups: dict[str, dict[str, Any]] = {}
    cases: dict[str, dict[str, Any]] = {}

    def containing_scopes(line: int, reason_key: str) -> list[dict[str, Any]]:
        matches = [
            scope for scope in flat_scopes
            if int(scope.get("startLine") or 0) <= line <= int(scope.get("endLine") or 0)
            and scope.get(reason_key)
        ]
        return sorted(matches, key=lambda scope: int(scope.get("endLine") or 0) - int(scope.get("startLine") or 0))

    for binding in bindings:
        external_id = str(binding.get("externalId") or "")
        test_title = str(binding.get("testTitle") or "")
        test = tests_by_title.get(test_title) or {}
        line = int(test.get("line") or binding.get("line") or 0)
        hard_scopes = containing_scopes(line, "hardReasons")
        review_scopes = containing_scopes(line, "reviewReasons")
        selected_scope = hard_scopes[0] if hard_scopes else review_scopes[0] if review_scopes else None
        if selected_scope is None:
            cases[external_id] = {
                "recommendation": "single",
                "groupId": "",
                "externalIds": [external_id],
                "testTitles": [test_title],
                "reasons": [],
                "manualChoiceRequired": False,
            }
            continue
        recommendation = "group" if hard_scopes else "review"
        reasons = list(selected_scope.get("hardReasons") or selected_scope.get("reviewReasons") or [])
        scope_tests = [
            item for item in tests
            if int(selected_scope.get("startLine") or 0) <= int(item.get("line") or 0) <= int(selected_scope.get("endLine") or 0)
        ]
        scope_titles = [str(item.get("title") or "") for item in scope_tests]
        scope_external_ids = [
            str(bindings_by_title[title].get("externalId") or "")
            for title in scope_titles
            if title in bindings_by_title
        ]
        fingerprint = json.dumps(
            [selected_scope.get("titlePath") or [], scope_external_ids, [item.get("code") for item in reasons]],
            ensure_ascii=False,
            sort_keys=True,
        )
        group_id = f"dependency-{hashlib.sha256(fingerprint.encode('utf-8')).hexdigest()[:12]}"
        group = {
            "id": group_id,
            "title": " › ".join(selected_scope.get("titlePath") or []) or "整个 spec",
            "externalIds": scope_external_ids,
            "testTitles": scope_titles,
            "reasons": reasons,
            "recommendation": recommendation,
        }
        groups[group_id] = group
        cases[external_id] = {
            "recommendation": recommendation,
            "groupId": group_id,
            "externalIds": scope_external_ids,
            "testTitles": scope_titles,
            "reasons": reasons,
            "manualChoiceRequired": recommendation == "review",
        }
    status = "group-required" if any(item["recommendation"] == "group" for item in cases.values()) else "review-required" if any(item["recommendation"] == "review" for item in cases.values()) else "independent"
    return {"version": 1, "status": status, "groups": list(groups.values()), "cases": cases}
