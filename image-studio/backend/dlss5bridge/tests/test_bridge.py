"""The JSONL/local-render boundary is testable without NVIDIA or addon imports.

Run with ``python -m unittest discover -s tests -v`` from dlss5bridge.
"""

import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from fractions import Fraction
from types import SimpleNamespace
from unittest import mock


BRIDGE_PATH = Path(__file__).resolve().parents[1] / "bridge.py"
_SPEC = importlib.util.spec_from_file_location("xai_dlss5_bridge_tests", BRIDGE_PATH)
bridge = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = bridge
_SPEC.loader.exec_module(bridge)


def options(**overrides):
    values = {
        "enabled": True,
        "style": 0,
        "intensity": 1.0,
        "localTone": 1.0,
        "localStructure": 1.0,
        "skinStructure": 1.0,
        "autoMask": True,
        "outputMix": 1.0,
        "flowBackend": "off",
        "flowWidth": 512,
        "flowIterations": 6,
        "previewResolution": {"mode": "source"},
        "exportResolution": {"mode": "source"},
    }
    values.update(overrides)
    return values


class OptionTests(unittest.TestCase):
    def test_ui_values_reach_native_keys_without_clamping(self):
        result = bridge.normalize_options(options(
            style=2, intensity=0.75, localTone=0.25, localStructure=0.9,
            skinStructure=0.5, outputMix=0.6, flowBackend="raft",
            flowWidth=1024, flowIterations=12,
        ))
        for key, expected in {
            "style": 2, "intensity": 0.75, "local_tone": 0.25,
            "local_struct": 0.9, "skin_struct": 0.5, "output_mix": 0.6,
            "use_auto_mask": True, "guidance_mode": 1,
            "guidance_flow_backend": "raft", "guidance_flow_edge": 1024,
            "guidance_flow_updates": 12,
        }.items():
            with self.subTest(key=key):
                self.assertEqual(result[key], expected)

    def test_numbers_cannot_be_boolean_nonfinite_or_outside_supported_range(self):
        for key, values in {
            "intensity": [True, float("nan"), float("inf"), -0.01, 1.01],
            "localTone": [float("-inf")],
            "localStructure": ["1.0"],
            "skinStructure": [None],
            "outputMix": [1.01],
            "style": [True, 1.5, 3],
            "flowWidth": [127, 2049, 512.5],
            "flowIterations": [0, 33, True],
        }.items():
            for value in values:
                with self.subTest(key=key, value=value):
                    with self.assertRaises(bridge.BridgeError):
                        bridge.normalize_options(options(**{key: value}))

    def test_unsupported_flow_is_rejected_instead_of_downgraded(self):
        with self.assertRaises(bridge.BridgeError):
            bridge.normalize_options(options(flowBackend="unsupported"))

    def test_unknown_effect_cannot_be_silently_ignored(self):
        with self.assertRaises(bridge.BridgeError):
            bridge.normalize_options(options(sharpness=0.5))

    def test_disabled_skin_mask_is_a_true_noop(self):
        result = bridge.normalize_options(options(autoMask=False, skinStructure=0.8))
        self.assertEqual(result["use_auto_mask"], 0)
        self.assertEqual(result["skin_struct"], 0.0)


