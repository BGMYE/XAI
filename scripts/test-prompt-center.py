#!/usr/bin/env python3
"""Production-browser regression. No API Key or external network required.
Run after `npm ci && npm run build:windows` in image-studio/frontend.
Python dependency: playwright; browser: `python -m playwright install chromium`.
"""
from __future__ import annotations
import argparse
import base64
import functools
import http.server
import json
import re
from pathlib import Path
import threading
import traceback
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5v8AAAAASUVORK5CYII=')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', default=None, help='Optional installed Chromium executable')
    parser.add_argument('--offline-bundle', type=Path, default=None, help='Use inline components and an explicit mock Wails/media boundary; no origin/IndexedDB/native clipboard coverage')
    parser.add_argument('--fixtures', type=Path, default=None, help='Optional local coffee.png/cat.png/rocket.png, used only for screenshots')
    args = parser.parse_args()
    out = ROOT / 'image-studio/frontend/studio-evidence/prompt-center'
    out.mkdir(parents=True, exist_ok=True)
    dist = ROOT / 'image-studio/frontend/dist'
    if not (dist / 'index.html').exists():
        raise RuntimeError('Build the Windows-target frontend before browser validation.')
    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, fmt, *values): pass
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(dist)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    checks, errors, external = [], [], []
    def passed(label):
        checks.append(label)
        print('PASS:', label, flush=True)
    samples = [
        ('coffee', '窗边咖啡 · 产品摄影', 'image', '摄影', '  清晨窗边的一杯咖啡，陶瓷杯与温暖木桌。\n柔和侧光，浅景深，真实材质。  '),
        ('cat', '秋日猫咪 · 柔光肖像', 'image', '动物', '猫咪安静地看向镜头，柔和自然光，毛发细腻，背景散景。'),
        ('rocket', '航天纪实 · 缓慢运镜', 'video', '电影', '<script>window.__promptXSS=true</script>\n镜头缓慢推进，保留现场环境与自然光，不增加字幕。'),
    ]
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path=args.browser, args=['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'])
        context = browser.new_context(viewport={'width': 1440, 'height': 1000}, locale='zh-CN', accept_downloads=True)
        if not args.offline_bundle:
            context.grant_permissions(['clipboard-read','clipboard-write'], origin=origin)
        def route(request):
            if request.request.url.startswith(origin) or request.request.url.startswith(('data:', 'blob:')):
                request.continue_()
            elif request.request.url.startswith('https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources/'):
                request.fulfill(status=200,content_type='application/json',body='[]')
            else:
                external.append(request.request.url)
                request.abort()
        context.route('**/*', route)
        page = context.new_page()
        page.set_default_timeout(12000)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('dialog', lambda dialog: dialog.accept())
        try:
            if args.offline_bundle:
                page.set_content('<html><body><div id="root"></div></body></html>')
                html=(dist/'index.html').read_text()
                for link in re.findall(r'<link[^>]+href="([^"]+\.css)"',html):
                    page.add_style_tag(content=(dist/link.lstrip('/')).read_text())
                page.add_script_tag(content=args.offline_bundle.read_text())
            else:
                page.goto(origin, wait_until='networkidle')
            page.locator('.studio-mode-switch').get_by_role('button', name='专业模式', exact=True).click()
            expect(page.get_by_role('heading', name='无限画布', exact=True)).to_be_visible()
            page.get_by_role('button', name='资源 · 提示词', exact=True).click()
            expect(page.locator('.pc-drawer')).to_be_visible()
            expect(page.locator('.studio-mode-switch button.active')).to_have_text('专业模式')
            expect(page.get_by_role('tab', name='提示词中心')).to_have_attribute('aria-selected','true')
            page.get_by_role('tab',name='我的资源',exact=True).click()
            expect(page.locator('.pc-card')).to_have_count(0)
            passed('Professional resource drawer preserves the canvas and has no fabricated history')

            for idx, (filename, title, kind, category, prompt) in enumerate(samples):
                page.get_by_role('button', name='新建提示词', exact=True).click()
                editor = page.locator('.pc-dialog[open]')
                image = (args.fixtures / f'{filename}.png').read_bytes() if args.fixtures else PNG
                editor.locator('input[type=file]').set_input_files({'name':f'{filename}.png','mimeType':'image/png','buffer':image})
                # Import is asynchronous; do not overwrite the auto-filled title before it finishes.
                expect(editor.get_by_role('button', name='上传预览图')).to_be_enabled()
                expect(editor.get_by_label('提示词预览素材')).not_to_have_value('')
                editor.get_by_label('标题', exact=True).fill(title)
                editor.get_by_label('用途', exact=True).select_option(kind)
                editor.get_by_label('分类', exact=True).fill(category)
                editor.get_by_label('标签', exact=True).fill('自然光，示例')
                editor.get_by_label('作者／来源说明').fill('本地验收示例')
                editor.get_by_label('完整提示词', exact=True).fill(prompt)
                editor.get_by_role('button', name='保存提示词', exact=True).click()
                expect(page.locator('.pc-dialog[open]')).to_have_count(0)
                expect(page.locator('.pc-card')).to_have_count(idx + 1)
            passed('Upload local previews and persist image/video prompt cards')

            coffee = page.locator('.pc-card').filter(has_text=samples[0][1])
            coffee.get_by_role('button', name='复制提示词', exact=True).click()
            expect(page.get_by_role('status')).to_contain_text('完整提示词已复制')
            assert page.evaluate('window.__promptFixture.copied' if args.offline_bundle else 'navigator.clipboard.readText()') == samples[0][4]
            coffee.get_by_role('button', name=f'收藏：{samples[0][1]}').click()
            expect(coffee.get_by_role('button', name=f'取消收藏：{samples[0][1]}')).to_have_attribute('aria-pressed','true')
            page.get_by_role('button', name='我的收藏', exact=True).click()
            expect(page.locator('.pc-card')).to_have_count(1)
            page.get_by_role('button', name='我的收藏', exact=True).click()
            passed('Full prompt clipboard copy preserves whitespace; favorites filter works')

            page.get_by_role('textbox',name='搜索提示词').fill('航天')
            page.get_by_label('筛选提示词用途').select_option('video')
            page.get_by_label('筛选提示词分类').select_option('电影')
            expect(page.locator('.pc-card')).to_have_count(1)
            page.get_by_role('button',name=f'查看提示词：{samples[2][1]}').click()
            dialog = page.locator('.pc-dialog[open]')
            expect(dialog.get_by_role('textbox',name='完整提示词原文')).to_have_value(samples[2][4])
            assert page.evaluate('window.__promptXSS === undefined')
            dialog.get_by_role('button',name='复制完整提示词').click()
            assert page.evaluate('window.__promptFixture.copied' if args.offline_bundle else 'navigator.clipboard.readText()') == samples[2][4]
            dialog.get_by_role('button',name='关闭提示词对话框').click()
            passed('Combined search/category/media filters and safe literal prompt detail')
            page.get_by_role('textbox',name='搜索提示词').fill('')
            page.get_by_label('筛选提示词用途').select_option('all')
            page.get_by_label('筛选提示词分类').select_option('all')
            expect(page.locator('.pc-card')).to_have_count(3)
            page.locator('.pc-content').evaluate('(e) => e.scrollTop = 0')
            page.screenshot(path=str(out/'professional-resources.png'))

            page.locator('.pc-card').filter(has_text=samples[2][1]).get_by_role('button',name='加入画布',exact=True).click()
            expect(page.locator('.pc-drawer')).to_have_count(0)
            expect(page.locator('.studio-node')).to_have_count(2)
            expect(page.locator('.studio-node.kind-video')).to_have_count(1)
            expect(page.locator('.studio-edge-hit')).to_have_count(1)
            expect(page.locator('.studio-node.kind-prompt .studio-node-body')).to_contain_text(samples[2][4])
            assert page.locator('.studio-node.kind-asset').count() == 0
            if args.offline_bundle:
                page.evaluate('window.__promptFixture.remount()')
            else:
                page.reload(wait_until='networkidle')
            page.locator('.studio-mode-switch').get_by_role('button',name='专业模式',exact=True).click()
            expect(page.locator('.studio-node')).to_have_count(2)
            page.screenshot(path=str(out/'prompt-on-canvas.png'))
            passed('Adding a prompt creates two connected nodes; canvas survives ' + ('component remount with mock host' if args.offline_bundle else 'reload') + ' without auto-generation')

            page.get_by_role('button',name='资源 · 提示词',exact=True).click()
            page.get_by_role('tab',name='我的资源',exact=True).click()
            expect(page.locator('.pc-card')).to_have_count(3)
            expect(page.get_by_role('button',name=f'取消收藏：{samples[0][1]}')).to_have_attribute('aria-pressed','true')
            page.get_by_role('button',name=f'查看提示词：{samples[0][1]}').click()
            page.locator('.pc-dialog[open]').get_by_role('button',name='编辑',exact=True).click()
            editor=page.locator('.pc-dialog[open]')
            edited='保留原图，修改提示词\n第二行完整保留。'
            editor.get_by_label('完整提示词',exact=True).fill(edited)
            editor.get_by_role('button',name='保存提示词',exact=True).click()
            expect(page.locator('.pc-dialog[open]')).to_have_count(0)
            expect(page.locator('.pc-card').filter(has_text=samples[0][1]).locator('.pc-excerpt')).to_have_text(edited)
            passed('Cards, favorites and edits persist independently from canvas history')

            with page.expect_download() as download_info:
                page.get_by_role('button',name='导出筛选结果',exact=True).click()
            download=download_info.value
            pack_path=out/'exported-prompt-pack.json'
            download.save_as(str(pack_path))
            pack=json.loads(pack_path.read_text())
            assert pack['format']=='xai.prompt-pack' and len(pack['items'])==3
            serialized=json.dumps(pack)
            assert all(key not in serialized for key in ['previewAssetId','sourceJobId','apiKey','credentialId','baseUrl','fileName'])
            with page.expect_file_chooser() as chooser_info:
                page.get_by_role('button',name='导入资料包',exact=True).click()
            chooser_info.value.set_files(str(pack_path))
            expect(page.locator('.pc-card')).to_have_count(6)
            # Text-only import does not trigger remote downloads or pretend to bundle images.
            expect(page.locator('.pc-card .pc-preview-empty')).to_have_count(3)
            page.get_by_role('tab',name='本地素材',exact=True).click()
            expect(page.locator('.pc-card')).to_have_count(3)
            page.get_by_role('tab',name='提示词中心',exact=True).click()
            page.get_by_role('tab',name='我的资源',exact=True).click()
            passed('Text-only prompt packs round-trip with explicit missing previews and no credential fields')

            imported=page.locator('.pc-card').filter(has=page.locator('.pc-preview-empty')).first
            imported.locator('.pc-cover-button').click()
            page.locator('.pc-dialog[open]').get_by_role('button',name='删除卡片',exact=True).click()
            expect(page.locator('.pc-card')).to_have_count(5)
            page.get_by_role('tab',name='本地素材',exact=True).click()
            expect(page.locator('.pc-card')).to_have_count(3)
            page.get_by_role('tab',name='提示词中心',exact=True).click()
            page.get_by_role('tab',name='我的资源',exact=True).click()
            passed('Deleting a library card leaves original assets intact')

            # Exercise clipboard error handling; stale success notices must be cleared.
            if args.offline_bundle:
                page.evaluate('window.__promptFixture.clipboardFail = true')
            else:
                page.evaluate("""() => {Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(Error('denied'))}});document.execCommand=()=>false;}""")
            page.locator('.pc-card').first.get_by_role('button',name='复制提示词',exact=True).click()
            expect(page.locator('.pc-content > .pc-error')).to_contain_text('剪贴板写入失败' if args.offline_bundle else '不允许复制')
            expect(page.locator('.pc-content > .pc-notice')).to_have_count(0)
            passed('Denied clipboard writes produce an error, not false success')

            page.evaluate("document.documentElement.classList.add('dark')")
            for width,height in [(1100,780),(760,900)]:
                page.set_viewport_size({'width':width,'height':height})
                expect(page.locator('.pc-drawer')).to_be_visible()
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                box=page.locator('.pc-drawer').bounding_box()
                assert box and box['x']>=0 and box['x']+box['width']<=width
                page.screenshot(path=str(out/f'resources-{width}.png'))
            passed('Resource drawer remains usable at minimum desktop width and narrow preview')
            if args.offline_bundle:
                assert page.evaluate('window.__promptFixture.paidCalls') == 0
            assert errors==[], errors
            assert external==[], external
            passed('No uncaught runtime errors, external requests or paid API calls')
        except Exception:
            traceback.print_exc()
            try:
                (out/'failure.html').write_text(page.content(),encoding='utf8')
                page.screenshot(path=str(out/'failure.png'), timeout=10000)
            except Exception as screenshot_error:
                print('Screenshot unavailable:', screenshot_error,flush=True)
            raise
        finally:
            (out/'report.json').write_text(json.dumps({'checks':checks,'errors':errors,'external':external,'sampleData':True,'mode':'offline-components-mock-host' if args.offline_bundle else 'production-browser-preview'},ensure_ascii=False,indent=2),encoding='utf8')
            browser.close()
            server.shutdown()

if __name__=='__main__':
    main()
