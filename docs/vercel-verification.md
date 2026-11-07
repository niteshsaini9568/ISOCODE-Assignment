# Vercel compatibility verification — 6 November 2026

This is the historical local compatibility record. For the subsequent hosted deployment and final assessment checks, see [submission-verification.md](submission-verification.md).

The application has been adapted for Vercel's standard Next.js deployment. Cloud operation uses PostgreSQL, private Blob uploads and durable Workflows. SQLite/local files remain available for local development. No Vercel project or paid cloud resource was created during this work.

## Implementation

- Native Next.js API routing hosts the existing Express services. Server layouts enforce sessions, roles and provider setup before protected pages render.
- Database-dependent handlers now await database operations. PostgreSQL connections are scoped to requests/steps; transactions and workspace advisory locks use the same direct connection. Locks and connections are released through the function lifecycle, including post-response cleanup. Transaction-pooling URLs are rejected when recognized; deployment requires a direct connection.
- PostgreSQL migrations create application, credential, shared rate-limit, upload-manifest and workflow-outbox tables. Demo account detection checks the seeded IDs rather than rejecting arbitrary preview accounts using `.test` email addresses.
- Upload tokens authorize a specific private path, MIME type, declared size and expiry. Manifest finalization verifies uploaded objects, is idempotent, records consent and enqueues work transactionally. CV bytes bypass the Function request/response limits.
- A durable workflow processes items and scores through individual steps. Replays resume interrupted items under workspace locks. Candidate creation and parsing status commit together. Parsing/scoring never automatically rejects or submits a candidate.
- Queue requests persist before dispatch. `waitUntil` tracks dispatch and database cleanup. A protected scheduled endpoint recovers queued work and removes abandoned uploads, unreferenced duplicate objects and old rate-limit records.
- API keys use AES-256-GCM with a stable cloud environment master key. Values do not appear in API responses, scores or audit records. The app refuses a Vercel backend startup without required durable-storage configuration.
- Jobs, candidates, import history, consent records and review history use bounded API pages. The frontend collects all pages, keeping low scorers accessible. Full quoted evidence is fetched in candidate details.
- Production password-reset email supports Resend configuration. Google OAuth, invitations, session revocation and client/workspace isolation are preserved.
- Supplied credentials found in the example environment were preserved in ignored local files and removed from `.env.example`. Deployment/source archives exclude environment secrets, local databases, uploads and encryption files.

## Checks run

| Check | Result |
| --- | --- |
| Complete Node test suite with an isolated PostgreSQL test server | 60 passed, zero failed or skipped |
| Production Next.js/Workflow build | Passed; native API, protected pages, cron and generated workflow handlers emitted |
| Native production runtime smoke | 18 checks passed, including a compiled empty-queue workflow completing |
| Dependency audit | Zero reported vulnerabilities |
| Deployment preflight and PostgreSQL migration commands | Passed against the isolated local PostgreSQL server |
| Function file traces | Checked; no local data, environment files, outputs or tests found in emitted route traces |

The PostgreSQL integration tests exercise real PostgreSQL 18 using unique test schemas. They cover mixed-format 500-CV import with Unicode filenames, manifest limits, provider/consent checks, source scoring, long Unicode transcript verification, original-CV review, client decisions, deletion, interrupted work, transaction rollback, cross-instance sessions/rate limits, pagination beyond the first page, low-score availability, duplicate-object cleanup and expired-upload cleanup. Storage is injected as a synthetic private-object store. The actual Blob SDK separately rejects unsigned completion callbacks.

The native runtime check starts the production Next.js server against a temporary PostgreSQL schema. It verifies public pages, signed-out redirects, authenticated provider setup, dashboard gating, safe key responses, protected cron access, logout, outbox dispatch and completion of the compiled workflow through the local Workflow SDK runtime. Its workflow contains no CV work; actual parser/scorer steps are exercised by the PostgreSQL integration suite.

Raw local evidence is retained under ignored `data/`: `vercel-final-tests.log`, `vercel-postgres-tests.log`, `vercel-restart-regression.log`, `vercel-build.log`, `vercel-native-checks.json`, `vercel-native-server.log` and `vercel-dependency-audit.json`. Tests and reproducible runtime/preflight scripts are included in the source archive.

## Verification limits

No hosted Vercel deployment was performed. Real Vercel Blob authorization, upload/download URLs, managed PostgreSQL networking, hosted Workflow delivery, Google OAuth, provider billing/OCR accuracy and Resend delivery require configured cloud resources and deployment checks. The local runtime checks do not establish those integrations as live-verified.

A new visual browser pass could not be completed because the browser-control connection was unavailable; native production HTTP rendering and backend workflows were checked. No redesign was introduced. Throughput for 70 concurrent recruiters and business hiring outcomes were not benchmarked. Existing local SQLite data was preserved and was not copied to cloud services.

Use [vercel-deployment.md](vercel-deployment.md) to provision resources, set secrets, run migrations and validate the real deployment. The default recovery cron runs daily; plans supporting more frequent schedules can shorten recovery to five minutes.
