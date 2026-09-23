#!/usr/bin/env python3
"""Prepare a public, reviewable release manifest without production access."""
import hashlib
import html
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request

from release import validate_manifest

SERVICES = ("frontend", "backend", "maintenance")


def prepare_manifest(directory, run, repository):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("Invalid repository")
    expected = {service + ".json" for service in SERVICES}
    if {path.name for path in directory.iterdir()} != expected:
        raise ValueError("Expected exactly three service image metadata files")
    images = {}
    for service in SERVICES:
        metadata = json.loads((directory / (service + ".json")).read_text(encoding="utf-8"))
        image = metadata.get("image")
        if not isinstance(image, str) or not image.startswith(f"ghcr.io/{repository.lower()}@sha256:"):
            raise ValueError("Image does not belong to the release package")
        images[service] = image
    manifest = {"sha": run["head_sha"], "sequence": run["run_number"], "images": images}
    validate_manifest(manifest)
    if type(manifest["sequence"]) is not int:
        raise ValueError("Invalid CI sequence")
    return manifest


def registered_migrations(source):
    block = re.search(r"var registered = \[\]migration\{(.*?)\n\}", source, re.S)
    if not block:
        raise ValueError("Cannot locate migration registry")
    entries = re.findall(r'version:\s*(\d+),\s*name:\s*"([a-z0-9_]+)"', block[1])
    if not entries or len(entries) != len(re.findall(r"\bversion\s*:", block[1])):
        raise ValueError("Cannot read complete migration registry")
    versions = [int(version) for version, _ in entries]
    if versions != sorted(set(versions)):
        raise ValueError("Migration versions must be unique and ordered")
    return entries


def associated_prs(repository, sha, token):
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repository}/commits/{sha}/pulls?per_page=100",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            data = json.load(response)
        if not isinstance(data, list) or any(type(item.get("number")) is not int or item["number"] < 1 for item in data):
            raise ValueError("Invalid PR response")
        return [item["number"] for item in data], None
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError, TypeError, AttributeError):
        # PR discovery is informational. Never print authenticated request diagnostics.
        return [], "PR lookup unavailable; inspect the commit link before approval."


def render_summary(manifest, run, repository, migrations, prs, warning, digest):
    base = f"https://github.com/{repository}"
    sha = manifest["sha"]
    run_id = run["id"]
    if type(run_id) is not int or run_id < 1:
        raise ValueError("Invalid source CI run ID")
    branch = html.escape(str(run["head_branch"]), quote=True).replace("\n", " ")
    lines = ["# Release awaiting production approval", "",
             f"- Commit: [{sha}]({base}/commit/{sha})",
             f"- Branch: <code>{branch}</code>",
             f"- Source CI: [CI #{manifest['sequence']}]({base}/actions/runs/{run_id}) — success",
             "- Associated PRs (up to 100): " + (", ".join(f"[#{number}]({base}/pull/{number})" for number in prs) if prs else warning or "None found for this commit; a direct push/manual run can be valid."),
             "", "## Exact images to deploy", "", "| Service | Immutable image reference |", "| --- | --- |"]
    lines += [f"| {service} | `{manifest['images'][service]}` |" for service in SERVICES]
    lines += ["", f"Release manifest SHA-256: `{digest}`", "",
              "Approval deploys this manifest, not the latest branch head or mutable image tags.", "",
              "## Database migration notice", "",
              "The following migrations are registered in this release. This is NOT a list of pending production migrations.",
              "Production schema state and backup availability have not been inspected by this job.", ""]
    lines += [f"- `{version}` — `{name}`" for version, name in migrations]
    lines += ["", "The deployment job creates and verifies a backup before running pending migrations. A backup failure blocks migration.",
              "After migrations begin, an older image alone is not a safe rollback; follow the database recovery procedure.",
              f"[Deployment and recovery documentation]({base}/blob/{sha}/docs/automatic-deployment.md)", "",
              "Review the commit/PR, source CI results and migration implications before selecting **Approve and deploy**.", ""]
    return "\n".join(lines)


def main():
    env = os.environ
    run = json.loads(Path(env["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))["workflow_run"]
    repository = env["GITHUB_REPOSITORY"]
    manifest = prepare_manifest(Path("image-metadata"), run, repository)
    migrations = registered_migrations(Path("backend/internal/migrations/migrations.go").read_text(encoding="utf-8"))
    payload = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()
    prs, warning = associated_prs(repository, manifest["sha"], env["GH_TOKEN"])
    summary = render_summary(manifest, run, repository, migrations, prs, warning, digest)
    artifact = env["RELEASE_ARTIFACT"]
    if not re.fullmatch(r"reviewed-release-[0-9]+-[0-9]+", artifact):
        raise ValueError("Invalid release artifact name")
    Path("reviewed-release").mkdir(exist_ok=True)
    Path("reviewed-release/release.json").write_bytes(payload)
    Path("reviewed-release/summary.md").write_text(summary, encoding="utf-8")
    with Path(env["GITHUB_STEP_SUMMARY"]).open("a", encoding="utf-8") as stream:
        stream.write(summary)
    with Path(env["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as stream:
        stream.write(f"manifest_sha256={digest}\nartifact_name={artifact}\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Release summary preparation failed; check source artifacts and migration registry. Deployment is blocked.", file=sys.stderr)
        sys.exit(1)
