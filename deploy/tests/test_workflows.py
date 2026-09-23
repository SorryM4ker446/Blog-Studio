"""Exercise the CD trust gate against representative workflow_run events."""
import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
CD = (ROOT / ".github/workflows/cd.yml").read_text()
CI = (ROOT / ".github/workflows/ci.yml").read_text()


class WorkflowTests(unittest.TestCase):
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
        expression = re.search(r"    if: >-\n((?:      .+\n)+)", CD).group(1)
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

    def test_cd_uses_source_ci_identity_and_artifacts_without_rebuilding(self):
        for binding in (
            "ref: ${{ github.event.workflow_run.head_sha }}",
            "run-id: ${{ github.event.workflow_run.id }}",
            "DEPLOY_SHA: ${{ github.event.workflow_run.head_sha }}",
            "DEPLOY_SEQUENCE: ${{ github.event.workflow_run.run_number }}",
            "environment: production", "cancel-in-progress: false",
        ):
            self.assertIn(binding, CD)
        self.assertNotIn("build-push-action", CD)
        self.assertNotIn("deploy/dispatch.py", CI)
        self.assertNotIn("VPS_SSH_PRIVATE_KEY", CI)
        self.assertIn("needs: [frontend, backend, e2e, containers, deployment-tests]", CI)

    def test_summary_precedes_environment_approval_and_deployment_uses_reviewed_artifact(self):
        preparation, deployment = CD.split("  deploy-production:", 1)
        self.assertIn("  prepare-release:", preparation)
        self.assertNotIn("environment: production", preparation)
        self.assertNotIn("VPS_", preparation.replace("ENABLE_VPS_DEPLOY", "ENABLE_DEPLOY"))
        self.assertIn("pull-requests: read", preparation)
        self.assertIn("deploy/prepare_release.py", preparation)
        self.assertIn("if-no-files-found: error", preparation)
        self.assertIn("path: |\n            reviewed-release/release.json\n            reviewed-release/summary.md", preparation)
        self.assertNotIn("path: reviewed-release/", preparation)
        self.assertIn("needs: prepare-release", deployment)
        self.assertIn("environment: production", deployment)
        self.assertIn("name: ${{ needs.prepare-release.outputs.artifact_name }}", deployment)
        self.assertIn("RELEASE_MANIFEST_SHA256: ${{ needs.prepare-release.outputs.manifest_sha256 }}", deployment)
        self.assertNotIn("image-metadata", deployment)
        self.assertNotIn("always()", deployment)


if __name__ == "__main__":
    unittest.main()
