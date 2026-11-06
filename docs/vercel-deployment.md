# Deploy Shortlist on Vercel

The app now uses standard Next.js routing on Vercel. Express runs inside the Node.js API handler; a custom listening server is not needed. PostgreSQL stores records, sessions, consent, encrypted provider keys, rate limits and queue state. Private Vercel Blob stores CVs. Vercel Workflows runs parsing and scoring in durable steps.

Local development without `DATABASE_URL` continues to use the existing SQLite database and local uploads. Vercel refuses to start the backend without durable storage configuration; it never silently falls back to a temporary SQLite file.

## 1. Import the project

Push the source to a private GitHub repository, then import it into Vercel. Do not commit `.env`, `.env.local`, credentials, candidate files, `data`, `.next` or `node_modules`.

| Setting | Value |
| --- | --- |
| Root directory | `IsoCode Labs` when importing the CampusHire repository; `.` for a standalone repository |
| Framework | Next.js |
| Node.js | 24.x |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | Framework default |

`vercel.json` and `next.config.mjs` include the deployment and Workflow SDK configuration. Do not configure `server/index.js` as the Vercel entry point. The legacy launcher is retained only for older local commands.

## 2. Connect PostgreSQL

Create a PostgreSQL database through Vercel Marketplace, or connect an existing PostgreSQL service. Set `DATABASE_URL` to its **direct connection URL** with the provider's required TLS parameters.