class RequestTests(unittest.TestCase):
    def valid_request(self):
        return {"version": 1, "id": "preview-test", "op": "preview",
                "toolRoot": "C:/DLSS5Tool", "runtimePath": "C:/runtime.dll",
                "inputPath": "C:/input.mp4", "outputPath": "C:/preview.mp4",
                "options": options(), "positionSeconds": 1.0, "durationSeconds": 3.0}

    def test_protocol_rejects_unsupported_operations_and_boolean_version(self):
        for overrides in ({"version": True}, {"version": 2}, {"op": "cancel"},
                          {"op": "download"}, {"id": ["wrong-type"]}):
            with self.subTest(overrides=overrides):
                with self.assertRaises(bridge.BridgeError):
                    bridge.validate_request({**self.valid_request(), **overrides})

    def test_invalid_preview_times_fail_before_any_media_access(self):
        for overrides in ({"positionSeconds": -1}, {"positionSeconds": float("nan")},
                          {"durationSeconds": 0}, {"durationSeconds": 10.01},
                          {"durationSeconds": True}):
            with self.subTest(overrides=overrides):
                with self.assertRaises(bridge.BridgeError):
                    bridge.validate_request({**self.valid_request(), **overrides})

    def test_nr_only_boundary_does_not_enable_sr_fg_or_hdr(self):
        request = bridge.validate_request(self.valid_request())
        settings = request["_settings"]
        self.assertEqual(settings["guidance_mode"], 0)
        self.assertEqual(settings["frame_format"], "rgba8")
        self.assertEqual(settings["host_backend"], "v2")
        self.assertFalse(settings["host_auto_fallback"])
        self.assertNotIn("super_resolution_scale", settings)
        self.assertNotIn("frame_generation_multiplier", settings)

    def test_settings_only_probe_accepts_go_zero_value_options(self):
        request = self.valid_request()
        request.update(op="probe", options=options(enabled=False, autoMask=False,
                       flowBackend="", flowWidth=0, flowIterations=0))
        request.pop("inputPath")
        request.pop("outputPath")
        result = bridge.validate_request(request)
        self.assertEqual(result["_settings"]["guidance_mode"], 0)
        self.assertEqual(result["_settings"]["guidance_flow_edge"], 512)

    def test_nonobject_probe_options_return_a_protocol_validation_error(self):
        for value in (None, [], "off"):
            with self.subTest(value=value):
                request = {**self.valid_request(), "op": "probe", "options": value}
                with self.assertRaises(bridge.BridgeError) as error:
                    bridge.validate_request(request)
                self.assertEqual(error.exception.code, "invalid_request")


class DecodeFilterTests(unittest.TestCase):
    def test_interval_is_exact_and_resize_preserves_display_aspect_ratio(self):
        filters = bridge.build_decode_filter(1280, 720, 7, 10)
        self.assertIn("select=between(n\\,7\\,9)", filters)
        self.assertIn("scale=iw*sar:ih,setsar=1", filters)
        self.assertIn("scale=1280:720:force_original_aspect_ratio=decrease", filters)
        self.assertIn("pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black", filters)
        self.assertTrue(filters.endswith("setsar=1"))

    def test_vfr_preview_selection_pairs_the_same_display_frames(self):
        media = {"timestamps": list(map(Fraction, ("0", ".04", ".12", ".15", ".25"))),
                 "end": Fraction(".3")}
        first, end, start, duration, timestamps = bridge.select_timeline(
            media, {"op": "preview", "positionSeconds": .05, "durationSeconds": .15})
        self.assertEqual((first, end), (2, 4))
        self.assertEqual(start, Fraction(".12"))
        self.assertEqual(duration, Fraction(".08"))
        self.assertEqual(timestamps, ["0.0", "0.03"])

    def test_sparse_vfr_preview_does_not_hold_until_a_frame_beyond_ten_seconds(self):
        media = {"timestamps": [Fraction(0), Fraction(30)], "end": Fraction(60)}
        first, end, start, duration, timestamps = bridge.select_timeline(
            media, {"op": "preview", "positionSeconds": 0, "durationSeconds": 10})
        self.assertEqual((first, end), (0, 1))
        self.assertEqual(start, Fraction(0))
        self.assertEqual(duration, Fraction(10))
        self.assertLessEqual(duration, 10)
        self.assertEqual(timestamps, ["0.0"])

    def test_last_frame_preview_stops_at_earlier_of_request_and_source_end(self):
        for source_end, expected_duration in ((60, 10), (35, 5)):
            with self.subTest(source_end=source_end):
                media = {"timestamps": [Fraction(0), Fraction(30)],
                         "end": Fraction(source_end)}
                first, end, start, duration, timestamps = bridge.select_timeline(
                    media, {"op": "preview", "positionSeconds": 30, "durationSeconds": 10})
                self.assertEqual((first, end), (1, 2))
                self.assertEqual(start, Fraction(30))
                self.assertEqual(duration, Fraction(expected_duration))
                self.assertLessEqual(duration, 10)
                self.assertLessEqual(start + duration, min(source_end, 40))
                self.assertEqual(timestamps, ["0.0"])


