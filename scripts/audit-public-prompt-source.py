"""Read public, unauthenticated source data only. Never execute remote content."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.request
from urllib.parse import urlparse, urljoin
import re

OUT = Path('catalog-source-evidence')
OUT.mkdir(exist_ok=True)
report = []

def get(url, name, limit=10_000_000):
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'XAI-Public-Catalog-Verification/1.0'})
        with urllib.request.urlopen(request, timeout=25) as response:
            data = response.read(limit + 1)
            if len(data) > limit:
                raise ValueError('response exceeds verification size limit')
            info = {'url': url, 'file': name, 'status': response.status, 'finalURL': response.url, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        (OUT / name).write_bytes(data)
        report.append(info)
        return data
    except Exception as error:
        report.append({'url': url, 'file': name, 'error': str(error)[:300]})
        return None

metadata = get('https://api.github.com/repos/glidea/banana-prompt-quicker/commits/main', 'upstream-commit.json')
sha = json.loads(metadata)['sha'] if metadata else 'main'
base = 'https://raw.githubusercontent.com/glidea/banana-prompt-quicker/' + sha + '/'
data = get(base + 'prompts.json', 'prompts.json')
get(base + 'LICENSE', 'LICENSE.banana-prompt-quicker')
if data:
    rows = json.loads(data)
    if isinstance(rows, dict):
        rows = rows.get('prompts', [])
    def preview(pair):
        index, item = pair
        url = item.get('preview', '')
        prefix = 'https://cdn.jsdelivr.net/gh/glidea/banana-prompt-quicker@main/'
        if url.startswith(prefix):
            url = base + url[len(prefix):]
        parsed = urlparse(url)
        if parsed.scheme == 'https' and parsed.hostname in ('raw.githubusercontent.com', 'cdn.jsdelivr.net'):
            get(url, 'preview-%02d.bin' % index)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(preview, enumerate(rows[:12])))
# Verify the exact requested website too; public HTML only, no login or API token.
html = get('https://canvas-test.pqai.cc/prompts', 'reference-prompts.html')
if html:
    script_paths = re.findall(r'<script[^>]+src=[\"\']([^\"\']+)', html.decode('utf-8', errors='replace'))[:8]
    for index, path in enumerate(script_paths):
        url = urljoin('https://canvas-test.pqai.cc/prompts', path)
        if urlparse(url).hostname == 'canvas-test.pqai.cc':
            get(url, 'reference-script-%02d.js' % index)
(OUT / 'report.json').write_text(json.dumps({'upstreamCommit': sha, 'requests': report}, ensure_ascii=False, indent=2))
print(json.dumps({'upstreamCommit': sha, 'files': len(report), 'failures': sum('error' in x for x in report)}, ensure_ascii=False))
if not data:
    raise SystemExit('Public catalog source could not be verified')
