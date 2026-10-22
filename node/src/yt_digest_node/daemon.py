"""The node daemon: heartbeats, claims jobs and posts results to the Worker (spec lot 2, 9)."""

import json
import signal
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from importlib.metadata import version
from types import FrameType
from typing import Any

from pydantic import BaseModel, ValidationError

from yt_digest_node.cli import run_transcript
from yt_digest_node.contracts.node_claim_request import NodeClaimRequest
from yt_digest_node.contracts.node_claim_response import Job, NodeClaimResponse
from yt_digest_node.contracts.node_heartbeat_request import NodeHeartbeatRequest
from yt_digest_node.contracts.node_heartbeat_response import NodeHeartbeatResponse
from yt_digest_node.contracts.node_release_request import NodeReleaseRequest
from yt_digest_node.contracts.node_result_request import NodeResultRequest
from yt_digest_node.extractors import Extractor
from yt_digest_node.log import emit

REQUEST_TIMEOUT_S = 30
RETRY_DELAYS = (1.0, 2.0, 4.0)


class ConfigError(ValueError):
    """A bad or missing setting; the command exits 2."""


@dataclass(frozen=True)
class Settings:
    worker_url: str
    node_token: str
    claim_batch: int
    poll_seconds: float
    heartbeat_seconds: float


def read_settings(env: dict[str, str]) -> Settings:
    for name in ("WORKER_URL", "NODE_TOKEN"):
        if not env.get(name):
            raise ConfigError(f"{name} is required")
    try:
        batch = int(env.get("CLAIM_BATCH", "3"))
        poll = float(env.get("POLL_SECONDS", "10"))
        heartbeat = float(env.get("HEARTBEAT_SECONDS", "60"))
    except ValueError as error:
        raise ConfigError(str(error)) from error
    if not 1 <= batch <= 10:
        raise ConfigError("CLAIM_BATCH must be between 1 and 10")
    if poll <= 0 or heartbeat <= 0:
        raise ConfigError("POLL_SECONDS and HEARTBEAT_SECONDS must be positive")
    return Settings(
        env["WORKER_URL"].rstrip("/"), env["NODE_TOKEN"], batch, poll, heartbeat
    )


class Unauthorized(Exception):
    """The Worker answered 401: the node stops with exit code 1."""


@dataclass(frozen=True)
class Reply:
    status: int  # 0 on a network error
    body: Any


class Daemon:
    def __init__(
        self,
        settings: Settings,
        env: dict[str, str],
        extractor: Extractor,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.settings = settings
        self.env = env
        self.extractor = extractor
        self.sleep = sleep
        self.langs = [
            lang.strip()
            for lang in (env.get("TRANSCRIPT_LANGS") or "fr,en").split(",")
            if lang.strip()
        ]
        self.started = time.monotonic()
        self.stopping = False
        self.pending: list[Job] = []
        self.next_heartbeat = 0.0

    def _on_signal(self, signum: int, frame: FrameType | None) -> None:
        self.stopping = True

    # --- HTTP -------------------------------------------------------------

    def _call(
        self, endpoint: str, payload: BaseModel, omit_none: bool = False
    ) -> Reply:
        request = urllib.request.Request(
            f"{self.settings.worker_url}/node/{endpoint}",
            data=payload.model_dump_json(exclude_none=omit_none).encode(),
            headers={
                "Authorization": f"Bearer {self.settings.node_token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        started = time.monotonic()
        status = 0
        body: Any = None
        try:
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_S) as response:
                status = response.status
                body = json.loads(response.read() or b"null")
        except urllib.error.HTTPError as error:
            status = error.code
        except (OSError, ValueError):
            pass  # network error, or a 2xx whose body is not JSON
        emit(
            "worker.call",
            level="info" if 200 <= status < 300 else "warn",
            attrs={
                "endpoint": endpoint,
                "status": status,
                "duration_ms": round((time.monotonic() - started) * 1000),
            },
        )
        if status == 401:
            raise Unauthorized
        return Reply(status, body)

    def _call_retrying(self, endpoint: str, payload: BaseModel) -> Reply:
        """Retry a network error or a 5xx after 1, 2 and 4 seconds; never a 4xx."""
        reply = self._call(endpoint, payload)
        for delay in RETRY_DELAYS:
            if reply.status != 0 and reply.status < 500:
                break
            self.sleep(delay)
            reply = self._call(endpoint, payload)
        return reply

    # --- Cycle ------------------------------------------------------------

    def heartbeat(self) -> bool:
        payload = NodeHeartbeatRequest(
            version=version("yt-digest-node"),
            uptime_s=int(time.monotonic() - self.started),
            jobs_in_progress=len(self.pending),
        )
        reply = self._call("heartbeat", payload, omit_none=True)
        self.next_heartbeat = time.monotonic() + self.settings.heartbeat_seconds
        return self._valid(reply, NodeHeartbeatResponse)

    def claim(self) -> list[Job] | None:
        reply = self._call(
            "claim", NodeClaimRequest(max_jobs=self.settings.claim_batch)
        )
        if not self._valid(reply, NodeClaimResponse):
            return None
        return NodeClaimResponse.model_validate(reply.body).jobs

    @staticmethod
    def _valid(reply: Reply, model: type[BaseModel]) -> bool:
        if reply.status != 200:
            return False
        try:
            model.model_validate(reply.body)
        except ValidationError:
            return False
        return True

    def process(self, job: Job) -> None:
        try:
            transcript = run_transcript(
                job.video_id, self.langs, self.env, self.extractor
            )
            outcome = transcript.status.value
            request = NodeResultRequest.model_validate(
                {
                    "lease_id": job.lease_id,
                    "outcome": outcome,
                    "transcript": transcript.model_dump() if outcome == "ok" else None,
                }
            )
        except Exception:  # noqa: BLE001 - any pipeline failure is outcome "error"
            request = NodeResultRequest.model_validate(
                {"lease_id": job.lease_id, "outcome": "error", "transcript": None}
            )
        self._call_retrying("result", request)

    def release(self, job: Job) -> None:
        self._call_retrying("release", NodeReleaseRequest(lease_id=job.lease_id))

    def handle(self, jobs: list[Job]) -> None:
        """Process the claimed jobs in order; on a stop, release those not started."""
        self.pending = list(jobs)
        while self.pending:
            if self.stopping:
                self.release(self.pending[0])
            else:
                if time.monotonic() >= self.next_heartbeat:
                    self.heartbeat()
                self.process(self.pending[0])
            self.pending.pop(0)

    def _wait(self, seconds: float) -> None:
        deadline = time.monotonic() + seconds
        while not self.stopping and (left := deadline - time.monotonic()) > 0:
            self.sleep(min(0.1, left))

    # --- Entry points -----------------------------------------------------

    def run(self, once: bool) -> int:
        signal.signal(signal.SIGTERM, self._on_signal)
        signal.signal(signal.SIGINT, self._on_signal)
        try:
            return self._run(once)
        except Unauthorized:
            return 1

    def _run(self, once: bool) -> int:
        if once:
            if not self.heartbeat():
                return 1
            jobs = self.claim()
            if jobs is None:
                return 1
            self.handle(jobs)
            return 0
        while not self.stopping:
            if time.monotonic() >= self.next_heartbeat:
                self.heartbeat()
            jobs = self.claim()
            if jobs:
                self.handle(jobs)
            else:
                self._wait(self.settings.poll_seconds)
        return 0
