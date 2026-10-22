import inspect
from typing import Any, get_args

import pytest
from pydantic import BaseModel, ValidationError
from yt_digest_node.contracts import node_result_request, transcript_result
from yt_digest_node.contracts.error import ErrorBody
from yt_digest_node.contracts.node_claim_request import NodeClaimRequest
from yt_digest_node.contracts.node_claim_response import NodeClaimResponse
from yt_digest_node.contracts.node_heartbeat_request import NodeHeartbeatRequest
from yt_digest_node.contracts.node_heartbeat_response import NodeHeartbeatResponse
from yt_digest_node.contracts.node_job_ack import NodeJobAck
from yt_digest_node.contracts.node_release_request import NodeReleaseRequest
from yt_digest_node.contracts.node_result_request import NodeResultRequest

TS = "2026-10-16T07:00:01.123Z"
TRANSCRIPT: dict[str, Any] = {
    "video_id": "dQw4w9WgXcQ",
    "status": "ok",
    "lang": "en",
    "source": "manual",
    "word_count": 3,
    "truncated": False,
    "sponsor_ratio": 0.5,
    "pages": ["a b c"],
}

CASES: list[tuple[type[BaseModel], dict[str, Any]]] = [
    (
        NodeHeartbeatRequest,
        {
            "version": "1.0",
            "uptime_s": 5,
            "jobs_in_progress": 0,
            "last_success_at": None,
            "last_blocked_at": TS,
            "disk_free_ratio": 0.4,
            "cpu_temp_c": 51.5,
        },
    ),
    (
        NodeHeartbeatResponse,
        {"node_id": "n1", "state": "healthy", "hourly_budget": 20, "directive": "run"},
    ),
    (NodeClaimRequest, {"max_jobs": 3}),
    (
        NodeClaimResponse,
        {
            "jobs": [
                {
                    "video_id": "dQw4w9WgXcQ",
                    "lease_id": "0123456789abcdef",
                    "lease_expires_at": TS,
                }
            ]
        },
    ),
    (NodeResultRequest, {"lease_id": "l", "outcome": "ok", "transcript": TRANSCRIPT}),
    (NodeReleaseRequest, {"lease_id": "l"}),
    (NodeJobAck, {"video_id": "dQw4w9WgXcQ", "status": "done"}),
    (ErrorBody, {"error": {"code": "bad_request", "message": "nope"}}),
]


@pytest.mark.parametrize(("model", "valid"), CASES, ids=[m.__name__ for m, _ in CASES])
def test_valid_instance_is_accepted_and_extra_field_rejected(
    model: type[BaseModel], valid: dict[str, Any]
) -> None:
    model.model_validate(valid)
    with pytest.raises(ValidationError):
        model.model_validate({**valid, "extra": 1})


def test_empty_claim_request_is_valid() -> None:
    NodeClaimRequest.model_validate({})


@pytest.mark.parametrize("max_jobs", [0, 11])
def test_max_jobs_out_of_range_is_rejected(max_jobs: int) -> None:
    with pytest.raises(ValidationError):
        NodeClaimRequest.model_validate({"max_jobs": max_jobs})


def test_unknown_outcome_is_rejected() -> None:
    with pytest.raises(ValidationError):
        NodeResultRequest.model_validate(
            {"lease_id": "l", "outcome": "maybe", "transcript": None}
        )


def test_missing_transcript_key_is_rejected_and_null_accepted() -> None:
    NodeResultRequest.model_validate(
        {"lease_id": "l", "outcome": "error", "transcript": None}
    )
    with pytest.raises(ValidationError):
        NodeResultRequest.model_validate({"lease_id": "l", "outcome": "error"})


@pytest.mark.parametrize(
    "change", [{"video_id": "short"}, {"extra": 1}, {"status": "nope"}]
)
def test_transcript_breaking_its_schema_is_rejected(change: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        NodeResultRequest.model_validate(
            {"lease_id": "l", "outcome": "ok", "transcript": {**TRANSCRIPT, **change}}
        )


def test_heartbeat_without_version_is_rejected() -> None:
    with pytest.raises(ValidationError):
        NodeHeartbeatRequest.model_validate({"uptime_s": 1, "jobs_in_progress": 0})


def test_result_request_uses_the_generated_transcript_result_type() -> None:
    annotation = NodeResultRequest.model_fields["transcript"].annotation
    assert transcript_result.TranscriptResult in get_args(annotation)
    assert "class TranscriptResult" not in inspect.getsource(node_result_request)
