"""SponsorBlock client and sponsor ratio (spec 5.3)."""

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Literal

from yt_digest_node.log import emit

TIMEOUT_S = 10
CATEGORIES = ["sponsor", "selfpromo", "interaction"]

State = Literal["ok", "none", "error"]


@dataclass(frozen=True)
class SponsorBlockResult:
    segments: list[tuple[float, float]]
    state: State


def _parse(body: bytes) -> list[tuple[float, float]]:
    items = json.loads(body)
    return [(float(item["segment"][0]), float(item["segment"][1])) for item in items]


def fetch_segments(
    base_url: str, video_id: str, request_id: str | None = None
) -> SponsorBlockResult:
    """Call skipSegments, log `sponsorblock.call` and return the segments and the state."""
    query = urllib.parse.urlencode(
        {
            "videoID": video_id,
            "categories": json.dumps(CATEGORIES, separators=(",", ":")),
        }
    )
    url = f"{base_url.rstrip('/')}/api/skipSegments?{query}"
    started = time.monotonic()
    status = 0
    body = b""
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT_S) as response:
            status = response.status
            body = response.read()
    except urllib.error.HTTPError as error:
        status = error.code
    except (OSError, ValueError):
        status = 0
    segments: list[tuple[float, float]] = []
    state: State = "error"
    if status == 200:
        try:
            segments = _parse(body)
            state = "ok"
        except (ValueError, KeyError, IndexError, TypeError):
            segments = []
    elif status == 404:
        state = "none"
    emit(
        "sponsorblock.call",
        "info" if state != "error" else "warn",
        video_id=video_id,
        **({"request_id": request_id} if request_id else {}),
        attrs={
            "status": status,
            "segments": len(segments),
            "duration_ms": round((time.monotonic() - started) * 1000),
        },
    )
    return SponsorBlockResult(segments, state)


def sponsor_ratio(segments: list[tuple[float, float]], duration: float) -> float:
    """Length of the union of the segments clipped to [0, duration], over the duration."""
    if duration <= 0:
        return 0.0
    covered = 0.0
    reach = 0.0
    for start, end in sorted(
        (max(0.0, s), min(duration, e))
        for s, e in segments
        if min(duration, e) > max(0.0, s)
    ):
        start = max(start, reach)
        if end > start:
            covered += end - start
            reach = end
    return round(covered / duration, 3)
