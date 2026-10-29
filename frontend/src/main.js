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
  ownerAccessToken: sessionStorage.getItem('bizpoa-owner-token') || '',
  ownerOtpSent: false,
  ownerBusinessCode: '',
  ownerPhoneNumber: '',
  ownerError: '',
  ownerData: null,
  ownerDays: 30,
  ownerBusy: false,
  ownerStatus: '',
  clearDataBusy: false,
  clearDataError: '',
  clearDataNotice: '',
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
        <button id="open-owner-dashboard" class="text-link owner-entry-link" type="button">Business owner? Open your dashboard</button>
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
  root.querySelector('#open-owner-dashboard').addEventListener('click', () => {
    state.ownerOtpSent = false;
    state.ownerError = '';
    showBusinessLogin();
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
      const message = /failed to fetch|networkerror|load failed/i.test(String(error?.message || ''))
        ? 'Could not reach Supabase Auth from this site. Check this deployment’s VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, then rebuild/redeploy. Do not use the server secret key in the frontend.'
        : (error.message || 'Sign-in failed. Check your email and password and try again.');
      showLogin(message);
    }
  });
}

function showBusinessLogin(message = '') {
  root.innerHTML = `
    <main class="login-wrap owner-login-wrap">
      <section class="login-card">
        <div class="brand-mark">B<span>.</span></div>
        <p class="eyebrow">BIZPOA BUSINESS OWNER</p>
        <h1>Your business,<br><em>your numbers.</em></h1>
        <p class="login-copy">Enter your Bizpoa ID and the phone number used to register. We’ll text a one-time code to that number before opening the dashboard.</p>
        <form id="owner-login-form" class="login-form">
          <label for="owner-business-code">Bizpoa business ID</label>
          <input id="owner-business-code" name="businessCode" value="${escapeHtml(state.ownerBusinessCode)}" placeholder="BZ-ABC123" autocomplete="off" pattern="BZ-[A-Za-z0-9]{6}" required />
          <label for="owner-phone-number">Registered phone number</label>
          <input id="owner-phone-number" name="phoneNumber" type="tel" value="${escapeHtml(state.ownerPhoneNumber)}" placeholder="+254 7XX XXX XXX" autocomplete="tel" required />
          ${state.ownerOtpSent ? `<label for="owner-verification-code">SMS verification code</label><input id="owner-verification-code" name="verificationCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="6-digit code" required />` : ''}
          <button class="button button-primary" type="submit" ${state.ownerBusy ? 'disabled' : ''}>${state.ownerBusy ? 'Please wait…' : state.ownerOtpSent ? 'Verify and open dashboard' : 'Text me a verification code'} <span aria-hidden="true">→</span></button>
        </form>
        <p class="login-error" role="alert">${escapeHtml(message || state.ownerError)}</p>
        ${state.ownerOtpSent ? '<button id="reset-owner-login" class="text-link" type="button">Use different details</button>' : ''}
        <button id="back-to-admin-login" class="text-link owner-entry-link" type="button">← Back to admin sign in</button>
        <p class="login-footnote">Your dashboard is limited to your own business and its records. Never share your verification code.</p>
      </section>
      <aside class="login-aside"><div class="sun-disc"></div><div class="aside-caption"><span>01 / YOUR BUSINESS</span><p>Simple records.<br />Better decisions.</p></div><div class="aside-lines"><i></i><i></i><i></i><i></i><i></i></div></aside>
    </main>`;

  root.querySelector('#back-to-admin-login').addEventListener('click', () => showLogin());
  root.querySelector('#reset-owner-login')?.addEventListener('click', () => {
    state.ownerOtpSent = false;
    state.ownerError = '';
    showBusinessLogin();
  });
  root.querySelector('#owner-login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    state.ownerBusinessCode = String(formData.get('businessCode') || '').trim().toUpperCase();
    state.ownerPhoneNumber = String(formData.get('phoneNumber') || '').trim();
    state.ownerBusy = true;
    state.ownerError = '';
    showBusinessLogin();
    try {
      if (!state.ownerOtpSent) {
        const response = await fetch('/api/business-auth/request-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ businessCode: state.ownerBusinessCode, phoneNumber: state.ownerPhoneNumber }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Could not request a verification code.');
        state.ownerOtpSent = true;
        state.ownerBusy = false;
        showBusinessLogin(payload.message || 'If those details match a registered business, a verification code has been sent.');
        return;
      }

      const verificationCode = String(formData.get('verificationCode') || '').trim();
      const response = await fetch('/api/business-auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessCode: state.ownerBusinessCode, phoneNumber: state.ownerPhoneNumber, code: verificationCode }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'The code is invalid or expired. Request a new one.');
      state.ownerAccessToken = payload.accessToken;
      sessionStorage.setItem('bizpoa-owner-token', payload.accessToken);
      state.ownerOtpSent = false;
      state.ownerBusy = false;
      await loadBusinessDashboard();
    } catch (error) {
      state.ownerBusy = false;
      state.ownerError = ({
        owner_login_not_configured: 'Business-owner sign-in is not configured on the Bizpoa backend yet.',
        too_many_code_requests: 'Please wait at least one minute before requesting another code. Daily limits also apply.',
        verification_sms_not_sent: 'Bizpoa could not send the code. Check the Africa’s Talking SMS settings and try again shortly.',
        invalid_business_details: 'Enter a valid Bizpoa ID and the phone number used when registering the business.',
        invalid_or_expired_code: 'That code is incorrect or expired. Use different details to request a new code.',
      })[error.message] || error.message || 'Could not verify your business. Try again.';
      showBusinessLogin();
    }
  });
}

function ownerAuthHeaders(json = false) {
  return {
    ...(state.ownerAccessToken ? { Authorization: `Bearer ${state.ownerAccessToken}` } : {}),
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function loadBusinessDashboard() {
  state.ownerBusy = true;
  state.ownerStatus = '';
  try {
    const response = await fetch(`/api/business/dashboard?days=${encodeURIComponent(state.ownerDays)}`, {
      headers: ownerAuthHeaders(),
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok) {
      if (response.status === 401 || response.status === 404) {
        sessionStorage.removeItem('bizpoa-owner-token');
        state.ownerAccessToken = '';
        state.ownerData = null;
        state.ownerOtpSent = false;
        showBusinessLogin('Your business session expired. Sign in again with your Bizpoa ID and registered phone.');
        return;
      }
      throw new Error(payload.error || 'Could not load the business dashboard.');
    }
    state.ownerData = payload;
  } catch (error) {
    state.ownerStatus = error.message || 'Could not load the business dashboard.';
  } finally {
    state.ownerBusy = false;
    if (state.ownerAccessToken) showBusinessDashboard();
  }
}

function showBusinessDashboard() {
  const data = state.ownerData;
  if (!data) {
    root.innerHTML = `<main class="owner-app"><div class="owner-loading"><span class="brand-mark">B<span>.</span></span><p>${state.ownerBusy ? 'Loading your Bizpoa dashboard…' : escapeHtml(state.ownerStatus || 'No dashboard data is available.')}</p><button id="owner-sign-out" class="button button-light" type="button">Sign out</button></div></main>`;
    root.querySelector('#owner-sign-out')?.addEventListener('click', signOutBusinessOwner);
    return;
  }
  const { business, summary, transactions, smsNotes } = data;
  root.innerHTML = `
    <div class="owner-app">
      <header class="owner-header">
        <a class="wordmark" href="#owner" aria-label="Bizpoa owner dashboard"><span class="brand-mark small">B<span>.</span></span><span>bizpoa</span></a>
        <div class="owner-header-actions"><span class="owner-secure-label">Private business dashboard</span><button id="owner-refresh" class="button button-light" type="button" ${state.ownerBusy ? 'disabled' : ''}>↻ Refresh</button><button id="owner-sign-out" class="icon-button" type="button" aria-label="Sign out" title="Sign out">Sign out</button></div>
      </header>
      <main class="owner-content">
        <section class="page-heading owner-heading"><div><p class="eyebrow">BIZPOA BUSINESS DASHBOARD</p><h1>${escapeHtml(business.name)}</h1><p>${escapeHtml(business.type || 'Registered business')} · Bizpoa ID <strong>${escapeHtml(business.code)}</strong></p></div><span class="period-chip"><i></i> ${dateLabel(summary.periodStart)} – ${dateLabel(summary.periodEnd)}</span></section>
        ${state.ownerStatus ? `<div class="notice" role="status">${escapeHtml(state.ownerStatus)}</div>` : ''}
        <section class="owner-controls panel"><label for="owner-days">Audit period (days)<input id="owner-days" type="number" min="1" max="365" value="${escapeHtml(state.ownerDays)}" /></label><button id="apply-owner-days" class="button button-light" type="button">Update period</button><span class="owner-control-spacer"></span><button id="owner-download-csv" class="button button-outline" type="button">Download CSV ledger</button><button id="owner-send-statement" class="button button-primary" type="button">Send summary by SMS</button></section>
        <div class="stat-grid">
          ${statCard('Sales', `KES ${money(summary.sales)}`, `${summary.transactionCount} entries in ${summary.days} days`, '01', 'green')}
          ${statCard('Expenses', `KES ${money(summary.expenses)}`, 'For the selected period', '02', 'rose')}
          ${statCard('Net', `KES ${money(summary.net)}`, 'Sales less expenses', '03', 'dark')}
          ${statCard('SMS details', smsNotes.length, 'Business notes and AI summaries', '04', 'cream')}
        </div>
        <section class="panel full-panel owner-ledger-panel"><div class="panel-heading"><div><p class="eyebrow">YOUR RECORDS</p><h2>Sales and expenses</h2></div><span class="panel-note">${transactions.length} shown</span></div>
          ${transactions.length ? `<div class="table-scroll"><table><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th class="amount-col">Amount (KES)</th></tr></thead><tbody>${transactions.map((transaction) => `<tr><td>${dateLabel(transaction.createdAt || transaction.date)}</td><td><span class="type-chip ${transaction.type === 'sale' ? 'chip-sale' : 'chip-expense'}">${transaction.type === 'sale' ? 'Sale' : 'Expense'}</span></td><td class="mono">${escapeHtml(transaction.id || '—')}</td><td class="amount-col ${transaction.type === 'sale' ? 'positive' : 'negative'}">${transaction.type === 'sale' ? '+' : '−'} ${money(transaction.amount)}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No records in this period', 'Record sales and expenses using Bizpoa USSD after entering your business ID.')}
        </section>
        <section class="panel full-panel owner-notes-panel"><div class="panel-heading"><div><p class="eyebrow">BIZPOA TEXT ASSISTANT</p><h2>Messages and summaries</h2></div><span class="panel-note">Latest ${smsNotes.length}</span></div>
          ${smsNotes.length ? `<div class="notes-list">${smsNotes.map((note) => `<article class="note-card"><div class="note-head"><strong>${dateLabel(note.receivedAt)}</strong><span class="note-code">${escapeHtml(note.aiTopic || 'Message')}</span></div><p>${escapeHtml(note.text)}</p>${note.aiSummary ? `<p class="ai-summary"><strong>Bizpoa summary:</strong> ${escapeHtml(note.aiSummary)}</p>` : ''}</article>`).join('')}</div>` : emptyState('No messages yet', 'Text your business details or questions to Bizpoa at 62073 from your registered phone.')}
        </section>
        <footer class="page-footer"><span>Bizpoa</span><span>Your records are private to this registered business.</span></footer>
      </main>
    </div>`;

  root.querySelector('#owner-refresh').addEventListener('click', loadBusinessDashboard);
  root.querySelector('#owner-sign-out').addEventListener('click', signOutBusinessOwner);
  root.querySelector('#apply-owner-days').addEventListener('click', () => {
    const days = Number(root.querySelector('#owner-days').value);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      state.ownerStatus = 'Choose a whole number from 1 to 365 days.';
      showBusinessDashboard();
      return;
    }
    state.ownerDays = days;
    loadBusinessDashboard();
  });
  root.querySelector('#owner-download-csv').addEventListener('click', downloadOwnerStatement);
  root.querySelector('#owner-send-statement').addEventListener('click', sendOwnerStatement);
}

async function downloadOwnerStatement() {
  try {
    const response = await fetch(`/api/business/statement.csv?days=${encodeURIComponent(state.ownerDays)}`, {
      headers: ownerAuthHeaders(),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Could not download your ledger. Please refresh and try again.');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bizpoa-${state.ownerData.business.code}-${state.ownerDays}-day-ledger.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    state.ownerStatus = error.message || 'Could not download your ledger.';
    showBusinessDashboard();
  }
}

async function sendOwnerStatement() {
  try {
    const response = await fetch('/api/business/statement-sms', {
      method: 'POST',
      headers: ownerAuthHeaders(true),
      body: JSON.stringify({ days: state.ownerDays }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error === 'statement_sms_not_sent' ? 'SMS delivery failed. Check the Bizpoa SMS gateway settings.' : 'Could not send the statement SMS.');
    state.ownerStatus = payload.message || 'Statement summary sent by SMS.';
    showBusinessDashboard();
  } catch (error) {
    state.ownerStatus = error.message || 'Could not send the statement SMS.';
    showBusinessDashboard();
  }
}

function signOutBusinessOwner() {
  sessionStorage.removeItem('bizpoa-owner-token');
  state.ownerAccessToken = '';
  state.ownerData = null;
  state.ownerOtpSent = false;
  state.ownerStatus = '';
  showBusinessLogin();
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
  { id: 'settings', label: 'Data & settings', mark: 'D' },
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
  bindDataSettings();
}

function bindDataSettings() {
  const form = root.querySelector('#clear-data-form');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.clearDataBusy) return;
    const formData = new FormData(form);
    const confirmation = String(formData.get('confirmation') || '').trim();
    const password = String(formData.get('password') || '');
    state.clearDataError = '';
    state.clearDataNotice = '';
    if (confirmation !== 'CLEAR ALL BIZPOA DATA') {
      state.clearDataError = 'The confirmation phrase does not match. No records were changed.';
      shell();
      return;
    }
    if (!window.confirm('Permanently delete all Bizpoa businesses, transactions, SMS details, and owner sessions? This cannot be undone.')) return;

    state.clearDataBusy = true;
    shell();
    let phase = 'auth';
    try {
      const reauthenticated = await supabase.auth.signInWithPassword({
        email: state.session?.user?.email || '',
        password,
      });
      if (reauthenticated.error) throw reauthenticated.error;
      if (!reauthenticated.data.session?.access_token) throw new Error('Please sign in again before clearing records.');
      state.session = reauthenticated.data.session;
      phase = 'backend';
      const response = await fetch('/api/admin/clear-data', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ confirmation }),
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Could not clear Bizpoa records (HTTP ${response.status}).`);
      const cleared = payload.cleared || {};
      state.clearDataNotice = `Cleared ${cleared.businesses || 0} businesses, ${cleared.transactions || 0} transactions, and ${cleared.smsNotes || 0} SMS details. Owner and USSD sessions were also cleared; your admin login remains.`;
      await loadDashboard();
    } catch (error) {
      state.clearDataError = /failed to fetch|networkerror|load failed/i.test(String(error?.message || ''))
        ? (phase === 'auth'
          ? 'Could not reach Supabase Auth. Check the frontend Supabase URL/key and try again.'
          : 'Could not reach the Bizpoa backend. Check the deployment and try again; no success was confirmed.')
        : (error.message || 'Could not clear Bizpoa records.');
      shell();
    } finally {
      state.clearDataBusy = false;
      if (state.session && state.view === 'settings') shell();
    }
  });
}

