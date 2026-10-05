#!/usr/bin/env python3
"""XAI local DLSS NR bridge. One version-1 JSONL request per process.

No model downloads, API calls or GUI automation. The pinned MIT Python core is
vendored; native runtimes and FFmpeg are supplied in the publisher's engine bundle.
"""
from __future__ import annotations

import bisect
from contextlib import contextmanager
from fractions import Fraction
import importlib.util
import json
import math
import multiprocessing
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time

ENGINE_VERSION = "DLSS5Tool-e23654c6/XAI-NR-1"
MAX_LINE_BYTES = 1024 * 1024
MAX_TIMESTAMPS = 5_000_000
_ORIGINAL_POPEN = subprocess.Popen


class BridgeError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def _stop_process(process):
    """Windows children may own NGX/guidance/FFmpeg grandchildren."""
    try:
        running = process.poll() is None if hasattr(process, 'poll') else process.is_alive()
        if not running:
            return
        if os.name == 'nt':
            killer = _ORIGINAL_POPEN(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                     creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            try:
                killer.wait(timeout=5)
            except subprocess.TimeoutExpired:
                killer.kill()
        elif hasattr(process, 'kill'):
            process.kill()
        else:
            process.terminate()
    except (OSError, ValueError, ProcessLookupError):
        pass


class Cancellation:
    def __init__(self):
        self._event = threading.Event()
        self._lock = threading.Lock()
        self._processes = set()

    def is_set(self):
        return self._event.is_set()

    def check(self):
        if self.is_set():
            raise BridgeError('cancelled', 'DLSS 处理已取消')

    def register(self, process):
        with self._lock:
            self._processes.add(process)
            cancelled = self.is_set()
        if cancelled:
            _stop_process(process)
        return process

    def unregister(self, process):
        with self._lock:
            self._processes.discard(process)

    def set(self):
        self._event.set()
        with self._lock:
            processes = list(self._processes)
        # Includes a host that is still inside its initialization handshake.
        for process in processes + multiprocessing.active_children():
            _stop_process(process)


@contextmanager
def tracked_subprocesses(cancel):
    class TrackedPopen(_ORIGINAL_POPEN):
        def __init__(self, *args, **kwargs):
            cancel.check()
            super().__init__(*args, **kwargs)
            cancel.register(self)

        def wait(self, *args, **kwargs):
            result = super().wait(*args, **kwargs)
            cancel.unregister(self)
            return result

    previous = subprocess.Popen
    subprocess.Popen = TrackedPopen
    try:
        yield
    finally:
        subprocess.Popen = previous


def _number(value, name, low, high, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or isinstance(value, float) and not math.isfinite(value):
        raise BridgeError('invalid_request', f'{name} 必须是有限数值')
    if value < low or value > high or integer and int(value) != value:
        raise BridgeError('invalid_request', f'{name} 超出允许范围 {low}–{high}')
    return int(value) if integer else float(value)


def normalize_options(options):
    if not isinstance(options, dict):
        raise BridgeError('invalid_request', 'options 必须是对象')
    known = {'enabled', 'style', 'intensity', 'localTone', 'localStructure', 'skinStructure',
             'autoMask', 'outputMix', 'flowBackend', 'flowWidth', 'flowIterations',
             'previewResolution', 'exportResolution'}
    if set(options) - known:
        raise BridgeError('invalid_request', '未知 DLSS 参数: ' + ', '.join(sorted(set(options) - known)))
    for key in ('enabled', 'autoMask'):
        if key in options and not isinstance(options[key], bool):
            raise BridgeError('invalid_request', f'{key} 必须为布尔值')
    if options.get('enabled', True) is False:
        raise BridgeError('invalid_request', '此任务需要启用 DLSS NR，不会返回未处理视频冒充结果')
    result = {'style': _number(options.get('style', 0), 'style', 0, 2, True)}
    for public, internal in [('intensity', 'intensity'), ('localTone', 'local_tone'),
                             ('localStructure', 'local_struct'), ('skinStructure', 'skin_struct'),
                             ('outputMix', 'output_mix')]:
        result[internal] = _number(options.get(public, 1.0), public, 0, 1)
    auto_mask = options.get('autoMask', True)
    if not auto_mask:
        result['skin_struct'] = 0.0
    result['use_auto_mask'] = int(auto_mask and result['skin_struct'] > 0)
    backend = options.get('flowBackend', 'off')
    if backend not in ('off', 'raft', 'nvofa'):
        raise BridgeError('invalid_request', 'flowBackend 仅支持 off、raft、nvofa')
    result.update(guidance_mode=int(backend != 'off'), guidance_flow_backend='raft' if backend == 'off' else backend,
                  guidance_flow_edge=_number(options.get('flowWidth', 512), 'flowWidth', 128, 2048, True),
                  guidance_flow_updates=_number(options.get('flowIterations', 6), 'flowIterations', 1, 32, True),
                  guidance_flow_grid=1, guidance_flow_direction='backward', guidance_device='auto',
                  guidance_flow_fallback=False, guidance_execution='serial', guidance_cache_mb=0,
                  host_backend='v2', host_auto_fallback=False, host_in_flight=1,
                  host_tiled_mode=False, host_zero_fast_path=True, frame_format='rgba8', color_profile='srgb')
    return result


def validate_request(request):
    if not isinstance(request, dict) or request.get('version') != 1 or type(request.get('version')) is not int:
        raise BridgeError('invalid_request', '仅支持 version: 1 的 JSON 对象')
    if request.get('op') not in ('probe', 'preview', 'export'):
        raise BridgeError('invalid_request', 'op 仅支持 probe、preview、export')
    if not isinstance(request.get('id', ''), str) or len(request.get('id', '')) > 256:
        raise BridgeError('invalid_request', 'id 必须为不超过 256 字符的字符串')
    request = dict(request)
    # Go's settings-only probe may serialize a zero-valued Options struct.
    probe_options = request.get('options', {})
    if not isinstance(probe_options, dict):
        raise BridgeError('invalid_request', 'options 必须是对象')
    if request['op'] == 'probe' and not probe_options.get('enabled', False):
        probe_options = {}
    request['_settings'] = normalize_options(probe_options)
    if 'runtimePath' in request and not isinstance(request['runtimePath'], str):
        raise BridgeError('invalid_request', 'runtimePath 必须为字符串')
    for name in ('toolRoot',):
        if not isinstance(request.get(name), str) or not request[name].strip():
            raise BridgeError('invalid_request', f'请配置 {name}')
    if request['op'] != 'probe':
        for name in ('inputPath', 'outputPath'):
            if not isinstance(request.get(name), str) or not request[name].strip():
                raise BridgeError('invalid_request', f'缺少 {name}')
        if request['op'] == 'preview':
            request['positionSeconds'] = _number(request.get('positionSeconds', 0), 'positionSeconds', 0, 86400 * 365)
            request['durationSeconds'] = _number(request.get('durationSeconds', 3), 'durationSeconds', .05, 10)
    return request


def resolve_resolution(requested, source_width, source_height, op):
    if not isinstance(requested, dict) or requested.get('mode', 'source') not in ('source', 'custom'):
        raise BridgeError('invalid_resolution', 'resolution.mode 必须是 source 或 custom')
    mode = requested.get('mode', 'source')
    width = source_width if mode == 'source' else requested.get('width')
    height = source_height if mode == 'source' else requested.get('height')
    max_side, max_pixels = (4096, 3840 * 2160) if op == 'preview' else (8192, 7680 * 4320)
    try:
        width = _number(width, 'width', 128, max_side, True)
        height = _number(height, 'height', 128, max_side, True)
    except BridgeError as exc:
        raise BridgeError('invalid_resolution', str(exc) + '；请选择合法自定义尺寸') from exc
    if width % 2 or height % 2 or width * height > max_pixels:
        raise BridgeError('invalid_resolution', '输出宽高必须为偶数且像素总数不超过本模式限制；请选择自定义尺寸')
    return width, height


def build_decode_filter(width, height, start_frame, end_frame):
    # Exact display-frame selection; seeking by keyframe would make A/B pairing ambiguous.
    return (f"select=between(n\\,{start_frame}\\,{end_frame - 1}),"
            f"scale=iw*sar:ih,setsar=1,scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1")


def read_exact_frame(pipe, size, cancel):
    chunks = bytearray(size)
    view = memoryview(chunks)
    offset = 0
    while offset < size:
        cancel.check()
        block = pipe.read(size - offset)
        if not block:
            cancel.check()
            if offset == 0:
                return None
            raise BridgeError('truncated_frame', f'视频帧被截断: {offset}/{size} 字节')
        view[offset:offset + len(block)] = block
        offset += len(block)
    return chunks


def _find_file(roots, filename):
    return next((str((root / filename).resolve()) for root in roots if (root / filename).is_file()), None)


def configure_installation(request, state_dir):
    if sys.platform != 'win32':
        raise BridgeError('unsupported_platform', 'DLSS NR 当前仅支持 Windows x64 和兼容的 NVIDIA RTX 显卡')
    if sys.maxsize <= 2**32:
        raise BridgeError('unsupported_python', '内置视频引擎架构不匹配，请安装 Windows x64 完整版 XAI')
    root = Path(request['toolRoot']).expanduser().resolve()
    if not root.is_dir():
        raise BridgeError('missing_runtime', '内置视频引擎运行库目录不存在，请重新安装完整版 XAI')
    roots = [root / '_internal', root / 'runtime', root]
    selected = str(request.get('runtimePath', '')).strip()
    if selected:
        runtime = Path(selected).expanduser().resolve()
    elif (root / 'mods' / 'nvngx_dlssnr.dll').is_file():
        runtime = root / 'mods' / 'nvngx_dlssnr.dll'
    else:
        candidates = list(dict.fromkeys(str((folder / 'nvngx_dlssnr.dll').resolve())
                                       for folder in roots if (folder / 'nvngx_dlssnr.dll').is_file()))
        if len(candidates) != 1:
            raise BridgeError('missing_runtime', '内置视频引擎运行库缺失或不唯一，请重新安装完整版 XAI')
        runtime = Path(candidates[0])
    if not runtime.is_file() or runtime.suffix.lower() != '.dll':
        raise BridgeError('missing_runtime', '内置 NVIDIA 运行库不存在，请重新安装完整版 XAI')
    host = _find_file(roots, 'dlssnr_host_v2.dll')
    ffmpeg = _find_file(roots, 'ffmpeg.exe')
    ffprobe = _find_file(roots, 'ffprobe.exe')
    if not host or not ffmpeg or not ffprobe:
        raise BridgeError('missing_components', '安装目录必须包含 dlssnr_host_v2.dll、ffmpeg.exe 和 ffprobe.exe')
    for module in ('numpy', 'cv2', 'av'):
        if importlib.util.find_spec(module) is None:
            raise BridgeError('missing_python_dependency', f'内置视频引擎依赖不完整（{module}），请重新安装完整版 XAI')
    os.environ.update(XAI_DLSS5_TOOL_ROOT=str(root), XAI_DLSS5_RUNTIME_ROOT=str(Path(host).parent),
                      XAI_DLSS5_STATE_ROOT=str(state_dir), FFMPEG_EXE=ffmpeg, FFPROBE_EXE=ffprobe)
    settings = dict(request['_settings'], dlss_runtime=str(runtime), mods_directory=str(root / 'mods'))
    return settings, ffmpeg, ffprobe


def load_core():
    vendor = Path(__file__).resolve().parent / 'vendor'
    if not getattr(sys, 'frozen', False):
        sys.path.insert(0, str(vendor))
    import numpy as np
    import cv2
    from dlss5tool.dlss_host_process import ProcessLive
    from dlss5tool.video_export import FFmpegVideoWriter, compose_output_frame
    from dlss5tool import guidance_client, mod_paths
    return np, cv2, ProcessLive, FFmpegVideoWriter, compose_output_frame, guidance_client, mod_paths


def probe_engine(settings, core, cancel):
    np, _, Live, _, _, guidance, mods = core
    live = None
    try:
        cancel.check()
        live = Live(128, 128, settings)
        frame = np.empty((128, 128, 4), dtype=np.uint8)
        frame[..., :3] = np.arange(128, dtype=np.uint8)[None, :, None]
        frame[..., 3] = 255
        output = live.process(frame, reset=True)
        if output is None or output.shape != frame.shape or output.dtype != np.uint8:
            raise BridgeError('probe_failed', 'NR 运行库没有返回有效测试帧')
        if settings['guidance_mode']:
            output = live.process(np.roll(frame, 1, axis=1), reset=False)
            if output is None:
                raise BridgeError('probe_failed', '所选光流未通过双帧测试')
        supported = ['off']
        for backend in ('raft', 'nvofa'):
            try:
                candidate = dict(settings, guidance_mode=1, guidance_flow_backend=backend)
                guidance.validate(candidate)
                cancel.check()
                guidance.preflight(candidate)
                supported.append(backend)
            except Exception:
                cancel.check()
        cancel.check()
        return {'available': True, 'reason': '', 'engineVersion': ENGINE_VERSION,
                'gpu': live.adapter_info.get('name', live.adapter_info.get('description', 'NVIDIA RTX')),
                'supportsFlow': supported, 'flowVerification': 'two-frame preflight for every advertised backend',
                'limits': {'previewSeconds': 10, 'previewMaxSide': 4096, 'previewMaxPixels': 3840 * 2160,
                           'exportMaxSide': 8192, 'exportMaxPixels': 7680 * 4320,
                           'minSide': 128, 'evenDimensions': True, 'hdr': False, 'sr': False, 'fg': False}}
    finally:
        if live is not None:
            live.close()


def _run_json(command, cancel):
    cancel.check()
    completed = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, timeout=60,
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    cancel.check()
    if completed.returncode:
        raise BridgeError('media_probe_failed', completed.stderr.decode('utf-8', 'replace')[-2000:])
    try:
        return json.loads(completed.stdout)
    except ValueError as exc:
        raise BridgeError('media_probe_failed', 'ffprobe 未返回有效媒体信息') from exc


def inspect_media(ffprobe, path, cancel, emit):
    info = _run_json([ffprobe, '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)], cancel)
    video = next((stream for stream in info.get('streams', []) if stream.get('codec_type') == 'video'), None)
    if not video:
        raise BridgeError('unsupported_media', '输入没有可解码视频轨道')
    if video.get('color_transfer') in ('smpte2084', 'arib-std-b67') or any(
            'dovi' in str(item).lower() or 'dolby' in str(item).lower() for item in video.get('side_data_list', [])):
        raise BridgeError('unsupported_hdr', '当前 DLSS 桥接仅支持 SDR；HDR/PQ/HLG/Dolby Vision 请先显式转换为 SDR')
    try:
        rate = Fraction(video.get('avg_frame_rate') or video.get('r_frame_rate'))
        if not 0 < rate <= 240:
            raise ValueError()
        sar_value = video.get('sample_aspect_ratio') or '1:1'
        sar = Fraction(1) if sar_value in ('N/A', '0:1') else Fraction(sar_value.replace(':', '/'))
        if sar <= 0:
            sar = Fraction(1)
    except (ValueError, ZeroDivisionError, TypeError):
        raise BridgeError('unsupported_timeline', '视频帧率或像素比例不可识别') from None
    width, height = round(int(video['width']) * sar), int(video['height'])
    rotation = next((item.get('rotation', 0) for item in video.get('side_data_list', []) if 'rotation' in item), 0)
    if abs(int(rotation)) % 180 == 90:
        width, height = height, width
    timestamps = []
    last_duration = None
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen([ffprobe, '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                                    'frame=best_effort_timestamp_time,pkt_duration_time,duration_time',
                                    '-of', 'compact=p=0:nk=0', str(path)], stdout=subprocess.PIPE,
                                   stdin=subprocess.DEVNULL, stderr=errors,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        try:
            for raw in process.stdout:
                cancel.check()
                fields = dict(part.split('=', 1) for part in raw.decode('utf-8', 'replace').strip().split('|') if '=' in part)
                if 'best_effort_timestamp_time' not in fields:
                    continue
                try:
                    pts = Fraction(fields['best_effort_timestamp_time'])
                    duration = fields.get('duration_time') or fields.get('pkt_duration_time')
                    last_duration = Fraction(duration) if duration and duration != 'N/A' else None
                except (ValueError, ZeroDivisionError):
                    raise BridgeError('unsupported_timeline', '视频缺失有效逐帧时间戳') from None
                if not timestamps and pts != 0:
                    raise BridgeError('unsupported_timeline', '暂不支持非零视频起点；请先明确重置媒体时间线')
                if timestamps and pts <= timestamps[-1]:
                    raise BridgeError('unsupported_timeline', '视频时间戳重复或倒退，已停止以避免音画错位')
                timestamps.append(pts)
                if len(timestamps) > MAX_TIMESTAMPS:
                    raise BridgeError('timeline_limit', '时间戳数量超过安全上限，请分段处理')
                if len(timestamps) % 3000 == 0:
                    emit(stage='inspect', progress=2, message=f'已检查 {len(timestamps)} 帧时间戳')
            code = process.wait()
            cancel.check()
            if code:
                errors.seek(0)
                raise BridgeError('media_probe_failed', errors.read()[-2000:].decode('utf-8', 'replace'))
        finally:
            _stop_process(process)
            process.stdout.close()
    if not timestamps:
        raise BridgeError('unsupported_media', '视频没有可解码画面')
    end = timestamps[-1] + (last_duration if last_duration and last_duration > 0 else 1 / rate)
    return {'width': width, 'height': height, 'rate': rate, 'timestamps': timestamps, 'end': end,
            'audio': any(s.get('codec_type') == 'audio' for s in info.get('streams', []))}


def select_timeline(media, request):
    pts = media['timestamps']
    start, stop = 0, len(pts)
    if request['op'] == 'preview':
        begin = Fraction(str(request['positionSeconds']))
        limit = begin + Fraction(str(request['durationSeconds']))
        start, stop = bisect.bisect_left(pts, begin), bisect.bisect_left(pts, limit)
        if start >= len(pts) or stop <= start:
            raise BridgeError('empty_preview', '预览区间没有画面，请选择视频范围内的时间点')
    actual_start = pts[start]
    actual_end = media['end']
    if request['op'] == 'preview':
        actual_end = min(actual_end, limit)
    selected = [str(float(value - actual_start)) for value in pts[start:stop]]
    duration = actual_end - actual_start
    return start, stop, actual_start, duration, selected


def render_frames(reader, live, writer, reference, core, width, height, count, settings, cancel, emit):
    """Bounded streaming loop: dimensions are established before native NR."""
    np, cv2, _, _, compose, _, _ = core
    for index in range(count):
        cancel.check()
        raw = read_exact_frame(reader, width * height * 3, cancel)
        if raw is None:
            raise BridgeError('frame_count_mismatch', f'解码提前结束: {index}/{count}')
        original = np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 3)
        rgba = cv2.cvtColor(original, cv2.COLOR_BGR2RGBA)
        cancel.check()
        processed = live.process(rgba, reset=index == 0)
        cancel.check()
        if processed is None or processed.shape != rgba.shape or processed.dtype != np.uint8:
            raise BridgeError('invalid_engine_output', f'NR 第 {index + 1} 帧输出无效')
        result = compose(original, cv2.cvtColor(processed, cv2.COLOR_RGBA2BGR), view=0, mix=settings['output_mix'])
        writer.write(result)
        if reference is not None:
            reference.write(original)
        emit(stage='render', progress=10 + 80 * (index + 1) / count, frame=index + 1, totalFrames=count)
    return count


def render_video(request, settings, ffmpeg, ffprobe, state_dir, core, cancel, emit):
    source = Path(request['inputPath']).expanduser().resolve(strict=True)
    output = Path(request['outputPath']).expanduser().resolve()
    reference_path = Path(request['sourceOutputPath']).expanduser().resolve() if request.get('sourceOutputPath') else None
    if not source.is_file() or source.suffix.lower() == '.dlssseq':
        raise BridgeError('unsupported_media', '请选择普通视频文件')
    destinations = [output] + ([reference_path] if reference_path else [])
    if len(set(destinations + [source])) != len(destinations) + 1:
        raise BridgeError('invalid_output', '处理结果、参考视频和输入必须使用不同路径')
    for path in destinations:
        if path.exists() or not path.parent.is_dir() or path.suffix.lower() != '.mp4':
            raise BridgeError('invalid_output', '输出必须是现有目录内尚不存在的 .mp4 文件')
    emit(stage='inspect', progress=1, message='检查视频及逐帧时间戳')
    media = inspect_media(ffprobe, source, cancel, emit)
    width, height = resolve_resolution(request.get('resolution', {'mode': 'source'}), media['width'], media['height'], request['op'])
    first, end, actual_start, duration, timestamps = select_timeline(media, request)
    count = end - first
    rate = media['rate']
    expected = 1 / rate
    selected_pts = media['timestamps'][first:end]
    tolerance = max(Fraction(2, 1000000), expected / 500)
    vfr = (abs(duration - count * expected) > tolerance or
           any(abs(b - a - expected) > tolerance for a, b in zip(selected_pts, selected_pts[1:])))
    timeline = {'frame_timestamps': timestamps, 'timeline_end': str(float(duration))} if vfr else {}
    audio_source = str(source) if media['audio'] else None
    if request['op'] == 'preview' and audio_source:
        audio_source = str(Path(state_dir) / 'preview-audio.mkv')
        # Lossless intermediate; the established mux policy selects final audio codec.
        result = subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
                                 '-ss', f'{float(actual_start):.9f}', '-i', str(source),
                                 '-t', f'{float(duration):.9f}', '-map', '0:a?', '-vn', '-sn', '-dn',
                                 '-c:a', 'pcm_s16le', audio_source], stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        cancel.check()
        if result.returncode:
            raise BridgeError('audio_trim_failed', result.stderr.decode('utf-8', 'replace')[-2000:])
    _, _, Live, Writer, _, guidance, _ = core
    guidance.validate(settings)
    live = writer = reference = decoder = None
    completed = False
    # Keep outputs unpublished until both encoders and source-audio mux finish.
    work = tempfile.TemporaryDirectory(prefix='.xai-dlss-', dir=output.parent)
    staged = Path(work.name) / 'processed.mp4'
    staged_reference = Path(work.name) / 'reference.mp4'
    errors = tempfile.TemporaryFile()
    try:
        emit(stage='initialize', progress=5, message='初始化真实 DLSS NR 处理器')
        live = Live(width, height, settings)
        cancel.check()
        options = dict(audio_source=audio_source, codec='h264', nvenc_preset='p5', rate_control='quality',
                       quality_profile='high', cancel=cancel, **timeline)
        writer = Writer(str(staged), width, height, float(rate), **options)
        if reference_path:
            reference = Writer(str(staged_reference), width, height, float(rate), **options)
        decoder = subprocess.Popen([ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin',
                                    '-i', str(source), '-map', '0:v:0', '-an', '-sn', '-dn',
                                    '-vf', build_decode_filter(width, height, first, end),
                                    '-frames:v', str(count), '-fps_mode', 'passthrough',
                                    '-f', 'rawvideo', '-pix_fmt', 'bgr24', 'pipe:1'],
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=errors,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        render_frames(decoder.stdout, live, writer, reference, core, width, height, count, settings, cancel, emit)
        decoder.stdout.close()
        code = decoder.wait()
        cancel.check()
        if code:
            errors.seek(0)
            raise BridgeError('decode_failed', errors.read()[-2000:].decode('utf-8', 'replace'))
        emit(stage='encode', progress=92, message='完成编码并保留音轨')
        writer.finish()
        if reference:
            reference.finish()
        cancel.check()
        # Validate actual encoded geometry and frame count; native success alone is insufficient.
        for path in [staged] + ([staged_reference] if reference else []):
            info = _run_json([ffprobe, '-v', 'error', '-select_streams', 'v:0', '-count_frames',
                              '-show_entries', 'stream=width,height,codec_name,pix_fmt,nb_read_frames', '-of', 'json', str(path)], cancel)
            stream = (info.get('streams') or [{}])[0]
            if (stream.get('width'), stream.get('height'), stream.get('codec_name'), stream.get('pix_fmt')) != (width, height, 'h264', 'yuv420p') or int(stream.get('nb_read_frames') or 0) != count:
                raise BridgeError('encode_contract_failed', '实际输出尺寸、格式或帧数不匹配，未发布结果')
        if output.exists() or reference_path and reference_path.exists():
            raise BridgeError('invalid_output', '输出路径已被其他任务占用')
        # Windows rename refuses to overwrite an existing target.
        if reference_path:
            os.rename(staged_reference, reference_path)
        try:
            os.rename(staged, output)
        except BaseException:
            if reference_path:
                reference_path.unlink(missing_ok=True)
            raise
        completed = True
        return {'outputPath': str(output), 'sourcePath': str(reference_path) if reference_path else '',
                'width': width, 'height': height, 'sourceWidth': media['width'], 'sourceHeight': media['height'],
                'frames': count, 'fps': float(rate),
                'positionSeconds': float(actual_start), 'durationSeconds': float(duration),
                'engineVersion': ENGINE_VERSION, 'encoder': writer.encoder_name,
                'audioMode': getattr(writer, 'audio_mode', ''), 'vfr': vfr, 'resizeMode': 'contain-pad'}
    finally:
        if decoder:
            _stop_process(decoder)
            if decoder.stdout:
                decoder.stdout.close()
        if not completed:
            for item in (writer, reference):
                if item:
                    item.abort()
        if live:
            live.close()
        errors.close()
        work.cleanup()


def execute(request, cancel, emit):
    # Resolve caller paths before changing cwd; packaged engines can live in a
    # read-only MSIX/Program Files directory. All mutable state belongs in temp.
    request = dict(request)
    for key in ('toolRoot', 'runtimePath', 'inputPath', 'outputPath', 'sourceOutputPath'):
        if request.get(key):
            request[key] = str(Path(request[key]).expanduser().resolve())
    previous_cwd = os.getcwd()
    with tempfile.TemporaryDirectory(prefix='xai-dlss5-') as state_dir:
        settings, ffmpeg, ffprobe = configure_installation(request, state_dir)
        sys.dont_write_bytecode = True
        os.environ.update(PYTHONDONTWRITEBYTECODE='1', TORCH_HOME=str(Path(state_dir) / 'torch'),
                          XDG_CACHE_HOME=str(Path(state_dir) / 'cache'),
                          CUDA_CACHE_PATH=str(Path(state_dir) / 'cuda'))
        try:
            os.chdir(state_dir)
            core = load_core()
            if request['op'] == 'probe':
                return probe_engine(settings, core, cancel)
            return render_video(request, settings, ffmpeg, ffprobe, state_dir, core, cancel, emit)
        finally:
            os.chdir(previous_cwd)


def frozen_self_test():
    """Build-time dependency smoke; deliberately does not initialize NVIDIA."""
    sys.dont_write_bytecode = True
    import numpy as np
    import cv2
    import av
    load_core()
    from dlss5tool import paths
    for language in ('zh_CN', 'en_US'):
        catalog = paths.resource_root() / 'locales' / (language + '.json')
        if not isinstance(json.loads(catalog.read_text(encoding='utf-8')), dict):
            raise BridgeError('frozen_dependency_error', 'Missing locale resources')
    source = np.zeros((4, 4, 3), dtype=np.uint8)
    if cv2.cvtColor(source, cv2.COLOR_BGR2RGBA).shape != (4, 4, 4):
        raise BridgeError('frozen_dependency_error', 'OpenCV conversion failed')
    return {'available': True, 'frozen': bool(getattr(sys, 'frozen', False)),
            'engineVersion': ENGINE_VERSION, 'numpy': np.__version__,
            'opencv': cv2.__version__, 'av': av.__version__, 'gpuTested': False}



def _read_request(stream):
    line = stream.readline(MAX_LINE_BYTES + 1)
    if len(line) > MAX_LINE_BYTES:
        raise BridgeError('invalid_request', 'JSONL 请求过大')
    try:
        return json.loads(line, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    except (ValueError, UnicodeError):
        raise BridgeError('invalid_request', '首行必须是合法 JSON 请求') from None


def main():
    # Keep every native/library stdout write out of the machine-readable channel.
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), 'w', encoding='utf-8', buffering=1)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    control_stream = os.fdopen(os.dup(sys.stdin.fileno()), 'rb', buffering=0)
    request_id = ''
    request = None
    cancel = Cancellation()
    def send(event):
        protocol.write(json.dumps(dict(event, id=request_id), ensure_ascii=False, allow_nan=False) + '\n')
        protocol.flush()
    last_progress = [0.0]
    def progress(**event):
        now = time.monotonic()
        if event.get('stage') == 'render' and now - last_progress[0] < .1 and event.get('progress', 0) < 90:
            return
        last_progress[0] = now
        send(dict(event, type='progress'))
    try:
        raw = _read_request(control_stream)
        request_id = raw.get('id', '') if isinstance(raw, dict) and isinstance(raw.get('id', ''), str) else ''
        request = validate_request(raw)
        def control():
            while True:
                line = control_stream.readline(MAX_LINE_BYTES + 1)
                if not line:
                    return  # EOF after the request is normal.
                if len(line) > MAX_LINE_BYTES:
                    continue
                try:
                    message = json.loads(line)
                    if isinstance(message, dict) and message.get('op') == 'cancel' and message.get('id', request_id) == request_id:
                        cancel.set()
                        return
                except (ValueError, UnicodeError):
                    continue
        threading.Thread(target=control, name='dlss-control', daemon=True).start()
        for signum in (signal.SIGINT, signal.SIGTERM):
            signal.signal(signum, lambda *_: cancel.set())
        with tracked_subprocesses(cancel):
            result = execute(request, cancel, progress)
        cancel.check()
        send(dict(result, type='result'))
        return 0
    except BaseException as exc:
        if isinstance(exc, (KeyboardInterrupt, SystemExit)) or cancel.is_set():
            exc = BridgeError('cancelled', 'DLSS 处理已取消')
        code = getattr(exc, 'code', 'engine_error')
        if request and request.get('op') == 'probe' and code != 'cancelled':
            send({'type': 'result', 'available': False, 'reason': str(exc)[-4000:],
                  'engineVersion': ENGINE_VERSION, 'supportsFlow': [], 'code': code})
            return 0
        else:
            send({'type': 'error', 'code': code, 'error': str(exc)[-4000:]})
        return 1
    finally:
        # No orphaned native worker remains after a protocol terminal response.
        for child in multiprocessing.active_children():
            _stop_process(child)
        protocol.close()


if __name__ == '__main__':
    multiprocessing.freeze_support()
    if '--self-test' in sys.argv:
        try:
            print(json.dumps(frozen_self_test()))
        except Exception as error:
            print(json.dumps({'available': False, 'error': str(error)}))
            raise SystemExit(1)
    else:
        raise SystemExit(main())
