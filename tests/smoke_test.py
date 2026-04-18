#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import io
import sys
from pathlib import Path

if sys.stdout.encoding != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
if sys.stderr.encoding != "utf-8":
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SCREENSHOT = ROOT / "output" / "smoke-test.png"


def main() -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1200})
        page.goto("http://127.0.0.1:5173", wait_until="networkidle")

        page.get_by_role("button", name="New Room").click()
        page.wait_for_timeout(500)
        page.get_by_role("button", name="Start Fresh").click()
        page.wait_for_timeout(500)
        page.get_by_role("button", name="Step").click()
        page.wait_for_timeout(600)

        composer = page.locator(".composer-card textarea")
        composer.fill("New evidence: the pilot already shows a measurable effect on a small dataset.")
        page.get_by_role("button", name="Send to Discussion").click()
        page.wait_for_timeout(500)

        page.get_by_role("button", name="Run All").click()
        page.wait_for_timeout(1200)

        final_summary = page.locator(".insight-final")
        final_summary.wait_for()
        page.screenshot(path=str(SCREENSHOT), full_page=True)

        summary = final_summary.inner_text().strip()
        message_count = page.locator(".chat-message").count()
        user_message_count = page.locator(".chat-message.kind-user").count()

        print(f"messages={message_count}")
        print(f"user_messages={user_message_count}")
        print(f"summary={summary}")

        browser.close()


if __name__ == "__main__":
    main()
