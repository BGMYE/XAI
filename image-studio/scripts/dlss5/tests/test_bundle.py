"""Real-file bundle CLI checks; all PE files are inert synthetic fixtures.

Run with ``python -m unittest discover -s tests -v`` from scripts/dlss5.
The suite never executes a worker, DLL, FFmpeg, or GPU component.
"""

import copy
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import struct
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "bundle.py"


def pe_fixture(machine=0x8664, optional_magic=0x20B):
    """Enough PE metadata for architecture validation, with no machine code."""
    content = bytearray(512)
    content[:2] = b"MZ"
    struct.pack_into("<I", content, 0x3C, 0x80)
    content[0x80:0x84] = b"PE\x00\x00"
    struct.pack_into("<H", content, 0x84, machine)
    struct.pack_into("<H", content, 0x94, 0xF0)
    struct.pack_into("<H", content, 0x98, optional_magic)
    return bytes(content)


class BundleCLITests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="xai-bundle-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.worker = self.root / "developer-worker"
        self.runtime = self.root / "developer-runtime"
        self.output = self.root / "bundle"
        self.required = [
            self.worker / "xai-video-engine.exe",
            self.worker / "_internal" / "python311.dll",
            self.runtime / "dlssnr_host_v2.dll",
            self.runtime / "nvngx_dlssnr.dll",
            self.runtime / "ffmpeg.exe",
            self.runtime / "ffprobe.exe",
        ]
        for path in self.required:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(pe_fixture())
        self.notice = self.runtime / "THIRD_PARTY_NOTICES.md"
        self.notice.write_text("Synthetic fixture notices; no proprietary binary is included.\n", encoding="utf-8")
        (self.worker / "_internal" / "application-data.bin").write_bytes(b"fixture data\x00\xff")
        python_license = self.worker / "_internal" / "licenses" / "Python" / "LICENSE.txt"
        python_license.parent.mkdir(parents=True)
        python_license.write_text("Synthetic Python license fixture; never a distributable runtime.\n", encoding="utf-8")

    def cli(self, *arguments, success=True):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), *map(str, arguments)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=15,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}, check=False,
        )
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            self.assertIsInstance(payload, dict)
        else:
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            payload = json.loads(result.stderr)
            self.assertTrue(payload.get("error"), result.stderr)
            self.assertNotIn("Traceback", result.stderr)
        return payload

    def build(self, *, output=None, success=True):
        return self.cli("build", "--worker-root", self.worker,
                        "--runtime-root", self.runtime, "--output", output or self.output,
                        "--engine-version", "fixture-engine-1", "--bundle-version", "fixture-bundle-1",
                        success=success)

    def manifest(self):
        return json.loads((self.output / "manifest.json").read_text(encoding="utf-8"))

    def write_manifest(self, manifest):
        (self.output / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    def test_build_and_verify_cover_every_file_with_relative_sha256_entries(self):
        self.build()
        self.cli("verify", self.output)
        manifest = self.manifest()
        self.assertEqual(manifest["engineVersion"], "fixture-engine-1")
        self.assertEqual(manifest["bundleVersion"], "fixture-bundle-1")
        actual = {path.relative_to(self.output).as_posix()
                  for path in self.output.rglob("*") if path.is_file()
                  and path != self.output / "manifest.json"}
        entries = manifest["files"]
        registered = [entry["path"] for entry in entries]
        self.assertEqual(set(registered), actual)
        self.assertEqual(len(registered), len(actual))
        self.assertTrue(any(name.startswith("licenses/") for name in actual))
        for entry in entries:
            with self.subTest(path=entry["path"]):
                path = PurePosixPath(entry["path"])
                self.assertFalse(path.is_absolute())
                self.assertNotIn("..", path.parts)
                self.assertNotIn("\\", entry["path"])
                self.assertEqual(entry["path"], path.as_posix())
                content = self.output.joinpath(*path.parts).read_bytes()
                self.assertEqual(entry["sha256"], hashlib.sha256(content).hexdigest())

    def test_manifest_does_not_record_developer_absolute_paths(self):
        self.build()
        text = (self.output / "manifest.json").read_text(encoding="utf-8")
        for private_path in (self.worker, self.runtime, self.output, self.root):
            with self.subTest(path=private_path):
                self.assertNotIn(str(private_path), text)
                self.assertNotIn(str(private_path).replace("\\", "\\\\"), text)

    def test_developer_installation_metadata_is_not_copied_into_release(self):
        for index, filename in enumerate(("environment.json", "xai-dlss5-environment.json", "bridge-bundle.json")):
            with self.subTest(filename=filename):
                metadata = self.runtime / filename
                metadata.write_text(json.dumps({"runtimeRoot": str(self.runtime),
                                                "pythonPath": "C:/Users/developer/python.exe"}), encoding="utf-8")
                try:
                    self.build(output=self.root / f"private-metadata-{index}", success=False)
                finally:
                    metadata.unlink()

    def test_build_accepts_an_existing_empty_output_directory(self):
        self.output.mkdir()
        self.build()
        self.cli("verify", self.output)

    def test_build_refuses_nonempty_output_without_touching_existing_content(self):
        self.output.mkdir()
        sentinel = self.output / "keep.txt"
        sentinel.write_bytes(b"must stay byte-for-byte intact")
        self.build(success=False)
        self.assertEqual(sentinel.read_bytes(), b"must stay byte-for-byte intact")
        self.assertEqual(list(self.output.iterdir()), [sentinel])

    def test_each_required_binary_is_required_at_build_time(self):
        for index, path in enumerate(self.required):
            with self.subTest(path=path.relative_to(self.root)):
                data = path.read_bytes()
                path.unlink()
                try:
                    self.build(output=self.root / f"missing-{index}", success=False)
                finally:
                    path.write_bytes(data)

    def test_runtime_notice_is_required_and_cannot_be_empty(self):
        self.notice.unlink()
        self.build(output=self.root / "missing-notice", success=False)
        self.notice.write_text("", encoding="utf-8")
        self.build(output=self.root / "empty-notice", success=False)

    def test_frozen_interpreter_license_is_required_and_xai_license_is_preserved(self):
        self.build()
        self.assertEqual((self.output / "licenses" / "XAI-AGPL-3.0.txt").read_bytes(),
                         (SCRIPT.parents[3] / "LICENSE").read_bytes())
        (self.worker / "_internal" / "licenses" / "Python" / "LICENSE.txt").unlink()
        self.build(output=self.root / "missing-python-license", success=False)

    def test_wrong_architecture_or_non_pe_native_files_are_rejected(self):
        target = self.runtime / "ffmpeg.exe"
        for index, data in enumerate((b"this is not an executable", pe_fixture(machine=0x14C),
                                      pe_fixture(optional_magic=0x10B))):
            with self.subTest(case=index):
                target.write_bytes(data)
                self.build(output=self.root / f"invalid-pe-{index}", success=False)

    def test_extra_native_extension_also_requires_amd64_pe(self):
        (self.worker / "_internal" / "wrong-architecture.pyd").write_bytes(pe_fixture(machine=0xAA64))
        self.build(success=False)

    def make_guidance(self, backends):
        guidance = self.runtime / "mods" / "enhancement"
        (guidance / "_internal").mkdir(parents=True)
        (guidance / "guidance_worker.exe").write_bytes(pe_fixture())
        (guidance / "_internal" / "python311.dll").write_bytes(pe_fixture())
        (guidance / "enhancement.json").write_text(json.dumps({
            "id": "dlss5-guidance", "protocol": 1,
            "architectures": ["raft_large", "depth_anything_v2"],
            "flow_backends": backends,
        }), encoding="utf-8")
        return guidance

    def test_nvofa_bundle_does_not_require_unrelated_raft_weights(self):
        self.make_guidance(["nvofa"])
        self.build()
        self.cli("verify", self.output)

    def test_declared_raft_requires_matching_nonempty_model_weights(self):
        self.make_guidance(["raft"])
        self.build(output=self.root / "raft-missing-weights", success=False)
        models = self.runtime / "mods" / "models"
        models.mkdir()
        weights = models / "raft_large_C_T_SKHT_V2-ff5fadd5.pth"
        weights.write_bytes(b"")
        self.build(output=self.root / "raft-empty-weights", success=False)
        weights.write_bytes(b"synthetic fixture weights, never loaded")
        self.build()
        self.cli("verify", self.output)

    def test_nonobject_guidance_manifest_has_structured_error(self):
        guidance = self.make_guidance(["nvofa"])
        for index, value in enumerate(([], None)):
            with self.subTest(value=value):
                (guidance / "enhancement.json").write_text(json.dumps(value), encoding="utf-8")
                self.build(output=self.root / f"malformed-guidance-{index}", success=False)

    def test_verify_rejects_file_tampering_even_with_unchanged_filename(self):
        self.build()
        path = self.output / "worker" / "_internal" / "application-data.bin"
        path.write_bytes(b"tampered data")
        self.cli("verify", self.output, success=False)

    def test_verify_rejects_missing_registered_file(self):
        self.build()
        (self.output / "runtime" / "ffprobe.exe").unlink()
        self.cli("verify", self.output, success=False)

    def test_verify_rejects_unregistered_files_and_omitted_manifest_entries(self):
        self.build()
        rogue = self.output / "worker" / "unregistered.txt"
        rogue.write_text("unexpected payload", encoding="utf-8")
        self.cli("verify", self.output, success=False)
        rogue.unlink()
        manifest = self.manifest()
        manifest["files"].pop()
        self.write_manifest(manifest)
        self.cli("verify", self.output, success=False)

    def test_verify_rejects_duplicate_manifest_entries(self):
        self.build()
        manifest = self.manifest()
        manifest["files"].append(dict(manifest["files"][0]))
        self.write_manifest(manifest)
        self.cli("verify", self.output, success=False)

    def test_version_limits_match_go_utf8_bytes(self):
        self.build()
        baseline = self.manifest()
        for field in ("engineVersion", "bundleVersion"):
            for value, success in (("a" * 200, True), ("a" * 201, False),
                                   ("界" * 66, True), ("界" * 67, False)):
                with self.subTest(field=field, bytes=len(value.encode("utf-8"))):
                    manifest = copy.deepcopy(baseline)
                    manifest[field] = value
                    self.write_manifest(manifest)
                    self.cli("verify", self.output, success=success)

    def test_verify_rejects_bom_manifest_like_go(self):
        self.build()
        manifest_path = self.output / "manifest.json"
        manifest_path.write_bytes(b"\xef\xbb\xbf" + manifest_path.read_bytes())
        self.cli("verify", self.output, success=False)

    def test_verify_rejects_casefold_duplicate_paths_on_case_sensitive_hosts(self):
        self.build()
        original = self.output / "worker" / "xai-video-engine.exe"
        alias = original.with_name("XAI-VIDEO-ENGINE.EXE")
        if alias.exists():
            self.skipTest("Requires a case-sensitive filesystem to create distinct alias files")
        alias.write_bytes(original.read_bytes())
        manifest = self.manifest()
        manifest["files"].append({"path": "worker/XAI-VIDEO-ENGINE.EXE",
                                  "sha256": hashlib.sha256(alias.read_bytes()).hexdigest()})
        self.write_manifest(manifest)
        self.cli("verify", self.output, success=False)

    def test_verify_rejects_escaping_and_noncanonical_manifest_paths(self):
        self.build()
        baseline = self.manifest()
        outside = self.root / "outside.dll"
        outside.write_bytes(pe_fixture())
        paths = ["../outside.dll", str(outside), "C:/outside.dll",
                 "worker\\xai-video-engine.exe", "./worker/xai-video-engine.exe",
                 "worker//xai-video-engine.exe", "worker/../runtime/ffmpeg.exe", ""]
        for path in paths:
            with self.subTest(path=path):
                manifest = copy.deepcopy(baseline)
                manifest["files"][0]["path"] = path
                self.write_manifest(manifest)
                self.cli("verify", self.output, success=False)

    def test_verify_rejects_windows_reserved_names_trailing_dots_and_spaces(self):
        self.build()
        baseline = self.manifest()
        original = self.output / "worker" / "_internal" / "application-data.bin"
        data = original.read_bytes()
        original.unlink()
        for filename in ("CON.txt", "NUL", "COM1.bin", "data.", "data "):
            with self.subTest(filename=filename):
                renamed = original.with_name(filename)
                if os.name == "nt":
                    # Create real fixture files, not Windows device aliases.
                    renamed = Path("\\\\?\\" + str(renamed))
                try:
                    renamed.write_bytes(data)
                except OSError:
                    continue  # Windows itself may refuse these filesystem names.
                try:
                    manifest = copy.deepcopy(baseline)
                    for entry in manifest["files"]:
                        if entry["path"] == "worker/_internal/application-data.bin":
                            entry["path"] = "worker/_internal/" + filename
                    self.write_manifest(manifest)
                    self.cli("verify", self.output, success=False)
                finally:
                    renamed.unlink()

    def test_verify_requires_canonical_lowercase_sha256(self):
        self.build()
        baseline = self.manifest()
        digest = baseline["files"][0]["sha256"]
        for invalid in (digest.upper(), "0" * 63, "g" * 64):
            with self.subTest(digest=invalid):
                manifest = copy.deepcopy(baseline)
                manifest["files"][0]["sha256"] = invalid
                self.write_manifest(manifest)
                self.cli("verify", self.output, success=False)

    def create_symlink(self, link, target, *, directory=False):
        try:
            link.symlink_to(target, target_is_directory=directory)
        except (NotImplementedError, OSError) as exc:
            self.skipTest(f"Cannot create symlink on this host: {exc}")

    def test_build_rejects_symlinked_source_files(self):
        outside = self.root / "outside-secret.txt"
        outside.write_text("not part of the release", encoding="utf-8")
        self.create_symlink(self.worker / "_internal" / "secret.txt", outside)
        self.build(success=False)

    def test_build_rejects_symlinked_source_directories(self):
        outside = self.root / "outside-directory"
        outside.mkdir()
        (outside / "secret.txt").write_text("not part of the release", encoding="utf-8")
        self.create_symlink(self.worker / "_internal" / "external", outside, directory=True)
        self.build(success=False)

    def test_build_rejects_symlinked_source_roots(self):
        for attribute in ("worker", "runtime"):
            with self.subTest(root=attribute):
                original = getattr(self, attribute)
                alias = self.root / f"linked-{attribute}"
                self.create_symlink(alias, original, directory=True)
                setattr(self, attribute, alias)
                try:
                    self.build(output=self.root / f"linked-{attribute}-output", success=False)
                finally:
                    setattr(self, attribute, original)

    def test_build_rejects_symlinked_empty_output_root(self):
        target = self.root / "untouched-empty-output"
        target.mkdir()
        self.create_symlink(self.output, target, directory=True)
        self.build(success=False)
        self.assertEqual(list(target.iterdir()), [])
        self.assertTrue(self.output.is_symlink())

    def test_verify_rejects_symlinked_bundle_root(self):
        self.build()
        alias = self.root / "linked-bundle"
        self.create_symlink(alias, self.output, directory=True)
        self.cli("verify", alias, success=False)

    def test_verify_rejects_symlink_even_when_target_hash_matches_manifest(self):
        self.build()
        victim = self.output / "runtime" / "ffmpeg.exe"
        outside = self.root / "external-ffmpeg.exe"
        outside.write_bytes(victim.read_bytes())
        victim.unlink()
        self.create_symlink(victim, outside)
        self.cli("verify", self.output, success=False)


if __name__ == "__main__":
    unittest.main()
