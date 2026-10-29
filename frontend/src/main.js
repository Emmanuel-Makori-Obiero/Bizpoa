import './style.css';
import { supabase } from './supabase.js';
import { BIZPOA_VOICE_AGENT_ID } from './voice-agent.js';

const root = document.querySelector('#app');
const state = {
  session: null,
  authMode: 'sign-in',
  view: 'overview',
  data: null,
  loading: false,
  error: '',
  voiceLanguage: 'en',
  selectedBusinessCode: '',
  voiceCommand: '',
  pendingVoice: null,
  voiceReview: null,
  voiceReviewing: false,
  voiceError: '',
  voiceSuccess: '',
};

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

function money(value) {
  return new Intl.NumberFormat('en-KE', { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function dateLabel(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? escapeHtml(value) : new Intl.DateTimeFormat('en', {
    day: 'numeric', month: 'short', year: 'numeric',
  }).format(date);
}

function maskPhone(value = '') {
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 6) return 'Owner phone';
  return `+${digits.slice(0, 3)} ••• ••${digits.slice(-2)}`;
}

function showLogin(message = '') {
  const creatingAccount = state.authMode === 'sign-up';
  root.innerHTML = `
    <main class="login-wrap">
      <section class="login-card">
        <div class="brand-mark">B<span>.</span></div>
        <p class="eyebrow">SMALL BUSINESS MANAGER</p>
        <h1>Your business,<br><em>at a glance.</em></h1>
        <p class="login-copy">${creatingAccount ? 'Create your Bizpoa admin account with an email and password.' : 'Sign in with your Bizpoa admin email and password.'} Passwords are securely handled by Supabase Auth.</p>
        <form id="auth-form" class="login-form">
          <label for="auth-email">Email address</label>
          <input id="auth-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required />
          <div class="password-field"><label for="auth-password">Password</label><div class="password-input-wrap">
            <input id="auth-password" name="password" type="password" minlength="8" autocomplete="${creatingAccount ? 'new-password' : 'current-password'}" placeholder="${creatingAccount ? 'Choose at least 8 characters' : 'Enter your password'}" required />
            <button id="toggle-password-visibility" class="password-toggle" type="button" aria-controls="auth-password" aria-pressed="false" aria-label="Show password">Show</button>
          </div></div>
          <button class="button button-primary" type="submit">${creatingAccount ? 'Create account' : 'Sign in'} <span aria-hidden="true">→</span></button>
        </form>
        <p class="login-error" role="alert">${escapeHtml(message)}</p>
        <button id="toggle-auth-mode" class="text-link auth-mode-toggle" type="button">${creatingAccount ? 'Already have an account? Sign in' : 'Need an account? Create one'}</button>
        <button id="open-public-voice-demo" class="button button-outline login-voice-demo" type="button">Try the AI voice demo <span aria-hidden="true">↗</span></button>
        <p class="login-footnote">Only the admin email configured for this Bizpoa backend can open the dashboard. Never share your password.</p>
      </section>
      <aside class="login-aside">
        <div class="sun-disc"></div>
        <div class="aside-caption"><span>01 / EVERYDAY CLARITY</span><p>Simple records.<br />Better decisions.</p></div>
        <div class="aside-lines"><i></i><i></i><i></i><i></i><i></i></div>
      </aside>
    </main>`;

  root.querySelector('#toggle-password-visibility').addEventListener('click', (event) => {
    const input = root.querySelector('#auth-password');
    const button = event.currentTarget;
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    button.textContent = reveal ? 'Hide' : 'Show';
    button.setAttribute('aria-pressed', String(reveal));
    button.setAttribute('aria-label', `${reveal ? 'Hide' : 'Show'} password`);
  });

  root.querySelector('#toggle-auth-mode').addEventListener('click', () => {
    state.authMode = creatingAccount ? 'sign-in' : 'sign-up';
    showLogin();
  });
  root.querySelector('#open-public-voice-demo').addEventListener('click', showPublicVoiceDemo);
  root.querySelector('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '');
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = creatingAccount ? 'Creating account…' : 'Signing in…';
    try {
      const result = creatingAccount
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (creatingAccount && !result.data.session) {
        state.authMode = 'sign-in';
        showLogin('Check your email for the Supabase confirmation link, then sign in.');
        return;
      }
      state.session = result.data.session;
      await loadDashboard(true);
    } catch (error) {
      showLogin(error.message || 'Sign-in failed. Check your email and password and try again.');
    }
  });
}

function showPublicVoiceDemo() {
  root.innerHTML = `
    <main class="public-voice-wrap">
      <section class="public-voice-card">
        <button id="back-to-login" class="text-link" type="button">← Back to sign in</button>
        <p class="eyebrow">BIZPOA AI VOICE DEMO</p>
        <h1>Talk to Bizpoa.</h1>
        <p class="public-voice-copy">Start a live browser voice conversation with Bizpoa’s AI assistant. It can discuss a sale or expense, but this demo is not connected to business records and will not save transactions.</p>
        <div class="public-voice-widget"><elevenlabs-convai agent-id="${BIZPOA_VOICE_AGENT_ID}" variant="expanded" start-call-text="Start voice conversation" end-call-text="End conversation" action-text="Talk to Bizpoa"></elevenlabs-convai></div>
        <p class="voice-note">Allow microphone access when prompted. This is a website voice conversation, not a telephone call. The assistant will identify itself as AI.</p>
      </section>
    </main>`;
  root.querySelector('#back-to-login').addEventListener('click', () => showLogin());
}

const views = [
  { id: 'overview', label: 'Overview', mark: 'O' },
  { id: 'businesses', label: 'Businesses', mark: 'B' },
  { id: 'transactions', label: 'Transactions', mark: 'T' },
  { id: 'sms', label: 'SMS details', mark: 'S' },
  { id: 'voice', label: 'AI Call', mark: 'C' },
];

function shell() {
  const current = views.find((item) => item.id === state.view) ?? views[0];
  root.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <a class="wordmark" href="#overview" aria-label="Bizpoa home"><span class="brand-mark small">B<span>.</span></span><span>bizpoa</span></a>
        <div class="sidebar-label">WORKSPACE</div>
        <nav class="side-nav" aria-label="Dashboard sections">
          ${views.map((view) => `<button class="nav-item ${state.view === view.id ? 'active' : ''}" data-view="${view.id}"><span class="nav-mark">${view.mark}</span><span>${view.label}</span>${view.id === 'sms' && state.data?.smsNotes?.length ? `<small>${state.data.smsNotes.length}</small>` : ''}</button>`).join('')}
        </nav>
        <div class="sidebar-spacer"></div>
        <div class="sidebar-help"><span class="help-dot"></span><div><strong>USSD connected</strong><small>Records sync from your backend</small></div></div>
        <div class="sidebar-user"><div class="avatar">BP</div><div><strong>Bizpoa admin</strong><small>${escapeHtml(state.session?.user?.email || 'Signed in')}</small></div><button id="sign-out" class="icon-button" aria-label="Sign out" title="Sign out">↗</button></div>
      </aside>
      <main class="main-content">
        <header class="topbar">
          <div class="crumb"><span>Workspace</span><b>/</b><strong>${current.label}</strong></div>
          <div class="top-actions"><span class="sync-label"><i></i> ${state.loading ? 'Syncing…' : `Updated ${dateLabel(state.data?.generatedAt)}`}</span><button id="refresh" class="button button-light" ${state.loading ? 'disabled' : ''}><span class="refresh-icon">↻</span> Refresh</button></div>
        </header>
        <section class="page-heading"><div><p class="eyebrow">BIZPOA BUSINESS MANAGER</p><h1>${current.label === 'Overview' ? 'The numbers that matter.' : current.label}</h1><p>${headingCopy(state.view)}</p></div><span class="period-chip"><i></i> Last 7 days</span></section>
        ${state.error ? `<div class="notice" role="alert">${escapeHtml(state.error)}</div>` : ''}
        <section id="view-content" class="view-content">${renderView()}</section>
        <footer class="page-footer"><span>Bizpoa</span><span>Built for the hustle behind every small business.</span></footer>
      </main>
    </div>`;

  root.querySelector('#refresh').addEventListener('click', () => loadDashboard());
  root.querySelector('#sign-out').addEventListener('click', async () => {
    await supabase.auth.signOut();
    state.session = null;
    state.data = null;
    showLogin();
  });
  bindVoiceAssistant();
}

function headingCopy(view) {
  return {
    overview: 'A clear view of your registered businesses and recent activity.',
    businesses: 'Every business profile registered through the USSD service.',
    transactions: 'Sales and expenses recorded by business owners.',
    sms: 'Extra business information sent by SMS.',
    voice: 'Start a live voice conversation with the Bizpoa AI assistant.',
  }[view];
}

function renderView() {
  if (!state.data) return '<div class="empty-panel">No dashboard data loaded yet.</div>';
  if (state.view === 'businesses') return renderBusinesses();
  if (state.view === 'transactions') return renderTransactions();
  if (state.view === 'sms') return renderSmsNotes();
  if (state.view === 'voice') return renderVoiceCallView();
  return renderOverview();
}

function renderVoiceCallView() {
  return `
    <section class="panel voice-call-panel" aria-labelledby="voice-call-title">
      <div class="voice-call-intro">
        <div><p class="eyebrow">LIVE BROWSER VOICE CONVERSATION</p><h2 id="voice-call-title">Talk to your Bizpoa AI agent</h2><p>Tap the widget to begin, allow microphone access, and speak naturally. The assistant identifies itself as AI and can discuss a sale or expense.</p></div>
        <span class="voice-demo-badge">Test mode</span>
      </div>
      <div class="voice-call-widget"><elevenlabs-convai agent-id="${BIZPOA_VOICE_AGENT_ID}" variant="expanded" start-call-text="Start voice conversation" end-call-text="End conversation" action-text="Talk to Bizpoa"></elevenlabs-convai></div>
      <div class="voice-call-note"><strong>Important:</strong> This browser conversation is not connected to Bizpoa records and cannot save transactions. It does not call a phone number. Outbound/inbound telephone calls require a Twilio or SIP phone number to be connected to ElevenLabs.</div>
    </section>`;
}

function renderOverview() {
  const { summary, businesses, transactions, smsNotes } = state.data;
  return `
    ${renderVoiceAssistant(businesses)}
    <div class="stat-grid">
      ${statCard('Registered businesses', summary.businessCount, 'Across all business types', '01', 'green')}
      ${statCard('Sales', `KES ${money(summary.sales)}`, `From ${summary.transactionCount} recent entries`, '02', 'cream')}
      ${statCard('Expenses', `KES ${money(summary.expenses)}`, 'Recorded in the last 7 days', '03', 'rose')}
      ${statCard('Net', `KES ${money(summary.net)}`, 'Sales less expenses', '04', 'dark')}
    </div>
    <div class="overview-grid">
      <section class="panel business-panel"><div class="panel-heading"><div><p class="eyebrow">YOUR NETWORK</p><h2>Recent businesses</h2></div><button class="text-link" data-view="businesses">All businesses <span>→</span></button></div>
        ${businesses.length ? `<div class="business-list">${businesses.slice(0, 5).map(businessRow).join('')}</div>` : emptyState('No businesses yet', 'Registered businesses will appear here after the first USSD signup.')}
      </section>
      <section class="panel pulse-panel"><div class="panel-heading"><div><p class="eyebrow">ACTIVITY PULSE</p><h2>Recent entries</h2></div><span class="count-pill">${transactions.length}</span></div>
        ${transactions.length ? `<div class="activity-list">${transactions.slice(0, 5).map(activityRow).join('')}</div>` : emptyState('No transactions yet', 'Sales and expenses recorded through USSD will show here.')}
      </section>
    </div>
    <section class="insight-strip"><div class="insight-number">${String(smsNotes.length).padStart(2, '0')}</div><div><p class="eyebrow">BUSINESS CONTEXT</p><h2>${smsNotes.length ? 'New details from SMS' : 'Make room for the details'}</h2><p>${smsNotes.length ? `${smsNotes.length} message${smsNotes.length === 1 ? '' : 's'} saved from business owners.` : 'Owners can text a Bizpoa ID followed by useful details like location or opening hours.'}</p></div><button class="button button-outline" data-view="sms">View SMS details <span>→</span></button></section>`;
}

function renderVoiceAssistant(businesses) {
  const hasBusinesses = businesses.length > 0;
  if (!businesses.some((business) => business.code === state.selectedBusinessCode)) {
    state.selectedBusinessCode = businesses[0]?.code ?? '';
  }
  const options = businesses.map((business) => `<option value="${escapeHtml(business.code)}" ${business.code === state.selectedBusinessCode ? 'selected' : ''}>${escapeHtml(business.name)} · ${escapeHtml(business.code)}</option>`).join('');
  const pendingBusiness = businesses.find((business) => business.code === state.pendingVoice?.businessCode);
  const confirmation = state.pendingVoice && pendingBusiness ? `
    <div class="voice-confirm" role="region" aria-label="Review transaction before saving">
      <div><span class="voice-confirm-label">AI UNDERSTOOD</span><strong>${escapeHtml(state.pendingVoice.summary)}</strong><p>${state.pendingVoice.type === 'sale' ? 'Sale' : 'Expense'} · KES ${money(state.pendingVoice.amount)} · ${escapeHtml(pendingBusiness.name)}</p></div>
      <div class="voice-confirm-actions"><button id="cancel-voice" class="button button-light" type="button">Cancel</button><button id="confirm-voice" class="button button-primary" type="button">Confirm and save</button></div>
    </div>` : '';
  const clarification = state.voiceReview && !state.voiceReview.ready ? `
    <div class="voice-ai-clarification" role="status"><strong>I need to check one thing</strong><p>${escapeHtml(state.voiceReview.summary)}</p><p>${escapeHtml(state.voiceReview.clarification)}</p><small>Edit or add details to your command, then ask me to review it again.</small></div>` : '';

  return `
    <section class="panel voice-panel" aria-labelledby="voice-title">
      <div class="voice-intro">
        <div><p class="eyebrow">AI VOICE REVIEW · CONFIRM BEFORE SAVING</p><h2 id="voice-title">Talk to Bizpoa</h2><p class="voice-description">Say or type naturally. AI will explain what it understood and ask if anything is unclear. Nothing is saved until you confirm.</p></div>
        <span class="voice-demo-badge">Prototype</span>
      </div>
      ${hasBusinesses ? `
        <form id="voice-form" class="voice-form">
          <label class="voice-field business-field"><span>Business</span><select id="voice-business" name="businessCode">${options}</select></label>
          <label class="voice-field language-field"><span>Language</span><select id="voice-language" name="language"><option value="en" ${state.voiceLanguage === 'en' ? 'selected' : ''}>English</option><option value="sw" ${state.voiceLanguage === 'sw' ? 'selected' : ''}>Kiswahili</option></select></label>
          <div class="voice-command-field"><label for="voice-command">What should I record?</label><div class="voice-command-row"><input id="voice-command" name="command" value="${escapeHtml(state.voiceCommand)}" placeholder="Record a sale of 300" autocomplete="off" /><button id="voice-microphone" class="button button-mic" type="button" aria-label="Speak a command">${state.listening ? 'Listening…' : 'Use microphone'}</button></div></div>
          <button class="button button-primary voice-review" type="submit" ${state.voiceReviewing ? 'disabled' : ''}>${state.voiceReviewing ? 'AI is reviewing…' : 'Review with AI'} <span aria-hidden="true">→</span></button>
        </form>
        <p class="voice-examples">Try speaking naturally: “I sold three hundred shillings of tomatoes” or “Nilinunua bidhaa za duka kwa mia tano.”</p>
        <p class="voice-note">Your browser transcribes speech; Gemini AI reviews the words. You can edit the transcript before review. AI is only for understanding and does not save anything by itself.</p>
      ` : `<div class="voice-no-business">Register a business through USSD first; then you can try a demo transaction here.</div>`}
      <p id="voice-status" class="voice-status ${state.voiceError ? 'is-error' : ''}" role="status" aria-live="polite">${escapeHtml(state.voiceError || state.voiceSuccess || '')}</p>
      ${clarification}
      ${confirmation}
    </section>`;
}

function bindVoiceAssistant() {
  const form = root.querySelector('#voice-form');
  if (!form) return;
  const commandInput = root.querySelector('#voice-command');
  const status = root.querySelector('#voice-status');

  root.querySelector('#voice-business').addEventListener('change', (event) => {
    state.selectedBusinessCode = event.currentTarget.value;
    state.pendingVoice = null;
    state.voiceReview = null;
  });
  root.querySelector('#voice-language').addEventListener('change', (event) => {
    state.voiceLanguage = event.currentTarget.value;
  });
  commandInput.addEventListener('input', (event) => {
    state.voiceCommand = event.currentTarget.value;
    state.voiceError = '';
    state.pendingVoice = null;
    state.voiceReview = null;
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    state.voiceCommand = commandInput.value.trim();
    state.voiceError = '';
    state.voiceSuccess = '';
    state.voiceReview = null;
    state.pendingVoice = null;
    if (!state.voiceCommand) {
      state.voiceError = state.voiceLanguage === 'sw' ? 'Tafadhali sema au andika unachotaka kurekodi.' : 'Please say or type what you want me to record.';
      shell();
      return;
    }
    await reviewVoiceCommand();
  });

  root.querySelector('#voice-microphone').addEventListener('click', () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      state.voiceError = state.voiceLanguage === 'sw'
        ? 'Utambuzi wa sauti haupatikani kwenye kivinjari hiki. Tafadhali andika amri.'
        : 'Voice recognition is not available in this browser. Please type your command instead.';
      shell();
      return;
    }
    const recognition = new Recognition();
    recognition.lang = state.voiceLanguage === 'sw' ? 'sw-KE' : 'en-KE';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      state.listening = true;
      state.voiceError = '';
      const button = root.querySelector('#voice-microphone');
      if (button) { button.disabled = true; button.textContent = 'Listening…'; }
      if (status) status.textContent = state.voiceLanguage === 'sw' ? 'Sikiliza… sema amri yako.' : 'Listening… say your command.';
    };
    recognition.onresult = (event) => {
      state.voiceCommand = event.results?.[0]?.[0]?.transcript ?? '';
      if (commandInput) commandInput.value = state.voiceCommand;
      if (status) status.textContent = state.voiceLanguage === 'sw'
        ? 'Maneno yameandikwa. Yahakiki na uyarekebishe kabla ya kuendelea.'
        : 'Transcript ready. Review or edit it before continuing.';
    };
    recognition.onerror = (event) => {
      state.voiceError = event.error === 'not-allowed'
        ? (state.voiceLanguage === 'sw' ? 'Ruhusu matumizi ya maikrofoni kwenye kivinjari, au andika amri.' : 'Allow microphone access in your browser, or type your command instead.')
        : (state.voiceLanguage === 'sw' ? 'Sauti haikupatikana vizuri. Jaribu tena au andika amri.' : 'I couldn’t hear that clearly. Try again or type your command.');
    };
    recognition.onend = () => {
      state.listening = false;
      const button = root.querySelector('#voice-microphone');
      if (button) { button.disabled = false; button.textContent = 'Use microphone'; }
      if (state.voiceError && status) {
        status.textContent = state.voiceError;
        status.classList.add('is-error');
      }
    };
    try { recognition.start(); } catch {
      state.voiceError = 'The microphone is already active. Wait a moment and try again.';
      if (status) status.textContent = state.voiceError;
    }
  });

  root.querySelector('#cancel-voice')?.addEventListener('click', () => {
    state.pendingVoice = null;
    state.voiceError = '';
    state.voiceSuccess = '';
    shell();
  });
  root.querySelector('#confirm-voice')?.addEventListener('click', saveVoiceTransaction);
}

async function reviewVoiceCommand() {
  state.voiceReviewing = true;
  shell();
  try {
    const response = await fetch('/api/voice/review', {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ command: state.voiceCommand, businessCode: state.selectedBusinessCode }),
    });
    const payload = await response.json();
    if (!response.ok) {
      const messages = {
        missing_ai_key: 'AI review is not configured yet. The site owner needs to add GEMINI_API_KEY to the backend environment settings.',
        ai_unavailable: 'The AI service could not be reached. Please try again in a moment.',
        ai_provider_error: 'The AI service could not review this command right now. Please try again later.',
        unknown_business: 'That business could not be found. Refresh the dashboard and try again.',
        command_too_long: 'Please shorten the command and try again.',
      };
      throw new Error(messages[payload.error] || 'AI could not review this command. Please try again.');
    }
    state.voiceReview = payload.review;
    if (payload.review.ready) {
      state.pendingVoice = {
        type: payload.review.type,
        amount: payload.review.amount,
        businessCode: payload.business.code,
        summary: payload.review.summary,
      };
    }
  } catch (error) {
    state.voiceError = error.message || 'AI could not review this command. Please try again.';
  } finally {
    state.voiceReviewing = false;
    shell();
  }
}

async function saveVoiceTransaction() {
  const button = root.querySelector('#confirm-voice');
  if (!state.pendingVoice || !button) return;
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const response = await fetch('/api/voice/record', {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify(state.pendingVoice),
    });
    const payload = await response.json();
    if (!response.ok) {
      const message = payload.error === 'unknown_business'
        ? 'That business was not found. Refresh the dashboard and try again.'
        : 'The transaction could not be saved. Check the details and try again.';
      throw new Error(message);
    }
    const isSwahili = state.voiceLanguage === 'sw';
    const amount = money(payload.transaction.amount);
    state.voiceSuccess = isSwahili
      ? `${payload.transaction.type === 'sale' ? 'Mauzo' : 'Matumizi'} ya KES ${amount} yamerekodiwa kwa ${payload.business.name}.`
      : `${payload.transaction.type === 'sale' ? 'Sale' : 'Expense'} of KES ${amount} recorded for ${payload.business.name}.`;
    state.pendingVoice = null;
    state.voiceCommand = '';
    state.voiceError = '';
    await loadDashboard();
    speakConfirmation(state.voiceSuccess, isSwahili ? 'sw-KE' : 'en-KE');
  } catch (error) {
    state.voiceError = error.message || 'Could not save this transaction.';
    shell();
  }
}

function speakConfirmation(message, language) {
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = language;
  window.speechSynthesis.speak(utterance);
}

function statCard(label, value, caption, number, tone) {
  return `<article class="stat-card tone-${tone}"><div class="stat-top"><span>${label}</span><span class="stat-index">${number}</span></div><strong class="stat-value">${escapeHtml(value)}</strong><span class="stat-caption">${escapeHtml(caption)}</span><div class="stat-rule"></div></article>`;
}

function businessRow(business) {
  return `<article class="business-row"><div class="business-avatar">${escapeHtml((business.name || 'B').slice(0, 1).toUpperCase())}</div><div class="business-main"><strong>${escapeHtml(business.name)}</strong><span>${escapeHtml(business.type)} · ${escapeHtml(business.categoryLabel)}</span></div><div class="business-code"><small>BIZPOA ID</small><strong>${escapeHtml(business.code)}</strong></div></article>`;
}

function activityRow(transaction) {
  const business = state.data.businesses.find((item) => item.code === transaction.businessCode);
  const isSale = transaction.type === 'sale';
  return `<article class="activity-row"><span class="activity-mark ${isSale ? 'sale' : 'expense'}">${isSale ? '+' : '−'}</span><div class="activity-main"><strong>${escapeHtml(business?.name || 'Business')}</strong><span>${isSale ? 'Sale' : 'Expense'} · ${dateLabel(transaction.createdAt)}</span></div><strong class="activity-amount ${isSale ? 'positive' : 'negative'}">${isSale ? '+' : '−'} KES ${money(transaction.amount)}</strong></article>`;
}

function renderBusinesses() {
  const businesses = state.data.businesses;
  return `<section class="panel full-panel"><div class="panel-heading"><div><p class="eyebrow">BUSINESS REGISTER</p><h2>${businesses.length} profile${businesses.length === 1 ? '' : 's'}</h2></div><span class="panel-note">Created through USSD</span></div>
    ${businesses.length ? `<div class="registry-list">${businesses.map((business) => `<article class="registry-card"><div class="registry-avatar">${escapeHtml((business.name || 'B').slice(0, 1).toUpperCase())}</div><div class="registry-info"><h3>${escapeHtml(business.name)}</h3><p>${escapeHtml(business.categoryLabel)} <span>·</span> ${escapeHtml(business.type)}</p><div class="registry-meta"><span>Owner ${escapeHtml(maskPhone(business.phoneNumber))}</span><span>Registered ${dateLabel(business.registeredAt)}</span></div></div><div class="code-badge"><small>BIZPOA ID</small><strong>${escapeHtml(business.code)}</strong></div></article>`).join('')}</div>` : emptyState('No registered businesses', 'A business appears here after someone completes registration in the USSD menu.')}
  </section>`;
}

function renderTransactions() {
  const transactions = state.data.transactions;
  return `<section class="panel full-panel"><div class="panel-heading"><div><p class="eyebrow">SALES & EXPENSES</p><h2>Transaction ledger</h2></div><span class="panel-note">Showing latest ${transactions.length}</span></div>
    ${transactions.length ? `<div class="table-scroll"><table><thead><tr><th>Business</th><th>Type</th><th>Bizpoa ID</th><th>Date</th><th class="amount-col">Amount</th></tr></thead><tbody>${transactions.map((transaction) => { const business = state.data.businesses.find((item) => item.code === transaction.businessCode); const isSale = transaction.type === 'sale'; return `<tr><td><strong>${escapeHtml(business?.name || 'Business')}</strong></td><td><span class="type-chip ${isSale ? 'chip-sale' : 'chip-expense'}">${isSale ? 'Sale' : 'Expense'}</span></td><td class="mono">${escapeHtml(transaction.businessCode || '—')}</td><td>${dateLabel(transaction.createdAt)}</td><td class="amount-col ${isSale ? 'positive' : 'negative'}">${isSale ? '+' : '−'} KES ${money(transaction.amount)}</td></tr>`; }).join('')}</tbody></table></div>` : emptyState('No transactions recorded', 'When owners record a sale or expense through USSD, it will appear in this ledger.')}
  </section>`;
}

function renderSmsNotes() {
  const notes = state.data.smsNotes;
  return `<section class="panel full-panel"><div class="panel-heading"><div><p class="eyebrow">OWNER MESSAGES</p><h2>Details received by SMS</h2></div><span class="panel-note">Latest ${notes.length}</span></div>
    ${notes.length ? `<div class="notes-list">${notes.map((note) => { const business = state.data.businesses.find((item) => item.code === note.businessCode); return `<article class="note-card"><div class="note-head"><div><span class="note-code">${escapeHtml(note.businessCode || 'UNLINKED')}</span><strong>${escapeHtml(business?.name || 'Unmatched detail')}</strong></div><time>${dateLabel(note.receivedAt)}</time></div><p>${escapeHtml(note.text)}</p></article>`; }).join('')}</div>` : emptyState('No SMS details yet', 'After registration, owners can text their Bizpoa ID followed by details to your Africa’s Talking SMS shortcode.')}
  </section>`;
}

function emptyState(title, description) {
  return `<div class="empty-state"><span class="empty-mark">—</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p></div>`;
}

function authHeaders(json = false) {
  return {
    ...(state.session?.access_token ? { Authorization: `Bearer ${state.session.access_token}` } : {}),
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function loadDashboard(fromLogin = false) {
  state.loading = true;
  state.error = '';
  if (state.data) shell();
  try {
    const response = await fetch('/api/dashboard', {
      headers: authHeaders(),
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        const message = payload.error || 'This account is not authorized for the Bizpoa dashboard.';
        await supabase.auth.signOut();
        state.session = null;
        state.data = null;
        showLogin(message);
      } else if (response.status === 503) {
        state.error = payload.error || 'Dashboard is not configured.';
        if (state.data) shell(); else showLogin(state.error);
      } else {
        state.error = payload.error || 'Could not load dashboard data.';
        if (state.data) shell(); else showLogin(state.error);
      }
      return;
    }
    state.data = payload;
    shell();
  } catch {
    state.error = 'Cannot reach the backend. Start it with npm run dev:backend and try again.';
    if (state.data) shell(); else showLogin(state.error);
  } finally {
    state.loading = false;
  }
}

root.addEventListener('click', (event) => {
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) {
    state.view = viewButton.dataset.view;
    shell();
  }
});

supabase.auth.onAuthStateChange((event, session) => {
  state.session = session;
  if (event === 'SIGNED_OUT') {
    state.data = null;
    showLogin();
  }
});

supabase.auth.getSession().then(({ data, error }) => {
  if (error) {
    showLogin('Could not restore your Supabase session. Please sign in again.');
    return;
  }
  state.session = data.session;
  if (state.session) loadDashboard();
  else showLogin();
});
