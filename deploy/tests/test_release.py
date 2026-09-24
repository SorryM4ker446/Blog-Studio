import importlib.util
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parents[1] / (name + ".py"))
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


release = module("release")
dispatch = module("dispatch")
SHA = "a" * 40
MANIFEST = {"sha": SHA, "sequence": 20, "images": {
    service: "ghcr.io/example/blog@sha256:" + digest * 64
    for service, digest in (("frontend", "a"), ("backend", "b"), ("maintenance", "c"))}}


class TransportPrivacyTests(unittest.TestCase):
    def test_captures_transport_diagnostics_without_printing(self):
        with patch.object(dispatch.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, " result\n", "private diagnostic")) as run:
            self.assertEqual(dispatch.transport(["ssh", "example.test"]), "result")
        run.assert_called_once_with(["ssh", "example.test"], check=True, text=True, capture_output=True)

    def test_transport_failures_do_not_expose_arguments_or_output(self):
        args = ["ssh", "deploy@example.test", "cat /srv/private/status.json"]
        failures = [subprocess.CalledProcessError(255, args, output="private output", stderr="private diagnostic"),
                    OSError("private path")]
        for failure in failures:
            with self.subTest(failure=type(failure).__name__), patch.object(dispatch.subprocess, "run", side_effect=failure):
                with self.assertRaises(RuntimeError) as caught:
                    dispatch.transport(args)
                self.assertEqual(str(caught.exception), "SSH transport failed; verify production secrets, connectivity and server state privately.")


class ImageManifestTests(unittest.TestCase):
    def test_one_package_retains_distinct_service_digests(self):
        validated = release.validate_manifest(MANIFEST)
        self.assertEqual(len(set(validated["images"].values())), 3)
        self.assertEqual({image.split("@")[0] for image in validated["images"].values()}, {"ghcr.io/example/blog"})

    def test_existing_separate_packages_remain_valid(self):
        previous = {**MANIFEST, "images": {
            service: f"ghcr.io/example/blog-{service}@sha256:" + "b" * 64
            for service in MANIFEST["images"]}}
        self.assertEqual(release.validate_manifest(previous), previous)


