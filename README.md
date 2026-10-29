# Bizpoa — USSD/SMS business manager

Bizpoa is a bilingual English/Kiswahili starter for small businesses. Owners register through Africa's Talking USSD, receive a unique Bizpoa ID by SMS when outbound SMS is configured, record sales and expenses, and can send code-prefixed business details back by SMS. A local admin dashboard shows registered businesses, recent transactions, and SMS notes.

This is a prototype, not production accounting software. Business data is kept in a local JSON file and summaries use UTC dates. The dashboard includes Gemini-reviewed transaction entry and an ElevenLabs browser voice agent; neither should be used as production accounting until the storage and security architecture is upgraded.

## Run on Windows with Git Bash

Install Node.js 20 or newer and Git for Windows. In Git Bash, clone the repository and install the frontend dependency:

```bash
git clone https://github.com/Emmanuel-Makori-Obiero/Bizpoa.git
cd Bizpoa
npm install
cp .env.example .env
notepad .env
```

Set `BIZPOA_ADMIN_EMAIL` in `.env` to the one email account allowed to open the admin dashboard. The Supabase URL and publishable key in `.env.example` point at the connected Bizpoa project and are public client configuration; never use a Supabase service-role key in the browser.

Create an email/password user in the Supabase Auth section or use the sign-up form in the app, then confirm the email if Supabase requests it. Only the email matching `BIZPOA_ADMIN_EMAIL` is authorized by the Node backend. Do not share the password in chat or commit `.env`; it is ignored by Git. To enable AI transaction review, the current Node backend needs `GEMINI_API_KEY` in its own environment (for local development, `.env`; for a hosted Node backend, its server environment settings). A key stored only as a Supabase Edge Function secret is not automatically available to this Node server. For Africa's Talking sandbox SMS, set `AT_API_KEY` and leave `AT_ENV=sandbox` and `AT_USERNAME=sandbox`.

### Start the backend

Open the first Git Bash window in the `Bizpoa` folder and run:

```bash
npm run dev:backend
```

The backend listens on `http://localhost:3000`. Check it in a browser at `http://localhost:3000/health`. It stores local records in `data/bizpoa.json`.

### Start the frontend

Open a second Git Bash window, go to the same `Bizpoa` folder, and run:

```bash
npm run dev:frontend
```

Open the Vite URL printed in that terminal, normally `http://localhost:5173`. Sign in with the Supabase Auth email and password for the email configured as `BIZPOA_ADMIN_EMAIL`. The frontend sends the Supabase access token to the backend, which verifies it with Supabase before returning dashboard data.

Run automated tests from either Git Bash window in the project folder:

```bash
npm test
```

## Connect the local backend to Africa's Talking

Africa's Talking must be able to reach your computer over the public internet. In a third Git Bash window, run a tunnel such as:

```bash
ngrok http 3000
```

Copy the HTTPS forwarding address ngrok prints. In the Africa's Talking Sandbox dashboard, set the USSD callback to `https://YOUR-NGROK-ADDRESS/ussd`. Create/configure a sandbox SMS shortcode and set its incoming SMS callback to `https://YOUR-NGROK-ADDRESS/sms/incoming`. Keep the backend terminal and tunnel running while testing. Use the Sandbox simulator to dial the USSD service code; do not enter the callback URL as the dialled code.

A tunnel address can change when restarted. If it changes, update both callback URLs in the Africa's Talking dashboard. The currently running hosted test endpoint used earlier in the conversation is separate from this local Git Bash setup.

## How the product flow works

The first USSD session asks for English or Kiswahili. The main menu offers business registration, today's audit, business management, a seven-day audit, and language change. Registration collects category, business type, and business name. Bizpoa assigns each business a unique ID such as `BZ-ABC123`.

When the Africa's Talking sandbox API key is configured, Bizpoa sends the ID and SMS instructions to the phone number used for registration. The owner can send a message such as `BZ-ABC123, located near the market; opens at 7am` to the SMS shortcode. Bizpoa checks that the ID matches the sender's registered phone before linking the detail to that business, then attempts to send a receipt SMS. SMS replies are received at `/sms/incoming`.

The sandbox routes SMS through its simulator rather than an ordinary handset. Live SMS requires live Africa's Talking credentials and may incur charges. Do not switch to `AT_ENV=live` while testing.

## AI voice and call demo

The sign-in page has **Try the AI voice demo**; signed-in users can also open **AI Call** in the dashboard. This starts a live voice conversation in the browser using the Bizpoa Voice Assistant ElevenLabs agent (`agent_5301m63nex5rfxe9phm907ng2r57`). Allow microphone access and speak naturally. The agent identifies itself as AI and can discuss a sale or expense, but it is not connected to business records and cannot save transactions.

The Overview's transaction assistant remains separate: it transcribes speech in the browser, sends the text to Gemini through the Node backend, and requires the owner to review and confirm before writing a demo transaction to the local JSON database. The Gemini key must therefore be configured in that backend's environment; storing it only in Supabase does not connect it automatically.

This is a browser voice conversation, not a telephone call. ElevenLabs currently has no phone number connected to this project. To place or receive real phone calls, connect a Twilio number or SIP trunk to ElevenLabs first; only then can an outbound test be made to a specific recipient after they agree to receive it. Once the website is published, restrict the ElevenLabs agent to the site domain using its allowlist to reduce unauthorized use.

## Before production

Supabase Auth now protects the dashboard, but business records still live in a local JSON file and the conversational agent is not connected to the ledger. Before handling real business data, migrate records to Supabase with row-level security, keep the API keys in server-side secrets, add audit controls and backups, and test financial safeguards. Do not expose service-role, Gemini, or ElevenLabs keys to browser code.
