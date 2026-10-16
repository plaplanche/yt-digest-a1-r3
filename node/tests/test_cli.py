import json
import os
import subprocess
import sys
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

import pytest

FIXTURES = Path(__file__).parent / "fixtures" / "fake_ytdlp"
reply: dict[str, Any] = {}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        body = reply["body"].encode()
        self.send_response(reply["status"])
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        pass


@pytest.fixture
def sponsorblock_url() -> Iterator[str]:
    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    reply.clear()
    reply.update(status=404, body="")
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()
    server.server_close()


def run(*args: str, url: str, **env: str) -> subprocess.CompletedProcess[str]:
    inherited = {
        k: v
        for k, v in os.environ.items()
        if k not in ("TRANSCRIPT_LANGS", "MAX_WORDS", "PAGE_WORDS", "YT_DELAY_SECONDS")
    }
    full = {
        **inherited,
        "FETCHER_FAKE_YTDLP": "1",
        "FAKE_YTDLP_DIR": str(FIXTURES),
        "SPONSORBLOCK_URL": url,
        **env,
    }
    return subprocess.run(
        [sys.executable, "-m", "yt_digest_node.cli", *args],
        check=False,
        env=full,
        capture_output=True,
        text=True,
        timeout=60,
    )


def log_events(stderr: str) -> list[dict[str, Any]]:
    return [json.loads(line) for line in stderr.splitlines()]


def test_ok_with_sponsor_cuts(sponsorblock_url: str) -> None:
    reply.update(status=200, body='[{"segment": [8, 22]}]')
    done = run("transcript", "sponsored01", "--request-id", "r1", url=sponsorblock_url)
    assert done.returncode == 0
    result = json.loads(done.stdout)
    assert result == {
        "video_id": "sponsored01",
        "status": "ok",
        "lang": "fr",
        "source": "manual",
        "word_count": 10,
        "truncated": False,
        "sponsor_ratio": 0.14,
        "pages": ["Bonjour tout le monde voici la suite\n\nretour au sujet"],
    }
    events = log_events(done.stderr)
    assert [e["event"] for e in events] == [
        "service.started",
        "sponsorblock.call",
        "fetch.transcript",
    ]
    fetch = events[-1]
    assert fetch["request_id"] == "r1"
    assert fetch["video_id"] == "sponsored01"
    assert fetch["attrs"]["outcome"] == "ok"
    assert fetch["attrs"]["words"] == 10
    assert fetch["attrs"]["pages"] == 1
    assert fetch["attrs"]["sponsorblock"] == "ok"
    assert "Bonjour" not in done.stderr
    assert "SECRETSPONSOR" not in done.stderr


def test_sponsorblock_error_gives_null_ratio(sponsorblock_url: str) -> None:
    reply.update(status=500, body="")
    done = run("transcript", "sponsored01", url=sponsorblock_url)
    result = json.loads(done.stdout)
    assert result["status"] == "ok"
    assert result["sponsor_ratio"] is None
    assert "SECRETSPONSOR" in result["pages"][0]
    assert log_events(done.stderr)[-1]["attrs"]["sponsorblock"] == "error"


def test_truncation_and_pages_from_env(sponsorblock_url: str) -> None:
    done = run(
        "transcript", "sponsored01", url=sponsorblock_url, MAX_WORDS="4", PAGE_WORDS="2"
    )
    result = json.loads(done.stdout)
    assert result["truncated"] is True
    assert result["word_count"] == 4
    assert result["pages"] == ["Bonjour tout\n\n[…]", "au sujet"]


def test_langs_option(sponsorblock_url: str) -> None:
    done = run("transcript", "sponsored01", "--langs", "en", url=sponsorblock_url)
    assert json.loads(done.stdout)["status"] == "no_transcript"


def test_no_transcript(sponsorblock_url: str) -> None:
    done = run("transcript", "notrack0001", url=sponsorblock_url)
    assert done.returncode == 0
    result = json.loads(done.stdout)
    assert result["status"] == "no_transcript"
    assert result["pages"] == []
    assert result["sponsor_ratio"] is None
    assert log_events(done.stderr)[-1]["attrs"]["outcome"] == "no_transcript"


@pytest.mark.parametrize(
    ("video_id", "status"),
    [
        ("unavailable", "unavailable"),
        ("blocked0001", "blocked"),
        ("missing0001", "unavailable"),
    ],
)
def test_failures(sponsorblock_url: str, video_id: str, status: str) -> None:
    done = run("transcript", video_id, url=sponsorblock_url)
    assert done.returncode == 0
    assert json.loads(done.stdout)["status"] == status
    assert log_events(done.stderr)[-1]["attrs"]["outcome"] == status


@pytest.mark.parametrize("video_id", ["short", "has space!!", "waytoolongvideoid"])
def test_invalid_video_id(sponsorblock_url: str, video_id: str) -> None:
    done = run("transcript", video_id, url=sponsorblock_url)
    assert done.returncode == 2
    assert done.stdout == ""


def test_invalid_config(sponsorblock_url: str) -> None:
    done = run("transcript", "sponsored01", url=sponsorblock_url, MAX_WORDS="abc")
    assert done.returncode == 2
    assert done.stdout == ""


@pytest.mark.parametrize("name", ["MAX_WORDS", "PAGE_WORDS"])
@pytest.mark.parametrize("value", ["0", "-3", "abc"])
def test_invalid_word_limits(sponsorblock_url: str, name: str, value: str) -> None:
    done = run("transcript", "sponsored01", url=sponsorblock_url, **{name: value})
    assert done.returncode == 2
    assert done.stdout == ""


def test_missing_fake_dir(sponsorblock_url: str) -> None:
    done = run("transcript", "sponsored01", url=sponsorblock_url, FAKE_YTDLP_DIR="")
    assert done.returncode == 2
    assert done.stdout == ""


def test_transcript_langs_env(sponsorblock_url: str) -> None:
    done = run("transcript", "sponsored01", url=sponsorblock_url, TRANSCRIPT_LANGS="en")
    assert json.loads(done.stdout)["status"] == "no_transcript"
    done = run("transcript", "notrack0001", url=sponsorblock_url, TRANSCRIPT_LANGS="de")
    result = json.loads(done.stdout)
    assert (result["status"], result["lang"]) == ("ok", "de")


def test_langs_option_wins_over_env(sponsorblock_url: str) -> None:
    done = run(
        "transcript",
        "sponsored01",
        "--langs",
        "fr",
        url=sponsorblock_url,
        TRANSCRIPT_LANGS="en",
    )
    assert json.loads(done.stdout)["lang"] == "fr"


def test_empty_langs_option_uses_env(sponsorblock_url: str) -> None:
    done = run(
        "transcript",
        "sponsored01",
        "--langs",
        "",
        url=sponsorblock_url,
        TRANSCRIPT_LANGS="en",
    )
    assert json.loads(done.stdout)["status"] == "no_transcript"


def test_blank_langs_entries_give_no_transcript(sponsorblock_url: str) -> None:
    done = run("transcript", "sponsored01", "--langs", ", ,", url=sponsorblock_url)
    assert done.returncode == 0
    assert json.loads(done.stdout)["status"] == "no_transcript"
