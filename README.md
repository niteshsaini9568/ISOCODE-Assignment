# Shortlist · IsoCode Labs

An independent hiring application for the Company A assignment. Next.js App Router frontend and Node.js/Express API. Vercel deployments use PostgreSQL, private Blob storage and durable Workflows; local development can use SQLite and private local CV files. No CampusHire services or accounts are required.

**Live app:** https://isocode-pied.vercel.app · **Current verification:** [submission checks](docs/submission-verification.md) · **Small fictional test pack:** [download](https://isocode-pied.vercel.app/demo/shortlist-manual-test-kit.zip). Hosted reviewer credentials are supplied in the private submission's `deployment.md`, not this public repository. Live AI requires the reviewer's own provider key; preloaded sample scores are labeled demo rules.

**Vercel deployment:** follow [docs/vercel-deployment.md](docs/vercel-deployment.md) for resource setup, environment variables, schema migration and verification. The app now runs with standard Next.js commands; Vercel does not need the legacy custom server.

## Run locally

Requires Node.js 24.x and npm.

```powershell
git clone https://github.com/niteshsaini9568/ISOCODE-Assignment.git
cd ISOCODE-Assignment
npm.cmd ci
npm.cmd run dev
```

Open **http://127.0.0.1:5173**. The public home is at `/`, authentication at `/login` and `/signup`, and protected workspaces at `/dashboard`. Next.js refreshes frontend changes automatically. Restart the command after backend changes. The first development start seeds the demo database without overwriting existing data.

| Role | Email | Password |
| --- | --- | --- |
| Recruiter | recruiter@company-a.test | Demo@12345 |
| Northstar hiring manager | client@northstar.test | Demo@12345 |
| Meridian hiring manager, for isolation checks | client@meridian.test | Demo@12345 |

These are local demonstration accounts. Demo seeding is disabled by default when using `npm start` or `NODE_ENV=production`, and non-demo startup refuses a database that still contains shared demo accounts. Use a fresh `DATA_DIR` for non-demo operation. New signups create private workspaces. `DEMO_MODE=true` explicitly enables the demonstration in a production build. The database contains only synthetic demonstration consent; do not treat it as real candidate consent.

## Accounts and Google OAuth

Email signup creates a new private recruiting workspace without sample candidates. Recruiters create clients and invitation links under **Trust & review → Clients & access**. An invitation binds the hiring manager to its workspace, client and email address. It expires in seven days and is single-use. The server assigns roles; signup cannot select privileged roles or another workspace. Clients land on their own overview, shortlist portal and read-only shared pipeline.

Google sign-in uses authorization code flow with PKCE, browser-bound state, nonce and verified Google ID tokens. Copy `.env.example` to `.env`, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `APP_URL`, then restart. Register this exact web OAuth redirect URI in Google Cloud:

```text
http://127.0.0.1:5173/api/auth/google/callback
```

For deployment, use the HTTPS application origin and the same callback path. Google sign-in stays visibly unavailable until credentials are configured. Matching emails are not automatically linked to password accounts. Live Google sign-in has not been tested without credentials.

Server layouts validate database sessions and provider setup before rendering protected pages. APIs separately enforce authentication, role, workspace and client boundaries. Session tokens are hashed, expire in eight hours and use HTTP-only SameSite=Lax cookies (Secure for an HTTPS `APP_URL`). Password reset links expire in 30 minutes, are single-use and revoke sessions. Demo reset links appear locally; production recovery uses Resend when `RESEND_API_KEY` and `MAIL_FROM` are configured. Invitation links are copied manually; no invitation email is sent.

Existing submissions from earlier versions require recruiter approval again because they did not record which scorecard version was submitted. Existing pipeline outcomes are preserved. Open the CV and use **Resubmit reviewed profile** for an active shortlist.

## Demo walkthrough

1. Sign in as recruiter, connect a provider key on the setup page, then open **JD scorecard** to review the Senior Java Developer brief. Skills, 5–8 years and notice up to 60 days are editable. Location is unknown for the sample CVs and no CTC is invented.
2. Open **CV inbox**. Upload PDF or DOCX files from `sample-data/`, record a consent reference and tick the hiring-use consent box. The same sample candidate in another format is detected as a duplicate.
3. Open **Candidate ranking**. Ritika ranks ahead of Pooja and Arjun for the Java requisition. Search includes low scores and rejected profiles. Open a candidate to see exact evidence lines and unknown criteria.
4. Click **Open original CV**. Submission remains locked until the server records that view for the current scorecard version. Seeded candidates have an original plain-text sample; newly uploaded candidates retain their original PDF or DOCX.
5. **Submit to client**, then sign out and sign in as the Northstar hiring manager. Only submitted Northstar candidates are visible. Review masked evidence, shortlist, reject with a reason or propose a future interview slot.
6. Sign back in as recruiter. **Hiring pipeline** reflects the client decision. Move submitted candidates through offered and joined. A rejection requires an explicit reason.
7. **Trust & review** shows consent, audited access and a seven-day sample of ranks against recruiter submissions. Save a review snapshot. Candidate deletion requires typing the candidate ID and erases data across requisitions.

