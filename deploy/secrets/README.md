# Deployment secrets

Create these files on the deployment host before starting Compose:

- `postgres_password`: a unique password for the application database role.
- `jwt_secret`: at least 32 random bytes used only to sign application sessions.
- `admin_password`: a strong 12–128 character password used only by the one-time seed command.

The files in this directory are ignored except for this README. Keep them readable only by the deployment account, do not copy them into an image, and do not commit their contents.

One Linux example is:

```bash
umask 077
openssl rand -base64 32 > deploy/secrets/postgres_password
openssl rand -base64 48 > deploy/secrets/jwt_secret
openssl rand -base64 24 > deploy/secrets/admin_password
```

Changing `jwt_secret` immediately invalidates existing login sessions. Changing `postgres_password` after the database has been initialized also requires an explicit PostgreSQL role-password rotation; editing the file alone does not update the database role.
