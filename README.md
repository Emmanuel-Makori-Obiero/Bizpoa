# Bizpoa — USSD/SMS business manager

Bizpoa is a bilingual English/Kiswahili starter for small businesses. Owners can register over Africa's Talking USSD, record sales and expenses, receive a unique Bizpoa ID, use a private web dashboard for their own business, and exchange business information with the Bizpoa SMS assistant at **62073**. An admin dashboard remains available separately.

Production storage is Supabase Postgres. The Bizpoa tables use row-level security and deny direct browser access; the backend uses a server-only Supabase secret key and applies owner scoping before returning dashboard or statement data. This remains a prototype rather than production accounting software: add backups, audit controls, and operational monitoring before using it for real financial records.

## Run locally on Windows with Git Bash

Install Node.js 20 or newer and Git for Windows. Clone the repository, install dependencies, and create a local environment file:

```bash
git clone https://github.com/Emmanuel-Makori-Obiero/Bizpoa.git
cd Bizpoa
npm install
cp .env.example .env
notepad .env
```

The frontend uses the Supabase project URL and publishable key for Supabase Auth. Those are public client settings. The backend uses `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`) for private database RPCs. Store that server-only key only in a backend environment; never use it in a `VITE_` variable, browser code, or committed `.env` file.

`.env.example` sets `BIZPOA_STORAGE_DRIVER=json` for local testing, so no database secret is needed to start the demo flow. To use Supabase locally, set `BIZPOA_STORAGE_DRIVER=supabase`, provide `SUPABASE_URL` and the server-only key, and ensure the Bizpoa migration has been applied. In production, the backend defaults to Supabase storage.

Also configure these backend values as needed:

- `BIZPOA_ADMIN_EMAIL`: the one Supabase Auth email permitted to access the admin dashboard.
- `BIZPOA_OWNER_SESSION_SECRET`: a randomly generated secret of at least 32 characters for signed business-owner sessions.
- `BIZPOA_STATEMENT_SECRET`: a separate random secret of at least 32 characters for expiring CSV statement links.
- `BIZPOA_PUBLIC_URL`: the public HTTPS origin of the deployed site/backend, with no route suffix, such as `https://bizpoa.example`.
- `SUPABASE_PUBLISHABLE_KEY`: the public Supabase key used by the backend to verify admin access tokens. This is separate from the server-only database secret.
- `AT_API_KEY`, `AT_USERNAME`, and `AT_ENV`: Africa's Talking SMS configuration. Keep `AT_ENV=sandbox` while testing. Live SMS can incur charges; use the provider's configured service shortcode, including **62073** where provisioned.
- `GEMINI_API_KEY`: enables the natural-language SMS assistant and admin transaction-review feature. It must be available to the backend; a key stored only as a Supabase Edge Function secret is not automatically available to Node.
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`: optional public frontend build-time overrides; the current project values are already used as defaults.

The database migration is in `supabase/migrations/20261029_bizpoa_storage.sql`. It creates relational tables for businesses, transactions, SMS notes, language preferences, USSD sessions, and owner OTP state. It also creates private `bizpoa_read_state` and `bizpoa_apply_state_delta` functions. The latter uses a database revision check so concurrent backend instances do not overwrite newer writes. Only `service_role` can execute these functions; anonymous and authenticated browser roles cannot.

The connected Supabase project initially had no Bizpoa tables or application records, and no local `data/bizpoa.json` file was present, so there was no existing record set to import. New registrations and transactions are stored in Supabase when the backend runs with the `supabase` storage driver.

Create/confirm the admin email/password user in Supabase Auth. Only the email matching `BIZPOA_ADMIN_EMAIL` can use the admin dashboard.

### Start the local backend

In the first Git Bash window, from the repository folder, run:

```bash
npm run dev:backend
```

The local Node server listens at `http://localhost:3000`; check `http://localhost:3000/health`. With the example local setting, records are stored in `data/bizpoa.json`. When using Supabase locally, `/health` checks the database RPC connection and reports unavailable storage if it cannot connect.

### Start the frontend

In a second Git Bash window, run:

```bash
npm run dev:frontend
```

Open the Vite URL printed in the terminal, normally `http://localhost:5173`. The admin signs in with the configured Supabase email/password. Each registered business owner selects **Business owner? Open your dashboard**, enters their Bizpoa ID and registered phone, and verifies the one-time code sent by SMS. Owner dashboards require the backend signing secret and working outbound SMS; a sandbox SMS account may not deliver codes to ordinary handsets.

Run all tests with `npm test` and build the frontend with `npm run build:frontend`.

## Vercel serverless deployment

The repository now includes `vercel.json` and one shared Node.js Function at `api/[...path].js`. Vercel builds the frontend with `npm run build:frontend` and serves `frontend/dist`; `/api/*` requests reach the shared handler. The rewrites send `/health`, `/ussd`, `/sms/incoming`, and `/statement/*` to the same function while preserving those public URLs.