## Eight screens

1. Public home, email/Google login, signup and recovery
2. Overview and requisitions
3. JD intake and editable scorecard
4. Bulk CV inbox, progress, duplicates and transcript verification
5. Ranked candidates and evidence review drawer
6. Per-requisition hiring pipeline
7. Responsive client shortlist portal
8. Trust, consent, deletion, access log and weekly rank review

## AI and demo mode

Recruiters can choose **OpenAI, Gemini or Groq** under **Trust & review → AI provider**. The model is prefilled when a provider is selected and can be edited. The selection persists in the configured database for this workspace. Existing scores stay unchanged and retain the provider/model that produced them; new work and explicit retries use the current selection. Switching is blocked while parsing or scoring is active.

| Provider | Default model | Scope |
| --- | --- | --- |
| OpenAI | `gpt-4.1-mini` | JD/CV extraction, evidence scoring and PDF transcription |
| Gemini | `gemini-2.5-flash` | JD/CV extraction, evidence scoring and PDF transcription |
| Groq | `openai/gpt-oss-120b` | Text extraction and scoring; scanned PDFs need a verified transcript |

These are starting defaults for document extraction and ranking, not a claim of measured provider superiority. Models can be changed to another compatible model available to your account. See [official OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [Google's structured-output example](https://blog.google/innovation-and-ai/technology/developers-tools/gemini-api-structured-outputs/) and [Groq's model documentation](https://console.groq.com/docs/models).

After recruiter login or signup, `/setup/provider` lets you select OpenAI, Gemini or Groq, keep its default model, and enter your own API key. A small provider request validates each new key before saving; no CV is included in that check. Successful setup opens the dashboard. Recruiter dashboard access redirects to setup until a provider is configured. Clients enter their review portal without provider setup.

Keys are encrypted with AES-256-GCM in the workspace-scoped `ai_credentials` table. The server creates a 32-byte master key at `DATA_DIR/credentials.key`; keep this private and back it up separately from the database. Losing it makes stored keys unreadable. For a hosted deployment, protect the data directory with OS permissions and use HTTPS. Keys are never sent back in API responses, scores or audit logs. A workspace's own key takes precedence over a server environment key. You can replace it from Trust & review → AI provider.

Alternatively, copy `.env.example` to `.env`, set server-wide fallback keys, then restart:

```dotenv
AI_PROVIDER=gemini
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-4.1-mini
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-2.5-flash
GROQ_API_KEY=your_groq_key
GROQ_MODEL=openai/gpt-oss-120b
```

Keep unused keys blank. `AI_PROVIDER` sets the initial selection; the saved workspace choice takes precedence. The API key input is cleared after saving and is not stored in browser storage. Data files, master keys and environment secrets are excluded from exported archives. A successful connection check confirms access at that moment; later usage still depends on provider credits, limits and model access.

If the selected provider has no key, extraction and scoring use explicitly labelled deterministic **demo rules**. Other configured providers are not used automatically. A provider error never silently falls back to demo rules or another provider. Responses use JSON mode plus local schema/evidence validation.

CV processing requires consent for the **selected provider**. Uploads and consent updates bind the grant to that provider. Changing from Gemini to OpenAI or Groq does not reuse a Gemini grant. Existing records without an explicit provider are treated as Gemini-only for backwards compatibility. Existing seeded profiles have no AI consent; record consent before retrying scoring with a configured provider. Scanned PDFs are sent only to the selected, consented provider when it supports PDF input; Groq's default model keeps them in manual review.

Scoring sees a conservative set of job-relevant, numbered CV lines, excluding identified names, contact lines and protected-trait fields. Model quotes must match those lines exactly; missing criteria, invented evidence and unsupported statuses fail validation. The server calculates weighted scores itself: met = 1, partial = 0.5, unknown or outside requirement = 0. Every score can be inspected. Scores never change pipeline decisions automatically.

Unknown criteria lower the displayed score and remain explicitly unknown rather than becoming a factual rejection. Must-have criteria are flagged for human review; no automatic hard rejection is attached to them. The demo parser recognizes a small vocabulary and explicit numerical patterns. Live models can process a broader set of job requirements, but provider quality still needs evaluation.

Scanned PDFs with no usable text enter **needs review** without a key. With a key and AI consent, the transcription also waits for recruiter verification before scoring. Use **Verify transcript**, open the original and save a corrected transcript. Unsupported, corrupt and password-protected documents show per-file errors and can be retried. DOCX extraction supports paragraphs and tables. Decompressed DOCX content is capped at 32 MB. No OCR-quality claim is made without testing a real provider and representative scans.

## Storage and safeguards

- SQLite records and uploaded files live in ignored `data/`; nothing is exposed as a public upload directory.
- A durable, single-consumer queue streams up to 500 files to disk, capped at 8 MB each and 100 MB per batch. Documents parse sequentially rather than buffering the batch in RAM.
- SHA-256 file and normalized-text hashes plus explicit email matches prevent duplicate candidate records; profiles can be linked to more than one requisition. Identical seed files have normalized-text deduplication.
- Authentication uses scrypt password hashes and opaque, expiring, HTTP-only, same-site cookies. API role and client checks run on the server. Same-origin checks protect mutations and login is rate limited.
- Clients never receive the original CV, email, recruiter-only consent records or another client’s submissions. Their profile uses a candidate ID instead of the candidate name.
- A scorecard version change invalidates previous scores, CV views and client decision authority. The recruiter must open the CV and resubmit against the new version. Clients see a stale-submission notice and cannot act until renewed approval. Repeating an unchanged submission preserves client decisions and joined-hire outcomes.
- Deletion removes uploaded files, linked applications and views, consent, names and copied batch metadata. Linked weekly snapshots are removed and SQLite WAL is checkpointed. An anonymous deletion event is retained. Backups and operating-system forensic erasure are outside the demo.

## Commands

```powershell
npm test          # Node unit and HTTP workflow tests, including a real 500-file batch
npm run build    # Production frontend bundle
npm run samples  # Regenerate the six sample PDF/DOCX files
npm run seed     # Idempotent development-only seed
```

To review the production bundle locally with demonstration accounts:

```powershell
$env:DEMO_MODE="true"
npm run build
npm start
```

## Scope and honest limits

This is an assignment-ready local vertical slice, not a certified DPDP-compliant production service. Payments, email, messages, interview invitations and outside systems are intentionally mocked or omitted. No job-board integration, scraping, video interview or background-verification feature is included.

Before real candidate use: disable demo accounts, configure Google credentials and recovery email delivery, serve behind HTTPS, restrict and encrypt storage, evaluate malware handling, establish retention and backup-erasure policies, review consent wording and provider agreements, and benchmark on representative CVs. The local SQLite runtime remains a single-host demonstration. The cloud runtime uses PostgreSQL workspace locks and durable jobs; neither has been benchmarked for 70 concurrent recruiters. AI/OCR provider calls have not been live-validated in this build. Redaction uses conservative heuristics and requires a broader multilingual/layout privacy evaluation before production.

The targets of 60% less screening, 48-hour shortlists for 80% of requisitions and 60% client acceptance are **success targets**, not measured achievements. See `docs/assignment.md` for the delivery plan and calculation assumptions.

## Validation

With `TEST_DATABASE_URL` set, the verification suite passes 60 checks, including 500 distinct PDF/DOCX profiles, duplicates, corrupt files, workspace privacy, queue recovery, consent-gated AI flows with mocked provider responses, rejection of invented evidence, stale-submission controls, authentication and candidate erasure. `npm run build` passes. See `docs/verification.md` for coverage and limits.

## Design provenance

Built using the [Ponytail skill](C:/Users/Om/.codex/plugins/cache/ponytail/ponytail/5.3.3/skills/ponytail/SKILL.md) for backend implementation discipline. Ponytail is a skill, not an MCP service.

Frontend components were retrieved through the **21st.dev MCP** and adapted to this app, using CSS transitions and the existing React stack instead of pulling in unused component variants:

- [Dashboard Shell by isaiahbjork](https://21st.dev/@isaiahbjork/components/app-dashboard-shell), demo ID 43212
- [File Dropzone by joyco](https://21st.dev/@joyco/components/file-dropzone), demo ID 19201

No 21st.dev API token is included in source. The current interface adapts the MIT-licensed [ShadcnStore dashboard and landing template](https://github.com/shadcnstore/shadcn-dashboard-landing-template), with local Inter Variable, dark neutral cards, white primary actions and shared styling across all pages. The requested CLI slug returned `Template not found`, so the matching public source was imported directly. See `docs/design-system.md` and `docs/shadcnstore-reference.json` for source details, the pinned commit and licenses.

Dashboard charts use current workspace requisition counts, rather than the template's mock sales data. Recruiters see applications by role and review/submission/joined counts; clients see only submitted applications for their own account. Charts are snapshots, not a time series. The app keeps its existing Next.js/Node stack and packages.

The home page retains its original animated Mosaic layout, pixel headings, glass cards and footer wordmark, with muted blue, teal and violet accents over the dashboard's charcoal palette. Authentication also retains the neutral mosaic background. The dashboard uses the ShadcnStore layout; scoped public styles do not change it.
