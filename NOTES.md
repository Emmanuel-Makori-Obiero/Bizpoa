# Bizpoa project notes

Bizpoa is a prototype business manager for small-scale businesses, with Africa's Talking USSD/SMS and a local web dashboard.

Current features:
- English/Kiswahili language choice persisted by sender phone number.
- USSD registration with category, subtype, business name, and a distinct generated Bizpoa ID.
- Business management menu for recording sales/expenses and viewing daily or rolling seven-day audits.
- Sandbox-first SMS sender that sends a registered business ID and instructions when `AT_API_KEY` is configured.
- Incoming SMS detail capture using `BZ-CODE, details`; the sender's number must match the registered business.
- Vite admin dashboard for business profiles, transactions, and SMS details; `/api/dashboard` requires `BIZPOA_ADMIN_TOKEN`.
- Root npm scripts start backend and frontend separately for Git Bash development.

Data currently lives in `data/bizpoa.json`. Gemini is not connected yet. This is not production-ready; replace JSON storage and strengthen account/data security before handling live customer data.
