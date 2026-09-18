"""Exercise the built UI without real credentials or paid generation calls.
Run after npm run build, with playwright 1.57.0 and Chromium installed.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "verification" / "studio-v2-browser"
OUT.mkdir(parents=True, exist_ok=True)
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(ROOT / "image-studio/frontend/dist")))
Thread(target=server.serve_forever, daemon=True).start()
report = {"checks": [], "errors": [], "live_upstream_tested": False}
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1394, "height": 810}, device_scale_factor=1)
        page.on("pageerror", lambda error: report["errors"].append(str(error)))
        page.on("dialog", lambda dialog: dialog.accept())
        try:
            page.goto(f"http://127.0.0.1:{server.server_port}/?target=windows", wait_until="networkidle")
            expect(page.get_by_role("heading", name="用 AI，创造无限可能")).to_be_visible(timeout=20000)
            page.screenshot(path=str(OUT / "home.png"))
            assert page.evaluate("document.body.scrollWidth <= innerWidth + 1"), "Home overflows viewport"
            report["checks"].append("Home loads at 1394x810 without page overflow")
            page.locator(".studio-quick-grid button").filter(has_text="新建画布").click()
            expect(page.locator(".studio-creator")).to_be_visible()
            expect(page.locator('[title="双击重命名"]')).to_have_count(2)
            page.screenshot(path=str(OUT / "canvas.png"))
            report["checks"].append("New canvas opens professional mode and creates workspace")
            page.locator(".studio-mode-switch").get_by_role("button", name="简洁模式", exact=True).click()
            prompt = page.get_by_role("textbox", name="创作提示词", exact=True)
            prompt.fill("STUDIO_V2_PERSISTENCE_SMOKE")
            page.wait_for_timeout(1200)
            assert page.locator(".studio-save-error").count() == 0, "Canvas autosave failed"
            page.reload(wait_until="networkidle")
            expect(page.get_by_role("heading", name="用 AI，创造无限可能")).to_be_visible(timeout=20000)
            page.locator(".studio-mode-switch").get_by_role("button", name="简洁模式", exact=True).click()
            expect(page.get_by_role("textbox", name="创作提示词", exact=True)).to_have_value("STUDIO_V2_PERSISTENCE_SMOKE")
            expect(page.locator('[title="双击重命名"]')).to_have_count(2)
            report["checks"].append("Workspace list and prompt survive reload using IndexedDB fallback")
            page.locator(".xai-media-tabs").get_by_role("button", name="视频", exact=True).click()
            expect(page.get_by_role("textbox", name="视频提示词")).to_be_visible()
            expect(page.get_by_role("button", name="生成视频", exact=True)).to_be_disabled()
            page.screenshot(path=str(OUT / "video.png"))
            report["checks"].append("Video UI opens and disables requests without desktop service")
            page.get_by_role("button", name="XAI 首页").click()
            page.set_viewport_size({"width": 740, "height": 900})
            expect(page.get_by_role("heading", name="用 AI，创造无限可能")).to_be_visible()
            page.screenshot(path=str(OUT / "responsive.png"))
            assert page.evaluate("document.body.scrollWidth <= innerWidth + 1"), "Responsive home overflows viewport"
            report["checks"].append("Responsive home remains within 740px viewport")
            assert not report["errors"], report["errors"]
            report["passed"] = True
        except Exception as error:
            report["passed"] = False
            report["failure"] = str(error)
            page.screenshot(path=str(OUT / "failure.png"))
            (OUT / "failure.html").write_text(page.content(), encoding="utf-8")
            raise
        finally:
            (OUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            browser.close()
finally:
    server.shutdown()
