"""Verify approval content and that deployment consumes the reviewed bytes."""
import hashlib
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
import urllib.error
from unittest.mock import patch, MagicMock

from test_release import module, release, dispatch, MANIFEST, SHA

with patch.dict(sys.modules, {"release": release}):
    prepare = module("prepare_release")

RUN = {"id": 95, "head_sha": SHA, "run_number": 20, "head_branch": "main"}
ROOT = Path(__file__).resolve().parents[2]


class ApprovalSummaryTests(unittest.TestCase):
    def metadata(self, folder):
        for service, image in MANIFEST["images"].items():
            (folder / (service + ".json")).write_text(json.dumps({"image": image}), encoding="utf-8")

    def test_exact_ci_images_form_reviewed_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            self.metadata(folder)
            self.assertEqual(prepare.prepare_manifest(folder, RUN, "Example/Blog"), MANIFEST)

    def test_missing_extra_malformed_mutable_and_foreign_images_block_preparation(self):
        for case in ("missing", "extra", "malformed", "mutable", "foreign"):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as temp:
                folder = Path(temp)
                self.metadata(folder)
                file = folder / "frontend.json"
                if case == "missing": file.unlink()
                elif case == "extra": (folder / "unknown.json").write_text("{}")
                elif case == "malformed": file.write_text("not json")
                elif case == "mutable": file.write_text(json.dumps({"image": "ghcr.io/example/blog:latest"}))
                else: file.write_text(json.dumps({"image": "ghcr.io/other/blog@sha256:" + "a" * 64}))
                with self.assertRaises(ValueError): prepare.prepare_manifest(folder, RUN, "example/blog")

    def test_current_migration_registry_and_unsupported_format(self):
        source = (ROOT / "backend/internal/migrations/migrations.go").read_text(encoding="utf-8")
        entries = prepare.registered_migrations(source)
        self.assertIn(("2026092301", "allow_custom_link_colors"), entries)
        for invalid in ("", source.replace('name:    "establish_application_schema"', 'name: migrationName')):
            with self.assertRaises(ValueError): prepare.registered_migrations(invalid)

    def test_summary_links_digests_and_honest_migration_notice(self):
        summary = prepare.render_summary(MANIFEST, RUN, "example/blog", [("2026092301", "allow_custom_link_colors")], [12], None, "d" * 64)
        for expected in (f"/commit/{SHA}", "/actions/runs/95", "/pull/12", "2026092301", "NOT a list of pending", "have not been inspected"):
            self.assertIn(expected, summary)
        for image in MANIFEST["images"].values(): self.assertIn(image, summary)
        self.assertNotIn("VPS_HOST", summary)

    def test_missing_pr_and_failed_lookup_are_distinct_and_do_not_leak_diagnostics(self):
        empty = prepare.render_summary(MANIFEST, RUN, "example/blog", [], [], None, "d" * 64)
        self.assertIn("None found", empty)
        with patch.object(prepare.urllib.request, "urlopen", side_effect=urllib.error.URLError("private diagnostic")):
            prs, warning = prepare.associated_prs("example/blog", SHA, "test-token")
        self.assertEqual(prs, [])
        self.assertIn("unavailable", warning)
        self.assertNotIn("private diagnostic", warning)
        with patch.object(prepare.urllib.request, "urlopen") as open_request:
            response = MagicMock()
            response.read.return_value = b'[{"number": 12}]'
            open_request.return_value.__enter__.return_value = response
            self.assertEqual(prepare.associated_prs("example/blog", SHA, "test-token"), ([12], None))

    def test_branch_markup_cannot_inject_summary_html(self):
        summary = prepare.render_summary(MANIFEST, {**RUN, "head_branch": "<img src=x>"}, "example/blog", [], [], None, "d" * 64)
        self.assertNotIn("<img", summary)
        self.assertIn("&lt;img", summary)

    def test_generated_artifact_and_summary_use_the_same_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "image-metadata").mkdir()
            self.metadata(root / "image-metadata")
            registry = root / "backend/internal/migrations"
            registry.mkdir(parents=True)
            (registry / "migrations.go").write_text((ROOT / "backend/internal/migrations/migrations.go").read_text(encoding="utf-8"), encoding="utf-8")
            private_marker = "SYNTHETIC_PRIVATE_VALUE_DO_NOT_EXPORT"
            event = {"workflow_run": {**RUN, "head_commit": {"message": private_marker, "author": {"email": private_marker}},
                                      "actor": {"email": private_marker}}, "unrelated_payload": private_marker}
            (root / "event.json").write_text(json.dumps(event))
            metadata = root / "image-metadata/frontend.json"
            metadata.write_text(json.dumps({"image": MANIFEST["images"]["frontend"], "private_extra": private_marker}))
            env = {"GITHUB_EVENT_PATH": str(root / "event.json"), "GITHUB_REPOSITORY": "example/blog", "GH_TOKEN": "test-token",
                   "GITHUB_STEP_SUMMARY": str(root / "summary.md"), "GITHUB_OUTPUT": str(root / "outputs"), "RELEASE_ARTIFACT": "reviewed-release-101-2",
                   "VPS_HOST": private_marker, "VPS_USER": private_marker, "VPS_DEPLOY_PATH": private_marker,
                   "VPS_SSH_PRIVATE_KEY": private_marker, "DB_DSN": private_marker}
            stdout, stderr = io.StringIO(), io.StringIO()
            previous = Path.cwd()
            try:
                os.chdir(root)
                with patch.dict(os.environ, env, clear=True), patch.object(prepare, "associated_prs", return_value=([], None)), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                    prepare.main()
            finally: os.chdir(previous)
            payload = (root / "reviewed-release/release.json").read_bytes()
            digest = hashlib.sha256(payload).hexdigest()
            self.assertEqual(json.loads(payload), MANIFEST)
            self.assertIn(digest, (root / "summary.md").read_text(encoding="utf-8"))
            self.assertEqual((root / "summary.md").read_bytes(), (root / "reviewed-release/summary.md").read_bytes())
            self.assertIn("artifact_name=reviewed-release-101-2", (root / "outputs").read_text())
            exported = b"".join(path.read_bytes() for path in (root / "reviewed-release").iterdir())
            exported += (root / "summary.md").read_bytes() + (root / "outputs").read_bytes()
            self.assertNotIn(private_marker.encode(), exported)
            self.assertEqual(stdout.getvalue() + stderr.getvalue(), "")
            with patch.dict(sys.modules, {"release": release}):
                self.assertEqual(dispatch.load_reviewed_manifest(root / "reviewed-release/release.json", SHA, "20", digest), MANIFEST)

    def test_preparation_failure_does_not_print_payload_or_traceback(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            marker = "SYNTHETIC_PRIVATE_ERROR_VALUE"
            event = root / "event.json"
            event.write_text(json.dumps({"workflow_run": {**RUN, "head_sha": marker}}))
            metadata = root / "image-metadata"
            metadata.mkdir()
            self.metadata(metadata)
            result = subprocess.run([sys.executable, str(ROOT / "deploy/prepare_release.py")], cwd=root,
                                    env={**os.environ, "GITHUB_EVENT_PATH": str(event), "GITHUB_REPOSITORY": "example/blog"},
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, "")
            self.assertIn("Deployment is blocked", result.stderr)
            self.assertNotIn(marker, result.stderr)
            self.assertNotIn("Traceback", result.stderr)
            self.assertFalse((root / "reviewed-release").exists())

    def test_dispatch_rejects_wrong_commit_sequence_checksum_and_changed_images(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(sys.modules, {"release": release}):
            file = Path(temp) / "release.json"
            payload = json.dumps(MANIFEST).encode()
            file.write_bytes(payload)
            digest = hashlib.sha256(payload).hexdigest()
            for sha, sequence, checksum in (("b" * 40, "20", digest), (SHA, "21", digest), (SHA, "20", "e" * 64)):
                with self.assertRaises(ValueError): dispatch.load_reviewed_manifest(file, sha, sequence, checksum)
            altered = json.loads(payload)
            altered["images"]["frontend"] = "ghcr.io/example/blog@sha256:" + "f" * 64
            file.write_text(json.dumps(altered))
            with self.assertRaises(ValueError): dispatch.load_reviewed_manifest(file, SHA, "20", digest)


if __name__ == "__main__":
    unittest.main()
