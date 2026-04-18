#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import io
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from pypdf import PdfReader

from document_parser_common import build_outline, clean_text, compact_title, looks_like_structured_heading, split_blocks


def run_process(command: list[str]) -> tuple[int, str]:
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    return result.returncode, result.stdout


def run_ocr(pdf_path: Path, page_number: int) -> tuple[str, list[str]]:
    warnings: list[str] = []
    pdftoppm = shutil.which("pdftoppm")
    if not pdftoppm:
        return "", ["pdf_render_tool_missing"]

    tesseract = shutil.which("tesseract")
    if not tesseract:
        return "", ["pdf_ocr_tool_missing"]

    with tempfile.TemporaryDirectory(prefix="doc-ocr-") as temp_dir:
        temp_prefix = Path(temp_dir) / "page"
        render_command = [pdftoppm, "-f", str(page_number), "-l", str(page_number), "-png", str(pdf_path), str(temp_prefix)]
        render_code, _ = run_process(render_command)
        if render_code != 0:
            return "", [f"pdf_render_failed:{page_number}"]

        image_path = Path(f"{temp_prefix}-{page_number}.png")
        if not image_path.exists():
            fallback = sorted(Path(temp_dir).glob("*.png"))
            if not fallback:
                return "", [f"pdf_render_failed:{page_number}"]
            image_path = fallback[0]

        ocr_command = [tesseract, str(image_path), "stdout", "-l", "eng+chi_sim"]
        ocr_code, ocr_output = run_process(ocr_command)
        if ocr_code != 0:
            ocr_command = [tesseract, str(image_path), "stdout"]
            ocr_code, ocr_output = run_process(ocr_command)

        if ocr_code != 0:
            return "", [f"pdf_ocr_failed:{page_number}"]

        return clean_text(ocr_output), warnings


def parse_pdf(path: Path) -> dict:
    reader = PdfReader(str(path))
    warnings: list[str] = []
    pages: list[dict] = []
    partial = False

    for page_index, page in enumerate(reader.pages, start=1):
        extracted = clean_text(page.extract_text() or "")
        page_warnings: list[str] = []

        if len(extracted) < 80:
            ocr_text, ocr_warnings = run_ocr(path, page_index)
            page_warnings.extend(ocr_warnings)
            if ocr_text and len(ocr_text) > len(extracted):
                extracted = ocr_text
            elif ocr_warnings:
                partial = True

        warnings.extend(page_warnings)
        pages.append({"page": page_index, "text": extracted})

    flat_blocks: list[dict] = []
    for page in pages:
        blocks = split_blocks(page["text"])
        if not blocks and page["text"]:
            blocks = [page["text"]]
        for block in blocks:
            flat_blocks.append({"page": page["page"], "text": block})

    segments: list[dict] = []
    stack: list[dict] = []
    current: dict | None = None
    pending_intro: list[dict] = []
    counter = 0
    section_found = False

    def flush_current() -> None:
        nonlocal current
        if not current:
            return
        current["content"] = clean_text(current["content"])
        segments.append(current)
        current = None

    for block in flat_blocks:
        text = block["text"]
        is_heading, level = looks_like_structured_heading(text)
        if is_heading:
            section_found = True
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
                "pageStart": block["page"],
                "pageEnd": block["page"],
                "level": level,
                "parentId": parent["id"] if parent else None,
                "path": path_parts,
                "order": counter,
            }
            stack.append({"id": current["id"], "level": level, "path": path_parts})
            continue

        if current:
            current["content"] = f"{current['content']}\n\n{text}".strip()
            current["pageEnd"] = block["page"]
        else:
            pending_intro.append(block)

    flush_current()

    if pending_intro:
        intro_text = clean_text("\n\n".join(item["text"] for item in pending_intro))
        if intro_text:
            segments.insert(
                0,
                {
                    "id": "segment-0",
                    "kind": "block",
                    "title": compact_title(intro_text, "Intro"),
                    "content": intro_text,
                    "pageStart": pending_intro[0]["page"],
                    "pageEnd": pending_intro[-1]["page"],
                    "level": 0,
                    "parentId": None,
                    "path": [compact_title(intro_text, "Intro")],
                    "order": 0,
                },
            )

    if not section_found:
        warnings.append("pdf_section_fallback_to_pages")
        segments = []
        for page in pages:
            page_text = page["text"]
            if not page_text:
                continue
            segments.append(
                {
                    "id": f"segment-page-{page['page']}",
                    "kind": "page",
                    "title": f"Page {page['page']}",
                    "content": page_text,
                    "pageStart": page["page"],
                    "pageEnd": page["page"],
                    "level": 0,
                    "parentId": None,
                    "path": [f"Page {page['page']}"],
                    "order": page["page"],
                }
            )

    metadata_title = None
    try:
        metadata_title = reader.metadata.title if reader.metadata else None
    except Exception:
        metadata_title = None

    full_text = clean_text("\n\n".join(page["text"] for page in pages if page["text"]))
    title = clean_text(metadata_title or "") or (segments[0]["title"] if segments else path.stem)
    status = "failed" if not full_text else "partial" if partial else "ready"
    if not full_text:
        warnings.append("empty_document_text")

    return {
        "title": title,
        "pageCount": len(reader.pages),
        "charCount": len(full_text),
        "fullText": full_text,
        "segments": segments,
        "outline": build_outline(segments),
        "warnings": warnings,
        "status": status,
    }


def main() -> None:
    input_path = Path(sys.argv[1]).resolve()
    print(json.dumps(parse_pdf(input_path), ensure_ascii=False))


if __name__ == "__main__":
    main()