class FakeDocker:
    def __init__(self, fail=None):
        self.calls = []
        self.fail = fail
        self.config = {"name": "blog-studio", "volumes": {"postgres_data": {"name": "blog-studio_postgres_data"}}, "services": {
            "maintenance": {"image": "blog-studio-maintenance:old"},
            "backend": {"environment": {"ALLOWED_ORIGINS": "https://example.test"}},
            "postgres": {},
        }}

    def __call__(self, args, capture=False):
        self.calls.append(args)
        if self.fail and self.fail(args):
            raise subprocess.CalledProcessError(1, args)
        if "config" in args and "json" in args:
            return json.dumps(self.config)
        if "ps" in args:
            return "container-" + args[-1]
        if args[:2] == ["docker", "inspect"]:
            return "sha256:old-" + args[-1]
        if args[:3] == ["docker", "image", "inspect"]:
            if "{{json .}}" in args:
                return json.dumps({"Architecture": "amd64", "Config": {"Labels": {"org.opencontainers.image.revision": SHA}}})
            return "sha256:old-maintenance"
        if args[:2] == ["docker", "version"]:
            return "amd64"
        return ""


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "deploy").mkdir()
        (self.root / "deploy/.env").write_text("APP_IMAGE_TAG=old\n")
        self.state = self.root / "deploy/.deployment"
        self.bundle = self.state / "releases/100-1"
        self.bundle.mkdir(parents=True)
        release.write_json(self.bundle / "release.json", MANIFEST)

    def deploy(self, fake=None):
        fake = fake or FakeDocker()
        worker = release.Deployer(self.root, self.bundle, run=fake)
        worker._execute_locked()
        return fake

    def test_backup_uses_old_image_before_migration_and_pointer_changes_after_health(self):
        fake = self.deploy()
        calls = fake.calls
        stop = next(i for i, args in enumerate(calls) if "stop" in args)
        backup = next(i for i, args in enumerate(calls) if "/app/backup" in args)
        migration = next(i for i, args in enumerate(calls) if "run" in args and args[-1] == "migrate")
        health = next(i for i, args in enumerate(calls) if args[0] == "curl")
        self.assertLess(max(i for i, args in enumerate(calls) if "pull" in args), stop)
        self.assertLess(stop, backup)
        self.assertLess(backup, migration)
        self.assertLess(migration, health)
        previous = release.read_json(self.bundle / "previous-images.json")
        self.assertEqual(previous["services"]["maintenance"]["image"], "sha256:old-maintenance")
        self.assertIn(str(self.bundle / "previous-images.json"), calls[backup])
        self.assertEqual(release.read_json(self.state / "current.json")["sha"], SHA)
        self.assertFalse((self.state / "attention.json").exists())
        self.assertEqual((self.root / "deploy/.env").read_text(), "APP_IMAGE_TAG=old\n")

    def test_public_health_checks_retry_transient_failures(self):
        fake = FakeDocker()
        release.Deployer(self.root, self.bundle, run=fake).health(fake.config)
        self.assertEqual(fake.calls, [
            ["curl", "--fail", "--silent", "--show-error", "--retry", "10", "--retry-all-errors", "--max-time", "30", "https://example.test/health/ready"],
            ["curl", "--fail", "--silent", "--show-error", "--retry", "10", "--retry-all-errors", "--max-time", "30", "https://example.test/api/settings"],
            ["curl", "--fail", "--silent", "--show-error", "--retry", "10", "--retry-all-errors", "--max-time", "30", "https://example.test/api/links"],
        ])
        
    def test_pull_failure_keeps_application_running(self):
        fake = FakeDocker(lambda args: args[:2] == ["docker", "pull"])
        with self.assertRaises(subprocess.CalledProcessError):
            self.deploy(fake)
        self.assertFalse(any("stop" in args for args in fake.calls))
        self.assertFalse((self.state / "attention.json").exists())

    def test_cleanup_runs_only_after_healthy_current_pointer_and_guard_clear(self):
        def cleanup(worker):
            self.assertEqual(release.read_json(self.state / "current.json")["sha"], SHA)
            self.assertFalse((self.state / "attention.json").exists())
            self.assertEqual(worker.phase, "cleanup")
            return {"removed": 0, "protected": 0, "failed": 0}
        with patch.object(release.Deployer, "retain_images", autospec=True, side_effect=cleanup) as clean:
            self.deploy()
            clean.assert_called_once()

    def test_failed_deployment_never_starts_cleanup(self):
        fake = FakeDocker(lambda args: args[0] == "curl")
        with patch.object(release.Deployer, "retain_images") as clean:
            with self.assertRaises(subprocess.CalledProcessError):
                self.deploy(fake)
            clean.assert_not_called()

    def test_backup_failure_restarts_old_services_without_migrating_new_release(self):
        fake = FakeDocker(lambda args: "/app/backup" in args)
        with self.assertRaises(subprocess.CalledProcessError):
            self.deploy(fake)
        restored = next(args for args in fake.calls if "up" in args)
        self.assertIn(str(self.bundle / "previous-images.json"), restored)
        self.assertFalse(any("run" in args and args[-1] == "migrate" for args in fake.calls))
        self.assertFalse((self.state / "attention.json").exists())

    def test_migration_or_health_failure_blocks_further_deployments_without_rollback(self):
        for stage in ("migrate", "health"):
            with self.subTest(stage=stage):
                guard = self.state / "attention.json"
                guard.unlink(missing_ok=True)
                fake = FakeDocker(lambda args: (stage == "migrate" and "run" in args and args[-1] == "migrate") or (stage == "health" and args[0] == "curl"))
                with self.assertRaises(subprocess.CalledProcessError):
                    self.deploy(fake)
                self.assertTrue(guard.exists())
                self.assertFalse((self.state / "current.json").exists())
                self.assertFalse(any("up" in args and str(self.bundle / "previous-images.json") in args for args in fake.calls))
                with self.assertRaisesRegex(release.ReleaseError, "operator review"):
                    self.deploy()

    def test_older_ci_run_is_rejected_before_docker_calls(self):
        release.write_json(self.state / "current.json", {"sha": "c" * 40, "sequence": 21, "path": str(self.root)})
        fake = FakeDocker()
        with self.assertRaisesRegex(release.ReleaseError, "older CI"):
            self.deploy(fake)
        self.assertEqual(fake.calls, [])

    def test_same_commit_is_idempotent_and_advances_sequence(self):
        release.write_json(self.state / "current.json", {"sha": SHA, "sequence": 19, "path": str(self.root)})
        fake = self.deploy()
        self.assertFalse(any("stop" in args or "run" in args for args in fake.calls))
        self.assertTrue(any(args[0] == "curl" for args in fake.calls))
        self.assertEqual(release.read_json(self.state / "current.json")["sequence"], 20)

    def test_mutable_image_tags_are_rejected(self):
        manifest = json.loads(json.dumps(MANIFEST))
        manifest["images"]["backend"] = "ghcr.io/example/blog-backend:latest"
        with self.assertRaises(release.ReleaseError):
            release.validate_manifest(manifest)

    def test_architecture_mismatch_fails_before_stopping_services(self):
        fake = FakeDocker()
        def run(args, capture=False):
            if args[:2] == ["docker", "version"]:
                return "arm64"
            return fake(args, capture)
        with self.assertRaisesRegex(release.ReleaseError, "architecture"):
            self.deploy(run)
        self.assertFalse(any("stop" in args for args in fake.calls))

    def test_persistent_guard_survives_process_restart(self):
        release.write_json(self.state / "attention.json", {"phase": "backup"})
        with self.assertRaisesRegex(release.ReleaseError, "operator review"):
            self.deploy()

    def test_failed_backup_and_failed_recovery_keep_guard(self):
        fake = FakeDocker(lambda args: "/app/backup" in args or "up" in args)
        with self.assertRaises(subprocess.CalledProcessError):
            self.deploy(fake)
        self.assertTrue((self.state / "attention.json").exists())
        self.assertIn("restoring old services", release.read_json(self.bundle / "status.json")["message"])

    def test_server_lock_excludes_a_second_process(self):
        try:
            import fcntl  # noqa: F401
        except ImportError:
            self.skipTest("Linux flock is exercised by the Linux CI job")
        with release.deployment_lock(self.state / "lock"):
            with self.assertRaisesRegex(release.ReleaseError, "lock"):
                with release.deployment_lock(self.state / "lock"):
                    pass

    def test_rollback_overlay_keeps_previous_release_assets(self):
        fake = FakeDocker()
        (self.bundle / "images.json").write_text("{}")
        override = self.bundle / "previous-images.json"
        worker = release.Deployer(self.root, self.bundle, run=fake)
        worker.compose(self.bundle, "up", override=override)
        args = fake.calls[-1]
        self.assertLess(args.index(str(self.bundle / "images.json")), args.index(str(override)))


