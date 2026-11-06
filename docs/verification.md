# Verification · 5 November 2026

**Latest verification (6 November 2026):** 60 tests passed with PostgreSQL integration enabled; production build and 18 native runtime checks passed. See [vercel-verification.md](vercel-verification.md) and [vercel-deployment.md](vercel-deployment.md). Earlier backend/provider reports below are historical; no hosted Vercel deployment has been claimed.

## Result

40 automated checks pass, with no failures or skipped tests. The Next.js production build passes. `npm audit --omit=dev` reports zero known vulnerabilities at verification time. These checks do not establish that every possible CV or deployment scenario will work.

The saved TurboStarter reference was inspected as a local page with its captured scripts removed. Its embedded Geist font was extracted and verified as WOFF2; the browser confirms that Geist loads locally. The application now uses one stylesheet instead of the previous layered themes.

## Backend coverage

| Assessment requirement | Verified behavior |
| --- | --- |
| JD intake | HTTP extraction and editable, versioned scorecards; skills, experience, CTC and notice limits; protected-trait and invalid-range criteria rejected |
| Bulk parsing | One 500-file repeated-CV batch for capacity/deduplication, plus one batch of 500 distinct CVs mixing PDF, paragraph DOCX and table DOCX; corrupt files fail per item; interrupted parsing resumes after database reopen |
| Duplicate detection | File/text/email fingerprints; same CV in another format reuses the profile within its workspace; identical content in another workspace creates a separate private record |
| Evidence scoring | All criteria present, exact source quotations verified, invented evidence refused, missing facts remain unknown, identity/contacts/protected-trait lines excluded, no automatic pipeline decisions; zero years and zero notice preserved |
| AI processing | Mocked OpenAI/Gemini/Groq adapters; full mocked-AI intake/parse/score/retry workflow; provider-bound consent prevents outbound CV processing without permission; errors do not silently fall back |
| Client portal | Only submitted candidates for the correct client; names/contacts/original CV access masked; rejection reason required; future interview proposal validated; terminal hires protected |
| Pipeline | Open original CV before submission; scorecard edits invalidate views and decision authority until renewed recruiter submission; repeated unchanged submissions preserve decisions and joined hires |
| Consent and erasure | Hiring-use consent required before uploads; provider-specific processing grants; original files, profiles, consent, applications, linked views, copied batch details and affected review snapshots removed on deletion |
| Access and review | View/decision audit records, weekly rank-versus-choice sample and saved notes; scoped to the workspace |
| Authentication | Opaque hashed sessions, password validation, role-injection rejection, isolated signup workspaces, email-bound single-use client invitations, password reset/revocation, Google PKCE/browser state, replay and account-collision rejection |

Cross-workspace processing no longer blocks unrelated teams from changing providers or deleting candidate data. In-flight uploads are tracked so deletion cannot race an upload before it enters the durable queue. Existing local data was backed up through SQLite’s backup API before migration; the backup remains under ignored `data/backups/turbo-rebuild-2026-11-05/`.

## Browser workflow in the production build

The end-to-end browser test used a separate synthetic database under ignored `data/qa-turbo-production/`, on localhost port 5175. It did not add test requisitions or decisions to the user’s normal workspace.

Verified: recruiter login → blank new requisition → JD extraction including CTC 25 LPA and 60-day notice → save → select three PDF/DOCX samples → upload blocked without consent → duplicate processing → ranked profiles → submission disabled before CV opening → original CV opening → submission → client login → only the submitted masked profile visible → rejection blocked until a reason → recorded rejection → human shortlisting → future interview proposal → read-only client pipeline → recruiter Offered and Joined stages → saved weekly review → provider defaults and persisted Groq selection after reload. No browser console errors were observed during this walkthrough.

Responsive checks: home/auth and workspaces at desktop width, scorecard/ranking/client portal at 390 × 844. Phone views stayed within the document width. Navigation drawer opening, closing, background inertness and focus transfer were checked; a visibility-transition focus bug was fixed. Temporary viewport overrides were reset after QA.

Screenshots under `docs/screenshots/` use the `turbo-` prefix. They show synthetic assignment data. Prior `next-` screenshots describe the previous design and are retained only as history.

## Final server checks

The final production build is running on http://127.0.0.1:5173/. HTTP assertions verify the public home and health endpoint, anonymous/forged-cookie dashboard redirects, client denial of recruiter pages and privacy APIs, invalid dashboard route handling, private no-store dashboard caching, and the original client-scoped requisitions without the isolated QA job. The temporary reference and QA servers were stopped. A final targeted regression also verifies that processing in one workspace does not block a deletion request in another.

## Limits

No live Google credentials or AI provider keys are configured. Google token exchange/identity verification and AI responses were mocked in automated tests; live OAuth, provider credits/model access, scoring quality and OCR quality remain unverified. The runtime clearly labels demo scoring. Outbound messages, email and interview invitations remain mocked as required by the assignment; non-demo password recovery reports unavailable mail delivery.

Not load-tested for 70 simultaneous recruiters, externally deployed or certified for DPDP compliance. Parsing fixtures cover a defined set of layouts, not all real-world documents, encrypted CVs or languages. Identity redaction remains heuristic and needs representative privacy evaluation before real candidate use. Business outcome figures are targets, not measured results. Backup erasure and host-level retention require an operational policy.


## Content rewrite

Applied the installed Human Content Writer and Humanizer skills to the home page, authentication, dashboard guidance and helper text. Replaced repeated slogans with task-specific instructions. Kept the original CV quotations, numeric limits, consent requirements, demo notices and business targets.

