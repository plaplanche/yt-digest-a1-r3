import json
import os
import signal
import subprocess
import sys
import threading
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

FIXTURES = Path(__file__).parent / "fixtures" / "fake_ytdlp"
TOKEN = "secret-node-token-123"
LEASE = "lease-0123456789abcdef"
EXPIRES = "2026-10-16T07:00:01.123Z"


class FakeWorker:
    """A local Worker: records requests, answers from `script`."""

    def __init__(self) -> None:
        self.requests: list[tuple[str, dict[str, Any], str]] = []
        self.jobs: list[str] = []
        self.statuses: dict[str, list[int]] = {}  # endpoint -> statuses, then 200
        self.on_request: Any = None
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                length = int(self.headers["Content-Length"])
                body = json.loads(self.rfile.read(length))
                endpoint = self.path.removeprefix("/node/")
                outer.requests.append(
                    (endpoint, body, self.headers.get("Authorization", ""))
                )
                if outer.on_request:
                    outer.on_request(endpoint, body)
                queue = outer.statuses.get(endpoint, [])
                status = queue.pop(0) if queue else 200
                payload = outer.answer(endpoint, body) if status == 200 else {}
                data = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, format: str, *args: Any) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def answer(self, endpoint: str, body: dict[str, Any]) -> dict[str, Any]:
        if endpoint == "heartbeat":
            return {
                "node_id": "n1",
                "state": "healthy",
                "hourly_budget": 20,
                "directive": "run",
            }
        if endpoint == "claim":
            jobs = [
                {"video_id": v, "lease_id": f"{LEASE}-{v}", "lease_expires_at": EXPIRES}
                for v in self.jobs
            ]
            self.jobs = []
            return {"jobs": jobs}
        return {"video_id": "x" * 11, "status": "done"}

    def of(self, endpoint: str) -> list[dict[str, Any]]:
        return [b for e, b, _ in self.requests if e == endpoint]


@pytest.fixture
def worker() -> Iterator[FakeWorker]:
    fake = FakeWorker()
    yield fake
    fake.server.shutdown()
    fake.server.server_close()


def env_for(url: str, **extra: str) -> dict[str, str]:
    inherited = {
        k: v
        for k, v in os.environ.items()
        if k not in ("WORKER_URL", "NODE_TOKEN", "TRANSCRIPT_LANGS", "CLAIM_BATCH")
    }
    return {
        **inherited,
        "FETCHER_FAKE_YTDLP": "1",
        "FAKE_YTDLP_DIR": str(FIXTURES),
        "SPONSORBLOCK_URL": "http://127.0.0.1:1",
        "WORKER_URL": url,
        "NODE_TOKEN": TOKEN,
        **extra,
    }


