#!/usr/bin/env python3
"""Actual React UI with the reference website's real captured JSON and images.
Production mode exercises browser fetch/IndexedDB/clipboard; optional offline
mode explicitly substitutes only the Wails host, not the third-party content.
"""
import argparse
import functools
import http.server
import json
import re
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright,expect

ROOT=Path(__file__).resolve().parents[1]
BASE='https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources/'

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--sources',type=Path,default=ROOT/'image-studio/frontend/studio-evidence/reference-source');ap.add_argument('--browser');ap.add_argument('--offline-bundle',type=Path);args=ap.parse_args()
    source=args.sources;manifest=json.loads((source/'manifest.json').read_text());raws={s['id']:(source/(s['id']+'.json')).read_text() for s in manifest['sources']}
    rows=json.loads(raws['banana-prompt-quicker']);count=sum(len(json.loads(x)) for x in raws.values())
    media={x['url']:(source/x['file']).read_bytes() for x in manifest['images'] if 'file'in x}
    out=ROOT/'image-studio/frontend/studio-evidence/public-catalog';out.mkdir(parents=True,exist_ok=True)
    dist=ROOT/'image-studio/frontend/dist'
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self,*args):pass
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(dist)));threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
    checks=[];errors=[];paid=[];unexpected=[];network={'offline':False}
    def passed(msg):checks.append(msg);print('PASS:',msg,flush=True)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path=args.browser,args=['--no-sandbox','--disable-dev-shm-usage'])
        ctx=browser.new_context(viewport={'width':1440,'height':1080},locale='zh-CN',accept_downloads=True)
        if not args.offline_bundle:ctx.grant_permissions(['clipboard-read','clipboard-write'],origin=origin)
        def route(r):
            u=r.request.url
            if r.request.method not in ('GET','HEAD'):paid.append(u);r.abort();return
            assert not r.request.headers.get('authorization'), 'Catalog must never carry API credentials'
            if u.startswith(origin) or u.startswith(('blob:','data:')):r.continue_()
            elif u.startswith(BASE):
                if network['offline']:r.abort()
                else:r.fulfill(status=200,content_type='application/json',body=raws[u[len(BASE):].removesuffix('.json')],headers={'access-control-allow-origin':'*'})
            elif u in media and not network['offline']:r.fulfill(status=200,content_type='image/png' if media[u].startswith(b'\x89PNG') else 'image/jpeg',body=media[u])
            else:
                # Uncaptured original images (including the site's broken item)
                # deliberately fail; the app must show an honest placeholder.
                r.abort()
        ctx.route('**/*',route)
        page=ctx.new_page();page.set_default_timeout(15000);page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
        def launch():
            if args.offline_bundle:
                page.set_content('<html><body><div id="root"></div></body></html>')
                for url in re.findall(r'<link[^>]+href="([^"]+\.css)"',(dist/'index.html').read_text()):page.add_style_tag(content=(dist/url.lstrip('/')).read_text())
                page.evaluate('(sources)=>window.__catalogFixture={sources,fail:false}',raws)
                page.add_script_tag(content=args.offline_bundle.read_text())
            else:page.goto(origin,wait_until='networkidle')
        def resources():
            page.locator('.studio-mode-switch').get_by_role('button',name='专业模式',exact=True).click()
            page.get_by_role('button',name='资源 · 提示词',exact=True).click()
        def copied():return page.evaluate('window.__promptFixture.copied' if args.offline_bundle else 'navigator.clipboard.readText()')
        try:
            launch();resources()
            expect(page.get_by_role('tab',name='站点图库',exact=True)).to_have_attribute('aria-selected','true')
            expect(page.locator('.pc-public-catalog .pc-count b')).to_have_text(f'{count:,}')
            expect(page.locator('.pc-public-grid .pc-card')).to_have_count(24)
            titles=page.locator('.pc-public-grid h3').all_text_contents()
            assert titles[:12]==[x['title'] for x in rows[:12]]
            for index,item in enumerate(rows[:12]):
                el=page.locator(f'[data-catalog-key="{item["id"]}"]')
                if el.locator('img').count():assert el.locator('img').get_attribute('src')==item['coverUrl']
            for item in rows[:2]:expect(page.locator(f'[data-catalog-key="{item["id"]}"] img')).to_be_visible()
            page.wait_for_function('Array.from(document.querySelectorAll(".pc-public-grid img")).slice(0,2).every(i=>i.complete&&i.naturalWidth>0)')
            page.screenshot(path=str(out/'catalog-overview.png'))
            # Re-open from the valid in-memory cache before the visual capture.
            # In the opaque offline harness IndexedDB is intentionally absent.
            page.get_by_role('tab',name='我的资源',exact=True).click()
            page.get_by_role('tab',name='站点图库',exact=True).click()
            expect(page.locator('.pc-public-catalog .pc-count b')).to_have_text(f'{count:,}')
            page.set_viewport_size({'width':1440,'height':1400})
            page.locator('.pc-content').evaluate('(e)=>e.scrollTop=330')
            page.wait_for_timeout(250)
            page.screenshot(path=str(out/'professional-original-catalog.png'))
            page.locator('.pc-content').evaluate('(e)=>e.scrollTop=0')
            page.set_viewport_size({'width':1440,'height':1080})
            passed('All seven exact source feeds load; first twelve cards match the user screenshot in original order')
            first=page.locator(f'[data-catalog-key="{rows[0]["id"]}"]')
            first.get_by_role('button',name='复制',exact=True).click();expect(page.locator('.pc-public-catalog > [role=status]')).to_contain_text('已复制')
            assert copied()==rows[0]['prompt'];passed('Copy preserves the complete original prompt, not its card summary')
            first.get_by_role('button',name='加入我的资源',exact=True).click();expect(first.get_by_role('button',name='已加入我的资源')).to_be_disabled()
            page.get_by_role('tab',name='我的资源',exact=True).click();expect(page.locator('.pc-card')).to_have_count(1)
            assert page.locator('.pc-card img').get_attribute('src')==rows[0]['coverUrl']
            page.get_by_role('button',name='查看提示词：'+rows[0]['title']).click();expect(page.get_by_role('textbox',name='完整提示词原文')).to_have_value(rows[0]['prompt']);page.get_by_role('button',name='关闭提示词对话框').click()
            passed('Saving keeps source identity, original image URL and prompt together in personal resources')
            page.get_by_role('tab',name='站点图库',exact=True).click();expect(page.locator('.pc-public-catalog .pc-count b')).to_have_text(f'{count:,}')
            expect(page.locator(f'[data-catalog-key="{rows[0]["id"]}"]').get_by_role('button',name='已加入我的资源')).to_be_disabled()
            page.get_by_role('textbox',name='搜索站点图库').fill('疯狂动物城海报');expect(page.locator('.pc-public-grid .pc-card')).to_have_count(1)
            page.get_by_role('button',name='查看图库提示词：疯狂动物城海报').click();expect(page.get_by_role('textbox',name='图库完整提示词')).to_have_value(rows[1]['prompt'])
            page.get_by_role('button',name='复制完整提示词').click();assert copied()==rows[1]['prompt']
            page.get_by_role('button',name='关闭图库详情').click();page.get_by_role('textbox',name='搜索站点图库').fill('')
            passed('Source search and detail retain the exact second image and full text')
            page.get_by_label('选择图库来源').select_option('awesome-gpt-image');expect(page.locator('.pc-filters > span')).to_have_text(f'{len(json.loads(raws["awesome-gpt-image"]))} 条结果');page.get_by_label('选择图库来源').select_option('all')
            if args.offline_bundle:page.evaluate('window.__catalogFixture.fail=true')
            network['offline']=True;page.get_by_role('button',name='刷新图库',exact=True).click();expect(page.get_by_role('button',name='刷新图库',exact=True)).to_be_enabled();expect(page.locator('.pc-public-catalog .pc-count b')).to_have_text(f'{count:,}');expect(page.locator('.pc-source-warning')).to_be_visible()
            page.locator(f'[data-catalog-key="{rows[0]["id"]}"]').get_by_role('button',name='复制',exact=True).click();assert copied()==rows[0]['prompt'];passed('Failed refresh preserves last-good cache and copied text, with an explicit stale warning')
            network['offline']=False
            if args.offline_bundle:page.evaluate('window.__catalogFixture.fail=false')
            page.locator(f'[data-catalog-key="{rows[0]["id"]}"]').get_by_role('button',name='查看图库提示词：苹果风格海报').click();page.get_by_role('button',name='加入当前画布').click()
            expect(page.locator('.pc-drawer')).to_have_count(0);expect(page.locator('.studio-node')).to_have_count(2);expect(page.locator('.studio-edge-hit')).to_have_count(1)
            assert page.locator('.studio-node.kind-asset').count()==0
            assert page.locator('.studio-node.kind-prompt p').text_content()==rows[0]['prompt'];page.screenshot(path=str(out/'original-prompt-on-canvas.png'))
            passed('Add-to-canvas creates two connected nodes without uploading a preview or generating')
            if args.offline_bundle:page.evaluate('window.__promptFixture.remount()')
            else:page.reload(wait_until='networkidle')
            resources();page.get_by_role('tab',name='我的资源',exact=True).click();expect(page.locator('.pc-card')).to_have_count(1)
            assert page.locator('.pc-card img').get_attribute('src')==rows[0]['coverUrl'];passed('Personal image/prompt pairing survives '+('component remount (mock host)' if args.offline_bundle else 'production page reload (IndexedDB)'))
            for width in [1100,760]:
                page.set_viewport_size({'width':width,'height':1000});expect(page.get_by_role('tab',name='站点图库')).to_be_visible();page.get_by_role('tab',name='站点图库').click();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path=str(out/f'catalog-{width}.png'))
            passed('Professional resources remain usable at desktop minimum and narrow preview widths')
            assert errors==[];assert paid==[]
            if args.offline_bundle:assert page.evaluate('window.__promptFixture.paidCalls')==0
            passed('No uncaught exceptions or paid API calls; public reads carry no Authorization')
        except Exception:
            page.screenshot(path=str(out/'failure.png'));raise
        finally:
            (out/'report.json').write_text(json.dumps({'checks':checks,'errors':errors,'paidRequests':paid,'sourceCommit':manifest['commit'],'sourceRecords':count,'mode':'offline-real-UI-mock-host' if args.offline_bundle else 'production-browser-actual-source-fixtures','originalSourceImages':True},ensure_ascii=False,indent=2));browser.close();server.shutdown()

if __name__=='__main__':main()
