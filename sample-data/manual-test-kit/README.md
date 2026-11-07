# Shortlist: small manual test

App: https://isocode-pied.vercel.app/login

Allow about 20 minutes. Use a fresh workspace so the counts below are easy to check. All CVs in this pack are fictional assignment samples. Do not use them as real applicants.

## Files

- `JD.txt`: Senior Java Developer, 5–8 years, Java, Spring Boot, Noida, notice up to 60 days.
- `01-upload-first/`: three CVs. Upload these together first.
- `02-duplicate-check/ritika-same-cv.docx`: the same Ritika profile in another format. Upload this later.
- `expected-candidates.csv`: reference facts to compare with the parsed profiles. This CSV is for you; the app accepts CVs as PDF or DOCX.

| Candidate | Experience | Skills | Notice | What to look for |
|---|---:|---|---:|---|
| Ritika Bansal | 6.5 years | Java, Spring Boot, microservices | 60 days | Strongest fit for this JD |
| Pooja Nair | 4 years | Java, Hibernate, REST APIs | 90 days | Experience and notice gaps; Spring Boot not stated |
| Arjun Rawat | 3 years | KYC, AML checks, Excel | 30 days | Notice fits; Java skills and experience do not |

The CVs do not state CTC, location, phone numbers or email addresses. Missing facts must stay unknown, not be invented. Imported candidate IDs may differ from the assignment IDs. Scores can vary by model; compare the evidence rather than expecting a fixed number.

## 1. Sign in and choose AI

1. Create a recruiter account with an email you control and a unique password of at least 12 characters, or sign in to an existing account. There are no seeded demo accounts in production.
2. After signup, choose OpenAI, Gemini or Groq on the provider setup page. Keep its preselected model, enter your real API key, and save. A dummy key cannot test AI scoring; these three CVs use a small amount of provider quota.
3. Confirm you reach the dashboard. The sidebar review-advice card should be absent. Collapse/expand navigation should still work.
4. If Google reports `redirect_uri_mismatch`, register `https://isocode-pied.vercel.app/api/auth/google/callback` in that OAuth client's Authorized redirect URIs. Email signup is a separate way to test the workflow.

## 2. Add a client and a job

1. Open **Trust & review → Clients & access**. Add a client named **Manual Test Client**. If signup already created a default client, you can leave it in place.
2. Open **JD scorecard → Create new**. Enter **Manual Test — Senior Java Developer**, select **Manual Test Client**, and set location to **Noida**.
3. Paste `JD.txt` into the job description and click **Extract scorecard**.
4. Check Java, Spring Boot, experience 5–8 years, notice at most 60 days, and Noida. Correct the editable scorecard if needed. CTC must not be invented because the JD does not state it.
5. Click **Save scorecard**. Select this requisition when testing subsequent screens.

## 3. Upload and score three CVs

1. Open **CV inbox** and select all three files from `01-upload-first`.
2. Enter consent source **Fictional assignment samples — manual test only**. Tick hiring-use consent and consent for the selected AI provider.
3. Click **Parse 3 CVs**. Wait for the batch to finish; allow extra time for the first serverless run. If a provider error appears, check the API key/quota and use Retry. An error is not a successful score.
4. Open **Candidate ranking**. Expect three unique candidates. Compare experience, skills and notice with the table above. All three must remain available, including low scorers; none should be automatically rejected.
5. Open Ritika's candidate review. Check each criterion's quoted evidence against the original CV. Missing location/CTC must not receive invented evidence. The score should identify the active provider/model.

## 4. Check duplicate detection and the review gate

1. Upload only `02-duplicate-check/ritika-same-cv.docx`, recording the same fictional consent.
2. Expect duplicate detection or attachment to the existing profile, not a fourth unique candidate for this requisition.
3. In **Candidate ranking**, open Ritika. Before opening the original CV, **Submit to client** must be disabled.
4. Click **Open original CV**, inspect it, return to the app and submit Ritika. Repeat the CV-open and submit steps for Pooja. Leave Arjun unsubmitted.
5. Expect Ritika and Pooja in **Submitted**; Arjun stays recruiter-only. Opening a profile drawer alone must not bypass the original-CV requirement.

## 5. Test the client portal in a separate session

1. As recruiter, open **Trust & review → Clients & access**. Select **Manual Test Client**, enter a second email you control, and click **Create invitation**. Use a different email from the recruiter.
2. Copy the private invitation link. Open it in an incognito window or a second browser and create the hiring-manager account with the invited email. Keep the recruiter session open in your first browser. The displayed link is enough for this test; no invitation email is needed.
3. In **Your shortlists**, expect only submitted Ritika and Pooja. Arjun must not be visible. The client view should use masked candidate references/job facts and must not expose original recruiter CV downloads.
4. Click **Read full evidence**. Verify supporting CV lines are readable on a narrow/mobile-width window.
5. **Shortlist** Ritika. Then use **Interview** to propose a date/time tomorrow, and save. This records a proposal; it does not send a calendar invitation.
6. **Reject** Pooja. Try saving with an empty reason: it must not save. Enter **The role requires at least 5 years; this CV states 4 years**, then save.
7. Back in the recruiter session, refresh **Hiring pipeline**. Expect Ritika in Interview with the proposed time, and Pooja in Rejected with the reason. Arjun remains searchable.
8. As recruiter, move Ritika to **Offered**, then **Joined**. Confirm the pipeline and overview counts update after refresh. These are manual decisions, not automatic AI actions.

## 6. Check review records and deletion

1. Open **Trust & review → Access log**. Look for the CV views, submissions and decisions you just made.
2. Open **Weekly rank review**. Inspect the recent sample comparing ranks with recruiter choices. Save a short review note if offered. This is an audit sample, not proof of demographic fairness.
3. Open **Consent & deletion**. Confirm the fictional consent source and selected-provider permission are recorded.
4. As the final test, delete Pooja using the confirmation dialog and the exact candidate ID shown by the app. Only delete this fictional test candidate.
5. Refresh recruiter ranking and the client's shortlist. Pooja must disappear from both. Reopening an old candidate link must not reveal the deleted profile or CV. Retained audit records must not preserve the deleted CV's personal contents.

## Optional quick checks

- Upload a CV without consent: parsing must stay disabled or be rejected.
- Try selecting `JD.txt` as a CV: only PDF/DOCX should be accepted.
- Change notice maximum from 60 to 30 in the saved scorecard. Existing scores should refresh; previously submitted profiles need recruiter review/resubmission before another client decision. Do this after the main checklist so it does not interrupt it.
- Create another client, **Other Test Client**, and invite a third distinct account. With no candidates submitted to it, its portal should be empty.
- Add a CTC criterion manually: **Maximum 18 LPA**. Since these CVs have no CTC, expect missing/unknown evidence, not a fabricated salary.

## Boundaries of this pack

This pack tests a three-candidate flow and cross-format deduplication. It does not exercise scanned-image OCR, the 500-file limit, load/concurrency, actual email delivery or a completed Google account callback. To test OCR separately, use a fictional image-only PDF; it should wait for transcript verification before scoring.

If something fails, note the screen, action, time, visible error and batch/candidate ID. Never include API keys or passwords in screenshots or bug reports.
