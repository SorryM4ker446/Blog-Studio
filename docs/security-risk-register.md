# Security Risk Register

## Mitigated In This Pass

- Markdown rendering no longer permits raw HTML in post pages or editor previews.
- Admin-only mutation routes now require an authenticated admin role.
- Public read endpoints consistently treat draft visibility as an admin-only capability.

## Accepted Risk

### Session Token Storage

- Current state: the frontend still stores the JWT session token in `localStorage` under `blog_token`.
- Why this matters: any future client-side XSS would still be able to exfiltrate the token and replay authenticated requests until expiry.
- Why it is deferred: the current pass prioritizes eliminating the active stored-XSS path first and avoids a larger authentication migration mid-stream.

## Recommended Follow-Up

1. Move session handling to HttpOnly cookies.
2. Add CSRF protection for state-changing requests if cookie auth is adopted.
3. Define token rotation and logout invalidation behavior.

## Validation Checklist

- Confirm raw HTML is escaped in post rendering.
- Confirm admin routes reject non-admin tokens with `403`.
- Confirm public post/category/search handlers still hide drafts for non-admin requests.
