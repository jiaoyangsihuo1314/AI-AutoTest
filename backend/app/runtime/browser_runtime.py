"""Compatibility exports for modularized platform code."""

from ..platform import (
    BrowserRuntime,
    BROWSER_RUNTIMES,
    start_browser_session,
    close_browser_runtime,
    handle_worker_event,
    pump_browser_worker,
)
