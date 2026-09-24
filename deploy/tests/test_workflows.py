"""Exercise the CD trust gate against representative workflow_run events."""
import json
from pathlib import Path
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[2]


def parse_workflow(source):
    # Keep GitHub's "on" key and expression scalars as strings, not YAML 1.1 booleans.
    return yaml.load(source, Loader=yaml.BaseLoader)


CD = parse_workflow((ROOT / ".github/workflows/cd.yml").read_text())
CI = parse_workflow((ROOT / ".github/workflows/ci.yml").read_text())


def action_steps(job, action):
    return [step for step in job["steps"] if step.get("uses", "").startswith(action + "@")]


class WorkflowTests(unittest.TestCase):
    def assert_go_caches(self, workflow):
        for job in workflow["jobs"].values():
            for step in action_steps(job, "actions/setup-go"):
                options = step.get("with", {})
                self.assertIn("go-version-file", options)
                self.assertIn("cache-dependency-path", options)
                module_path = ROOT / options["go-version-file"]
                cache_path = ROOT / options["cache-dependency-path"]
                self.assertTrue(module_path.is_file())
                self.assertTrue(cache_path.is_file())
                self.assertEqual(cache_path, module_path.with_name("go.sum"))

    def test_go_caches_use_existing_module_checksum_files(self):
        for workflow in (ROOT / ".github/workflows").glob("*.yml"):
            with self.subTest(workflow=workflow.name):
                self.assert_go_caches(parse_workflow(workflow.read_text()))

    def test_named_go_steps_cannot_hide_missing_cache_configuration(self):
        workflow = parse_workflow("""
jobs:
  backend:
    steps:
      - name: Set up Go
        uses: actions/setup-go@v6
        with:
          go-version-file: backend/go.mod
""")
        with self.assertRaises(AssertionError):
            self.assert_go_caches(workflow)
        workflow["jobs"]["backend"]["steps"][0]["with"]["cache-dependency-path"] = "backend/go.sum"
        self.assert_go_caches(workflow)

    def test_cd_trigger_filters_source_branches_before_the_deployment_gate(self):
        trigger = CD["on"]["workflow_run"]
        self.assertEqual(trigger["workflows"], ["CI"])
        self.assertEqual(trigger["types"], ["completed"])
        branches = set(trigger["branches"])
        self.assertEqual(branches, {"main", "master"})
        self.assertEqual(set(CI["on"]["push"]["branches"]), branches)
        for branch in ("codex", "feature/example"):
            self.assertNotIn(branch, branches)
        for branch in branches:
            for event in ("push", "workflow_dispatch"):
                with self.subTest(branch=branch, event=event):
                    self.assertTrue(self.allowed(**{
                        "vars.DEPLOY_BRANCH": branch,
                        "github.event.workflow_run.head_branch": branch,
                        "github.event.workflow_run.event": event,
                    }))
            # A matching source branch alone must not authorize a PR deployment.
            self.assertFalse(self.allowed(**{
                "vars.DEPLOY_BRANCH": branch,
                "github.event.workflow_run.head_branch": branch,
                "github.event.workflow_run.event": "pull_request",
            }))

    def allowed(self, **changes):
        values = {
            "vars.ENABLE_VPS_DEPLOY": "true",
            "vars.DEPLOY_BRANCH": "main",
            "github.repository": "example/blog",
            "github.event.workflow_run.conclusion": "success",
            "github.event.workflow_run.head_repository.full_name": "example/blog",
            "github.event.workflow_run.path": ".github/workflows/ci.yml",
            "github.event.workflow_run.event": "push",
            "github.event.workflow_run.head_branch": "main",
        }
        values.update(changes)
        expression = CD["jobs"]["prepare-release"]["if"]
        for name, value in sorted(values.items(), key=lambda item: len(item[0]), reverse=True):
            expression = expression.replace(name, json.dumps(value))
        expression = " ".join(expression.splitlines()).replace("&&", " and ").replace("||", " or ")
        return bool(eval(expression.strip(), {"__builtins__": {}}, {}))

    def test_only_successful_local_production_push_or_manual_ci_can_deploy(self):
        self.assertTrue(self.allowed())
        self.assertTrue(self.allowed(**{"github.event.workflow_run.event": "workflow_dispatch"}))
        self.assertTrue(self.allowed(**{"vars.DEPLOY_BRANCH": ""}))
        self.assertTrue(self.allowed(**{"vars.DEPLOY_BRANCH": "master", "github.event.workflow_run.head_branch": "master"}))
        denied = {
            "vars.ENABLE_VPS_DEPLOY": ["false", ""],
            "github.event.workflow_run.conclusion": ["failure", "cancelled", "skipped", ""],
            "github.event.workflow_run.event": ["pull_request", "pull_request_target", "schedule"],
            "github.event.workflow_run.head_repository.full_name": ["fork/blog", ""],
            "github.event.workflow_run.path": [".github/workflows/other.yml"],
            "github.event.workflow_run.head_branch": ["codex", "feature", "master"],
        }
        for field, values in denied.items():
            for value in values:
                with self.subTest(field=field, value=value):
                    self.assertFalse(self.allowed(**{field: value}))

    def assert_production_environment(self, workflow):
        self.assertEqual(workflow["jobs"]["deploy-production"].get("environment"), "production")

    def test_commented_environment_does_not_authorize_production(self):
        source = (ROOT / ".github/workflows/cd.yml").read_text()
        changed = source.replace("    environment: production", "    # environment: production")
        self.assertNotEqual(source, changed)
        with self.assertRaises(AssertionError):
            self.assert_production_environment(parse_workflow(changed))

    def test_cd_uses_source_ci_identity_and_artifacts_without_rebuilding(self):
        self.assert_production_environment(CD)
        deployment = CD["jobs"]["deploy-production"]
        self.assertEqual(deployment["concurrency"]["cancel-in-progress"], "false")
        for job in CD["jobs"].values():
            checkouts = action_steps(job, "actions/checkout")
            self.assertTrue(checkouts)
            for step in checkouts:
                self.assertEqual(step["with"]["ref"], "${{ github.event.workflow_run.head_sha }}")
            self.assertFalse(action_steps(job, "docker/build-push-action"))
        downloads = action_steps(CD["jobs"]["prepare-release"], "actions/download-artifact")
        self.assertEqual(len(downloads), 1)
        self.assertEqual(downloads[0]["with"]["run-id"], "${{ github.event.workflow_run.id }}")
        dispatch = [step for step in deployment["steps"] if step.get("run") == "python3 deploy/dispatch.py"]
        self.assertEqual(len(dispatch), 1)
        self.assertEqual(dispatch[0]["env"]["DEPLOY_SHA"], "${{ github.event.workflow_run.head_sha }}")
        self.assertEqual(dispatch[0]["env"]["DEPLOY_SEQUENCE"], "${{ github.event.workflow_run.run_number }}")
        self.assertNotIn("deploy/dispatch.py", json.dumps(CI))
        self.assertNotIn("VPS_SSH_PRIVATE_KEY", json.dumps(CI))
        self.assertEqual(set(CI["jobs"]["publish-images"]["needs"]),
                         {"frontend", "backend", "e2e", "containers", "deployment-tests"})

    def test_summary_precedes_environment_approval_and_deployment_uses_reviewed_artifact(self):
        preparation = CD["jobs"]["prepare-release"]
        deployment = CD["jobs"]["deploy-production"]
        self.assertNotIn("environment", preparation)
        self.assertNotIn("VPS_", json.dumps(preparation).replace("ENABLE_VPS_DEPLOY", "ENABLE_DEPLOY"))
        self.assertEqual(preparation["permissions"]["pull-requests"], "read")
        self.assertTrue(any(step.get("run") == "python3 deploy/prepare_release.py" for step in preparation["steps"]))
        uploads = action_steps(preparation, "actions/upload-artifact")
        self.assertEqual(len(uploads), 1)
        self.assertEqual(uploads[0]["with"]["if-no-files-found"], "error")
        self.assertEqual(uploads[0]["with"]["path"].splitlines(),
                         ["reviewed-release/release.json", "reviewed-release/summary.md"])
        self.assertEqual(deployment["needs"], "prepare-release")
        self.assert_production_environment(CD)
        downloads = action_steps(deployment, "actions/download-artifact")
        self.assertEqual(len(downloads), 1)
        self.assertEqual(downloads[0]["with"]["name"], "${{ needs.prepare-release.outputs.artifact_name }}")
        dispatch = next(step for step in deployment["steps"] if step.get("run") == "python3 deploy/dispatch.py")
        self.assertEqual(dispatch["env"]["RELEASE_MANIFEST_SHA256"], "${{ needs.prepare-release.outputs.manifest_sha256 }}")
        self.assertNotIn("image-metadata", json.dumps(deployment))
        self.assertNotIn("always()", json.dumps(deployment))


if __name__ == "__main__":
    unittest.main()
