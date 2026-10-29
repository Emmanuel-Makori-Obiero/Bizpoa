# Bizpoa — USSD/SMS business manager

Bizpoa is a bilingual English/Kiswahili starter for small businesses. Owners register through Africa's Talking USSD, receive a unique Bizpoa ID by SMS when outbound SMS is configured, record sales and expenses, and can send code-prefixed business details back by SMS. A local admin dashboard shows registered businesses, recent transactions, and SMS notes.

This is a prototype, not production accounting software. Data is kept in a local JSON file, summaries use UTC dates, and Gemini/AI is not integrated yet.

## Run on Windows with Git Bash

Install Node.js 20 or newer and Git for Windows. In Git Bash, clone the repository and install the frontend dependency:

```bash
git clone https://github.com/Emmanuel-Makori-Obiero/Bizpoa.git
cd Bizpoa
npm install
cp .env.example .env
notepad .env
```

In `.env`, set a private dashboard token. You can generate a random token from Git Bash:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the generated value into `BIZPOA_ADMIN_TOKEN`. For Africa's Talking sandbox SMS, also set `AT_API_KEY` to the sandbox API key and leave `AT_ENV=sandbox` and `AT_USERNAME=sandbox`. Do not paste secrets into source code or commit `.env`; it is ignored by Git. You can start the dashboard without an AT key, but outbound SMS will be skipped.

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

Open the Vite URL printed in that terminal, normally `http://localhost:5173`. Enter the value of `BIZPOA_ADMIN_TOKEN` from `.env`. The frontend proxies dashboard requests to the backend. The dashboard token is held in the current browser tab, not included in frontend source.

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

## Try the voice transaction demo

After signing in, open the Overview and choose a registered business. Type a command or select English/Kiswahili and press **Use microphone**. Example commands include `sale 300`, `expense 50`, `mauzo 300`, and `matumizi 50`. Review the transcript and proposed amount, then select **Confirm and save** to add the transaction to the local JSON database.

This is a deliberately small prototype: it uses browser-provided speech recognition when supported, falls back to typed commands, recognizes only simple sale/expense commands with numeric amounts, and speaks a short confirmation when browser speech synthesis is available. It does not use ElevenLabs or an AI model. The demo write endpoint is protected by the same single admin token as the dashboard; do not expose it publicly or use it for real accounting until per-business authentication, a proper database, audit controls, and financial safeguards are implemented. Microphone access and language support depend on the browser; HTTPS or `localhost` may be required.

## Before production

The JSON data file and single dashboard admin token are for a prototype only. Before handling real business data, use a database, per-user access control, backups, privacy protections, appropriate time zones, and hardened authentication. Do not expose secrets to browser code. Gemini should only be connected through the backend and only execute validated business actions.
