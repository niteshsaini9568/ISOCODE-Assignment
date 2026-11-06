# Backend verification — 6 November 2026

The standalone IsoCode Labs backend passes 51 automated tests, with zero failures, cancellations or skipped tests. The complete run took 60.27 seconds. Tests use synthetic CVs and isolated temporary SQLite databases; they do not erase or replace the application's saved candidates.

## Commands and evidence

- `node --experimental-test-coverage --test --test-concurrency=1 tests/*.test.js` — 51 passed. Raw local output: `data/backend-test-final.log`.
- `npm audit --omit=dev --json` — zero reported vulnerabilities. Raw local output: `data/backend-audit-final.json`.
- Production launch: `node --env-file=.env.example server/index.js --production` — running at http://127.0.0.1:5173/.
- 18 HTTP assertions against the production launch — passed; output in `data/backend-production-smoke.json`. Public pages and authenticated recruiter pages return 200; unauthenticated/forged-cookie dashboard access redirects to login; authenticated login redirects to the dashboard; logout invalidates the session.
- Overall instrumented coverage: 98.82% lines, 88.73% branches, 94.54% functions. API app: 99.62% lines. AI, auth, database, domain, parser and worker each reach 100% line coverage. This measures executed code, not universal correctness.

No frontend changes or dependency additions were made for this audit. The existing Next.js production output was exercised; a fresh frontend build and visual browser regression were not run in this backend pass.

## Requirement checks

| Area | Verified behavior |
| --- | --- |
| Authentication | Login/signup, isolated workspaces, role injection refusal, email-bound single-use invitations, password reset and session revocation, expired/forged sessions, repeated-login rate limiting |
| Google authentication | Mocked callback token verification, PKCE/state/browser binding, replay and account-collision rejection; unconfigured login reports its state |
| JD intake | Editable/versioned scorecards; skills, experience, CTC and notice extraction; invalid ranges, duplicate criteria and personal-trait criteria rejected |
| Bulk import | 500 distinct synthetic CVs in one mixed PDF/paragraph-DOCX/table-DOCX batch; 500 duplicate CV batch; malformed files isolated rather than failing unrelated items |
| Upload/parser limits | 501-file refusal; files over 8 MB and batches over 100 MB refused with no orphan files or batch rows; DOCX expanded-size limit of 32 MB; extracted-text limit of 100,000 characters; ZIPs that are not Word documents rejected |
| Deduplication | File, normalized text and email detection; reuse within workspace and isolation across workspaces; repeated scans cannot bypass review, including when uploaded to another requisition |
| Scan handling | Manual transcript flow; mocked OpenAI/Gemini OCR requires consent and human verification; unusable OCR rejected; Groq scan path makes no PDF provider call |
| Ranking/evidence | Exact source evidence required for each known result; invented quotations refused; unsupported AI profile numbers corrected to source facts or unknown; separate-line technologies retained; protected traits and contacts filtered; low scorers remain available; no automatic rejection |
| Recruiter submission | CV opening required for current scorecard version; current successful scoring required; repeat submission preserves existing decisions; scorecard changes require renewed review and submission |
| Client portal | Assigned-client/workspace isolation; only submitted candidates visible; identity/contacts/original CV masked; rejection reason required; future interview slot required; offered/joined candidates protected |
| Pipeline | Human-controlled stages from sourced through joined; advanced stages cannot bypass stale scorecard/submission checks |
| Consent/deletion | Hiring consent before import; provider-bound AI grants; processing conflicts handled; deletion removes CV files, duplicate copies, candidate profiles, applications, linked views, consent and affected review snapshots |
| Governance | Access/decision audit records and weekly AI-rank versus recruiter-choice samples; workspace scoping |
| Recovery/persistence | Failed parser item retry after repairing a synthetic file; failed scoring retry; interrupted work resumes after database reopen without duplicate seed users |
| Request security | No-store API responses, production CSP/HSTS/nosniff headers, HttpOnly/SameSite session cookie, request-size limits, cross-site request blocking, role enforcement and unknown API route handling |
| Provider selection | Mocked OpenAI, Gemini and Groq requests use the selected endpoint/model; provider provenance retained; consent cannot silently transfer to a new provider; failures never silently switch providers |

## Bugs fixed during this audit

1. Repeated scanned CVs could be treated as ordinary duplicates and attached before transcript verification. They now remain in review, preserve reviewable files, and are attached to waiting requisitions only after verification. Verified identity and deduplication checks are updated transactionally.
2. Recruiters could advance candidates after changing the scorecard without renewed submission. Advanced stages now require current scoring and submission approval.
3. AI profile extraction could accept invented experience, notice or CTC numbers. Numbers now need explicit source support, otherwise the deterministic source value or unknown is retained.
4. Standalone technologies under a technical-skills heading were dropped by the scoring filter. Section-aware filtering now retains these lines while continuing to exclude personal/contact information.

The first three failures were reproduced before the fixes (`data/backend-regressions-before.log`). The separate-line skill regression was also observed failing before repair. The final complete suite includes all four regressions.

## External setup and remaining limits

- Live Google OAuth has not been exercised: Google client credentials are not configured.
- Live OpenAI/Gemini/Groq requests and real scanned-document OCR accuracy have not been exercised: provider keys are not configured. Adapter tests use mocked responses; the running app uses labelled deterministic demo rules. Groq requires a verified text transcript for scans.
- Outbound messages, payments and outside systems remain mocked as the assignment permits. Non-demo password recovery returns 503 until real mail delivery is implemented/configured; demo reset behavior is tested.
- The 500-file tests establish this local batch workflow, not multi-instance operation, 70-user concurrent load, or a production throughput guarantee. Synthetic PDF/DOCX fixtures cannot represent every real CV layout.
- Tests do not establish legal compliance, hiring fairness outcomes, penetration-test completeness, or the business targets of 60% less screening time and 48-hour shortlists. Those require deployment-specific review and measured usage.

Local logs under `data/` are excluded from the distributable archive along with databases, uploads, secrets, node_modules and build output. Tests and this report are included so the checks can be rerun.
