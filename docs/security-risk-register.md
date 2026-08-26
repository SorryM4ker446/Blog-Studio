# Security Risk Register

## Mitigated controls

- Markdown rendering does not permit raw HTML in public posts or editor previews.
- Administrator mutations require an authenticated administrator role and a matching CSRF token.
- The JWT is stored only in an HttpOnly Cookie; it is never returned to frontend JavaScript or written to local storage.
- Public post, category, file, settings, and search handlers do not use session identity. Programmatic browser reads omit credentials, while authenticated and mutation responses remain non-cacheable.
- Login attempts and anonymous public searches have process-local rate limits based on the client address resolved through explicitly trusted proxies.
- Operational metrics use bounded route-template labels and do not expose raw URLs, query strings, client addresses, request IDs, Cookies, or credentials.

## Accepted risks

### Single-instance throttling

- Current state: login and public-search limiters are held in one backend process.
- Impact: restarting the process clears buckets, and multiple replicas would enforce independent limits.
- Rationale: the supported deployment uses one backend instance and a small number of administrators. Shared state would add operational complexity without current evidence of need.
- Revisit when: multiple API replicas are introduced or monitoring shows sustained abusive traffic that the current boundary cannot control.

### Private-network metrics

- Current state: `/internal/metrics` has no application credential and relies on the backend listener remaining private. Caddy does not proxy it and Compose does not publish the backend port.
- Impact: exposing the backend port through a firewall, proxy, or host mapping would also expose runtime metrics.
- Rationale: private network reachability is the normal Prometheus trust boundary and the metrics contain no per-user labels.
- Revisit when: monitoring must scrape across an untrusted network; use a private tunnel, authenticated collector, or protected metrics proxy.

### Local upload storage and content scanning

- Current state: uploads use validated local storage and a strict type allowlist, but no antivirus or content-scanning service.
- Impact: type validation cannot prove that every otherwise valid file is benign.
- Rationale: uploads are restricted to administrators in the current operating model.
- Revisit when: uploads are opened to untrusted accounts or served to a wider audience.

## Validation checklist

- Confirm public API reads hide drafts and public browser `fetch` calls use `credentials: omit`.
- Confirm administrator, authentication, error, health, and metrics responses use `Cache-Control: no-store`.
- Confirm public file validators return `304` for unchanged content without exposing storage keys.
- Confirm public search returns `429`, `Retry-After`, and `search_rate_limited` after its burst is exhausted.
- Confirm Caddy does not route `/internal/metrics` and metric output contains route templates rather than query values.
