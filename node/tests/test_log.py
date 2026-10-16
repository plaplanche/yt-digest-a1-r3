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
