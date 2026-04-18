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
        page.add_init_script("window.localStorage.clear();")
        page.goto("http://127.0.0.1:5173", wait_until="networkidle")

        page.get_by_test_id("new-room-button").first.click()
        page.wait_for_timeout(400)

        page.get_by_test_id("locale-toggle").click()
        page.wait_for_timeout(250)

        page.get_by_test_id("room-rail-toggle").click()
        page.wait_for_timeout(250)

        page.get_by_test_id("studio-toggle").click()
        page.wait_for_timeout(250)
        page.get_by_test_id("studio-toggle").click()
        page.wait_for_timeout(250)

        page.get_by_test_id("presets-tab-button").click()
        page.wait_for_timeout(250)
        page.get_by_test_id("provider-guide-button").click()
        page.get_by_test_id("provider-guide-modal").wait_for(timeout=3000)
        page.get_by_test_id("provider-guide-close").click()
        page.wait_for_timeout(250)

        page.get_by_test_id("room-tab-button").click()
        page.wait_for_timeout(250)
        page.get_by_test_id("auto-run-delay-input").fill("0.2")
        page.wait_for_timeout(250)

        page.get_by_test_id("start-fresh-button").click()
        page.wait_for_timeout(500)
        page.get_by_test_id("step-button").click()
        page.wait_for_timeout(1000)

        page.locator(".message-reply-button").first.click()
        page.get_by_test_id("composer-reply-card").wait_for(timeout=3000)

        page.get_by_test_id("user-intervention-input").fill(
            "New evidence: the pilot study already shows a measurable effect, but only on a narrow benchmark."
        )
        page.get_by_test_id("user-message-send").click()
        page.wait_for_timeout(500)

        page.get_by_test_id("run-all-button").click()
        final_summary = page.get_by_test_id("final-insight-card")
        final_summary.wait_for(timeout=15000)

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
