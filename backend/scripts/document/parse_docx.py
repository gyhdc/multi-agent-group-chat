#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import io
import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from document_parser_common import build_outline, clean_text, compact_title, split_blocks

W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def read_docx_xml(path: Path, inner_path: str) -> ET.Element | None:
    with zipfile.ZipFile(path, "r") as archive:
        try:
            with archive.open(inner_path) as handle:
                return ET.parse(handle).getroot()
        except KeyError:
            return None


def read_styles(path: Path) -> dict[str, str]:
    root = read_docx_xml(path, "word/styles.xml")
    if root is None:
        return {}

    styles: dict[str, str] = {}
    for style in root.findall(f"{W_NS}style"):
        style_id = style.get(f"{W_NS}styleId") or style.get("styleId")
        name_node = style.find(f"{W_NS}name")
        style_name = name_node.get(f"{W_NS}val") if name_node is not None else style_id
        if style_id and style_name:
            styles[style_id] = style_name
    return styles


def paragraph_text(node: ET.Element) -> str:
    texts = []
    for text_node in node.iterfind(f".//{W_NS}t"):
        texts.append(text_node.text or "")
    return clean_text("".join(texts))


def table_text(node: ET.Element) -> str:
    rows = []
    for row in node.findall(f"{W_NS}tr"):
        cells = []
        for cell in row.findall(f"{W_NS}tc"):
            cell_text = clean_text(" ".join(paragraph_text(paragraph) for paragraph in cell.findall(f".//{W_NS}p")))
            if cell_text:
                cells.append(cell_text)
        if cells:
            rows.append(" | ".join(cells))
    return clean_text("\n".join(rows))


def heading_level(node: ET.Element, styles: dict[str, str]) -> int | None:
    p_pr = node.find(f"{W_NS}pPr")
    if p_pr is None:
        return None

    style = p_pr.find(f"{W_NS}pStyle")
    style_id = style.get(f"{W_NS}val") if style is not None else None
    style_name = styles.get(style_id or "", style_id or "")
    match = re.search(r"(Heading|标题)\s*([1-6])", style_name, re.IGNORECASE)
    if match:
        return int(match.group(2))
    return None


def parse_docx(path: Path) -> dict:
    document_root = read_docx_xml(path, "word/document.xml")
    if document_root is None:
        return {
            "title": path.stem,
            "pageCount": None,
            "charCount": 0,
            "fullText": "",
            "segments": [],
            "outline": [],
            "warnings": ["docx_missing_document_xml", "empty_document_text"],
            "status": "failed",
        }

    styles = read_styles(path)
    body = document_root.find(f"{W_NS}body")
    warnings: list[str] = []
    all_blocks: list[dict] = []

    if body is not None:
        for child in list(body):
            if child.tag == f"{W_NS}p":
                text = paragraph_text(child)
                if not text:
                    continue
                all_blocks.append({"type": "paragraph", "text": text, "level": heading_level(child, styles)})
            elif child.tag == f"{W_NS}tbl":
                text = table_text(child)
                if not text:
                    continue
                all_blocks.append({"type": "table", "text": text, "level": None})

    segments: list[dict] = []
    stack: list[dict] = []
    current: dict | None = None
    intro_buffer: list[str] = []
    counter = 0

    def flush_current() -> None:
        nonlocal current
        if not current:
            return
        current["content"] = clean_text(current["content"])
        segments.append(current)
        current = None

    for block in all_blocks:
        level = block["level"]
        text = block["text"]
        if level is not None:
            flush_current()
            counter += 1
            while stack and level <= stack[-1]["level"]:
                stack.pop()
            parent = stack[-1] if stack else None
            title = compact_title(text, f"Section {counter}")
            path_parts = [*parent["path"], title] if parent else [title]
            current = {
                "id": f"segment-{counter}",
                "kind": "section",
                "title": title,
                "content": text,
                "pageStart": None,
                "pageEnd": None,
                "level": level,
                "parentId": parent["id"] if parent else None,
                "path": path_parts,
                "order": counter,
            }
            stack.append({"id": current["id"], "level": level, "path": path_parts})
            continue

        if current:
            current["content"] = f"{current['content']}\n\n{text}".strip()
        else:
            intro_buffer.append(text)

    flush_current()

    if intro_buffer:
        intro_text = clean_text("\n\n".join(intro_buffer))
        if intro_text:
            segments.insert(
                0,
                {
                    "id": "segment-0",
                    "kind": "block",
                    "title": compact_title(intro_text, "Intro"),
                    "content": intro_text,
                    "pageStart": None,
                    "pageEnd": None,
                    "level": 0,
                    "parentId": None,
                    "path": [compact_title(intro_text, "Intro")],
                    "order": 0,
                },
            )

    if not any(segment["kind"] == "section" for segment in segments):
        warnings.append("docx_heading_fallback_to_blocks")
        segments = []
        for index, block in enumerate(all_blocks, start=1):
            title = compact_title(block["text"], f"Block {index}")
            segments.append(
                {
                    "id": f"segment-{index}",
                    "kind": "table" if block["type"] == "table" else "block",
                    "title": title,
                    "content": block["text"],
                    "pageStart": None,
                    "pageEnd": None,
                    "level": 0,
                    "parentId": None,
                    "path": [title],
                    "order": index,
                }
            )

    full_text = clean_text("\n\n".join(segment["content"] for segment in segments if segment["content"]))
    title = segments[0]["title"] if segments else path.stem
    status = "failed" if not full_text else "ready"
    if not full_text:
        warnings.append("empty_document_text")

    return {
        "title": title,
        "pageCount": None,
        "charCount": len(full_text),
        "fullText": full_text,
        "segments": segments,
        "outline": build_outline(segments),
        "warnings": warnings,
        "status": status,
    }


def main() -> None:
    input_path = Path(sys.argv[1]).resolve()
    print(json.dumps(parse_docx(input_path), ensure_ascii=False))


if __name__ == "__main__":
    main()