class ResolutionTests(unittest.TestCase):
    def test_4k_preview_and_8k_export_are_independent_limits(self):
        self.assertEqual(bridge.resolve_resolution(
            {"mode": "custom", "width": 3840, "height": 2160},
            1920, 1080, "preview"), (3840, 2160))
        self.assertEqual(bridge.resolve_resolution(
            {"mode": "custom", "width": 7680, "height": 4320},
            1920, 1080, "export"), (7680, 4320))
        with self.assertRaises(bridge.BridgeError):
            bridge.resolve_resolution(
                {"mode": "custom", "width": 7680, "height": 4320},
                1920, 1080, "preview")

    def test_source_resolution_is_not_silently_downscaled_to_preview_limit(self):
        with self.assertRaises(bridge.BridgeError):
            bridge.resolve_resolution({"mode": "source"}, 7680, 4320, "preview")

    def test_side_limit_does_not_replace_total_pixel_limit(self):
        for op, side in (("preview", 4096), ("export", 8192)):
            with self.subTest(op=op):
                with self.assertRaises(bridge.BridgeError):
                    bridge.resolve_resolution(
                        {"mode": "custom", "width": side, "height": side},
                        1920, 1080, op)

    def test_odd_tiny_and_noninteger_dimensions_are_rejected(self):
        for width, height in ((1919, 1080), (1920, 1079), (126, 128),
                              (128, 126), (1920.5, 1080), (True, 1080)):
            with self.subTest(width=width, height=height):
                with self.assertRaises(bridge.BridgeError):
                    bridge.resolve_resolution(
                        {"mode": "custom", "width": width, "height": height},
                        1920, 1080, "preview")


class ShortReader:
    """A pipe may legally return fewer bytes than requested before its EOF."""

    def __init__(self, pieces, on_read=None):
        self.pieces = list(pieces)
        self.on_read = on_read
        self.reads = 0

    def read(self, size):
        self.reads += 1
        if self.on_read:
            self.on_read(self.reads)
        if not self.pieces:
            return b""
        data = self.pieces.pop(0)
        if len(data) > size:
            self.pieces.insert(0, data[size:])
            data = data[:size]
        return data


class FrameReadTests(unittest.TestCase):
    def test_short_pipe_reads_are_assembled_into_one_complete_frame(self):
        pipe = ShortReader([b"ab", b"c", b"def", b"gh"])
        cancel = bridge.Cancellation()
        self.assertEqual(bridge.read_exact_frame(pipe, 6, cancel), b"abcdef")
        self.assertEqual(bridge.read_exact_frame(pipe, 2, cancel), b"gh")
        self.assertIsNone(bridge.read_exact_frame(pipe, 6, cancel))

    def test_truncated_frame_is_an_error_not_a_clean_eof(self):
        with self.assertRaises(bridge.BridgeError) as error:
            bridge.read_exact_frame(io.BytesIO(b"abc"), 4, bridge.Cancellation())
        self.assertEqual(error.exception.code, "truncated_frame")

    def test_cancel_is_checked_between_short_reads(self):
        cancel = bridge.Cancellation()
        pipe = ShortReader([b"ab", b"cd"], on_read=lambda _: cancel.set())
        with self.assertRaises(bridge.BridgeError) as error:
            bridge.read_exact_frame(pipe, 4, cancel)
        self.assertEqual(pipe.reads, 1)
        self.assertEqual(error.exception.code, "cancelled")