class TransportTests(unittest.TestCase):
    def test_dispatch_binds_manifest_to_source_ci_not_cd_defaults(self):
        env = {"VPS_HOST": "example.test", "VPS_USER": "deploy", "VPS_PORT": "", "VPS_DEPLOY_PATH": "/srv/blog",
               "DEPLOY_SHA": SHA, "DEPLOY_SEQUENCE": "123", "GITHUB_RUN_ID": "900", "GITHUB_RUN_ATTEMPT": "2",
               "GITHUB_SHA": "f" * 40, "GITHUB_RUN_NUMBER": "1",
               "VPS_SSH_PRIVATE_KEY": "test", "VPS_KNOWN_HOSTS": "test"}
        uploaded = []
        def transport(args):
            if args[0] == "scp":
                self.assertEqual(args[args.index("-P") + 1], "22")
                with tarfile.open(args[-2]) as archive:
                    uploaded.append(json.load(archive.extractfile("release.json")))
                self.assertTrue(args[-1].endswith("/releases/900-2/release.tar.gz"))
            return '{"state":"success","phase":"complete","message":"Release is healthy"}'
        previous_directory = Path.cwd()
        with tempfile.TemporaryDirectory() as directory:
            try:
                os.chdir(directory)
                Path("reviewed-release").mkdir()
                payload = json.dumps({**MANIFEST, "sequence": 123}).encode("utf-8")
                Path("reviewed-release/release.json").write_bytes(payload)
                env["RELEASE_MANIFEST_SHA256"] = hashlib.sha256(payload).hexdigest()
                for name in ("compose.yaml", "deploy/Caddyfile", "deploy/postgres/initialize-search.sql", "deploy/release.py"):
                    path = Path(name)
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text("test fixture")
                with patch.dict(os.environ, env, clear=True), patch.dict(sys.modules, {"release": release}), patch.object(dispatch, "transport", side_effect=transport):
                    self.assertEqual(dispatch.main(), 0)
            finally:
                os.chdir(previous_directory)
        self.assertEqual(uploaded, [{"sha": SHA, "sequence": 123, "images": MANIFEST["images"]}])

    def test_rejects_shell_injection_and_missing_secrets(self):
        env = {"VPS_HOST": "example.test", "VPS_USER": "deploy", "VPS_PORT": "22", "VPS_DEPLOY_PATH": "/srv/blog",
               "DEPLOY_SHA": SHA, "DEPLOY_SEQUENCE": "1", "GITHUB_RUN_ID": "2", "GITHUB_RUN_ATTEMPT": "1",
               "VPS_SSH_PRIVATE_KEY": "test", "VPS_KNOWN_HOSTS": "test"}
        self.assertEqual(dispatch.validate_settings(env), "/srv/blog")
        for key, value in (("VPS_HOST", "host;id"), ("VPS_DEPLOY_PATH", "/srv/../etc"),
                           ("VPS_DEPLOY_PATH", "/srv/$(id)"), ("VPS_PORT", "65536"), ("VPS_KNOWN_HOSTS", ""),
                           ("DEPLOY_SHA", ""), ("DEPLOY_SEQUENCE", "0"), ("DEPLOY_SEQUENCE", "")):
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                dispatch.validate_settings({**env, key: value})


if __name__ == "__main__":
    unittest.main()
