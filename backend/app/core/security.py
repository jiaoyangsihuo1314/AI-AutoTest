"""Compatibility exports for core platform helpers."""

from ..platform import (
    auth_disabled,
    normalize_username,
    validate_username,
    validate_password,
    hash_password,
    verify_password,
    create_session,
    clear_session,
    set_auth_cookie,
    delete_auth_cookie,
    user_from_session_token,
    current_user_from_request,
    current_user_from_websocket,
    require_current_user,
    require_role_user,
)
