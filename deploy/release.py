#!/usr/bin/env python3
"""Deploy a verified image bundle to an existing Linux Compose installation."""
import contextlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time


class ReleaseError(RuntimeError):
    pass


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, data):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(data, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def command(args, capture=False):
    # Never print the resolved Compose environment: it may contain secrets.
    timeout = 2100 if "/app/backup" in args else 1800
    result = subprocess.run(args, check=True, text=True, timeout=timeout,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout.strip() if capture else ""


def validate_manifest(data):
    if not re.fullmatch(r"[0-9a-f]{40}", data.get("sha", "")):
        raise ReleaseError("Invalid release SHA")
    if not isinstance(data.get("sequence"), int) or data["sequence"] < 1:
        raise ReleaseError("Invalid CI sequence")
    for service in ("frontend", "backend", "maintenance"):
        if not re.fullmatch(r"ghcr\.io/[a-z0-9_./-]+@sha256:[0-9a-f]{64}", data.get("images", {}).get(service, "")):
            raise ReleaseError("Release must contain three digest-pinned GHCR images")
    return data


@contextlib.contextmanager
def deployment_lock(path):
    import fcntl
    with Path(path).open("a") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ReleaseError("Another deployment holds the server lock") from error
        yield


class Deployer:
    def __init__(self, root, release, run=command):
        self.root = Path(root).resolve()
        self.release = Path(release).resolve()
        self.state = self.root / "deploy/.deployment"
        self.run = run
        self.phase = "preflight"
        self.stopped = False
        self.migration_started = False
        self.previous = None

    def compose(self, source, *args, override=None, capture=False):
        source = Path(source)
        files = ["-f", str(source / "compose.yaml")]
        chosen = source / "images.json"
        if chosen.exists():
            files += ["-f", str(chosen)]
        if override:
            files += ["-f", str(override)]
        profiles = ["--profile", "tools"] if args and args[0] == "config" else []
        return self.run(["docker", "compose", "--project-directory", str(self.root),
                         "--env-file", str(self.root / "deploy/.env"), *files, *profiles, *args], capture=capture)

    def status(self, state, message=""):
        write_json(self.release / "status.json", {
            "state": state, "phase": self.phase, "message": message,
            "updated_at": int(time.time()),
        })

    def health(self, config):
        origin = config["services"]["backend"]["environment"]["ALLOWED_ORIGINS"].rstrip("/")
        if not origin.startswith("https://") or "," in origin:
            raise ReleaseError("Production SITE_ORIGIN must be a single HTTPS origin")
        for path in ("/health/ready", "/api/settings", "/api/links"):
            self.run(["curl", "--fail", "--silent", "--show-error", "--max-time", "30", origin + path], capture=True)

    def execute(self):
        self.state.mkdir(parents=True, exist_ok=True, mode=0o700)
        with deployment_lock(self.state / "lock"):
            self._execute_locked()

    def _execute_locked(self):
        try:
            self.status("running")
            manifest = validate_manifest(read_json(self.release / "release.json"))
            if not self.release.is_relative_to(self.state / "releases"):
                raise ReleaseError("Release must be inside the deployment releases directory")
            if (self.state / "attention.json").exists():
                raise ReleaseError("An interrupted or failed deployment requires operator review")
            if not (self.root / "deploy/.env").is_file():
                raise ReleaseError("Existing deployment configuration is required")
            current_path = self.state / "current.json"
            current = read_json(current_path) if current_path.exists() else None
            if current and manifest["sequence"] < current["sequence"]:
                raise ReleaseError("Refusing an older CI run after a newer release")
            if current and manifest["sha"] == current["sha"]:
                config = json.loads(self.compose(Path(current["path"]), "config", "--format", "json", capture=True))
                self.health(config)
                current["sequence"] = manifest["sequence"]
                write_json(current_path, current)
                self.status("success", "This commit is already deployed")
                return
            if current and manifest["sequence"] == current["sequence"]:
                raise ReleaseError("A CI sequence cannot identify two different commits")
            self.previous = Path(current["path"]) if current else self.root
            config = json.loads(self.compose(self.previous, "config", "--format", "json", capture=True))
            origin = config["services"]["backend"]["environment"]["ALLOWED_ORIGINS"].rstrip("/")
            if not origin.startswith("https://") or "," in origin:
                raise ReleaseError("Production SITE_ORIGIN must be a single HTTPS origin")
            # Capture the actual running images, not mutable local image tags.
            images = {}
            for service in ("backend", "frontend", "postgres", "caddy"):
                container = self.compose(self.previous, "ps", "--quiet", service, capture=True)
                if not container or "\n" in container:
                    raise ReleaseError("Expected one running container for " + service)
                images[service] = self.run(["docker", "inspect", "--format", "{{.Image}}", container], capture=True)
            maintenance = config["services"]["maintenance"]["image"]
            images["maintenance"] = self.run(["docker", "image", "inspect", "--format", "{{.Id}}", maintenance], capture=True)
            images["migrate"] = images["seed"] = images["backend"]
            self.rollback = self.release / "previous-images.json"
            write_json(self.rollback, {"services": {name: {"image": image} for name, image in images.items()}})
            write_json(self.release / "previous.json", {"path": str(self.previous), "current": current})
            new_images = dict(images)
            new_images.update(manifest["images"])
            new_images["migrate"] = new_images["seed"] = new_images["backend"]
            services = {name: {"image": image} for name, image in new_images.items()}
            # Keep runtime configuration/secrets at the root; version proxy/init assets.
            services["caddy"]["volumes"] = [str(self.release / "deploy/Caddyfile") + ":/etc/caddy/Caddyfile:ro"]
            services["postgres"]["volumes"] = [str(self.release / "deploy/postgres/initialize-search.sql") + ":/docker-entrypoint-initdb.d/10-search.sql:ro"]
            write_json(self.release / "images.json", {"services": services})
            self.compose(self.release, "config", "--quiet")
            updated = json.loads(self.compose(self.release, "config", "--format", "json", capture=True))
            if config["name"] != updated["name"] or config["volumes"] != updated["volumes"]:
                raise ReleaseError("Changing the Compose project or persistent volumes requires a manual upgrade")
            for service in ("postgres", "backend"):
                before = [v for v in config["services"][service].get("volumes", []) if v["type"] == "volume"]
                after = [v for v in updated["services"][service].get("volumes", []) if v["type"] == "volume"]
                if before != after:
                    raise ReleaseError("Changing database or upload mounts requires a manual upgrade")
            architecture = self.run(["docker", "version", "--format", "{{.Server.Arch}}"], capture=True)
            for image in manifest["images"].values():
                self.run(["docker", "pull", image])
                metadata = json.loads(self.run(["docker", "image", "inspect", "--format", "{{json .}}", image], capture=True))
                if metadata["Architecture"] != architecture or metadata["Config"]["Labels"].get("org.opencontainers.image.revision") != manifest["sha"]:
                    raise ReleaseError("Image architecture or revision does not match the intended release")
            self.phase = "backup"
            # Persistent guard survives SSH loss, process termination and host restart.
            write_json(self.state / "attention.json", {"release": str(self.release), "phase": self.phase})
            self.status("running")
            self.stopped = True
            self.compose(self.previous, "stop", "caddy", "frontend", "backend", override=self.rollback)
            # create includes archive verification and refuses inconsistent storage.
            self.compose(self.previous, "run", "--rm", "--no-deps", "--pull", "never", "maintenance",
                         "/app/backup", "create", "/backups", override=self.rollback)
            self.phase = "migrate"
            self.migration_started = True
            write_json(self.state / "attention.json", {"release": str(self.release), "phase": self.phase})
            self.status("running")
            self.compose(self.release, "run", "--rm", "--no-deps", "--pull", "never", "migrate")
            self.phase = "start"
            self.status("running")
            self.compose(self.release, "up", "--detach", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "240",
                         "postgres", "migrate", "backend", "frontend", "caddy")
            self.phase = "health"
            self.status("running")
            self.health(updated)
            write_json(current_path, {"sha": manifest["sha"], "sequence": manifest["sequence"], "path": str(self.release)})
            (self.state / "attention.json").unlink()
            self.phase = "complete"
            self.status("success", "Release is healthy")
        except Exception:
            # Never roll back an image across a possibly changed migration history.
            if self.stopped and not self.migration_started:
                try:
                    self.compose(self.previous, "up", "--detach", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "240",
                                 "postgres", "migrate", "backend", "frontend", "caddy", override=self.rollback)
                    (self.state / "attention.json").unlink()
                except Exception:
                    self.status("failed", "Backup failed; restoring old services also failed. Operator review required.")
                    raise
            self.status("failed", "Deployment failed. Review the private server log and deployment guard before retrying.")
            raise


def main():
    os.umask(0o077)
    if len(sys.argv) < 3:
        raise ReleaseError("Usage: release.py run ROOT RELEASE | compose ROOT [arguments...]")
    mode, root = sys.argv[1:3]
    if mode == "run" and len(sys.argv) == 4:
        deployer = Deployer(root, sys.argv[3])
        try:
            deployer.execute()
        except Exception as error:
            # Errors and subprocess output are retained only in the private server log.
            if not (deployer.release / "status.json").exists():
                deployer.status("failed", "Deployment could not acquire the lock or initialize")
            print(str(error), file=sys.stderr)
            return 1
    elif mode == "compose":
        state = Path(root).resolve() / "deploy/.deployment/current.json"
        source = Path(read_json(state)["path"]) if state.exists() else Path(root).resolve()
        Deployer(root, source).compose(source, *sys.argv[3:])
    else:
        raise ReleaseError("Unknown release command")
    return 0


if __name__ == "__main__":
    sys.exit(main())
