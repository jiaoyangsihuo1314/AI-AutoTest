"""Small encrypted value store used by per-environment runtime variables."""

from __future__ import annotations

import base64
import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken


def _normalized_key(raw: str) -> bytes:
    value = raw.strip().encode("ascii")
    try:
        decoded = base64.urlsafe_b64decode(value)
    except Exception as exc:  # pragma: no cover - defensive validation
        raise RuntimeError("QA_SECRET_KEY 必须是有效的 urlsafe base64 Fernet 密钥") from exc
    if len(decoded) != 32:
        raise RuntimeError("QA_SECRET_KEY 解码后必须为 32 字节")
    return value


def load_or_create_key(key_path: Path) -> bytes:
    configured = os.environ.get("QA_SECRET_KEY", "")
    if configured:
        return _normalized_key(configured)
    key_path.parent.mkdir(parents=True, exist_ok=True)
    if key_path.exists():
        return _normalized_key(key_path.read_text(encoding="ascii"))
    key = Fernet.generate_key()
    key_path.write_text(key.decode("ascii"), encoding="ascii")
    key_path.chmod(0o600)
    return key


def encrypt_value(value: str, key_path: Path) -> str:
    return Fernet(load_or_create_key(key_path)).encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_value(value: str, key_path: Path) -> str:
    try:
        return Fernet(load_or_create_key(key_path)).decrypt(value.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise RuntimeError("运行环境密钥无法解密，请检查 QA_SECRET_KEY") from exc