This app uses session-level advisory locks to serialize workspace mutations and job replays. Transaction-mode poolers are incompatible with those locks. For Neon, turn off the connection-pooling toggle when copying the URL. If the integration sets a pooled `DATABASE_URL`, also set `DATABASE_URL_UNPOOLED` to the direct URL; the app gives that variable precedence. The adapter uses a small process-local connection pool and Vercel's pool lifecycle helper. Monitor the database's connection limit when increasing traffic. See [Neon's connection guidance](https://neon.com/docs/get-started/connect-neon).

Create the tables before opening the deployed app. Add the target database URL to your ignored local environment file, then run:

```powershell
npm ci
npm run migrate:cloud
```

The migration is repeatable and does not create demo users. It creates the PostgreSQL schema; it does **not** copy local SQLite users, CVs or encryption keys. Existing local data remains untouched. A fresh cloud deployment starts with signup. Moving existing private data requires a separate, backed-up data migration.

## 3. Create a private Blob store

In the Vercel project's Storage section, create a Blob store with **Private** access. Connect its `BLOB_READ_WRITE_TOKEN` to the appropriate environment.

CVs upload directly from the browser to Blob, using a short-lived token limited to a pre-authorized workspace path, file size and MIME type. Only authenticated recruiters can obtain tokens. Completion verifies metadata against the stored manifest before enqueuing the batch. A batch supports up to 500 PDF/DOCX files, 8 MB per file and 100 MB total.

Original CV downloads are authorized before a signed URL valid for one minute is issued. Client hiring managers cannot obtain these URLs. Downloads and uploads bypass the Function payload limit; CV bytes are not returned through the API function. See [Vercel client uploads](https://vercel.com/docs/vercel-blob/client-upload).

## 4. Set production environment variables

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Exact HTTPS application origin, such as `https://shortlist.example.com` |
| `DEMO_MODE` | `false` |
| `DATABASE_URL` | PostgreSQL URL; use a direct connection |
| `DATABASE_URL_UNPOOLED` | Optional direct URL override when the integration's default URL uses transaction pooling |
| `BLOB_READ_WRITE_TOKEN` | Token for the private Blob store |
| `CREDENTIALS_ENCRYPTION_KEY` | Stable 32-byte master key encoded as 64 hexadecimal characters |
| `CRON_SECRET` | Random secret of at least 32 characters for recovery/cleanup |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Both required to enable Google login; otherwise email login remains available |
| `RESEND_API_KEY` / `MAIL_FROM` | Enable production password-reset emails; use a verified sender domain |
| `AI_PROVIDER` | Initial provider: `gemini`, `openai` or `groq`; defaults to Gemini |

Generate independent secrets locally, once for each secret:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep the credential encryption key unchanged across redeployments. Losing or changing it makes existing saved API keys unreadable. Do not add `NEXT_PUBLIC_` to any credential variable. Use separate databases, Blob stores, encryption keys and OAuth callbacks for Production and Preview; preview code must not access production candidate data.

Recruiters can enter their own OpenAI, Gemini or Groq key after login. Workspace keys override optional server fallback `OPENAI_API_KEY`, `GEMINI_API_KEY` or `GROQ_API_KEY` values. New keys are checked using a small provider request without CV data. Existing consent restrictions remain enforced.

Run the preflight against your intended production environment:

```powershell
npm run check:cloud
npm run build
```

The preflight checks configuration and required PostgreSQL tables. It does not claim live Blob, OAuth, AI or email verification.

## 5. Configure authentication and workflows

In Google Cloud, register this exact authorized callback URI:

```text
https://YOUR-DOMAIN/api/auth/google/callback
```

Set `APP_URL` to the same origin. For Preview, use a stable preview domain with its own OAuth configuration rather than reusing a production callback.

The Workflow SDK registers its `/.well-known/workflow/v1/...` handlers during the build. Do not rewrite those paths or route them through the Express catch-all. On Vercel, the SDK uses Vercel's workflow runtime; no local timer or manually started worker is needed.

Queue requests are persisted in an outbox before API responses. Dispatch is registered with `waitUntil`; a failed dispatch remains recoverable. Each processing step holds a workspace lock, safely resumes interrupted work, and commits a new candidate/profile/item together. Duplicate workflow deliveries do not bypass transcript verification or automatically advance candidates.

`vercel.json` schedules an authenticated recovery/cleanup endpoint daily at 03:00 UTC. Normal parsing starts immediately after upload finalization; it does not wait for cron. The daily schedule is compatible with Hobby cron restrictions. For a production plan supporting more frequent cron runs, change the schedule to `*/5 * * * *` to recover failed dispatches sooner. Cron also deletes expired abandoned uploads, unreferenced duplicate objects and old rate-limit rows. See [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## 6. Deploy and verify

Redeploy after connecting resources and saving environment variables. Then verify:

1. `/api/health` returns `{"ok":true}`; it now checks database access.
2. Signup/login leads a recruiter to provider setup; the dashboard cannot bypass setup.
3. Provider key validation succeeds with a valid account; saved keys are not returned by the API.
4. PDF/DOCX uploads go to the private store and appear in the processing inbox. Check Workflow runs and logs.
5. Scans wait for a verified transcript, duplicates reuse the original profile, and scores quote CV evidence.
6. A recruiter must open the original CV before submission. Clients see only assigned submitted profiles, with contacts masked.
7. Rejection reasons, future interviews, pipeline changes and consent/deletion work. Verify deletion in Blob and PostgreSQL.
8. Redeploy and confirm sessions, provider settings and candidates persist.
9. Exercise Google OAuth and password reset with your actual configured accounts.

List APIs return bounded pages to keep responses below Vercel's payload limit. The existing frontend automatically loads all pages for jobs, candidates, import history, consent records and weekly reviews. Full quoted evidence is loaded in the candidate drawer. Low scorers remain accessible.

## Reproduce local verification

Use a dedicated PostgreSQL test database and set `TEST_DATABASE_URL` to its direct URL:

```powershell
npm test
npm run build
npm run test:runtime
```

With `TEST_DATABASE_URL` set, the suite creates uniquely named test schemas and drops only those schemas afterward. Without it, cloud integration tests are explicitly skipped; the local suite still runs. The runtime check starts an isolated production Next server on port 5176 by default (`TEST_APP_PORT` overrides it), uses synthetic accounts, and verifies that a compiled empty-queue workflow completes.

Verification separates real PostgreSQL and compiled local workflow execution from mocked private-Blob storage and mocked AI/mail/OAuth adapters. A real Vercel deployment and live service credentials are still required to verify those external services. No cloud account or paid resource was provisioned automatically.
