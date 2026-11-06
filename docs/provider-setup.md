# Provider setup — 6 November 2026

Recruiter email login, signup and Google login now lead to `/setup/provider` before the dashboard. The setup page shares the dashboard's dark neutral palette, Inter typography, inputs and buttons. Client hiring managers continue to the dashboard without being asked for an AI key.

Choose OpenAI, Gemini or Groq and use the prefilled model or enter another compatible model. Paste an API key, then select **Save & open dashboard**. A small JSON request checks a new key and model before saving; it contains no candidate data. Failed checks leave the previous credentials and selection intact. A configured server fallback key can also be used. Recruiters with no configured provider are redirected back to setup by server middleware, including when opening a dashboard URL directly.

| Provider | Default | Use |
| --- | --- | --- |
| OpenAI | `gpt-4.1-mini` | CV facts, evidence scoring and PDF transcription |
| Gemini | `gemini-2.5-flash` | Document extraction, evidence scoring and PDF transcription |
| Groq | `openai/gpt-oss-120b` | Text extraction and scoring; scans need a verified transcript |

These are starting choices, not a comparative benchmark. Sources checked: [OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [Gemini model documentation](https://ai.google.dev/gemini-api/docs/models?hl=en), [Groq production model catalog](https://console.groq.com/docs/models). Groq's catalog lists Llama 3.3 70B as enterprise-only, so new selections default to GPT OSS 120B instead. Existing saved selections are preserved.

## Credential handling

- Keys are isolated by workspace and provider, encrypted using AES-256-GCM with a fresh nonce and workspace/provider authenticated data.
- Ciphertext is saved in the configured database's `ai_credentials` table. Local SQLite operation uses the ignored `data/credentials.key`; Vercel uses the stable server-only `CREDENTIALS_ENCRYPTION_KEY` environment variable. A missing master key causes reads to fail rather than silently switching providers. See [Vercel deployment](vercel-deployment.md).
- Plaintext keys are not returned by settings/config APIs or written to score metadata, audit records or the ordinary settings table. The password input is cleared on success; no browser storage is used.
- Each workspace's own key overrides the environment fallback for that provider. Provider changes remain blocked during active parsing/scoring. Consent remains bound to the selected provider.
- HTTPS and restricted server filesystem access are required for hosted use. Filesystem administrators with both database and master key can decrypt saved keys.

## Verification

Run `node --test --test-concurrency=1 tests/*.test.js` and `npm run build`.

Regression tests cover all three provider key-validation requests, failed-key preservation, workspace isolation, recruiter/client routing, ciphertext storage, database reopen, ciphertext transplant refusal, missing-master-key refusal, actual JD extraction and worker scoring with the workspace key, and absence of key material in API responses and persisted scores/audits/settings.

Browser checks cover recruiter login to setup, automatic model changes, disabled submit without a key, a password-type key field, and a 390px responsive layout without horizontal overflow. A successful save-to-dashboard transition is covered by HTTP integration tests using mocked providers. Real provider billing, key acceptance and OCR accuracy require a user's valid provider credentials and have not been claimed as live-verified.

Raw local logs: `data/provider-final-tests.log` and `data/provider-build.log`. Test fixtures use temporary databases; no real API keys were inserted into the running demo database.
