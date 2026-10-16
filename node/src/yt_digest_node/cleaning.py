"""VTT parsing and cleaning (spec 5.4): from a VTT file to paragraphs of clean text."""

import html
import re
from dataclasses import dataclass

PARAGRAPH_GAP_MS = 2000

_TIMING = re.compile(
    r"((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})"
)
_IGNORED_BLOCKS = ("WEBVTT", "NOTE", "STYLE", "REGION")
_TAG = re.compile(r"<[^>]*>")
_BRACKETED = re.compile(r"\[[^\]]*\]")
_SPACES = re.compile(r"\s+")


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    lines: list[str]


def _seconds(stamp: str) -> float:
    *head, last = stamp.replace(",", ".").split(":")
    total = 0.0
    for part in head:
        total = total * 60 + float(part)
    return total * 60 + float(last)


def _is_ignored(first_line: str) -> bool:
    word = re.split(r"[ \t]", first_line, maxsplit=1)[0]
    return word in _IGNORED_BLOCKS


def parse_vtt(text: str) -> list[Cue]:
    """Parse VTT text into cues; header, NOTE, STYLE and REGION blocks and cue settings are ignored."""
    cues: list[Cue] = []
    for block in re.split(
        r"\n[ \t]*\n", text.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
    ):
        lines = block.strip("\n").split("\n")
        if not lines or _is_ignored(lines[0]):
            continue
        for i, line in enumerate(lines[:2]):
            match = _TIMING.search(line)
            if match:
                cues.append(Cue(_seconds(match[1]), _seconds(match[2]), lines[i + 1 :]))
                break
    return cues


def _clean_line(line: str) -> str:
    line = html.unescape(_TAG.sub("", line))
    return _SPACES.sub(" ", _BRACKETED.sub("", line)).strip()


def _in_segment(cue: Cue, segments: list[tuple[float, float]]) -> bool:
    midpoint = (cue.start + cue.end) / 2
    return any(start <= midpoint < end for start, end in segments)


def clean_cues(cues: list[Cue], segments: list[tuple[float, float]]) -> list[str]:
    """Apply steps 2 to 5 of spec 5.4 and return the paragraphs."""
    paragraphs: list[list[str]] = []
    previous_line: str | None = None
    previous_end: float | None = None
    for cue in cues:
        if _in_segment(cue, segments):
            continue
        kept: list[str] = []
        for line in map(_clean_line, cue.lines):
            if line and line != previous_line:
                kept.append(line)
                previous_line = line
        if not kept:
            continue
        gap_ms = (
            None if previous_end is None else round((cue.start - previous_end) * 1000)
        )
        if gap_ms is None or gap_ms >= PARAGRAPH_GAP_MS:
            paragraphs.append([])
        paragraphs[-1].extend(kept)
        previous_end = cue.end
    return [" ".join(lines) for lines in paragraphs]
