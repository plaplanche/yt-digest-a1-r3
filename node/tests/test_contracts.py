import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError
from yt_digest_node.contracts.log_event import LogEventName
from yt_digest_node.contracts.transcript_result import TranscriptResult

ROOT = Path(__file__).resolve().parents[2]

VALID: dict[str, Any] = {
    "video_id": "dQw4w9WgXcQ",
    "status": "ok",
    "lang": "en",
    "source": "manual",
    "word_count": 3,
    "truncated": False,
    "sponsor_ratio": 0.5,
    "pages": ["a b c"],
}


def test_valid_result_is_accepted() -> None:
    assert TranscriptResult.model_validate(VALID).status == "ok"


@pytest.mark.parametrize(
    "change",
    [
        {"extra": 1},
        {"video_id": "short"},
        {"video_id": "bad id!!!!!!"},
        {"status": "nope"},
    ],
)
def test_invalid_result_is_rejected(change: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        TranscriptResult.model_validate({**VALID, **change})


def test_catalogue_is_a_str_enum() -> None:
    assert LogEventName("fetch.transcript") == "fetch.transcript"


def _copy_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    for name in ("contracts", "scripts"):
        shutil.copytree(ROOT / name, repo / name)
    for sub in ("worker/src/contracts", "node/src/yt_digest_node/contracts"):
        shutil.copytree(ROOT / sub, repo / sub)
    (repo / "worker").mkdir(exist_ok=True)
    (repo / "node").mkdir(exist_ok=True)
    # Reuse the installed tools of the real project (npm ci / uv sync then find them in place).
    (repo / "worker/node_modules").symlink_to(ROOT / "worker/node_modules")
    shutil.copy(ROOT / "worker/package.json", repo / "worker/package.json")
    shutil.copy(ROOT / "worker/package-lock.json", repo / "worker/package-lock.json")
    shutil.copy(ROOT / "node/pyproject.toml", repo / "node/pyproject.toml")
    shutil.copy(ROOT / "node/uv.lock", repo / "node/uv.lock")
    return repo


needs_tools = pytest.mark.skipif(
    not (ROOT / "worker/node_modules/.bin/json2ts").exists(),
    reason="worker/node_modules is not installed (run npm ci --prefix worker)",
)


def _check(repo: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(repo / "scripts/contracts.sh"), "--check"],
        check=False,
        env={**os.environ, "UV_PROJECT_ENVIRONMENT": str(ROOT / "node/.venv")},
        capture_output=True,
        text=True,
    )


@needs_tools
def test_check_passes_then_fails_naming_the_edited_file(tmp_path: Path) -> None:
    repo = _copy_repo(tmp_path)
    assert _check(repo).returncode == 0
    target = repo / "worker/src/contracts/log-event.ts"
    target.write_text(target.read_text() + "// hand edit\n")
    result = _check(repo)
    assert result.returncode == 1
    assert "worker/src/contracts/log-event.ts" in result.stderr


@needs_tools
def test_check_fails_when_a_schema_changes(tmp_path: Path) -> None:
    repo = _copy_repo(tmp_path)
    schema = repo / "contracts/log-event.schema.json"
    data = json.loads(schema.read_text())
    data["$defs"]["LogEventName"]["enum"].append("new.event")
    schema.write_text(json.dumps(data, indent=2) + "\n")
    result = _check(repo)
    assert result.returncode == 1
    assert "log_event.py" in result.stderr
    assert "log-event.ts" in result.stderr


@needs_tools
def test_check_fails_on_an_orphaned_generated_file(tmp_path: Path) -> None:
    repo = _copy_repo(tmp_path)
    (repo / "worker/src/contracts/gone.ts").write_text("// orphan\n")
    result = _check(repo)
    assert result.returncode == 1
    assert "worker/src/contracts/gone.ts" in result.stderr
