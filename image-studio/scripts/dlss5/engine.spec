# -*- mode: python ; coding: utf-8 -*-
"""Console onedir worker: Python is embedded; publisher native assets stay separate."""
import os
from pathlib import Path
import sys
from PyInstaller.utils.hooks import collect_all, collect_submodules, copy_metadata

bridge = Path(os.environ['XAI_ENGINE_BRIDGE_ROOT']).resolve()
vendor = bridge / 'vendor'
sys.path.insert(0, str(vendor))
datas = [(str(vendor / 'locales'), 'locales')]
binaries = []
hiddenimports = collect_submodules('dlss5tool')
for package in ('numpy', 'cv2', 'av'):
    package_data, package_binaries, package_imports = collect_all(package)
    datas += package_data
    binaries += package_binaries
    hiddenimports += package_imports
for distribution in ('numpy', 'opencv-python', 'av', 'Pillow'):
    datas += copy_metadata(distribution)
for name in ('LICENSE-DLSS5Tool.txt', 'THIRD_PARTY_NOTICES.md', 'UPSTREAM.md'):
    datas.append((str(vendor / name), 'licenses/DLSS5Tool'))
# The worker embeds a Python interpreter, not just Python source. Preserve the
# license delivered with this exact build interpreter instead of assuming MIT.
python_license = next((Path(sys.base_prefix) / name for name in ('LICENSE.txt', 'LICENSE')
                       if (Path(sys.base_prefix) / name).is_file()), None)
if python_license is None:
    raise RuntimeError('The build interpreter must provide its original LICENSE.txt or LICENSE for redistribution')
datas.append((str(python_license), 'licenses/Python'))
datas.append((str(bridge.parents[2] / 'LICENSE'), 'licenses/XAI'))

analysis = Analysis([str(bridge / 'bridge.py')], pathex=[str(vendor)],
                    binaries=binaries, datas=datas, hiddenimports=hiddenimports,
                    hookspath=[], hooksconfig={}, runtime_hooks=[],
                    excludes=['torch', 'torchvision', 'tkinter', 'imageio_ffmpeg'],
                    noarchive=False)
# ctypes analysis can discover driver DLLs on the build host. They must never be
# copied out of that machine; distributable native assets come only from the
# explicitly supplied publisher runtime source, with its own notices.
def is_driver(entry):
    name = Path(entry[0]).name.lower()
    return name in {'nvcuda.dll', 'nvapi.dll', 'nvapi64.dll', 'nvofapi64.dll'} or name.startswith(('nvngx', 'nvopticalflow'))
analysis.binaries = [entry for entry in analysis.binaries if not is_driver(entry)]
pyz = PYZ(analysis.pure)
exe = EXE(pyz, analysis.scripts, [], exclude_binaries=True,
          name='xai-video-engine', debug=False, bootloader_ignore_signals=False,
          strip=False, upx=False, console=True, disable_windowed_traceback=False,
          target_arch=None, codesign_identity=None, entitlements_file=None)
collection = COLLECT(exe, analysis.binaries, analysis.datas,
                     strip=False, upx=False, name='xai-video-engine')
