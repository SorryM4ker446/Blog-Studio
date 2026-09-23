"""Image retention is scoped to recorded releases and never forces deletion."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from test_release import release


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / "deploy/.deployment"
        self.inventory = []
        self.containers = {}
        self.calls = []
        self.fail_remove = False
        self.bundles = {}
        self.images = {}
        for number in range(1, 6):
            self.add_release(number)
        release.write_json(self.state / "current.json", {
            "sha": "5" * 40, "sequence": 5, "path": str(self.bundles[5])})
        self.worker = release.Deployer(self.root, self.bundles[5], run=self.run_docker)

    def add_release(self, number, status="success", sha=None):
        bundle = self.state / "releases" / str(number)
        bundle.mkdir(parents=True)
        images = {}
        for index, service in enumerate(("frontend", "backend", "maintenance")):
            digest = f"{number * 10 + index:064x}"
            image_id = "sha256:" + f"{number * 100 + index:064x}"
            ref = "ghcr.io/example/blog@sha256:" + digest
            images[service] = ref
            self.inventory.append({"ID": image_id, "Repository": "ghcr.io/example/blog",
                                   "Digest": "sha256:" + digest, "Tag": "<none>"})
        release.write_json(bundle / "release.json", {"sha": sha or str(number) * 40,
                           "sequence": number, "images": images})
        if status is not None:
            release.write_json(bundle / "status.json", {"state": status})
        self.bundles[number], self.images[number] = bundle, images

    def run_docker(self, args, capture=False):
        self.calls.append(args)
        if args[:3] == ["docker", "image", "ls"]:
            return "\n".join(json.dumps(row) for row in self.inventory)
        if args[:3] == ["docker", "container", "ls"]:
            return "\n".join(self.containers)
        if args[:3] == ["docker", "container", "inspect"]:
            return self.containers[args[-1]]
        if args[:3] == ["docker", "image", "rm"]:
            if self.fail_remove:
                raise subprocess.CalledProcessError(1, args)
            self.inventory = [row for row in self.inventory
                              if row["Repository"] + "@" + row["Digest"] != args[-1]]
            return ""
        self.fail("Unexpected Docker command: " + repr(args))

    def removals(self):
        return {args[-1] for args in self.calls if args[:3] == ["docker", "image", "rm"]}

    def test_keeps_three_successful_versions_and_cleanup_is_idempotent(self):
        self.assertEqual(self.worker.retain_images(), {"removed": 6, "protected": 0, "failed": 0})
        self.assertEqual(self.removals(), set(self.images[1].values()) | set(self.images[2].values()))
        self.assertEqual(len(self.inventory), 9)
        self.assertEqual(self.worker.retain_images()["removed"], 0)
        self.assertFalse(any("--force" in args or "prune" in args for args in self.calls))

    def test_retry_does_not_consume_a_version_slot(self):
        self.add_release(6, sha="5" * 40)
        self.worker.retain_images()
        self.assertTrue(self.removals().isdisjoint(self.images[3].values()))
        self.assertTrue(self.removals().isdisjoint(self.images[6].values()))

    def test_fewer_than_three_versions_do_not_remove_images(self):
        for number in (1, 2, 3):
            (self.bundles[number] / "status.json").unlink()
        self.assertEqual(self.worker.retain_images()["removed"], 0)
        self.assertEqual(self.calls, [])

    def test_failed_running_and_incomplete_releases_protect_images_and_rollback(self):
        rollback_id = self.inventory[5]["ID"]
        for state in ("failed", "running", None):
            with self.subTest(state=state):
                status = self.bundles[1] / "status.json"
                if state is None:
                    status.unlink(missing_ok=True)
                else:
                    release.write_json(status, {"state": state})
                release.write_json(self.bundles[1] / "previous-images.json", {
                    "services": {"maintenance": {"image": rollback_id}}})
                self.calls.clear()
                self.worker.retain_images()
                self.assertTrue(self.removals().isdisjoint(self.images[1].values()))
                self.assertNotIn(self.images[2]["maintenance"], self.removals())

    def test_current_pointer_protects_release_before_success_status_is_written(self):
        release.write_json(self.bundles[5] / "status.json", {"state": "running"})
        self.worker.retain_images()
        self.assertTrue(self.removals().isdisjoint(self.images[3].values()))
        self.assertTrue(self.removals().isdisjoint(self.images[5].values()))

    def test_containers_tags_shared_image_ids_and_unrelated_images_are_preserved(self):
        self.containers["stopped-container"] = self.inventory[0]["ID"]
        self.inventory[1]["Tag"] = "manual-backup"
        # Different digests can resolve to the same local image ID.
        self.inventory[2]["ID"] = self.inventory[-1]["ID"]
        self.inventory.append({"ID": "sha256:" + "f" * 64, "Repository": "example/other",
                               "Digest": "sha256:" + "e" * 64, "Tag": "<none>"})
        result = self.worker.retain_images()
        self.assertEqual(result, {"removed": 3, "protected": 3, "failed": 0})
        self.assertEqual(self.removals(), set(self.images[2].values()))
        self.assertTrue(any(row["Repository"] == "example/other" for row in self.inventory))

    def test_guard_or_corrupt_metadata_prevents_all_deletions(self):
        release.write_json(self.state / "attention.json", {"phase": "migrate"})
        with self.assertRaises(release.ReleaseError):
            self.worker.retain_images()
        (self.state / "attention.json").unlink()
        (self.bundles[1] / "release.json").write_text("invalid")
        with self.assertRaises(ValueError):
            self.worker.retain_images()
        self.assertEqual(self.calls, [])

    def test_cleanup_failure_reports_warning_without_failing_healthy_release(self):
        self.fail_remove = True
        self.worker.complete("Release is healthy")
        status = release.read_json(self.bundles[5] / "status.json")
        self.assertEqual(status["state"], "success")
        self.assertIn("old images remain", status["message"])
        self.assertEqual(release.read_json(self.bundles[5] / "cleanup.json")["failed"], 6)
        self.assertEqual(release.read_json(self.state / "current.json")["sequence"], 5)

    def test_inventory_failure_does_not_start_deletions(self):
        self.inventory[0]["ID"] = "malformed"
        self.worker.complete("Release is healthy")
        self.assertEqual(self.removals(), set())
        self.assertIn("operator review", release.read_json(self.bundles[5] / "status.json")["message"])


if __name__ == "__main__":
    unittest.main()
