#!/usr/bin/env python3
"""Capture the exact public feeds used by the reference website, for reproducible
browser tests only. No catalog text or third-party images are committed/bundled.
Reads HTTPS public endpoints without credentials and never executes remote JS.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'image-studio/frontend/studio-evidence/reference-source'
OUT.mkdir(parents=True, exist_ok=True)
COMMIT = '431009fe550f5b70f482b4484119ffe69b7773f6'
SOURCES = ['banana-prompt-quicker', 'davidwu-gpt-image2-prompts', 'freestylefly-gpt-image-2', 'awesome-gpt-image', 'awesome-gpt4o-image-prompts', 'youmind-gpt-image-2', 'youmind-nano-banana-pro']
BASE = 'https://raw.githubusercontent.com/yukkcat/image-prompts/' + COMMIT + '/'

def read(url, limit=8*1024*1024):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'XAI-Reference-Catalog-Check/1.0'}), timeout=25) as response:
        data = response.read(limit+1)
    if len(data)>limit: raise ValueError('Public source exceeds limit')
    return data

def source(id):
    data=read(BASE+'dist/sources/'+id+'.json')
    rows=json.loads(data)
    assert isinstance(rows,list) and all(x['sourceId']==id for x in rows)
    (OUT/(id+'.json')).write_bytes(data)
    return {'id':id,'count':len(rows),'sha256':hashlib.sha256(data).hexdigest()}

with ThreadPoolExecutor(max_workers=3) as pool:
    sources=list(pool.map(source,SOURCES))
rows=json.loads((OUT/'banana-prompt-quicker.json').read_text())
assert [x['title'] for x in rows[:4]]==['苹果风格海报','疯狂动物城海报','贴吧老哥疯狂吐槽批注','锐评世间万物']
images=[]
for index,item in enumerate(rows[:12]):
    info={'url':item['coverUrl'],'title':item['title']}
    try:
        assert item['coverUrl'].startswith('https://')
        try:
            data=read(item['coverUrl'])
        except Exception:
            # jsDelivr gh URLs map to this exact public repository path. This is
            # the original file, not a substitute preview. Keep the cover URL in
            # the tested record; record the fallback transport for auditability.
            prefix='https://cdn.jsdelivr.net/gh/glidea/banana-prompt-quicker@main/'
            if not item['coverUrl'].startswith(prefix): raise
            fallback='https://raw.githubusercontent.com/glidea/banana-prompt-quicker/main/'+item['coverUrl'][len(prefix):]
            data=read(fallback); info['downloadURL']=fallback
        if not (data.startswith((b'\x89PNG',b'\xff\xd8',b'GIF8',b'RIFF'))): raise ValueError('Original preview is not a supported image')
        filename=f'preview-{index:02d}.bin';(OUT/filename).write_bytes(data)
        info.update(file=filename,sha256=hashlib.sha256(data).hexdigest())
    except Exception as error:
        info['error']=str(error)[:250] # Original broken images remain broken, never substituted.
    images.append(info)
assert 'file' in images[0] and 'file' in images[1], 'The first two screenshot previews must be retrievable'
for name in ['NOTICE.md','sources.json']:(OUT/name).write_bytes(read(BASE+name))
(OUT/'manifest.json').write_text(json.dumps({'commit':COMMIT,'sources':sources,'images':images},ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'sources':len(sources),'records':sum(s['count'] for s in sources),'originalPreviews':sum('file'in i for i in images)},ensure_ascii=False))
