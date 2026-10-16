"""Truncation (spec 5.5) and pages (spec 5.6)."""

MARKER = "[…]"


def truncate(paragraphs: list[str], max_words: int) -> tuple[list[str], bool]:
    """Keep the first and last `max_words // 2` words around a `[…]` paragraph."""
    count = sum(len(p.split()) for p in paragraphs)
    if count <= max_words:
        return paragraphs, False
    half = max_words // 2
    head: list[str] = []
    left = half
    for paragraph in paragraphs:
        if left <= 0:
            break
        words = paragraph.split()
        head.append(" ".join(words[:left]))
        left -= len(words)
    tail: list[str] = []
    left = half
    for paragraph in reversed(paragraphs):
        if left <= 0:
            break
        words = paragraph.split()
        tail.append(" ".join(words[-left:]))
        left -= len(words)
    tail.reverse()
    return [*head, MARKER, *tail], True


def paginate(paragraphs: list[str], page_words: int) -> tuple[list[str], int]:
    """Group paragraphs into pages of at most `page_words` words; return the pages and the word count."""
    pages: list[str] = []
    current: list[str] = []
    size = 0
    total = 0

    def flush() -> None:
        nonlocal current, size
        if current:
            pages.append("\n\n".join(current))
        current, size = [], 0

    for paragraph in paragraphs:
        words = paragraph.split()
        weight = 0 if paragraph == MARKER else len(words)
        total += weight
        if weight > page_words:
            flush()
            for i in range(0, weight, page_words):
                pages.append(" ".join(words[i : i + page_words]))
            continue
        if size + weight > page_words:
            flush()
        current.append(paragraph)
        size += weight
    flush()
    return pages, total
