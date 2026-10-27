const SANDBOX_SMS_ENDPOINT = 'https://api.sandbox.africastalking.com/version1/messaging';
const LIVE_SMS_ENDPOINT = 'https://api.africastalking.com/version1/messaging';

export async function sendSms({ to, message }, options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = env.AT_API_KEY;
  if (!apiKey) return { sent: false, reason: 'missing_api_key' };
  if (!to || !message) return { sent: false, reason: 'missing_recipient_or_message' };

  const live = env.AT_ENV === 'live';
  const username = env.AT_USERNAME || (live ? '' : 'sandbox');
  if (!username) return { sent: false, reason: 'missing_username' };

  const body = new URLSearchParams({ username, to, message });
  if (env.AT_SMS_FROM) body.set('from', env.AT_SMS_FROM);

  try {
    const response = await fetchImpl(live ? LIVE_SMS_ENDPOINT : SANDBOX_SMS_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        apiKey,
      },
      body,
      signal: AbortSignal.timeout(7000),
    });
    const responseText = await response.text();
    if (!response.ok) return { sent: false, reason: `http_${response.status}`, responseText };

    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      return { sent: false, reason: 'invalid_gateway_response' };
    }
    const recipients = result.SMSMessageData?.Recipients ?? [];
    const recipient = recipients.find((entry) => entry.number === to) ?? recipients[0];
    const statusCode = Number(recipient?.statusCode);
    return {
      sent: statusCode === 100 || statusCode === 101 || statusCode === 102,
      status: recipient?.status ?? null,
      statusCode: Number.isFinite(statusCode) ? statusCode : null,
      messageId: recipient?.messageId ?? null,
      providerMessage: result.SMSMessageData?.Message ?? null,
    };
  } catch (error) {
    return { sent: false, reason: error.name === 'TimeoutError' ? 'timeout' : 'network_error' };
  }
}

export function registrationSms(code) {
  return `Bizpoa: Your business ID is ${code}. Reply by SMS: ${code}, followed by your details (example: ${code}, near the market). Tuma maelezo kwa SMS ukianza na ${code}.`;
}

export function detailsSavedSms(code) {
  return `Bizpoa: Details received for ${code}. Asante!`;
}
