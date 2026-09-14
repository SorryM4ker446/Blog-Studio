# Codex Collaboration Rules

These rules apply to all Codex work in this repository.

- Continue work on the `codex` branch by default. Do not create or switch to another branch unless the user explicitly approves it.
- Do not run `git commit`, `git push`, create or merge a pull request, or otherwise publish changes. The user performs all of these operations manually.
- After each requested change, run the relevant validation, summarize the changes and results, and stop for user acceptance before any repository history or remote operation.
- After completing a feature, review whether automated tests, deployment artifacts, CI workflows, configuration examples, or related operational documentation must change with it. When updates are needed, include them before the development task is considered complete and validate the synchronized result.
- Keep internal planning labels private to local planning material. Do not include them in source code, test names, code comments, public documentation, commit messages, or pull request descriptions. Describe observable behavior and actual functionality instead.
- Preserve unrelated user changes and never overwrite or discard them.
- Do not record real passwords, database connection strings, signing secrets, or other credentials in repository files, logs, or handoff notes.

## Project-wide engineering and acceptance principles

These principles apply to features, bug fixes, refactoring, performance work, dependencies, configuration, CI, deployment, migrations, and operational tooling.

Apply them **in proportion to the scope, risk, blast radius, reversibility, and shared impact of the change**. Do not investigate, redesign, or refactor unrelated systems without evidence that they are affected. A locally successful result is not sufficient evidence of a correct system change.

### 1. Understand the contract before changing the system

Before implementation, establish enough of the following to make the change safely:

* the intended outcome and acceptance criteria;
* the current behavior that must remain valid;
* the authoritative sources of data, state, and ownership;
* the relevant interfaces, callers, consumers, and lifecycle;
* the scope and likely blast radius of the change.

Trace the relevant flow across components or services when the behavior crosses those boundaries. Do not reason only from the file, symptom, screenshot, failing test, or endpoint presented.

Clearly distinguish:

* observed facts;
* confirmed causes;
* hypotheses;
* unverified assumptions.

For a bug, identify the mechanism producing the failure before selecting the remedy. For a feature or refactor, understand how the change fits the existing architecture and lifecycle.

Do not optimize for making a screenshot, endpoint, demo, test, or immediate task appear successful while leaving the underlying contract unresolved.

Preserve established behavior unless changing it is part of the requested outcome. Make material behavior changes and design tradeoffs explicit.

### 2. Prefer the correct source of truth and the simplest coherent design

Use existing mechanisms when their contracts fit the requirement. Avoid creating competing sources of truth, duplicated state, hidden synchronization, or execution-order dependencies.

Every new abstraction, dependency, state store, cache, background task, timer, retry, flag, fallback, listener, or queue must have a clear:

* purpose;
* owner;
* lifetime;
* failure behavior;
* cleanup behavior.

If successive patches require additional synchronization, fallback logic, or compensating layers to keep the system coherent, reconsider the underlying design instead of adding another patch.

Core correctness must not depend on an optional optimization, cache, timing assumption, local-machine default, or accidental environmental condition.

### 3. Design the relevant lifecycle, not only the happy path

For the affected flow, consider the states that materially apply:

* initial;
* loading or in-progress;
* normal success;
* empty or absent data;
* partial completion;
* failure;
* retry or recovery;
* cancellation;
* cleanup.

Where relevant, also account for:

* duplicate operations;
* concurrent updates;
* delayed or out-of-order work;
* stale requests or obsolete jobs;
* retries;
* process restarts;
* dependency outages;
* version changes;
* long-lived resource use.

For writes, define transaction, consistency, ownership, and idempotency boundaries where they matter. Prevent stale or obsolete work from modifying a newer target, identity, or state.

Retries must not duplicate writes. Cache expiry must not corrupt authoritative state. Cancellation and cleanup must release resources reliably.

Do not hide unresolved failures with arbitrary delays, suppressed exceptions, misleading success responses, visual masking, expanded caches, disabled safeguards, weakened tests, or excessive retries.

