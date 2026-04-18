#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import io
import re
import sys

if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')


def clean_text(text: str) -> str:
    if not text:
        return ""

    normalized = text.replace("\r", "\n").replace("\uf0b7", "-").replace("\u00ad", "")
    normalized = normalized.replace("\t", " ")
    normalized = re.sub(r"[ \u3000]+", " ", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized.strip()


def split_blocks(text: str, max_chars: int = 1400) -> list[str]:
    normalized = clean_text(text)
    if not normalized:
        return []

    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", normalized) if part.strip()]
    if not paragraphs:
        return []

    blocks: list[str] = []
    current = ""

    for paragraph in paragraphs:
        candidate = f"{current}\n\n{paragraph}".strip() if current else paragraph
        if len(candidate) <= max_chars:
            current = candidate
            continue

        if current:
            blocks.append(current)

        if len(paragraph) <= max_chars:
            current = paragraph
            continue

        sentences = re.split(r"(?<=[。！？.!?])\s+", paragraph)
        current = ""
        for sentence in sentences:
            candidate = f"{current} {sentence}".strip() if current else sentence
            if len(candidate) <= max_chars:
                current = candidate
            else:
                if current:
                    blocks.append(current)
                current = sentence[:max_chars].strip()

    if current:
        blocks.append(current)

    return [clean_text(block) for block in blocks if clean_text(block)]


def compact_title(text: str, fallback: str) -> str:
    normalized = clean_text(text)
    if not normalized:
        return fallback

    first_line = normalized.splitlines()[0].strip(" -:#")
    return first_line[:120] or fallback


def build_outline(segments: list[dict]) -> list[dict]:
    nodes: dict[str, dict] = {}
    roots: list[dict] = []

    for segment in segments:
        nodes[segment["id"]] = {
            "id": f"node-{segment['id']}",
            "segmentId": segment["id"],
            "title": segment["title"],
            "kind": segment["kind"],
            "children": [],
            "_order": segment.get("order", 0),
        }

    for segment in segments:
        node = nodes[segment["id"]]
        parent_id = segment.get("parentId")
        if parent_id and parent_id in nodes:
            nodes[parent_id]["children"].append(node)
        else:
            roots.append(node)

    def sort_node(node: dict) -> dict:
        children = [sort_node(child) for child in sorted(node["children"], key=lambda item: item["_order"])]
        return {
            "id": node["id"],
            "segmentId": node["segmentId"],
            "title": node["title"],
            "kind": node["kind"],
            "children": children,
        }

    return [sort_node(node) for node in sorted(roots, key=lambda item: item["_order"])]


def heading_level_from_numbering(text: str) -> int | None:
    match = re.match(r"^(\d+(?:\.\d+){0,5})\s+\S+", text)
    if not match:
        return None
    return match.group(1).count(".") + 1


def looks_like_structured_heading(text: str) -> tuple[bool, int]:
    line = clean_text(text).splitlines()[0] if clean_text(text) else ""
    if not line:
        return False, 0

    numbered = heading_level_from_numbering(line)
    if numbered is not None:
        return True, max(1, min(numbered, 6))

    keywords = {
        "abstract",
        "introduction",
        "background",
        "related work",
        "method",
        "methods",
        "approach",
        "experiments",
        "results",
        "discussion",
        "conclusion",
        "references",
        "summary",
        "education",
        "experience",
        "projects",
        "skills",
        "profile",
        "publications",
        "摘要",
        "引言",
        "方法",
        "实验",
        "结果",
        "讨论",
        "结论",
        "参考文献",
        "教育经历",
        "工作经历",
        "项目经历",
        "技能",
        "个人简介",
        "自我评价",
    }
    normalized = re.sub(r"[:：\-\s]+", " ", line.lower()).strip()
    if normalized in keywords:
        return True, 1

    if len(line) <= 80 and line.isupper() and len(line.split()) <= 8:
        return True, 1

    return False, 0

