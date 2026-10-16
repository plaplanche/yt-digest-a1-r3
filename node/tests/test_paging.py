from yt_digest_node.paging import MARKER, paginate, truncate


def words(n: int, start: int = 0) -> str:
    return " ".join(f"w{i}" for i in range(start, start + n))


def test_no_truncation_under_limit() -> None:
    assert truncate([words(10)], 10) == ([words(10)], False)


def test_truncation_keeps_head_and_tail() -> None:
    paragraphs, truncated = truncate([words(25)], 10)
    assert truncated
    assert paragraphs == [words(5), MARKER, words(5, 20)]
    _, count = paginate(paragraphs, 100)
    assert count == 10


def test_truncation_keeps_inner_paragraph_breaks() -> None:
    paragraphs, truncated = truncate([words(3), words(10, 3), words(10, 13)], 10)
    assert truncated
    assert paragraphs == [words(3), words(2, 3), MARKER, words(5, 18)]


def test_pages_group_paragraphs() -> None:
    pages, count = paginate([words(3), words(2, 3), words(4, 5)], 5)
    assert pages == [f"{words(3)}\n\n{words(2, 3)}", words(4, 5)]
    assert count == 9


def test_long_paragraph_is_cut_and_order_kept() -> None:
    paragraphs = [words(2), words(12, 2), words(1, 14)]
    pages, count = paginate(paragraphs, 5)
    assert pages == [words(2), words(5, 2), words(5, 7), words(2, 12), words(1, 14)]
    assert all(len(p.split()) <= 5 for p in pages)
    assert " ".join(pages).split() == words(15).split()
    assert count == 15


def test_marker_is_not_a_word() -> None:
    pages, count = paginate([words(5), MARKER, words(5, 5)], 5)
    assert count == 10
    assert pages == [f"{words(5)}\n\n{MARKER}", words(5, 5)]


def test_no_text_no_page() -> None:
    assert paginate([], 5) == ([], 0)
