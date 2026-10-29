# Bizpoa project notes

Bizpoa is a prototype business manager for small-scale businesses, with Africa's Talking USSD/SMS and a local web dashboard.

Current features:
- English/Kiswahili language choice persisted by sender phone number.
- USSD registration with category, subtype, business name, and a distinct generated Bizpoa ID.
- Business management menu for recording sales/expenses and viewing daily or rolling seven-day audits.
- Sandbox-first SMS sender that sends a registered business ID and instructions when `AT_API_KEY` is configured.
- Incoming SMS detail capture using `BZ-CODE, details`; the sender's number must match the registered business.
- Vite admin dashboard for business profiles, transactions, and SMS details; dashboard access uses Supabase email/password Auth and a backend `BIZPOA_ADMIN_EMAIL` allowlist.
- ElevenLabs browser voice demo uses agent `agent_5301m63nex5rfxe9phm907ng2r57`; it is conversational only and does not place phone calls or write to the ledger.
- Root npm scripts start backend and frontend separately for Git Bash development.

Business data currently lives in `data/bizpoa.json`; the connected Supabase project is used for Auth but has no application tables yet. The transaction-review endpoint still needs `GEMINI_API_KEY` in the Node backend environment; a Supabase Edge Function secret is not automatically available to Node. This is not production-ready; migrate JSON storage to Supabase with row-level security, configure secure server-side secrets, and connect a Twilio/SIP number before testing real phone calls.