class CancellationTests(unittest.TestCase):
    def new_child(self):
        child = subprocess.Popen(
            [sys.executable, "-c", "import sys; sys.stdin.buffer.read()"],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        self.addCleanup(self.reap_child, child)
        return child

    @staticmethod
    def reap_child(child):
        if child.poll() is None:
            child.kill()
        child.wait(timeout=5)
        child.stdin.close()

    def test_cancel_terminates_all_registered_children(self):
        cancel = bridge.Cancellation()
        children = [self.new_child(), self.new_child()]
        for child in children:
            cancel.register(child)
        cancel.set()
        self.assertTrue(cancel.is_set())
        for child in children:
            child.wait(timeout=5)
            self.assertIsNotNone(child.returncode)

    def test_unregister_prevents_cancelling_an_unowned_process(self):
        child = self.new_child()
        cancel = bridge.Cancellation()
        cancel.register(child)
        cancel.unregister(child)
        cancel.set()
        self.assertIsNone(child.poll())

    def test_process_registered_after_cancel_cannot_escape_cleanup(self):
        child = self.new_child()
        cancel = bridge.Cancellation()
        cancel.set()
        try:
            cancel.register(child)
        except bridge.BridgeError:
            pass
        child.wait(timeout=5)
        self.assertIsNotNone(child.returncode)


class RenderBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            import numpy as np
        except ImportError:
            raise unittest.SkipTest("Optional NumPy is required for fake-core frame tests")
        cls.np = np

    def fake_core(self):
        np = self.np
        calls = SimpleNamespace(live=[], writers=[], composition=[])

        class ColorConversion:
            COLOR_BGR2RGBA = 1
            COLOR_RGBA2BGR = 2

            @staticmethod
            def cvtColor(frame, code):
                if code == ColorConversion.COLOR_BGR2RGBA:
                    alpha = np.full((*frame.shape[:2], 1), 255, dtype=np.uint8)
                    return np.concatenate((frame[..., ::-1], alpha), axis=2)
                if code == ColorConversion.COLOR_RGBA2BGR:
                    return frame[..., 2::-1].copy()
                raise AssertionError("Unexpected conversion")

        class Live:
            def __init__(self, width, height, settings):
                self.size = (width, height)
                self.settings = dict(settings)
                self.frames = []
                self.resets = []
                self.closed = False
                calls.live.append(self)

            def process(self, frame, reset):
                self.frames.append(frame.copy())
                self.resets.append(reset)
                result = frame.copy()
                result[..., :3] += 1
                return result

            def close(self):
                self.closed = True

        class Writer:
            encoder_name = "fake-h264"
            audio_mode = "none"

            def __init__(self, path, width, height, fps, **kwargs):
                self.path = Path(path)
                self.size = (width, height)
                self.options = kwargs
                self.frames = []
                self.finished = self.aborted = False
                calls.writers.append(self)

            def write(self, frame):
                self.frames.append(frame.copy())

            def finish(self):
                self.finished = True
                self.path.write_bytes(b"fake-encoded-output")

            def abort(self):
                self.aborted = True

        def compose(original, processed, *, view, mix):
            calls.composition.append((view, mix))
            return processed

        core = (np, ColorConversion, Live, Writer, compose,
                SimpleNamespace(validate=mock.Mock()), None)
        return core, calls

    def test_custom_dimensions_reach_nr_and_both_outputs_share_selected_frames(self):
        np = self.np
        core, calls = self.fake_core()
        originals = [np.full((128, 256, 3), [10, 20, 30], dtype=np.uint8),
                     np.full((128, 256, 3), [40, 50, 60], dtype=np.uint8)]
        decoder = mock.Mock()
        decoder.stdout = io.BytesIO(b"".join(frame.tobytes() for frame in originals))
        decoder.wait.return_value = 0
        decoder.poll.return_value = 0
        media = {"width": 640, "height": 360, "rate": Fraction(25),
                 "timestamps": [Fraction(0), Fraction(1, 25)],
                 "end": Fraction(2, 25), "audio": False}
        verification = {"streams": [{"width": 256, "height": 128,
                                     "codec_name": "h264", "pix_fmt": "yuv420p",
                                     "nb_read_frames": "2"}]}
        settings = bridge.normalize_options(options())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "input.mp4"
            source.write_bytes(b"fake-input")
            output, reference = root / "result.mp4", root / "reference.mp4"
            request = {"op": "export", "inputPath": str(source), "outputPath": str(output),
                       "sourceOutputPath": str(reference),
                       "resolution": {"mode": "custom", "width": 256, "height": 128}}
            with mock.patch.object(bridge, "inspect_media", return_value=media), \
                    mock.patch.object(bridge, "_run_json", return_value=verification), \
                    mock.patch.object(bridge.subprocess, "Popen", return_value=decoder) as popen:
                result = bridge.render_video(request, settings, "ffmpeg", "ffprobe", root,
                                             core, bridge.Cancellation(), mock.Mock())
            self.assertTrue(output.is_file())
            self.assertTrue(reference.is_file())
        self.assertEqual((result["width"], result["height"], result["frames"]), (256, 128, 2))
        self.assertEqual(len(calls.live), 1)
        live = calls.live[0]
        self.assertEqual(live.size, (256, 128))
        self.assertEqual(live.resets, [True, False])
        self.assertTrue(live.closed)
        self.assertEqual([writer.size for writer in calls.writers], [(256, 128), (256, 128)])
        self.assertTrue(all(writer.finished for writer in calls.writers))
        self.assertEqual(calls.composition, [(0, 1.0), (0, 1.0)])
        for index, original in enumerate(originals):
            np.testing.assert_array_equal(live.frames[index][..., :3], original[..., ::-1])
            np.testing.assert_array_equal(live.frames[index][..., 3], 255)
            np.testing.assert_array_equal(calls.writers[0].frames[index], original + 1)
            np.testing.assert_array_equal(calls.writers[1].frames[index], original)
        command = popen.call_args.args[0]
        filters = command[command.index("-vf") + 1]
        self.assertIn("scale=256:128:force_original_aspect_ratio=decrease", filters)
        self.assertIn("pad=256:128", filters)
        self.assertEqual(command[command.index("-frames:v") + 1], "2")

    def test_missing_or_wrong_sized_nr_frame_is_not_written_as_success(self):
        np = self.np
        core, _ = self.fake_core()
        original = np.zeros((128, 128, 3), dtype=np.uint8)
        for invalid in (None, np.zeros((128, 126, 4), dtype=np.uint8),
                        np.zeros((128, 128, 4), dtype=np.float32)):
            with self.subTest(output_type=type(invalid).__name__):
                live = SimpleNamespace(process=mock.Mock(return_value=invalid))
                writer, reference = mock.Mock(), mock.Mock()
                with self.assertRaises(bridge.BridgeError) as error:
                    bridge.render_frames(io.BytesIO(original.tobytes()), live, writer, reference,
                                         core, 128, 128, 1, {"output_mix": 1.0},
                                         bridge.Cancellation(), mock.Mock())
                self.assertEqual(error.exception.code, "invalid_engine_output")
                writer.write.assert_not_called()
                reference.write.assert_not_called()

    def test_decoder_ending_before_expected_frame_count_is_an_error(self):
        core, _ = self.fake_core()
        with self.assertRaises(bridge.BridgeError) as error:
            bridge.render_frames(io.BytesIO(), mock.Mock(), mock.Mock(), None,
                                 core, 128, 128, 2, {"output_mix": 1.0},
                                 bridge.Cancellation(), mock.Mock())
        self.assertEqual(error.exception.code, "frame_count_mismatch")


class CLITests(unittest.TestCase):
    def test_invalid_request_returns_json_error_without_loading_gpu_packages(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            marker = root / "gpu-imported"
            for module in ("numpy", "cv2", "torch", "dlss5tool"):
                (root / (module + ".py")).write_text(
                    "from pathlib import Path\n"
                    f"Path({str(marker)!r}).write_text('unexpected import')\n"
                    "raise RuntimeError('GPU dependency imported during validation')\n",
                    encoding="utf-8",
                )
            env = {**os.environ, "PYTHONPATH": directory, "PYTHONDONTWRITEBYTECODE": "1"}
            for payload in ("{not-json}\n", json.dumps({"version": 999, "id": "bad-version", "op": "probe"}) + "\n"):
                with self.subTest(payload=payload):
                    result = subprocess.run(
                        [sys.executable, "-u", str(BRIDGE_PATH)], input=payload,
                        text=True, encoding="utf-8", stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                        timeout=5, env=env, check=False,
                    )
                    events = [json.loads(line) for line in result.stdout.splitlines() if line]
                    self.assertEqual(len(events), 1, result.stdout)
                    self.assertEqual(events[0]["type"], "error")
                    self.assertTrue(events[0].get("error"))
                    self.assertNotIn("Traceback", result.stderr)
                    self.assertFalse(marker.exists(), "Validation imported a GPU package")


if __name__ == "__main__":
    unittest.main()
