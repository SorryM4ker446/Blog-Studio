"""Validate release overlays with the real Compose parser, without a daemon."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


@unittest.skipUnless(shutil.which("docker"), "Docker Compose CLI not installed")
class ComposeTests(unittest.TestCase):
    def test_release_preserves_named_volumes_and_pins_all_app_consumers(self):
        repository = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "deploy/secrets").mkdir(parents=True)
            for name in ("postgres_password", "jwt_secret", "admin_password"):
                (root / "deploy/secrets" / name).write_text("disposable-test-value")
            (root / "deploy/.env").write_text("SITE_ADDRESS=example.test\nSITE_ORIGIN=https://example.test\n")
            shutil.copy(repository / "compose.yaml", root / "compose.yaml")
            bundle = root / "deploy/.deployment/releases/test"
            bundle.mkdir(parents=True)
            shutil.copy(repository / "compose.yaml", bundle / "compose.yaml")
            app = "ghcr.io/example/blog-backend@sha256:" + "a" * 64
            services = {name: {"image": app} for name in ("backend", "migrate", "seed", "maintenance")}
            services["caddy"] = {"volumes": [{"type": "bind", "source": str(bundle / "deploy/Caddyfile"), "target": "/etc/caddy/Caddyfile", "read_only": True}]}
            (bundle / "images.json").write_text(json.dumps({"services": services}))
            def config(source, overlay=False):
                args = ["docker", "compose", "--project-directory", str(root), "--env-file", str(root / "deploy/.env"), "-f", str(source / "compose.yaml")]
                if overlay:
                    args += ["-f", str(bundle / "images.json")]
                result = subprocess.run([*args, "--profile", "tools", "config", "--format", "json"],
                                        text=True, capture_output=True, check=True, env=os.environ.copy())
                return json.loads(result.stdout)
            old, new = config(root), config(bundle, True)
            self.assertEqual(old["name"], new["name"])
            self.assertEqual(old["volumes"], new["volumes"])
            for name in ("backend", "migrate", "seed", "maintenance"):
                self.assertEqual(new["services"][name]["image"], app)
            for name in ("backend", "postgres"):
                self.assertEqual(old["services"][name]["volumes"], new["services"][name]["volumes"])
            caddy = new["services"]["caddy"]["volumes"]
            self.assertEqual(len([v for v in caddy if v["type"] == "volume"]), 2)
            self.assertEqual(Path(next(v["source"] for v in caddy if v["target"] == "/etc/caddy/Caddyfile")), bundle / "deploy/Caddyfile")


if __name__ == "__main__":
    unittest.main()