A mitigation is not a resolution. If a workaround is necessary, identify it as such and define its limitations and failure behavior.

### 4. Keep resource use and operational behavior bounded

When the change can affect performance or resource use, evaluate it using realistic scale and operation frequency rather than small fixtures alone.

Consider the resources that materially apply, such as:

* queries and external calls;
* memory;
* CPU;
* connections;
* listeners;
* background jobs;
* queue growth;
* storage growth;
* client-side rendering or network work.

Avoid unbounded work or resource retention. Ensure cleanup occurs on success, failure, cancellation, replacement, and teardown where applicable.

Do not infer scalability or production readiness solely from successful compilation, a small test case, or a local run.

### 5. Validate contracts and failure modes, not merely implementation details

Choose verification from the requirements, affected contracts, and realistic failure modes.

Tests should cover the boundaries that materially apply, such as:

* empty or malformed input;
* authorization or permission changes;
* repeated execution;
* realistic data sizes;
* dependency failure;
* expiry;
* retries;
* interruption;
* concurrency;
* stale or out-of-order work.

Prefer regression tests that would fail for the original defect and pass for the correct reason.

Do not remove assertions, weaken expectations, inflate timeouts, add arbitrary retries, or change expected behavior merely to obtain a passing test.

When an existing expectation is genuinely obsolete, replace it only when the intended contract justifies the change.

Verify the affected workflow at the level appropriate to the change. Depending on the system, this may include:

* unit or integration behavior;
* API contracts;
* browser transitions and intermediate UI states;
* database consistency;
* restart or migration behavior;
* deployment or configuration checks.

A correct final screenshot, successful HTTP response, passing unit test, or successful build alone does not establish end-to-end correctness when broader behavior is affected.

### 6. Check shared impact conditionally

Inspect related project artifacts **when the change affects them**, rather than as a mandatory checklist.

For example:

* dependency changes → manifests and lockfiles;
* configuration changes → examples, defaults, secrets handling, deployment config;
* persistent-data changes → schemas, migrations, upgrades, rollback constraints;
* CI/build changes → workflows and build artifacts;
* public behavior changes → documentation and compatibility;
* operational changes → deployment, monitoring, recovery, or runbooks.

Check other consumers of shared modules when shared behavior changes.

For changes affecting existing data or running deployments, assess upgrade, recovery, compatibility, and rollback risks before declaring readiness.

### 7. Stop when the evidence is sufficient

Do not expand the task indefinitely.

Stop when:

* the requested behavior and agreed acceptance criteria are satisfied;
* relevant affected contracts have been verified at a depth proportional to the change;
* no known failure remains within the authorized scope;
* required supporting artifacts are synchronized;
* remaining uncertainty is either immaterial or clearly reported.

Do not perform unrelated refactoring or speculative improvements solely because nearby code could be improved.

If a broader issue is discovered outside the requested scope, report it separately unless it must be addressed for the requested change to be correct.

### 8. Report completion according to evidence

Completion claims must match the evidence actually obtained.

Report:

* what materially changed;
* what was verified;
* what compatibility or operational impact exists;
* what remains untested or uncertain;
* any known risks or external blockers.

Distinguish clearly between:

* code inspection;
* local execution;
* automated tests;
* simulated conditions;
* real CI results;
* real deployment or production validation.

Never present one as another.

Do not declare the work complete while a known failure of the requested behavior remains. If an external constraint prevents full completion, identify the constraint and the remaining work rather than presenting a partial result as a full fix.

Passing a narrow test suite does not override a known system-level problem.

### Operating rule

Use engineering judgment rather than maximum ceremony.

Small, isolated, low-risk changes should receive lightweight investigation and verification. Shared, persistent, security-sensitive, concurrent, operational, or difficult-to-reverse changes require correspondingly deeper analysis and validation.

The goal is not exhaustive process. The goal is to make the requested change correct, coherent, maintainable, and supported by evidence.

