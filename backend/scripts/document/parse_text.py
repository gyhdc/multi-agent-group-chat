#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import io
import json
import sys
from pathlib import Path

if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from document_parser_common import build_outline, clean_text, compact_title, split_blocks


def read_text_with_fallback(path: Path) -> tuple[str, list[str]]:
    warnings: list[str] = []
    for encoding in ("utf-8", "utf-8-sig", "gbk"):
        try:
            text = path.read_text(encoding=encoding)
            if encoding != "utf-8":
                warnings.append(f"encoding_fallback:{encoding}")
            return text, warnings
        except Exception:
            continue
    text = path.read_text(encoding="utf-8", errors="replace")
    warnings.append("encoding_fallback:replace")
    return text, warnings


def parse_markdown(text: str, fallback_title: str) -> tuple[list[dict], list[dict], str, list[str]]:
    lines = text.splitlines()
    segments: list[dict] = []
    warnings: list[str] = []
    pending_lines: list[str] = []
    current: dict | None = None
    stack: list[dict] = []
    counter = 0

    def flush_current() -> None:
        nonlocal current
        if not current:
            return
        current["content"] = clean_text(current["content"])
        segments.append(current)
        current = None

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#"):
            heading_text = stripped.lstrip("#").strip()
            level = len(stripped) - len(stripped.lstrip("#"))
            flush_current()
            counter += 1
            while stack and level <= stack[-1]["level"]:
                stack.pop()
            parent = stack[-1] if stack else None
            path = [*parent["path"], heading_text] if parent else [heading_text]
            current = {
                "id": f"segment-{counter}",
                "kind": "section",
                "title": heading_text or f"Section {counter}",
                "content": "",
                "pageStart": None,
                "pageEnd": None,
                "level": level,
                "parentId": parent["id"] if parent else None,
                "path": path,
                "order": counter,
            }
            stack.append({"id": current["id"], "level": level, "path": path})
            continue

        if current:
            current["content"] = f"{current['content']}\n{line}".strip()
        else:
            pending_lines.append(line)

    flush_current()

    intro_text = clean_text("\n".join(pending_lines))
    if intro_text:
        segments.insert(
            0,
            {
                "id": "segment-0",
                "kind": "block",
                "title": "Intro",
                "content": intro_text,
                "pageStart": None,
                "pageEnd": None,
                "level": 0,
                "parentId": None,
                "path": [compact_title(intro_text, fallback_title)],
                "order": 0,
            },
        )

    if not segments:
        warnings.append("markdown_heading_fallback_to_blocks")
        block_segments = []
        for index, block in enumerate(split_blocks(text), start=1):
            block_segments.append(
                {
                    "id": f"segment-{index}",
                    "kind": "block",
                    "title": compact_title(block, f"Block {index}"),
                    "content": block,
                    "pageStart": None,
                    "pageEnd": None,
                    "level": 0,
                    "parentId": None,
                    "path": [compact_title(block, f"Block {index}")],
                    "order": index,
                }
            )
        segments = block_segments

    title = segments[0]["title"] if segments else fallback_title
    return segments, build_outline(segments), title, warnings


def parse_plain_text(text: str, fallback_title: str) -> tuple[list[dict], list[dict], str, list[str]]:
    warnings = []
    blocks = split_blocks(text)
    segments: list[dict] = []
    for index, block in enumerate(blocks, start=1):
        title = compact_title(block, f"Block {index}")
        segments.append(
            {
                "id": f"segment-{index}",
                "kind": "block",
                "title": title,
                "content": block,
                "pageStart": None,
                "pageEnd": None,
                "level": 0,
                "parentId": None,
                "path": [title],
                "order": index,
            }
        )

    title = compact_title(text, fallback_title)
    return segments, build_outline(segments), title, warnings


def main() -> None:
    input_path = Path(sys.argv[1]).resolve()
    file_kind = sys.argv[2].strip().lower()
    fallback_title = input_path.stem

    raw_text, warnings = read_text_with_fallback(input_path)
    cleaned = clean_text(raw_text)

    if file_kind == "md":
        segments, outline, title, parse_warnings = parse_markdown(cleaned, fallback_title)
    else:
        segments, outline, title, parse_warnings = parse_plain_text(cleaned, fallback_title)

    warnings.extend(parse_warnings)
    full_text = clean_text("\n\n".join(segment["content"] for segment in segments if segment["content"]))
    status = "failed" if not full_text else "ready"
    if not full_text:
        warnings.append("empty_document_text")

    print(
        json.dumps(
            {
                "title": title,
                "pageCount": None,
                "charCount": len(full_text),
                "fullText": full_text,
                "segments": segments,
                "outline": outline,
                "warnings": warnings,
                "status": status,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
