import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parents[1] / (name + ".py"))
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


release = module("release")
dispatch = module("dispatch")
SHA = "a" * 40
MANIFEST = {"sha": SHA, "sequence": 20, "images": {
    service: f"ghcr.io/example/blog-{service}@sha256:" + "b" * 64
    for service in ("frontend", "backend", "maintenance")}}


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

    def test_pull_failure_keeps_application_running(self):
        fake = FakeDocker(lambda args: args[:2] == ["docker", "pull"])
        with self.assertRaises(subprocess.CalledProcessError):
            self.deploy(fake)
        self.assertFalse(any("stop" in args for args in fake.calls))
        self.assertFalse((self.state / "attention.json").exists())

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
    def test_rejects_shell_injection_and_missing_secrets(self):
        env = {"VPS_HOST": "example.test", "VPS_USER": "deploy", "VPS_PORT": "22", "VPS_DEPLOY_PATH": "/srv/blog",
               "GITHUB_SHA": SHA, "GITHUB_RUN_NUMBER": "1", "GITHUB_RUN_ID": "2", "GITHUB_RUN_ATTEMPT": "1",
               "VPS_SSH_PRIVATE_KEY": "test", "VPS_KNOWN_HOSTS": "test"}
        self.assertEqual(dispatch.validate_settings(env), "/srv/blog")
        for key, value in (("VPS_HOST", "host;id"), ("VPS_DEPLOY_PATH", "/srv/../etc"),
                           ("VPS_DEPLOY_PATH", "/srv/$(id)"), ("VPS_PORT", "65536"), ("VPS_KNOWN_HOSTS", "")):
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                dispatch.validate_settings({**env, key: value})


if __name__ == "__main__":
    unittest.main()
