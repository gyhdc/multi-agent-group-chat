import assert from "node:assert/strict";
import test from "node:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { createBlankRoom, createProviderConfig, normalizeRole } from "../src/defaults";
import {
  attachDocumentToRoom,
  buildDefaultDocumentTopic,
  canGenerateRecorderTopic,
  clearRoomDocument,
  updateRoomDocumentFocus,
  WHOLE_DOCUMENT_SEGMENT_ID,
} from "../src/documents";
import { startDiscussion } from "../src/orchestrator";

function createRoom() {
  const room = createBlankRoom();
  room.id = `test-room-${Math.random().toString(16).slice(2)}`;
  room.roles = [
    normalizeRole({
      name: "Reviewer",
      kind: "participant",
      roleTemplateKey: "reviewer",
      providerPresetId: null,
      provider: createProviderConfig("mock"),
      accentColor: "#8b3d3d",
      persona: "Reviewer persona",
      principles: "Reviewer principles",
      goal: "Reviewer goal",
      voiceStyle: "Reviewer voice",
      enabled: true,
    }),
    normalizeRole({
      name: "Recorder",
      kind: "recorder",
      roleTemplateKey: "recorder",
      providerPresetId: null,
      provider: createProviderConfig("openai-compatible"),
      accentColor: "#5b6475",
      persona: "Recorder persona",
      principles: "Recorder principles",
      goal: "Recorder goal",
      voiceStyle: "Recorder voice",
      enabled: true,
    }),
  ];
  return room;
}

async function makeTempFile(fileName: string, content: string | Buffer): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "magc-doc-test-"));
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, content);
  return filePath;
}

function runPythonGenerator(script: string): void {
  const candidates: Array<{ command: string; prefixArgs: string[] }> = [{ command: "python", prefixArgs: [] }, { command: "py", prefixArgs: ["-3"] }];
  let lastError = "";
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.prefixArgs, "-"], {
      input: script,
      encoding: "utf-8",
    });
    if (result.status === 0) {
      return;
    }
    lastError = result.stderr || result.stdout || lastError;
  }
  throw new Error(lastError || "Failed to run Python fixture generator.");
}

function createDocxFixture(filePath: string): void {
  runPythonGenerator(`
import zipfile
from pathlib import Path

path = Path(r"${filePath.replace(/\\/g, "\\\\")}")
content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>"""
rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""
document_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"""
styles = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/></w:style>
</w:styles>"""
document = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Experience</w:t></w:r>
    </w:p>
    <w:p><w:r><w:t>Built document parsing systems.</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Skill</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Level</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Python</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Advanced</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
    <w:sectPr/>
  </w:body>
</w:document>"""
with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
  archive.writestr("[Content_Types].xml", content_types)
  archive.writestr("_rels/.rels", rels)
  archive.writestr("word/_rels/document.xml.rels", document_rels)
  archive.writestr("word/styles.xml", styles)
  archive.writestr("word/document.xml", document)
`)
}

function createPdfFixture(text: string): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 18 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

test("short text documents enter whole-document mode and seed a default topic", async () => {
  const room = createRoom();
  const filePath = await makeTempFile("notes.txt", "Short notes about a paper idea.\n\nKey claim: the benchmark is narrow.");

  try {
    await attachDocumentToRoom(room, {
      path: filePath,
      originalName: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 72,
    });

    assert.equal(room.documentDiscussionMode, "whole-document");
    assert.deepEqual(room.selectedDocumentSegmentIds, [WHOLE_DOCUMENT_SEGMENT_ID]);
    assert.ok(room.documentAsset);
    assert.equal(room.documentAsset.fileKind, "txt");
    assert.ok(room.topic.length > 0);
  } finally {
    await clearRoomDocument(room);
    await fs.rm(path.dirname(filePath), { recursive: true, force: true });
  }
});

test("long markdown documents fall back to selected-segment mode", async () => {
  const room = createRoom();
  const longBody = "# Section One\n" + "A".repeat(7000) + "\n\n# Section Two\n" + "B".repeat(7000);
  const filePath = await makeTempFile("paper.md", longBody);

  try {
    await attachDocumentToRoom(room, {
      path: filePath,
      originalName: "paper.md",
      mimeType: "text/markdown",
      sizeBytes: longBody.length,
    });

    assert.equal(room.documentDiscussionMode, "selected-segments");
    assert.equal(room.selectedDocumentSegmentIds.length, 0);
    assert.ok(room.documentOutline.length > 0);
    assert.match(buildDefaultDocumentTopic(room), /选择|Select/);

    const firstSegmentId = room.documentSegments.find((segment) => segment.kind === "section")?.id;
    assert.ok(firstSegmentId);
    updateRoomDocumentFocus(room, { discussionMode: "selected-segments", selectedSegmentIds: [firstSegmentId] });
    assert.equal(room.selectedDocumentSegmentIds.length, 1);
    startDiscussion(room);
    assert.equal(room.state.status, "running");
  } finally {
    await clearRoomDocument(room);
    await fs.rm(path.dirname(filePath), { recursive: true, force: true });
  }
});

test("pdf parsing extracts text and records the pdf file kind", async () => {
  const room = createRoom();
  const pdfPath = await makeTempFile("sample.pdf", createPdfFixture("PDF fixture for discussion"));

  try {
    await attachDocumentToRoom(room, {
      path: pdfPath,
      originalName: "sample.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });

    assert.ok(room.documentAsset);
    assert.equal(room.documentAsset.fileKind, "pdf");
    assert.ok(room.documentAsset.charCount > 0);
    assert.ok(room.documentSegments.length > 0);
  } finally {
    await clearRoomDocument(room);
    await fs.rm(path.dirname(pdfPath), { recursive: true, force: true });
  }
});

test("docx parsing builds structured segments from headings and tables", async () => {
  const room = createRoom();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "magc-docx-test-"));
  const docxPath = path.join(tempDir, "resume.docx");
  createDocxFixture(docxPath);

  try {
    const stats = await fs.stat(docxPath);
    await attachDocumentToRoom(room, {
      path: docxPath,
      originalName: "resume.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: stats.size,
    });

    assert.ok(room.documentAsset);
    assert.equal(room.documentAsset.fileKind, "docx");
    assert.ok(room.documentSegments.some((segment) => segment.kind === "section"));
    assert.ok(room.documentSegments.some((segment) => segment.content.includes("Python | Advanced")));
  } finally {
    await clearRoomDocument(room);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("recorder topic generation is only available with a non-mock recorder and an attached document", async () => {
  const room = createRoom();
  const initial = canGenerateRecorderTopic(room);
  assert.equal(initial.enabled, false);

  const filePath = await makeTempFile("notes.txt", "Resume review notes.");
  try {
    await attachDocumentToRoom(room, {
      path: filePath,
      originalName: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 20,
    });

    const afterAttach = canGenerateRecorderTopic(room);
    assert.equal(afterAttach.enabled, true);
    assert.ok(afterAttach.recorder);

    room.roles[1].provider.type = "mock";
    const afterMock = canGenerateRecorderTopic(room);
    assert.equal(afterMock.enabled, false);
  } finally {
    await clearRoomDocument(room);
    await fs.rm(path.dirname(filePath), { recursive: true, force: true });
  }
});
