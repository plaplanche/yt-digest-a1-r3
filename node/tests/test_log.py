import json

import pytest
from yt_digest_node.log import emit


def test_emit_writes_one_valid_line(capsys: pytest.CaptureFixture[str]) -> None:
    emit("fetch.transcript", video_id="dQw4w9WgXcQ", attrs={"words": 3})
    err = capsys.readouterr().err
    assert err.count("\n") == 1
    line = json.loads(err)
    assert line["event"] == "fetch.transcript"
    assert line["service"] == "node"
    assert line["level"] == "info"
    assert line["attrs"] == {"words": 3}
    assert line["ts"].endswith("Z")


def test_unknown_event_raises(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(ValueError):
        emit("not.catalogued")
    assert capsys.readouterr().err == ""


def test_unknown_field_raises() -> None:
    with pytest.raises(ValueError):
        emit("service.started", color="red")


def test_unknown_level_raises() -> None:
    with pytest.raises(ValueError):
        emit("service.started", level="loud")


def test_lot2_event_is_accepted(capsys: pytest.CaptureFixture[str]) -> None:
    emit("worker.call", attrs={"endpoint": "claim", "status": 200, "duration_ms": 12})
    assert json.loads(capsys.readouterr().err)["event"] == "worker.call"


def test_lot2_worker_event_is_in_the_catalogue(
    capsys: pytest.CaptureFixture[str],
) -> None:
    emit("job.claimed", video_id="dQw4w9WgXcQ")
    assert json.loads(capsys.readouterr().err)["event"] == "job.claimed"
