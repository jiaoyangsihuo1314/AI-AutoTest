"""Application logging helpers with conservative context sanitization."""

from __future__ import annotations

import logging
import os
import re
import sys
import urllib.parse
from pathlib import Path
from typing import Any

LOGGER_NAME = "qa_platform"
DEFAULT_LOG_LEVEL = "INFO"
MAX_FIELD_LENGTH = 300

_SENSITIVE_KEY_PARTS = {
    "api_key",
    "authorization",
    "cookie",
    "credential",
    "password",
    "prompt",
    "requirement",
    "response_body",
    "script_content",
    "secret",
    "session_token",
    "test_data",
    "token",
}


class RedactingFormatter(logging.Formatter):
    def formatException(self, exc_info: Any) -> str:
        return _redact_value(super().formatException(exc_info))


def _configured_level() -> int:
    level_name = os.environ.get("QA_LOG_LEVEL", DEFAULT_LOG_LEVEL).strip().upper()
    return {
        "DEBUG": logging.DEBUG,
        "INFO": logging.INFO,
        "WARNING": logging.WARNING,
        "ERROR": logging.ERROR,
    }.get(level_name, logging.INFO)


def configure_logging() -> logging.Logger:
    """Configure the application logger once and return it."""
    logger = logging.getLogger(LOGGER_NAME)
    logger.setLevel(_configured_level())
    logger.propagate = False
    if not any(getattr(handler, "_qa_platform_handler", False) for handler in logger.handlers):
        handler = logging.StreamHandler(sys.stderr)
        handler._qa_platform_handler = True  # type: ignore[attr-defined]
        handler.setFormatter(
            RedactingFormatter(
                fmt="%(asctime)s %(levelname)s %(name)s %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
        )
        logger.addHandler(handler)
    return logger


def get_logger(component: str = "business") -> logging.Logger:
    configure_logging()
    return logging.getLogger(f"{LOGGER_NAME}.{component}")


def _is_sensitive_key(key: str) -> bool:
    normalized = key.lower().replace("-", "_")
    return any(part in normalized for part in _SENSITIVE_KEY_PARTS)


def _safe_url(value: Any, *, hostname_only: bool) -> str:
    parsed = urllib.parse.urlparse(str(value))
    if not parsed.hostname:
        return "[invalid-url]"
    hostname = parsed.hostname
    try:
        port = parsed.port
    except ValueError:
        port = None
    if port:
        hostname = f"{hostname}:{port}"
    if hostname_only:
        return hostname
    scheme = parsed.scheme or "http"
    path = parsed.path or ""
    return f"{scheme}://{hostname}{path}"


def _redact_value(value: str) -> str:
    value = re.sub(r"(?i)\bbearer\s+[^\s,;|]+", "Bearer [REDACTED]", value)
    value = re.sub(r"\bsk-[A-Za-z0-9_-]{8,}\b", "[REDACTED]", value)
    return re.sub(
        r"(?i)\b(password|passwd|pwd|api[_-]?key|authorization|cookie|token|secret)\b\s*(?:=|:|\s)\s*[^\s,;|]+",
        lambda match: f"{match.group(1)}=[REDACTED]",
        value,
    )


def sanitize_log_context(context: dict[str, Any]) -> dict[str, str]:
    """Return single-line, bounded values suitable for terminal logs."""
    sanitized: dict[str, str] = {}
    for key, value in context.items():
        if value is None or value == "":
            continue
        if _is_sensitive_key(key):
            sanitized[key] = "[REDACTED]"
            continue
        if key.lower() in {"base_url", "endpoint_url"}:
            rendered = _safe_url(value, hostname_only=True)
        elif key.lower().endswith("url"):
            rendered = _safe_url(value, hostname_only=False)
        elif isinstance(value, Path):
            rendered = str(value)
        elif isinstance(value, bool):
            rendered = str(value).lower()
        else:
            rendered = str(value)
        rendered = _redact_value(" ".join(rendered.split()))
        if len(rendered) > MAX_FIELD_LENGTH:
            rendered = f"{rendered[:MAX_FIELD_LENGTH]}..."
        sanitized[key] = rendered
    return sanitized


def log_event(
    level: int,
    event: str,
    *,
    component: str = "business",
    message: str = "",
    exc_info: bool = False,
    **context: Any,
) -> None:
    logger = get_logger(component)
    fields = sanitize_log_context(context)
    parts = [f"event={event}"]
    if message:
        safe_message = sanitize_log_context({"message": message}).get("message", "")
        if safe_message:
            parts.append(f"message={safe_message}")
    parts.extend(f"{key}={fields[key]}" for key in sorted(fields))
    logger.log(level, " | ".join(parts), exc_info=exc_info)


configure_logging()