def spawn(env: dict[str, str], *args: str) -> subprocess.Popen[str]:
    return subprocess.Popen(
        [sys.executable, "-m", "yt_digest_node.cli", "work", *args],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def run_once(env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "yt_digest_node.cli", "work", "--once"],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


def log_lines(stderr: str) -> list[dict[str, Any]]:
    return [json.loads(line) for line in stderr.splitlines()]


def test_once_sends_heartbeat_claim_and_one_result_per_job(worker: FakeWorker) -> None:
    worker.jobs = ["sponsored01", "notrack0001", "unavailable"]
    done = run_once(env_for(worker.url, TRANSCRIPT_LANGS="fr", CLAIM_BATCH="5"))
    assert done.returncode == 0, done.stderr
    assert [e for e, _, _ in worker.requests] == [
        "heartbeat",
        "claim",
        "result",
        "result",
        "result",
    ]
    assert all(auth == f"Bearer {TOKEN}" for _, _, auth in worker.requests)
    heartbeat = worker.of("heartbeat")[0]
    assert heartbeat["version"] == "0.1.0"
    assert heartbeat["jobs_in_progress"] == 0
    assert set(heartbeat) == {"version", "uptime_s", "jobs_in_progress"}
    assert worker.of("claim") == [{"max_jobs": 5}]
    first, second, third = worker.of("result")
    assert first["lease_id"] == f"{LEASE}-sponsored01"
    assert first["outcome"] == "ok"
    assert first["transcript"]["video_id"] == "sponsored01"
    assert first["transcript"]["status"] == "ok"
    assert second["outcome"] == "no_transcript" and second["transcript"] is None
    assert third["outcome"] == "unavailable" and third["transcript"] is None


def test_blocked_outcome(worker: FakeWorker) -> None:
    worker.jobs = ["blocked0001"]
    assert run_once(env_for(worker.url)).returncode == 0
    assert worker.of("result")[0]["outcome"] == "blocked"


def test_pipeline_exception_sends_error(worker: FakeWorker, tmp_path: Path) -> None:
    (tmp_path / "boom0000001").mkdir()
    (tmp_path / "boom0000001" / "meta.json").write_text("not json")
    worker.jobs = ["boom0000001"]
    done = run_once(env_for(worker.url, FAKE_YTDLP_DIR=str(tmp_path)))
    assert done.returncode == 0
    (sent,) = worker.of("result")
    assert sent["outcome"] == "error" and sent["transcript"] is None


def test_503_on_result_is_retried_then_succeeds(worker: FakeWorker) -> None:
    worker.jobs = ["sponsored01"]
    worker.statuses["result"] = [503]
    done = run_once(env_for(worker.url, TRANSCRIPT_LANGS="fr"))
    assert done.returncode == 0
    assert len(worker.of("result")) == 2
    calls = [
        e["attrs"]["status"]
        for e in log_lines(done.stderr)
        if e["event"] == "worker.call"
    ]
    assert calls == [200, 200, 503, 200]


def test_409_on_result_is_not_retried(worker: FakeWorker) -> None:
    worker.jobs = ["sponsored01"]
    worker.statuses["result"] = [409]
    done = run_once(env_for(worker.url, TRANSCRIPT_LANGS="fr"))
    assert done.returncode == 0
    assert len(worker.of("result")) == 1


def test_retries_stop_after_three_with_growing_delays(worker: FakeWorker) -> None:
    from yt_digest_node.daemon import Daemon, Settings

    worker.statuses["release"] = [500, 500, 500, 500, 500]
    slept: list[float] = []
    daemon = Daemon(
        Settings(worker.url, TOKEN, 3, 10, 60),
        {},
        None,  # type: ignore[arg-type]
        sleep=slept.append,
    )
    from yt_digest_node.contracts.node_claim_response import Job

    daemon.release(
        Job(video_id="sponsored01", lease_id=LEASE, lease_expires_at=EXPIRES)
    )
    assert len(worker.of("release")) == 4
    assert slept == [1.0, 2.0, 4.0]


@pytest.mark.parametrize("endpoint", ["heartbeat", "claim"])
def test_failed_heartbeat_or_claim_exits_1(worker: FakeWorker, endpoint: str) -> None:
    worker.statuses[endpoint] = [500]
    assert run_once(env_for(worker.url)).returncode == 1


def test_unauthorized_exits_1(worker: FakeWorker) -> None:
    worker.statuses["heartbeat"] = [401]
    assert run_once(env_for(worker.url)).returncode == 1


def test_unreachable_worker_exits_1() -> None:
    assert run_once(env_for("http://127.0.0.1:1")).returncode == 1


@pytest.mark.parametrize("missing", ["WORKER_URL", "NODE_TOKEN"])
def test_missing_variable_exits_2_without_request(
    worker: FakeWorker, missing: str
) -> None:
    env = env_for(worker.url)
    del env[missing]
    done = run_once(env)
    assert done.returncode == 2
    assert worker.requests == []


def test_claim_batch_out_of_range_exits_2(worker: FakeWorker) -> None:
    assert run_once(env_for(worker.url, CLAIM_BATCH="11")).returncode == 2
    assert worker.requests == []


def test_stderr_holds_only_json_log_lines_and_never_the_token(
    worker: FakeWorker,
) -> None:
    worker.jobs = ["sponsored01"]
    worker.statuses["result"] = [503]
    done = run_once(env_for(worker.url, TRANSCRIPT_LANGS="fr"))
    lines = log_lines(done.stderr)
    assert lines[0]["event"] == "service.started"
    events = {line["event"] for line in lines}
    assert {"worker.call", "fetch.transcript"} <= events
    assert all(line["service"] == "node" for line in lines)
    assert TOKEN not in done.stderr
    assert {
        line["attrs"]["endpoint"] for line in lines if line["event"] == "worker.call"
    } == {"heartbeat", "claim", "result"}


def test_sigterm_releases_jobs_not_started_and_exits_0(worker: FakeWorker) -> None:
    worker.jobs = ["sponsored01", "notrack0001", "unavailable"]
    holder: dict[str, subprocess.Popen[str]] = {}

    def on_request(endpoint: str, body: dict[str, Any]) -> None:
        if endpoint == "result":
            holder["proc"].send_signal(signal.SIGTERM)
            time.sleep(0.3)  # the result is still being answered when the signal lands

    worker.on_request = on_request
    proc = spawn(env_for(worker.url, TRANSCRIPT_LANGS="fr"))
    holder["proc"] = proc
    _, stderr = proc.communicate(timeout=60)
    assert proc.returncode == 0, stderr
    assert [b["lease_id"] for b in worker.of("result")] == [f"{LEASE}-sponsored01"]
    assert [b["lease_id"] for b in worker.of("release")] == [
        f"{LEASE}-notrack0001",
        f"{LEASE}-unavailable",
    ]
    assert TOKEN not in stderr


def test_loop_polls_until_sigterm(worker: FakeWorker) -> None:
    proc = spawn(env_for(worker.url, POLL_SECONDS="0.2"))
    deadline = time.monotonic() + 30
    while len(worker.of("claim")) < 2 and time.monotonic() < deadline:
        time.sleep(0.05)
    proc.send_signal(signal.SIGTERM)
    _, stderr = proc.communicate(timeout=30)
    assert proc.returncode == 0, stderr
    assert len(worker.of("heartbeat")) == 1
    assert len(worker.of("claim")) >= 2
