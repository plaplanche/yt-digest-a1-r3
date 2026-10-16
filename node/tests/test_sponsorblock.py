import json
import socket
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from yt_digest_node.cleaning import Cue, clean_cues
from yt_digest_node.sponsorblock import fetch_segments, sponsor_ratio

requests: list[dict[str, Any]] = []
reply: dict[str, Any] = {}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        url = urlparse(self.path)
        requests.append({"path": url.path, "query": parse_qs(url.query)})
        body = reply["body"].encode()
        self.send_response(reply["status"])
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        pass


@pytest.fixture
def server() -> Iterator[str]:
    requests.clear()
    httpd = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_port}"
    httpd.shutdown()
    httpd.server_close()


def log_line(capsys: pytest.CaptureFixture[str]) -> dict[str, Any]:
    result: dict[str, Any] = json.loads(capsys.readouterr().err)
    return result


def test_200_with_segments(server: str, capsys: pytest.CaptureFixture[str]) -> None:
    reply.update(
        status=200,
        body=json.dumps(
            [{"segment": [1.5, 4], "category": "sponsor"}, {"segment": [10, 12]}]
        ),
    )
    result = fetch_segments(server, "abc", "req-1")
    assert result.state == "ok"
    assert result.segments == [(1.5, 4.0), (10.0, 12.0)]
    assert requests[0]["path"] == "/api/skipSegments"
    assert requests[0]["query"]["videoID"] == ["abc"]
    assert json.loads(requests[0]["query"]["categories"][0]) == [
        "sponsor",
        "selfpromo",
        "interaction",
    ]
    line = log_line(capsys)
    assert line["event"] == "sponsorblock.call"
    assert line["video_id"] == "abc"
    assert line["request_id"] == "req-1"
    assert line["attrs"]["status"] == 200
    assert line["attrs"]["segments"] == 2
    assert line["attrs"]["duration_ms"] >= 0


def test_404_is_none(server: str, capsys: pytest.CaptureFixture[str]) -> None:
    reply.update(status=404, body="Not Found")
    result = fetch_segments(server, "abc")
    assert (result.state, result.segments) == ("none", [])
    line = log_line(capsys)
    assert line["attrs"]["status"] == 404
    assert line["attrs"]["segments"] == 0


def test_500_is_error(server: str, capsys: pytest.CaptureFixture[str]) -> None:
    reply.update(status=500, body="boom")
    result = fetch_segments(server, "abc")
    assert (result.state, result.segments) == ("error", [])
    assert log_line(capsys)["attrs"]["status"] == 500


def test_malformed_200_is_error(
    server: str, capsys: pytest.CaptureFixture[str]
) -> None:
    reply.update(status=200, body="{not json")
    result = fetch_segments(server, "abc")
    assert (result.state, result.segments) == ("error", [])
    assert log_line(capsys)["attrs"]["segments"] == 0


def test_connection_refused_is_error(capsys: pytest.CaptureFixture[str]) -> None:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    result = fetch_segments(f"http://127.0.0.1:{port}", "abc")
    assert (result.state, result.segments) == ("error", [])
    line = log_line(capsys)
    assert line["attrs"]["status"] == 0
    assert line["attrs"]["segments"] == 0


def test_ratio_without_segment_is_zero() -> None:
    assert sponsor_ratio([], 100) == 0


def test_ratio_union_of_overlapping_segments() -> None:
    # union is [10, 40] and [50, 60]: 40 s of 120
    assert sponsor_ratio([(10, 30), (20, 40), (50, 60), (55, 58)], 120) == 0.333


def test_ratio_clips_to_duration() -> None:
    assert sponsor_ratio([(90, 500)], 100) == 0.1
    assert sponsor_ratio([(150, 200)], 100) == 0
    assert sponsor_ratio([(-10, 10)], 100) == 0.1


def test_midpoint_rule_edges() -> None:
    cues = [Cue(0, 2, ["a"]), Cue(4, 6, ["b"])]  # midpoints 1 and 5
    assert clean_cues(cues, [(1.0, 3.0)]) == ["b"]  # start inclusive
    assert clean_cues(cues, [(0.0, 1.0)]) == ["a", "b"]  # end exclusive
