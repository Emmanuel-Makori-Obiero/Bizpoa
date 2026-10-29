# Bizpoa project notes

Bizpoa is a bilingual English/Kiswahili prototype business manager using Africa's Talking USSD/SMS, a Node backend, and a Vite website.

Current capabilities:
- USSD registration assigns a distinct `BZ-XXXXXX` Bizpoa ID and explains how to text Bizpoa at shortcode **62073** from the registered phone.
- USSD `0` backs up one step and `00` returns home. Business management requires the caller's Bizpoa ID to match the registered phone before recording a sale or expense.
- Audits accept a chosen period from 1 to 365 days. Owners can receive an SMS summary or a signed, 24-hour CSV link when statement settings are configured.
- Every registered owner has a private dashboard entry point. Access requires the Bizpoa ID, registered phone, and a one-time SMS code; sessions are signed server-side and limited to one business.
- The owner dashboard offers a custom audit period, filtered ledger, CSV download, statement by SMS, owner SMS notes, and Gemini summaries.
- Incoming SMS details are matched against the business ID and registered sender. Gemini summarizes safe, text-only business messages and drafts a reply; AI is not allowed to create or edit ledger transactions. A generic receipt reply is used if Gemini is unavailable.
- A separate Supabase Auth allowlist protects the admin dashboard. The web voice-call demo uses ElevenLabs agent `agent_5301m63nex5rfxe9phm907ng2r57`; it is browser-only and not connected to phone calls or business records.
- Root npm scripts run the frontend and backend separately; tests include owner-auth and HTTP business-isolation checks.

Configuration required for a deployed owner portal: `BIZPOA_OWNER_SESSION_SECRET` and `BIZPOA_STATEMENT_SECRET` (random secrets, 32+ characters), `BIZPOA_PUBLIC_URL` (public HTTPS Node backend origin), Africa's Talking SMS credentials, and a backend `GEMINI_API_KEY` for AI summaries. A Gemini key saved only as a Supabase Edge Function secret is not automatically available to this Node backend. The current store is `data/bizpoa.json`; this prototype is not production-ready and needs durable database storage, row-level security, backups, and audit controls before handling real financial records.
