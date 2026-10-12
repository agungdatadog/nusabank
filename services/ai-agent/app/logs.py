"""JSON logs to stdout. With DD_LOGS_INJECTION=true the injected tracer stamps dd.trace_id /
dd.span_id / dd.service... on every LogRecord; we nest them under "dd" like the Node services."""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone

_STANDARD = set(vars(logging.LogRecord("", 0, "", 0, "", None, None))) | {"message", "asctime", "taskName"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out: dict = {
            "level": record.levelname.lower(),
            "time": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "logger": record.name,
            "message": record.getMessage(),
        }
        dd: dict = {}
        for key, value in vars(record).items():
            if key.startswith("dd."):
                dd[key[3:]] = value
            elif key not in _STANDARD:
                out[key] = value
        if dd:
            out["dd"] = dd
        if record.exc_info:
            out["error"] = {"stack": self.formatException(record.exc_info)}
        return json.dumps(out, default=str, ensure_ascii=False)


def setup_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(logging.INFO)
    # uvicorn's access log duplicates our "request completed" line; httpx logs every call.
    for name in ("uvicorn.access", "httpx"):
        logging.getLogger(name).setLevel(logging.WARNING)
