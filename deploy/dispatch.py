#!/usr/bin/env python3
"""GitHub runner SSH transport; deployment itself survives runner disconnection."""
import json
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
        "GITHUB_SHA": r"[0-9a-f]{40}",
        "GITHUB_RUN_NUMBER": r"[0-9]+",
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


def main():
    env = os.environ
    root = validate_settings(env)
    release = f"{root}/deploy/.deployment/releases/{env['GITHUB_RUN_ID']}-{env['GITHUB_RUN_ATTEMPT']}"
    images = {}
    for service in ("frontend", "backend", "maintenance"):
        images[service] = json.loads(Path(f"image-metadata/{service}.json").read_text())["image"]
    manifest = {"sha": env["GITHUB_SHA"], "sequence": int(env["GITHUB_RUN_NUMBER"]), "images": images}
    # Import shares validation with the server without running deployment code.
    from release import validate_manifest
    validate_manifest(manifest)
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
            return subprocess.check_output(["ssh", *options, "-p", env["VPS_PORT"], target, code], text=True).strip()

        ssh("umask 077; mkdir -p " + shlex.quote(root + "/deploy/.deployment/releases") + "; mkdir " + shlex.quote(release))
        manifest_path = directory / "release.json"
        manifest_path.write_text(json.dumps(manifest))
        bundle = directory / "release.tar.gz"
        with tarfile.open(bundle, "w:gz") as archive:
            for name in ("compose.yaml", "deploy/Caddyfile", "deploy/postgres/initialize-search.sql", "deploy/release.py"):
                archive.add(name, arcname=name)
            archive.add(manifest_path, arcname="release.json")
        subprocess.run(["scp", *options, "-P", env["VPS_PORT"], str(bundle), target + ":" + release + "/release.tar.gz"], check=True)
        launcher = (
            "import subprocess; "
            f"log=open({release + '/deploy.log'!r},'a'); "
            f"subprocess.Popen(['python3',{release + '/deploy/release.py'!r},'run',{root!r},{release!r}], "
            "stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)"
        )
        ssh("umask 077; tar -xzf " + shlex.quote(release + "/release.tar.gz") + " -C " + shlex.quote(release)
            + " && python3 -c " + shlex.quote(launcher))
        print("Server deployment started. Logs: " + release + "/deploy.log", flush=True)
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
