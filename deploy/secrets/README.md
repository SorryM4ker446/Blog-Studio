# Deployment secrets

Create these files on the deployment host before starting Compose:

- `postgres_password`: a unique password for the application database role.
- `jwt_secret`: at least 32 random bytes used only to sign application sessions.
- `admin_password`: a strong 12–128 character password used only by the one-time seed command.

The files in this directory are ignored except for this README. Do not copy them into an image or commit their contents. The backend and maintenance containers run as UID/GID `10001`, so the files must be readable by that numeric group while remaining inaccessible to other host users.

One Linux example is:

```bash
umask 077
openssl rand -base64 32 > deploy/secrets/postgres_password
openssl rand -base64 48 > deploy/secrets/jwt_secret
openssl rand -base64 24 > deploy/secrets/admin_password
chown root:10001 deploy/secrets/postgres_password deploy/secrets/jwt_secret deploy/secrets/admin_password
chmod 640 deploy/secrets/postgres_password deploy/secrets/jwt_secret deploy/secrets/admin_password
```

Do not leave these files at mode `600`: Compose mounts file-backed secrets with the host file permissions, and the non-root migration, API, seed, and maintenance processes cannot read a root-only file. Keep the containing directory at mode `700`; root owns the files and group `10001` provides the required read access. Verify without printing secret contents:

```bash
stat -c '%U:%G %a %n' deploy/secrets/*
```

The three generated files should be owned by `root:10001` with mode `640`. If the host uses a different deployment user, that user must use `sudo` for the `chown` command; do not grant world-readable mode `644` as a workaround.

Changing `jwt_secret` immediately invalidates existing login sessions. Changing `postgres_password` after the database has been initialized also requires an explicit PostgreSQL role-password rotation; editing the file alone does not update the database role.
