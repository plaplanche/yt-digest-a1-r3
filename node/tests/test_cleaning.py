from pathlib import Path

from yt_digest_node.cleaning import Cue, clean_cues, parse_vtt

FIXTURES = Path(__file__).parent / "fixtures" / "vtt"


def load(name: str) -> list[Cue]:
    return parse_vtt((FIXTURES / f"{name}.vtt").read_text(encoding="utf-8"))


def test_parse_ignores_header_blocks_and_settings() -> None:
    cues = load("manual")
    assert [(c.start, c.end) for c in cues] == [
        (1.0, 3.0),
        (3.0, 5.0),
        (7.0, 9.0),
        (10.9, 12.0),
        (14.0, 15.0),
    ]
    assert cues[0].lines == ["Hello and welcome", "to the channel."]


def test_parse_hours_and_crlf() -> None:
    cues = parse_vtt("WEBVTT\r\n\r\n01:02:03.500 --> 01:02:04.000\r\nhi\r\n")
    assert cues == [Cue(3723.5, 3724.0, ["hi"])]


def test_manual_paragraphs() -> None:
    assert clean_cues(load("manual"), []) == [
        "Hello and welcome to the channel. Today we talk about parsing.",
        "A new paragraph starts here. Still the same paragraph.",
        "Gap of two seconds exactly.",
    ]


def test_gap_of_two_seconds_splits_and_1_9_does_not() -> None:
    cues = [Cue(0, 1, ["a"]), Cue(2.9, 4, ["b"]), Cue(6.0, 7, ["c"])]
    assert clean_cues(cues, []) == ["a b", "c"]


def test_auto_rolling_duplicates_and_inline_tags() -> None:
    assert clean_cues(load("auto"), []) == [
        "hello everyone and welcome to the show today we start"
    ]


def test_annotations_removed_and_entities_decoded() -> None:
    (paragraph,) = clean_cues(load("annotations"), [])
    assert "[" not in paragraph
    assert paragraph.startswith("Tom & Jerry are here 5 < 6 > 4 and")
    assert paragraph.endswith("more spaces bold under")


def test_empty_cue_does_not_bridge_gap() -> None:
    # The final [Applause] cue is empty once cleaned, so it is not a kept cue.
    paragraphs = clean_cues(load("annotations"), [])
    assert len(paragraphs) == 1


def test_duplicate_line_dropped_across_cues() -> None:
    cues = [Cue(0, 1, ["a", "a"]), Cue(1, 2, ["a", "b"]), Cue(2, 3, ["a"])]
    assert clean_cues(cues, []) == ["a b a"]


def test_segments_drop_cue_by_midpoint() -> None:
    cues = [Cue(0, 2, ["a"]), Cue(2, 4, ["b"]), Cue(4, 6, ["c"])]
    # midpoints 1, 3, 5: start inclusive, end exclusive
    assert clean_cues(cues, [(3.0, 5.0)]) == ["a", "c"]
    assert clean_cues(cues, [(1.0, 3.0)]) == ["b c"]
