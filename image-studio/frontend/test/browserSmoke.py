import asyncio,json,os,sys
from pathlib import Path
from playwright.async_api import async_playwright
HTML=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/xai-smoke.html').read_text()
OUTPUT=Path(sys.argv[2] if len(sys.argv)>2 else '/tmp/xai-smoke-results')
OUTPUT.mkdir(parents=True,exist_ok=True)
async def load(browser,seed=None):
 page=await browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 source=HTML.replace('<!--FIXTURE-->','<script>window.__seed='+json.dumps(seed or {})+'</script>')
 await page.set_content(source,wait_until='domcontentloaded')
 await page.wait_for_function('window.__studioSmoke?.ready()',timeout=20000)
 return page,errors
async def main():
 checks=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  page,errors=await load(browser)
  await page.wait_for_timeout(500)
  await page.screenshot(path=str(OUTPUT / 'xai-home-implemented.png'),full_page=True)
  assert await page.get_by_role('heading',name='用 AI，创造无限可能').count()==1
  checks.append('Home: real React shell rendered')
  target=await page.evaluate('window.__studioSmoke.store().activeWorkspaceId')
  await page.locator('.studio-quick-grid button').filter(has_text='生成视频').click()
  await page.get_by_role('textbox',name='视频提示词').fill('晨光穿过薄雾，镜头缓慢推近。')
  await page.get_by_role('button',name='生成视频',exact=True).click()
  await page.wait_for_function('window.__studioSmoke.snapshot().submits===1')
  await page.screenshot(path=str(OUTPUT / 'xai-video-implemented.png'),full_page=True)
  checks.append('Video form: one API submission through desktop adapter')
  # Leave the creation screen and switch workspace before the task finishes.
  await page.locator('.studio-sidebar button').filter(has_text='首页').click()
  await page.evaluate('window.__studioSmoke.store().newWorkspace("另一个画布")')
  other=await page.evaluate('window.__studioSmoke.store().activeWorkspaceId')
  assert other!=target
  await page.evaluate('window.__studioSmoke.complete()')
  snapshot=await page.evaluate('window.__studioSmoke.snapshot()')
  original=next(w for w in snapshot['document']['workspaces'] if w['id']==target)
  assert len(original['nodes'])==1 and original['nodes'][0]['type']=='video'
  assert len(next(w for w in snapshot['document']['workspaces'] if w['id']==other)['nodes'])==0
  assert await page.evaluate('window.__studioSmoke.store().activeWorkspaceId')==other
  assert 'smoke-test-key' not in json.dumps(snapshot['document'])
  checks.append('Global delivery: original workspace, no active-workspace theft, no key persistence')
  await page.evaluate('(id)=>window.__studioSmoke.store().switchWorkspace(id)',target)
  await page.get_by_role('button',name='专业模式',exact=True).click()
  await page.wait_for_timeout(500)
  assert await page.locator('canvas').count()>0
  await page.screenshot(path=str(OUTPUT / 'xai-canvas-implemented.png'),full_page=True)
  await page.evaluate('(id)=>window.__studioSmoke.store().removeCanvasNode(id)',original['nodes'][0]['id'])
  await page.evaluate('window.__studioSmoke.flush()')
  await page.evaluate('window.__studioSmoke.refresh()')
  after=await page.evaluate('window.__studioSmoke.snapshot()')
  assert len(next(w for w in after['document']['workspaces'] if w['id']==target)['nodes'])==0
  assert len(after['document']['appliedVideoTaskIds'])==1
  checks.append('Canvas: renders; deleting delivered video does not cause reinsertion')
  restart,restart_errors=await load(browser,after)
  await restart.evaluate('window.__studioSmoke.refresh()')
  assert await restart.evaluate('window.__studioSmoke.store().canvasNodes.length')==0
  checks.append('Restart: layout and delivery marker restored without duplicate media')
  await restart.evaluate('window.__studioSmoke.setConflict(); window.__studioSmoke.store().setField("prompt", "concurrent edit");')
  await restart.evaluate('window.__studioSmoke.flush()')
  assert await restart.evaluate('window.__studioSmoke.runtime().storage')=='error'
  revision=await restart.evaluate('window.__studioSmoke.snapshot().document.revision')
  await restart.evaluate('window.__studioSmoke.store().setField("prompt", "later edit");window.__studioSmoke.flush()')
  assert await restart.evaluate('window.__studioSmoke.snapshot().document.revision')==revision
  checks.append('Persistence conflict: blocks overwrite and further auto-save')
  # Responsive layout at widths corresponding to desktop and small-screen preview.
  await page.locator('.studio-sidebar button').filter(has_text='首页').click()
  for width,height in [(1394,810),(820,900),(390,844)]:
   await page.set_viewport_size({'width':width,'height':height}); await page.wait_for_timeout(150)
   dimensions=await page.evaluate('({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})')
   assert dimensions['scroll']<=dimensions['client']+1,dimensions
   await page.screenshot(path=str(OUTPUT / f'xai-home-{width}.png'),full_page=True)
  checks.append('Responsive: 1394/820/390px no document horizontal overflow')
  assert not errors,errors
  assert not restart_errors,restart_errors
  await browser.close()
 result={'passed':len(checks),'checks':checks,'pageErrors':errors+restart_errors,'mode':'offline React integration; mocked Wails boundary, not live upstream'}
 Path(str(OUTPUT / 'xai-ui-report.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2))
 print(json.dumps(result,ensure_ascii=False,indent=2))
asyncio.run(main())
