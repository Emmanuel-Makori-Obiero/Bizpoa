# Bizpoa — USSD/SMS business manager

Bizpoa is a bilingual English/Kiswahili starter for small businesses. Owners register through Africa's Talking USSD, receive a unique Bizpoa ID by SMS when outbound SMS is configured, record sales and expenses, and can send code-prefixed business details back by SMS. A local admin dashboard shows registered businesses, recent transactions, and SMS notes.

This is a prototype, not production accounting software. Data is kept in a local JSON file and summaries use UTC dates. The voice demo uses Gemini to interpret owner commands, but it does not save anything until the owner confirms the proposed transaction.

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

Copy the generated value into `BIZPOA_ADMIN_TOKEN`. To enable AI voice-command review, create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey) and set it as `GEMINI_API_KEY` in `.env`. The server uses `gemini-3.8-flash` by default; you can override it with `BIZPOA_AI_MODEL`. Keep the key in the backend environment only—never paste it into frontend source code or commit it. For Africa's Talking sandbox SMS, set `AT_API_KEY` and leave `AT_ENV=sandbox` and `AT_USERNAME=sandbox`. Without a Gemini key, the dashboard works but AI command review shows a configuration message; without an AT key, outbound SMS is skipped.

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

After signing in, open the Overview and choose a registered business. Select English or Kiswahili and press **Use microphone**, or type a request in your own words. For example, say “I sold three hundred shillings of tomatoes” or “Nilinunua bidhaa za duka kwa mia tano.” Press **Review with AI** to have Gemini interpret the command. It shows a proposed sale or expense and amount, or asks for clarification if something is missing or ambiguous. Check the proposal and press **Confirm and save** to add the transaction to the local JSON database.

Speech input is transcribed by the browser when supported; the server sends the resulting text to Gemini for structured interpretation. The Gemini key stays on the server, and the AI review endpoint never writes to the ledger. The final write still passes backend validation and requires the owner's explicit confirmation. The demo write endpoint is protected by the same single admin token as the dashboard; do not use it for real accounting until per-business authentication, a persistent database, audit controls, and financial safeguards are implemented. Microphone access and language support depend on the browser; HTTPS or `localhost` may be required.

## Before production

The JSON data file and single dashboard admin token are for a prototype only. Before handling real business data, use a database, per-user access control, backups, privacy protections, appropriate time zones, and hardened authentication. Do not expose secrets to browser code. Gemini should only be connected through the backend and only execute validated business actions.
