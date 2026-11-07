# Submission verification — 7 November 2026

Live app: https://isocode-pied.vercel.app

This record supersedes the earlier local-only hosting notes. It distinguishes synthetic integration checks from actual hosted-service evidence.

## Automated and compiled checks

- `npm.cmd test` with an isolated PostgreSQL 18 database: **63 passed, zero failures, zero skips**.
- `npm.cmd run build`: passed.
- `npm.cmd run test:runtime`: 18 checks passed with a completed compiled local Workflow.
- A duplicate-Blob deletion regression failed before the fix and passed afterward. Candidate deletion now erases retained upload-manifest paths before removing their metadata.
- Browser navigation check on the production build: section changes, requisition selection, Back/Forward, new-requisition query state and direct refresh passed. Internal changes made zero document requests, zero dashboard RSC requests and zero repeated `/api/config` or `/api/auth/me` requests.

The 500-file, replay/concurrency and malformed/scan fixtures use isolated databases plus controlled storage/provider responses. They are not a benchmark for 70 simultaneous users or proof of paid-provider quality.

## Hosted checks using fictional fixtures

An isolated reviewer workspace was created through the public application APIs. Its recruiter and client email/password logins were tested. Three assignment profiles were uploaded as PDF/DOCX through actual private Blob tokens and processed by hosted Vercel Workflows. Their parsed facts and visible score state were checked.

Verified behavior includes cross-format duplicate detection, private PDF/DOCX downloads, submission blocked before original-CV view, two masked client submissions with an unsubmitted third candidate hidden, denied original downloads for clients, mandatory rejection reasons, shortlist/interview proposals, pipeline changes through Offered and Joined, consent/access records, weekly review samples and cross-workspace denial. Candidate erasure was tested against API access and private object availability, then fictional profiles were restored for the reviewer.

Preloaded scores are explicitly **demo rules**, not claimed live model output. The reviewer supplies their own AI key for live extraction/scoring. Hosted reviewer credentials are included only in the private submission's `deployment.md`.

## Repository and remaining limits

The repository is public and retains its commit history. Configured-secret matching and high-confidence key-pattern checks found no matches in the scanned Git history and tracked ZIP contents; no private environment/key file was found in those archives. This bounded check is not a security certification.

Unverified: completed Google account callback, paid AI request quality/billing, representative scanned-CV OCR, outbound reset-email delivery, 70-recruiter load, disaster recovery and business outcome improvements. Invitation mailing and calendar delivery remain mocked. Consent/deletion controls do not constitute legal compliance certification. A fresh client-mobile browser pass was not part of final packaging.
