#!/usr/bin/env python3
"""Build/verify XAI's relocatable Windows video-engine bundle; stdlib only.

This tool never executes or downloads input binaries. RuntimeSource must be a
publisher-curated directory of components the publisher may redistribute.
SHA256 checks integrity, not publisher identity or a digital signature.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import struct
import sys
import tempfile

ENGINE_VERSION = 'DLSS5Tool-e23654c6/XAI-NR-1'
SHA256 = re.compile(r'^[0-9a-f]{64}$')
PYTHON_DLL = re.compile(r'^python3[0-9]+\.dll$', re.I)
RESERVED = re.compile(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)', re.I)
REQUIRED = ('worker/xai-video-engine.exe', 'runtime/dlssnr_host_v2.dll',
            'runtime/nvngx_dlssnr.dll', 'runtime/ffmpeg.exe', 'runtime/ffprobe.exe',
            'runtime/THIRD_PARTY_NOTICES.md', 'licenses/XAI-AGPL-3.0.txt')


class BundleError(ValueError):
    pass


def safe_path(value):
    if not isinstance(value, str) or not value or len(value) > 2048 or '\\' in value or ':' in value or '\x00' in value:
        raise BundleError('invalid relative bundle path')
    parts = value.split('/')
    if any(part in ('', '.', '..') or part[-1:] in (' ', '.') or RESERVED.match(part)
           or any(ord(char) < 32 for char in part) for part in parts):
        raise BundleError(f'unsafe bundle path: {value}')
    if PurePosixPath(value).is_absolute():
        raise BundleError('absolute bundle path is forbidden')
    return value


def regular_files(root):
    root = Path(root)
    if not root.is_dir() or root.is_symlink():
        raise BundleError(f'not a regular directory: {root}')
    found, folded = {}, set()
    for directory, directories, files in os.walk(root, followlinks=False):
        for name in sorted(directories + files):
            item = Path(directory) / name
            relative = safe_path(item.relative_to(root).as_posix())
            key = relative.casefold()
            if key in folded:
                raise BundleError(f'case-insensitive duplicate path: {relative}')
            folded.add(key)
            # Windows reparse points also include junctions, not only symlinks.
            stat = item.lstat()
            if item.is_symlink() or getattr(stat, 'st_file_attributes', 0) & 0x400:
                raise BundleError(f'links/reparse points are forbidden: {relative}')
            if item.is_file():
                found[relative] = item
            elif not item.is_dir():
                raise BundleError(f'non-regular bundle entry: {relative}')
    return found


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def verify_pe(path):
    """Check PE machine/format without loading or executing untrusted binaries."""
    with Path(path).open('rb') as source:
        header = source.read(64)
        if len(header) < 64 or header[:2] != b'MZ':
            raise BundleError(f'not a PE executable: {path}')
        offset = struct.unpack_from('<I', header, 0x3c)[0]
        if not 64 <= offset <= 1024 * 1024:
            raise BundleError(f'invalid PE offset: {path}')
        source.seek(offset)
        pe = source.read(26)
        if len(pe) < 26 or pe[:4] != b'PE\0\0' or struct.unpack_from('<H', pe, 4)[0] != 0x8664 or struct.unpack_from('<H', pe, 24)[0] != 0x20b:
            raise BundleError(f'expected Windows AMD64 PE32+ component: {path}')


def validate_layout(files):
    for relative in REQUIRED:
        if relative not in files or files[relative].stat().st_size == 0:
            raise BundleError(f'missing required component: {relative}')
    if not any(path.startswith('worker/_internal/') and '/' not in path[len('worker/_internal/'):]
               and PYTHON_DLL.match(PurePosixPath(path).name) for path in files):
        raise BundleError('worker/_internal must contain its bundled python3xx.dll')
    if not any(name in files and files[name].stat().st_size > 0 for name in
               ('worker/_internal/licenses/Python/LICENSE.txt', 'worker/_internal/licenses/Python/LICENSE')):
        raise BundleError('the frozen worker must retain the build interpreter Python license')
    # The complete onedir tree includes native Python dependencies, never a lone EXE.
    for relative, path in files.items():
        if path.suffix.lower() in ('.exe', '.dll', '.pyd'):
            verify_pe(path)
    guidance = 'runtime/mods/enhancement/'
    if any(name.startswith(guidance) for name in files):
        for name in ('guidance_worker.exe', 'enhancement.json'):
            if guidance + name not in files:
                raise BundleError('incomplete optical-flow component: ' + guidance + name)
        if not any(name.startswith(guidance + '_internal/') and PYTHON_DLL.match(PurePosixPath(name).name) for name in files):
            raise BundleError('optical-flow component is missing its Python runtime')
        manifest = json.loads(files[guidance + 'enhancement.json'].read_text(encoding='utf-8-sig'))
        if (not isinstance(manifest, dict) or type(manifest.get('protocol')) is not int or manifest.get('id') != 'dlss5-guidance' or manifest.get('protocol') != 1
                or manifest.get('architectures') != ['raft_large', 'depth_anything_v2']):
            raise BundleError('incompatible optical-flow component protocol')
        backends = manifest.get('flow_backends', ['raft'])
        if not isinstance(backends, list) or not backends or any(item not in ('raft', 'nvofa') for item in backends):
            raise BundleError('invalid optical-flow backends')
        if 'raft' in backends:
            weight = 'raft_large_C_T_SKHT_V2-ff5fadd5.pth'
            candidates = ('runtime/mods/models/' + weight, guidance + 'models/' + weight,
                          'runtime/mods/torch_home/hub/checkpoints/' + weight,
                          'runtime/mods/models/checkpoints/' + weight, 'runtime/mods/' + weight)
            if not any(path in files and files[path].stat().st_size > 0 for path in candidates):
                raise BundleError('RAFT component requires the matching external model weights')


def verify_bundle(root):
    original = Path(root)
    if original.is_symlink() or getattr(original.lstat(), 'st_file_attributes', 0) & 0x400:
        raise BundleError('bundle root must not be a link/reparse point')
    root = original.resolve()
    files = regular_files(root)
    if 'manifest.json' not in files or files['manifest.json'].stat().st_size > 16 * 1024 * 1024:
        raise BundleError('missing or oversized manifest.json')
    # Go's JSON parser rejects BOM-prefixed input; keep both verifiers identical.
    manifest = json.loads(files['manifest.json'].read_text(encoding='utf-8'))
    expected = dict(schemaVersion=1, protocolVersion=1, platform='windows', architecture='amd64',
                    executable='worker/xai-video-engine.exe', toolRoot='runtime', runtimePath='runtime/nvngx_dlssnr.dll')
    if not isinstance(manifest, dict) or any(type(manifest.get(key)) is not type(value) or manifest[key] != value for key, value in expected.items()):
        raise BundleError('incompatible engine manifest contract')
    if (not isinstance(manifest.get('engineVersion'), str) or not manifest['engineVersion'].strip()
            or len(manifest['engineVersion'].encode('utf-8')) > 200):
        raise BundleError('engineVersion must be a nonempty string of at most 200 UTF-8 bytes')
    if 'bundleVersion' in manifest and (not isinstance(manifest['bundleVersion'], str)
            or len(manifest['bundleVersion'].encode('utf-8')) > 200):
        raise BundleError('bundleVersion must be a string of at most 200 UTF-8 bytes')
    entries = manifest.get('files')
    if not isinstance(entries, list) or not entries or len(entries) > 100000:
        raise BundleError('manifest files must be a bounded nonempty list')
    declared, folded = set(), set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise BundleError('invalid file entry')
        name = safe_path(entry.get('path'))
        checksum = entry.get('sha256')
        if name.casefold() in folded or name == 'manifest.json':
            raise BundleError('duplicate/self-referencing manifest file: ' + name)
        declared.add(name); folded.add(name.casefold())
        if not isinstance(checksum, str) or not SHA256.fullmatch(checksum):
            raise BundleError('invalid SHA256: ' + name)
        if name not in files:
            raise BundleError('missing declared file: ' + name)
        if digest(files[name]) != checksum:
            raise BundleError('SHA256 mismatch: ' + name)
    if declared != set(files) - {'manifest.json'}:
        raise BundleError('bundle contains unlisted or missing files')
    validate_layout(files)
    return manifest


def build_bundle(worker_root, runtime_root, output, engine_version=ENGINE_VERSION, bundle_version=None):
    for value in (worker_root, runtime_root, output):
        item = Path(value)
        if item.is_symlink() or item.exists() and getattr(item.lstat(), 'st_file_attributes', 0) & 0x400:
            raise BundleError('source/output root must not be a link/reparse point')
    worker_root, runtime_root, output = map(lambda p: Path(p).resolve(), (worker_root, runtime_root, output))
    for source in (worker_root, runtime_root):
        if source == output or source in output.parents or output in source.parents:
            raise BundleError('output and source directories must be independent')
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise BundleError('output must be a new or empty staging directory')
    if not output.parent.is_dir():
        raise BundleError('output parent directory must exist')
    if not isinstance(engine_version, str) or not engine_version.strip():
        raise BundleError('engineVersion is required')
    worker_files, runtime_files = regular_files(worker_root), regular_files(runtime_root)
    # Reject local development manifests instead of shipping absolute machine paths.
    forbidden = {'environment.json', 'xai-dlss5-environment.json', 'bridge-bundle.json'}
    if any(PurePosixPath(name).name in forbidden for name in runtime_files):
        raise BundleError('runtime source contains developer installation metadata; provide a curated runtime tree')
    with tempfile.TemporaryDirectory(prefix='.dlss-bundle-', dir=output.parent) as temporary:
        staged = Path(temporary) / 'dlss5'
        staged.mkdir()
        for prefix, source_files in (('worker', worker_files), ('runtime', runtime_files)):
            for name, source in source_files.items():
                target = staged / prefix / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
        licenses = staged / 'licenses'
        licenses.mkdir()
        shutil.copyfile(Path(__file__).resolve().parents[3] / 'LICENSE', licenses / 'XAI-AGPL-3.0.txt')
        vendor = Path(__file__).resolve().parents[2] / 'backend' / 'dlss5bridge' / 'vendor'
        for source, target in (('LICENSE-DLSS5Tool.txt', 'DLSS5Tool-MIT.txt'), ('UPSTREAM.md', 'DLSS5Tool-source.md')):
            shutil.copyfile(vendor / source, licenses / target)
        copied = regular_files(staged)
        validate_layout(copied)
        manifest = dict(schemaVersion=1, protocolVersion=1, engineVersion=engine_version,
                        platform='windows', architecture='amd64', executable='worker/xai-video-engine.exe',
                        toolRoot='runtime', runtimePath='runtime/nvngx_dlssnr.dll',
                        files=[dict(path=name, sha256=digest(path)) for name, path in sorted(copied.items())])
        if bundle_version:
            manifest['bundleVersion'] = bundle_version
        (staged / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        verify_bundle(staged)
        if output.exists():
            # Rmdir is intentional: it fails safely if another writer added content.
            output.rmdir()
        os.rename(staged, output)
    return verify_bundle(output)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    build = commands.add_parser('build')
    build.add_argument('--worker-root', required=True)
    build.add_argument('--runtime-root', required=True)
    build.add_argument('--output', required=True)
    build.add_argument('--engine-version', default=ENGINE_VERSION)
    build.add_argument('--bundle-version')
    verify = commands.add_parser('verify'); verify.add_argument('bundle')
    args = parser.parse_args(argv)
    try:
        result = (verify_bundle(args.bundle) if args.command == 'verify' else
                  build_bundle(args.worker_root, args.runtime_root, args.output, args.engine_version, args.bundle_version))
        print(json.dumps({'valid': True, 'engineVersion': result['engineVersion'], 'files': len(result['files'])}))
        return 0
    except (BundleError, OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({'error': str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