function headingCopy(view) {
  return {
    overview: 'A clear view of your registered businesses and recent activity.',
    businesses: 'Every business profile registered through the USSD service.',
    transactions: 'Sales and expenses recorded by business owners.',
    sms: 'Extra business information sent by SMS.',
    voice: 'Start a live voice conversation with the Bizpoa AI assistant.',
    settings: 'Review and manage Bizpoa application data.',
  }[view];
}

function renderView() {
  if (!state.data) return '<div class="empty-panel">No dashboard data loaded yet.</div>';
  if (state.view === 'businesses') return renderBusinesses();
  if (state.view === 'transactions') return renderTransactions();
  if (state.view === 'sms') return renderSmsNotes();
  if (state.view === 'voice') return renderVoiceCallView();
  if (state.view === 'settings') return renderDataSettings();
  return renderOverview();
}

function renderDataSettings() {
  return `
    <section class="panel reset-panel" aria-labelledby="reset-title">
      <p class="eyebrow reset-eyebrow">DESTRUCTIVE ACTION</p>
      <h2 id="reset-title">Clear Bizpoa business records</h2>
      <p class="reset-copy">This permanently deletes all registered businesses, sales and expenses, owner SMS details, language preferences, USSD sessions, and owner verification codes. Your admin login, Supabase project, and deployment settings are not deleted.</p>
      <div class="reset-warning"><strong>Make a backup first.</strong> This cannot be undone from Bizpoa.</div>
      ${state.clearDataNotice ? `<p class="reset-result" role="status">${escapeHtml(state.clearDataNotice)}</p>` : ''}
      ${state.clearDataError ? `<p class="reset-error" role="alert">${escapeHtml(state.clearDataError)}</p>` : ''}
      <form id="clear-data-form" class="reset-form">
        <label for="clear-data-confirmation">Type <code>CLEAR ALL BIZPOA DATA</code> to confirm</label>
        <input id="clear-data-confirmation" name="confirmation" autocomplete="off" ${state.clearDataBusy ? 'disabled' : ''} required />
        <label for="clear-data-password">Re-enter your admin password</label>
        <input id="clear-data-password" name="password" type="password" autocomplete="current-password" ${state.clearDataBusy ? 'disabled' : ''} required />
        <button class="button button-danger" type="submit" ${state.clearDataBusy ? 'disabled' : ''}>${state.clearDataBusy ? 'Clearing records…' : 'Clear all Bizpoa records'}</button>
      </form>
    </section>`;
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
    ${notes.length ? `<div class="notes-list">${notes.map((note) => { const business = state.data.businesses.find((item) => item.code === note.businessCode); return `<article class="note-card"><div class="note-head"><div><span class="note-code">${escapeHtml(note.businessCode || 'UNLINKED')}</span><strong>${escapeHtml(business?.name || 'Unmatched detail')}</strong></div><time>${dateLabel(note.receivedAt)}</time></div><p>${escapeHtml(note.text)}</p>${note.aiSummary ? `<p class="ai-summary"><strong>AI summary:</strong> ${escapeHtml(note.aiSummary)}</p>` : ''}${note.aiReply ? `<p><strong>AI reply:</strong> ${escapeHtml(note.aiReply)}</p>` : ''}</article>`; }).join('')}</div>` : emptyState('No SMS details yet', 'Owners can send business details or questions to Bizpoa at 62073 from their registered phone.')}
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
    state.error = import.meta.env.DEV
      ? 'Cannot reach the local Bizpoa backend. Start it with npm run dev:backend and try again.'
      : 'Cannot reach the Bizpoa API. Check that this Vercel deployment includes /api/dashboard and that its backend Supabase environment variables are configured.';
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

window.addEventListener('hashchange', () => {
  if (window.location.hash === '#overview' && state.session && state.data) {
    state.view = 'overview';
    shell();
  }
});

supabase.auth.onAuthStateChange((event, session) => {
  if (state.ownerAccessToken) return;
  state.session = session;
  if (event === 'SIGNED_OUT') {
    state.data = null;
    showLogin();
  }
});

if (state.ownerAccessToken) {
  loadBusinessDashboard();
} else {
  supabase.auth.getSession().then(({ data, error }) => {
    if (state.ownerAccessToken) return;
    if (error) {
      showLogin('Could not restore your Supabase session. Please sign in again.');
      return;
    }
    state.session = data.session;
    if (state.session) loadDashboard();
    else showLogin();
  });
}
