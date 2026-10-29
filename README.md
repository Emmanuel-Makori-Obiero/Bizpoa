# Bizpoa — USSD/SMS business manager

Bizpoa is a bilingual English/Kiswahili starter for small businesses. Owners can register over Africa's Talking USSD, record sales and expenses, receive a unique Bizpoa ID, use a private web dashboard for their own business, and exchange business information with the Bizpoa SMS assistant at **62073**. An admin dashboard remains available separately.

This is a prototype, not production accounting software. Business data is still stored in a local JSON file and date summaries use UTC. Before real financial use, move the records to a database with row-level security, add backups and audit controls, and deploy the Node backend with persistent storage.

## Run locally on Windows with Git Bash

Install Node.js 20 or newer and Git for Windows. Clone the repository, install dependencies, and create a local environment file:

```bash
git clone https://github.com/Emmanuel-Makori-Obiero/Bizpoa.git
cd Bizpoa
npm install
cp .env.example .env
notepad .env
```

Configure these values in `.env` or in the hosted Node backend's secret settings:

- `BIZPOA_ADMIN_EMAIL`: the one Supabase Auth email permitted to access the admin dashboard.
- `BIZPOA_OWNER_SESSION_SECRET`: a randomly generated secret of at least 32 characters. It signs business-owner sessions; keep it only on the backend.
- `BIZPOA_STATEMENT_SECRET`: a separate random secret of at least 32 characters for expiring CSV statement links.
- `BIZPOA_PUBLIC_URL`: the public HTTPS origin of the Node backend, with no route suffix, such as `https://api.example.com`. It must be reachable by owners who receive CSV links.
- `AT_API_KEY`, `AT_USERNAME`, and `AT_ENV`: Africa's Talking SMS configuration. Keep `AT_ENV=sandbox` while testing. Live SMS can incur charges; use the provider's configured service number/shortcode, including **62073** where provisioned.
- `GEMINI_API_KEY`: enables the natural-language SMS assistant and the admin transaction-review feature. It must be available to the Node backend; a key stored only as a Supabase Edge Function secret is not automatically available to Node.

The Supabase URL and publishable key in `.env.example` are public client configuration. Never put a Supabase service-role key, Gemini key, Africa's Talking key, or signing secret in browser code or commit `.env`.

Create/confirm the admin email/password user in Supabase Auth. Only the email matching `BIZPOA_ADMIN_EMAIL` can use the admin dashboard.

### Start the backend

In the first Git Bash window, from the `Bizpoa` folder, run:

```bash
npm run dev:backend
```

The Node backend listens at `http://localhost:3000`; check `http://localhost:3000/health`. Local data is stored at `data/bizpoa.json`.

### Start the frontend

In a second Git Bash window, run:

```bash
npm run dev:frontend
```

Open the Vite URL printed in the terminal, normally `http://localhost:5173`. The admin signs in with the configured Supabase email/password. Each registered business owner selects **Business owner? Open your dashboard**, enters their Bizpoa ID and registered phone, and verifies the one-time code sent by SMS. Owner dashboards require the backend signing secret and working outbound SMS; a sandbox SMS account may not deliver codes to ordinary handsets.

Run all tests with:

```bash
npm test
```

Build the frontend with:

```bash
npm run build:frontend
```

## Africa's Talking callbacks and shortcode

For USSD/SMS webhooks, the Node backend must be reachable from Africa's Talking. During local testing, a tunnel such as `ngrok http 3000` can provide a temporary HTTPS address. In the Africa's Talking configuration, set:

- USSD callback: `https://YOUR-PUBLIC-HOST/ussd`
- Incoming SMS callback: `https://YOUR-PUBLIC-HOST/sms/incoming`

The phone owner should send SMS to the Bizpoa shortcode **62073** when that shortcode is provisioned for the service. Use the Sandbox simulator for sandbox tests; live SMS and USSD require live provider credentials/configuration and may incur charges. A tunnel URL can change after restart, so update the callbacks when it does.

## Product flows

The USSD flow offers registration, business management, a flexible audit/statement, and language selection. Entering `0` goes back one step; `00` returns to the Bizpoa home menu. **Manage business** asks for the Bizpoa ID and checks it against the calling phone before allowing sales or expenses to be recorded.

An owner can select any audit period from **1 to 365 days**. They can request a concise statement by SMS or, when `BIZPOA_PUBLIC_URL` and `BIZPOA_STATEMENT_SECRET` are valid, a CSV ledger link by SMS. CSV links are signed, expire after 24 hours, and download only that business's records. The website dashboard also offers a date range, CSV download, and SMS statement action.

After registering, the owner receives their Bizpoa ID and instructions to text a message such as `BZ-ABC123, near the market; opens at 7am` to **62073** from the registered phone. Bizpoa verifies that the ID and sender match, stores the message with the business, and asks Gemini to summarize it and draft a short reply. The dashboard displays the message and AI summary; Bizpoa replies by SMS when the SMS gateway is configured. This text assistant does not create or edit transactions. If Gemini is unavailable, Bizpoa uses a simple receipt reply.

## Voice and AI demo

The sign-in page has **Try the AI voice demo**; the admin dashboard also has an **AI Call** view. These use the Bizpoa ElevenLabs conversational agent (`agent_5301m63nex5rfxe9phm907ng2r57`) for a browser microphone conversation. It identifies itself as AI and is not connected to business records or a phone number.

The admin Overview's separate transaction assistant transcribes speech in the browser, asks Gemini to review the command, shows an editable proposal, and requires explicit confirmation before recording a demo transaction in the local JSON store. Do not treat it as production accounting.

This is a browser conversation, not a telephone call. To place real calls, connect a Twilio number or SIP trunk to ElevenLabs and configure access restrictions for the published website.

## Before production

Supabase Auth protects the admin, and SMS OTP protects the individual owner dashboards, but application records are still local JSON. Deploying multiple Node instances or an ephemeral filesystem will break consistency and lose data. Migrate to Supabase or another persistent database with per-business row-level security, store all provider/signing secrets server-side, configure backups and audit trails, and test SMS delivery and financial safeguards before using real business records.
