#!/usr/bin/env python3
"""GitHub runner SSH transport; deployment itself survives runner disconnection."""
import json
import hashlib
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tarfile
import tempfile
import time


def validate_settings(env):
    patterns = {
        "VPS_HOST": r"[A-Za-z0-9][A-Za-z0-9.-]*",
        "VPS_USER": r"[a-z_][a-z0-9_-]*",
        "VPS_PORT": r"[0-9]{1,5}",
        "VPS_DEPLOY_PATH": r"/[A-Za-z0-9_./-]+",
        "DEPLOY_SHA": r"[0-9a-f]{40}",
        "DEPLOY_SEQUENCE": r"[1-9][0-9]*",
        "GITHUB_RUN_ID": r"[0-9]+",
        "GITHUB_RUN_ATTEMPT": r"[0-9]+",
    }
    for key, pattern in patterns.items():
        if not re.fullmatch(pattern, env.get(key, "")):
            raise ValueError("Missing or invalid " + key)
    if not 1 <= int(env["VPS_PORT"]) <= 65535:
        raise ValueError("Invalid SSH port")
    root = env["VPS_DEPLOY_PATH"].rstrip("/")
    if not root or ".." in Path(root).parts:
        raise ValueError("Use an absolute deployment path without parent traversal")
    for key in ("VPS_SSH_PRIVATE_KEY", "VPS_KNOWN_HOSTS"):
        if not env.get(key, "").strip():
            raise ValueError("Missing " + key)
    return root


def transport(args):
    # SSH diagnostics and command arguments can expose host/user/path information.
    # Never forward them to public Actions logs, including on subprocess failure.
    try:
        return subprocess.run(args, check=True, text=True, capture_output=True).stdout.strip()
    except (subprocess.CalledProcessError, OSError):
        raise RuntimeError("SSH transport failed; verify production secrets, connectivity and server state privately.") from None


def load_reviewed_manifest(path, expected_sha, expected_sequence, expected_digest):
    from release import validate_manifest
    payload = Path(path).read_bytes()
    if not re.fullmatch(r"[0-9a-f]{64}", expected_digest) or hashlib.sha256(payload).hexdigest() != expected_digest:
        raise ValueError("Reviewed release manifest checksum mismatch")
    manifest = validate_manifest(json.loads(payload))
    if manifest["sha"] != expected_sha or type(manifest["sequence"]) is not int or manifest["sequence"] != int(expected_sequence):
        raise ValueError("Reviewed release does not match the source CI run")
    return manifest


def main():
    env = dict(os.environ)
    env["VPS_PORT"] = env.get("VPS_PORT") or "22"
    root = validate_settings(env)
    release = f"{root}/deploy/.deployment/releases/{env['GITHUB_RUN_ID']}-{env['GITHUB_RUN_ATTEMPT']}"
    manifest = load_reviewed_manifest("reviewed-release/release.json", env["DEPLOY_SHA"],
                                      env["DEPLOY_SEQUENCE"], env["RELEASE_MANIFEST_SHA256"])
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        key = directory / "key"
        known = directory / "known_hosts"
        key.write_text(env["VPS_SSH_PRIVATE_KEY"].strip() + "\n")
        known.write_text(env["VPS_KNOWN_HOSTS"].strip() + "\n")
        key.chmod(0o600)
        known.chmod(0o600)
        options = ["-i", str(key), "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
                   "-o", "StrictHostKeyChecking=yes", "-o", f"UserKnownHostsFile={known}",
                   "-o", "ConnectTimeout=20", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3"]
        target = f"{env['VPS_USER']}@{env['VPS_HOST']}"

        def ssh(code):
            return transport(["ssh", *options, "-p", env["VPS_PORT"], target, code])

        ssh("umask 077; mkdir -p " + shlex.quote(root + "/deploy/.deployment/releases") + "; mkdir " + shlex.quote(release))
        manifest_path = directory / "release.json"
        manifest_path.write_text(json.dumps(manifest))
        bundle = directory / "release.tar.gz"
        with tarfile.open(bundle, "w:gz") as archive:
            for name in ("compose.yaml", "deploy/Caddyfile", "deploy/postgres/initialize-search.sql", "deploy/release.py"):
                archive.add(name, arcname=name)
            archive.add(manifest_path, arcname="release.json")
        transport(["scp", *options, "-P", env["VPS_PORT"], str(bundle), target + ":" + release + "/release.tar.gz"])
        launcher = (
            "import subprocess; "
            f"log=open({release + '/deploy.log'!r},'a'); "
            f"subprocess.Popen(['python3',{release + '/deploy/release.py'!r},'run',{root!r},{release!r}], "
            "stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)"
        )
        ssh("umask 077; tar -xzf " + shlex.quote(release + "/release.tar.gz") + " -C " + shlex.quote(release)
            + " && python3 -c " + shlex.quote(launcher))
        print("Server deployment started. Detailed logs remain in the private server release directory.", flush=True)
        deadline = time.monotonic() + 5400
        previous = None
        while time.monotonic() < deadline:
            reader = f"import pathlib; p=pathlib.Path({release + '/status.json'!r}); print(p.read_text() if p.exists() else '{{}}')"
            status = json.loads(ssh("python3 -c " + shlex.quote(reader)))
            if status.get("phase") != previous:
                previous = status.get("phase")
                print("Deployment phase: " + str(previous), flush=True)
            if status.get("state") in ("success", "failed"):
                print(status.get("message", ""), flush=True)
                return 0 if status["state"] == "success" else 1
            time.sleep(10)
        raise RuntimeError("Deployment polling timed out. The server job was NOT cancelled; inspect it before retrying.")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
