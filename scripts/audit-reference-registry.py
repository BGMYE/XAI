"""Read the seven exact JSON URLs discovered in the reference site's public JS.
No remote code is executed; no account or API credentials are used.
"""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.request

OUT = Path('catalog-source-evidence/registry')
OUT.mkdir(parents=True, exist_ok=True)
SOURCES = ['banana-prompt-quicker', 'davidwu-gpt-image2-prompts', 'freestylefly-gpt-image-2', 'awesome-gpt-image', 'awesome-gpt4o-image-prompts', 'youmind-gpt-image-2', 'youmind-nano-banana-pro']

def download(url, name):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'XAI-Catalog-Source-Check/1.0'}), timeout=30) as r:
        data = r.read(32_000_001)
    if len(data) > 32_000_000:
        raise ValueError('Source exceeds 32 MB')
    (OUT/name).write_bytes(data)
    return data

commit = json.loads(download('https://api.github.com/repos/yukkcat/image-prompts/commits/main', 'commit.json'))['sha']
base = 'https://raw.githubusercontent.com/yukkcat/image-prompts/' + commit + '/'
for file in ['LICENSE', 'NOTICE.md', 'sources.json']:
    download(base + file, file)

def source(id):
    url = base + 'dist/sources/' + id + '.json'
    try:
        data = download(url, id + '.json')
        rows = json.loads(data)
        if not isinstance(rows, list):
            raise ValueError('Expected an array')
        return {'id':id, 'url':url, 'count':len(rows), 'bytes':len(data), 'sha256':hashlib.sha256(data).hexdigest(), 'firstTitles':[x.get('title') for x in rows[:12]]}
    except Exception as e:
        return {'id':id, 'error':str(e)[:300]}

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(source, SOURCES))
(OUT/'report.json').write_text(json.dumps({'commit':commit, 'sources':results}, ensure_ascii=False, indent=2))
print(json.dumps(results, ensure_ascii=False))
if any('error' in r for r in results):
    raise SystemExit('At least one reference source could not be read')