“Serverless” means Vercel runs the backend code on HTTP requests rather than keeping a Node server listening continuously. Bizpoa still uses JavaScript/Node as the Vercel Function runtime; the local `src/server.js` listener is retained only for local development. Supabase remains the database, not the public webhook server. The Vercel handler uses `waitUntil` so SMS processing and reply sending can finish after the webhook's quick acknowledgement.

To deploy, import this repository into Vercel and keep the **Project Root Directory** at the repository root. The build command and output directory are already declared in `vercel.json`. Add environment variables in Vercel Project Settings for the environments you will use (Preview and Production as appropriate):

- Backend: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `BIZPOA_STORAGE_DRIVER=supabase`, `BIZPOA_ADMIN_EMAIL`, `BIZPOA_OWNER_SESSION_SECRET`, `BIZPOA_STATEMENT_SECRET`, `BIZPOA_PUBLIC_URL`, `GEMINI_API_KEY`, `AT_API_KEY`, `AT_USERNAME`, and `AT_ENV=sandbox` while testing.
- Frontend build: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. These are public values; do not put the Supabase secret key in a `VITE_` variable.

Set `BIZPOA_PUBLIC_URL` to the Vercel HTTPS origin after it is assigned, then configure Africa's Talking callbacks to `https://YOUR-VERCEL-DOMAIN/ussd` and `https://YOUR-VERCEL-DOMAIN/sms/incoming`. Redeploy after changing environment variables; frontend `VITE_` values are embedded at build time. Use sandbox credentials and the provider simulator before enabling live SMS/USSD.

For an end-to-end local Vercel runtime check, run `npx vercel login`, `npx vercel link`, then `npx vercel dev`. The repository tests also exercise the shared function handler and parsed webhook bodies. A code/config change does not deploy by itself: Vercel must be connected to this repository or you must run a deployment command from an authenticated Vercel CLI.

If browser sign-in shows **Failed to fetch**, confirm the production build has the right `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then redeploy because `VITE_` values are embedded when Vite builds. The backend separately needs `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `BIZPOA_ADMIN_EMAIL` to verify the session and load `/api/dashboard`. Do not put `SUPABASE_SECRET_KEY` in the frontend. In the browser Network panel, a failed request to `/auth/v1/token` points to frontend/Auth reachability or configuration; a failure at `/api/dashboard` points to the Vercel function or its backend environment instead.

## Africa's Talking callbacks and shortcode

For local USSD/SMS webhooks, the backend must be reachable from Africa's Talking. A tunnel such as `ngrok http 3000` can provide a temporary HTTPS address. Set the USSD callback to `https://YOUR-PUBLIC-HOST/ussd` and the incoming SMS callback to `https://YOUR-PUBLIC-HOST/sms/incoming`.

The phone owner should send SMS to Bizpoa shortcode **62073** when that shortcode is provisioned for the service. Use the Sandbox simulator for sandbox tests; live SMS and USSD require live provider credentials/configuration and may incur charges. A tunnel URL can change after restart, so update the callbacks when it does.

## Product flows

The USSD flow offers registration, business management, a flexible audit/statement, and language selection. Entering `0` goes back one step; `00` returns to the Bizpoa home menu. **Manage business** asks for the Bizpoa ID and checks it against the calling phone before allowing sales or expenses to be recorded.

An owner can select any audit period from **1 to 365 days**. They can request a concise statement by SMS or, when `BIZPOA_PUBLIC_URL` and `BIZPOA_STATEMENT_SECRET` are valid, a CSV ledger link by SMS. CSV links are signed, expire after 24 hours, and download only that business's records. The website dashboard also offers a date range, CSV download, and SMS statement action.

After registering, the owner receives their Bizpoa ID and instructions to text a message such as `BZ-ABC123, near the market; opens at 7am` to **62073** from the registered phone. Bizpoa links a registered sender to their business, and if an ID is included, checks that it matches that phone. The message is stored with the business and Gemini can summarize it and draft a short reply. Unregistered or unlinked senders receive safe setup instructions and their text is not stored. The dashboard displays verified owner messages and AI summaries. This assistant does not create or edit transactions; if Gemini is unavailable, a simple acknowledgement is sent instead. SMS delivery requires the inbound callback URL and Africa's Talking API key/username to be configured.

## Voice and AI demo

The sign-in page has **Try the AI voice demo**; the admin dashboard also has an **AI Call** view. These use the Bizpoa ElevenLabs conversational agent (`agent_5301m63nex5rfxe9phm907ng2r57`) for a browser microphone conversation. It identifies itself as AI and is not connected to business records or a phone number.

The admin Overview's separate transaction assistant transcribes speech in the browser, asks Gemini to review the command, shows an editable proposal, and requires explicit confirmation before recording a transaction in the configured backend store.

Admins can open **Data & settings** and clear all Bizpoa operational records. The action requires re-entering the admin password, typing `CLEAR ALL BIZPOA DATA`, and confirming the browser prompt. It clears businesses, transactions, SMS details, language preferences, USSD sessions, and owner OTP state; it does not delete the Supabase Auth admin account or project configuration. Make an external backup first because the reset cannot be undone from the dashboard.

This is a browser conversation, not a telephone call. To place real calls, connect a Twilio number or SIP trunk to ElevenLabs and configure access restrictions for the published website.
