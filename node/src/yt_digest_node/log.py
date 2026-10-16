"""Structured logger: one JSON line per event on standard error, catalogued events only."""

import sys
from datetime import UTC, datetime
from typing import Any

from yt_digest_node.contracts.log_event import LogEvent


def emit(event: str, level: str = "info", **fields: Any) -> None:
    """Write one log line; raise ValueError on an unknown event, level or field."""
    ts = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    line = LogEvent.model_validate(
        {
            "attrs": {},
            **fields,
            "ts": ts,
            "level": level,
            "service": "node",
            "event": event,
        }
    )
    print(line.model_dump_json(exclude_none=True), file=sys.stderr, flush=True)