The production build passed after this copy pass. Hash checks confirmed no changes to backend source, packages, CSS or the current route. The native GET search form is byte-for-byte unchanged. Browser checks covered the home page at desktop size and login/scorecard at 390 × 844; no document overflow or browser errors were observed. Backend tests were not rerun for this copy-only update. New previews: `screenshots/copy-home.png` and `screenshots/copy-scorecard-mobile.png`.


## Monitor spacing and logo

Removed fixed public-page container caps and replaced them with fluid gutters: clamp(24px, 4vw, 96px). At a 1920px browser viewport, the logo and product preview start about 77px from the edge; at 2560px the gutter is 96px. Existing phone overrides remain. Browser checks at 1920px, 2560px and 320px showed no horizontal document overflow, and the search button text still fits at 320px.

A new SVG document-and-checkmark logo is shared by the site header, authentication pages, sidebar, footer and favicon. SVG parsing and browser image loading passed. `npm run build` passed. Backend tests were not rerun for these visual changes. Preview: `screenshots/monitor-layout-1920.png`.

## Mosaic frontend update · 5 November 2026

- Adapted the local reference archive's glyph map and fragment shader, without loading captured application scripts or adding packages.
- Re-ran the backend suite: all 40 tests passed, including mixed 500-file bulk parsing, authentication, client isolation, consent, evidence validation, scorecard refresh gates and deletion.
- Browser checked desktop home and aurora workflow, recruiter login/ranking/evidence drawer, client login/assigned shortlist, mobile drawer focus and Escape, native GET search (`/?q=Java+hiring`), visible keyboard focus, and no document overflow at 320px/390px. The existing client profile correctly requires renewed recruiter submission after a scorecard change; QA did not override that gate.
- The browser reported no warning/error logs on the home page. Actual WebGL rendering was visually confirmed. Reduced-motion and context-loss fallbacks were source-inspected, not browser-emulated.
- Live Google OAuth and AI provider credentials remain unconfigured; backend provider/security tests use mocks.

Final production rebuild passed after the hero spacing fix. Reference self-check confirmed every displayed pixel glyph and required shader uniform. Runtime health and homepage smoke checks were repeated against the final build. Final screenshots are `mosaic-home-desktop.png`, `mosaic-workflow-desktop.png`, `mosaic-home-mobile.png` and `mosaic-client-mobile.png` under `docs/screenshots/`.

## Global typography update

Production build passed. Source scan confirmed no explicit pixel font sizes below 14px in either stylesheet. Browser checks covered desktop home/pipeline and recruiter ranking; 320px home, login, recruiter overview and ranked cards; 390px scorecard, upload and client portal. The checked narrow-screen documents had no horizontal page overflow. Computed visible leaf text scans on home, scorecard, upload and client portal found no sizes below 14px. No hiring decisions or scorecard data were changed. Backend tests were not rerun for this CSS-only update.

## ShadcnStore dashboard rebuild

- The requested 21st.dev template CLI slug returned `Template not found`. The matching public MIT source was cloned and pinned in `shadcnstore-reference.json`; its Card composition, dashboard layout and dark theme tokens were adapted directly.
- `npm test`: 41 passed, 0 failed. The new dashboard test covers exclusive application segments, client-only submitted counts and empty workspaces. Existing authentication, evidence, consent, mixed 500-CV parsing, isolation and deletion tests passed.
- `npm run build`: passed after final font and layout fixes. Public pages, local Inter WOFF2, health and signed-out dashboard redirect passed final HTTP smoke checks.
- Browser: recruiter and client login; recruiter desktop/mobile metric cards and charts; bar navigation to KYC Analyst (`REQ-2402`); native homepage GET search; login/signup keyboard navigation; mobile drawer focus and Escape; 320px signup/client dashboard and 390px recruiter/client layouts without document overflow. The client portal rendered masked profiles and retained the stale-scorecard submission guard. The dashboard's visible text scan found no supporting text below 14px.
- Removed the mosaic renderer and pixel-heading components. Local Inter Variable, neutral cards and white primary actions render across home, auth and dashboard. No npm dependencies were added. The initial static Inter font was replaced with the official variable WOFF2 after browser inspection found incorrect weight rendering; final screenshots show the corrected version.
- Live Google OAuth and AI calls remain unverified because provider credentials are not configured. No production load test or live candidate-data compliance assessment was performed.

## Restore animated public design with neutral colors

Restored the prior homepage layout, pixel headings, glass panels, footer wordmark and all three animated shader phases from the saved reference. Shader output is converted to grayscale. The same neutral mosaic is available behind authentication. Public CSS is scoped to marketing/auth roots; the ShadcnStore dashboard retains its six metric/analytics cards and has no background canvas.

The production build passed. A Node self-check confirmed every displayed glyph, all three shader phases and neutral output. Browser screenshots captured different frames without interaction, confirming motion. Desktop hero and workflow transitions rendered without console warnings/errors; 320px home had no document overflow. Final search button retains its joined square corner and navigation links retain their 20px local blur. The dashboard rendered successfully after the final production restart. Backend tests and reduced-motion/context-loss emulation were not repeated for this public-frontend restoration.

Homepage color pass: restored muted blue, teal and violet in the animated shader and feature icons, with white actions and charcoal surfaces retained. Authentication receives zero color strength and stays neutral. Production build, shader-control self-check and browser rendering passed; no browser warnings/errors were reported. Backend tests were not repeated for this color-only change. Screenshot: `docs/screenshots/home-muted-colors.png`.
