import { randomInt, randomUUID } from 'node:crypto';
import { createStatementDownloadUrl, formatStatementSms, statementLinkConfigured } from './statements.js';

const languageChoices = {
  en: 'Choose language / Chagua lugha\n1. English\n2. Kiswahili',
  sw: 'Chagua lugha / Choose language\n1. Kiingereza (English)\n2. Kiswahili',
};

const categories = {
  en: [
    '1. Retail / shop',
    '2. Beauty / cosmetics',
    '3. Food / kiosk',
    '4. Jua Kali / other',
  ],
  sw: [
    '1. Rejareja / duka',
    '2. Urembo / vipodozi',
    '3. Chakula / kioski',
    '4. Jua Kali / nyingine',
  ],
};

const businessTypes = {
  en: {
    retail: ['Shopkeeper', 'Boutique', 'Hardware', 'Furniture'],
    beauty: ['Salon', 'Cosmetics'],
    food: ['Mama mboga', 'Kiosk / food shop'],
    other: ['Jua Kali / other'],
  },
  sw: {
    retail: ['Mwenye duka', 'Boutique', 'Duka la vifaa', 'Samani'],
    beauty: ['Saluni', 'Vipodozi'],
    food: ['Mama mboga', 'Kioski / chakula'],
    other: ['Jua Kali / nyingine'],
  },
};

const categoryKeys = { '1': 'retail', '2': 'beauty', '3': 'food', '4': 'other' };

const copy = {
  en: {
    menu: (code) => `Bizpoa${code ? ` (${code})` : ''}\n1. Register business\n2. Manage business\n3. Audit / statement\n4. Change language\n00. Home  0. Back`,
    manageIdPrompt: 'Bizpoa secure access\nEnter your Bizpoa business ID to continue:',
    manageMenu: (code) => `Bizpoa · ${code}\n1. Record sale\n2. Record expense\n0. Back  00. Home`,
    auditDaysPrompt: 'Bizpoa statement\nEnter the number of days to audit (1-365):\n0. Back  00. Home',
    auditDeliveryPrompt: (documentAvailable) => `Bizpoa statement · ${documentAvailable ? '1. Send summary by SMS\n2. Send CSV ledger link by SMS' : '1. Send summary by SMS\nCSV document delivery unavailable'}\n0. Back  00. Home`,
    invalidDays: 'Enter a whole number from 1 to 365 days.',
    invalidBusinessId: 'That Bizpoa ID does not match this registered phone. Enter the ID again or press 0 to go back.',
    statementSending: 'Bizpoa: Your statement summary is being sent to this phone by SMS.',
    documentSending: 'Bizpoa: Your CSV ledger link is being sent by SMS. The private link expires in 24 hours.',
    documentUnavailable: 'CSV document delivery is not configured yet. Choose SMS summary or press 0 to go back.',
    smsDetails: (code) => `Bizpoa: To share business details, SMS ${code} followed by your message to 62073. Example: ${code}, near the market; opens at 7am. Use your registered phone.`,
    categoryPrompt: 'Choose business category:',
    typePrompt: (category, types) => `Choose business type (${category}):\n${types.map((type, i) => `${i + 1}. ${type}`).join('\n')}`,
    namePrompt: 'Enter your business name (letters/numbers, max 40 characters):',
    invalidName: 'Enter a business name between 2 and 40 characters:',
    registered: (name, type, code) => `Business registered\n${name} (${type})\nBizpoa ID: ${code}`,
    alreadyRegistered: 'This phone already has a Bizpoa business. Registering again will update its profile.',
    invalidCategory: 'Choose a number from the category menu.',
    invalidType: 'Choose a number from the business type menu.',
    invalidMenu: 'Choose a valid menu number.',
    saleAmount: 'Enter sale amount (numbers only):',
    expenseAmount: 'Enter expense amount (numbers only):',
    invalidAmount: 'Enter a positive amount, e.g. 250 or 250.50:',
    saleSaved: (amount) => `Sale recorded: ${amount}. Thank you.`,
    expenseSaved: (amount) => `Expense recorded: ${amount}. Thank you.`,
    audit: (period, sales, expenses) => `${period}\nSales: ${sales}\nExpenses: ${expenses}\nNet: ${formatAmount(sales - expenses)}`,
    noBusiness: 'Register your business first to use this option.',
    languageInvalid: 'Invalid choice. Choose 1 for English or 2 for Kiswahili.',
    backToHome: 'Returned to the Bizpoa home menu.',
  },
  sw: {
    menu: (code) => `Bizpoa${code ? ` (${code})` : ''}\n1. Sajili biashara\n2. Simamia biashara\n3. Taarifa / hesabu\n4. Badili lugha\n00. Mwanzo  0. Rudi`,
    manageIdPrompt: 'Bizpoa: ufikiaji salama\nWeka nambari ya biashara ya Bizpoa kuendelea:',
    manageMenu: (code) => `Bizpoa · ${code}\n1. Rekodi mauzo\n2. Rekodi matumizi\n0. Rudi  00. Mwanzo`,
    auditDaysPrompt: 'Taarifa ya Bizpoa\nWeka idadi ya siku za kukagua (1-365):\n0. Rudi  00. Mwanzo',
    auditDeliveryPrompt: (documentAvailable) => `Taarifa ya Bizpoa · ${documentAvailable ? '1. Tuma muhtasari kwa SMS\n2. Tuma kiungo cha CSV kwa SMS' : '1. Tuma muhtasari kwa SMS\nKutuma hati ya CSV hakupatikani'}\n0. Rudi  00. Mwanzo`,
    invalidDays: 'Weka nambari kamili kati ya siku 1 na 365.',
    invalidBusinessId: 'Nambari hiyo ya Bizpoa haiendani na simu hii iliyosajiliwa. Weka tena au bonyeza 0 kurudi.',
    statementSending: 'Bizpoa: Muhtasari wa taarifa unatumiwa kwa SMS kwenye simu hii.',
    documentSending: 'Bizpoa: Kiungo cha CSV kinatumwa kwa SMS. Kiungo binafsi kinaisha baada ya saa 24.',
    documentUnavailable: 'Kutuma hati ya CSV hakujasanidiwa. Chagua muhtasari wa SMS au bonyeza 0 kurudi.',
    smsDetails: (code) => `Bizpoa: Kutuma maelezo ya biashara, SMS ${code} ikifuatiwa na ujumbe wako kwenda 62073. Mfano: ${code}, karibu na soko; hufungua saa 1 asubuhi. Tumia simu iliyosajiliwa.`,
    categoryPrompt: 'Chagua aina ya biashara:',
    typePrompt: (category, types) => `Chagua biashara (${category}):\n${types.map((type, i) => `${i + 1}. ${type}`).join('\n')}`,
    namePrompt: 'Weka jina la biashara yako (herufi/nambari, herufi 40 upeo):',
    invalidName: 'Weka jina la biashara lenye herufi 2 hadi 40:',
    registered: (name, type, code) => `Biashara imesajiliwa\n${name} (${type})\nNambari ya Bizpoa: ${code}`,
    alreadyRegistered: 'Nambari hii ina biashara ya Bizpoa. Usajili mpya utasasisha taarifa zake.',
    invalidCategory: 'Chagua nambari kutoka kwenye menyu ya aina.',
    invalidType: 'Chagua nambari kutoka kwenye menyu ya biashara.',
    invalidMenu: 'Chagua nambari sahihi ya menyu.',
    saleAmount: 'Weka kiasi cha mauzo (nambari pekee):',
    expenseAmount: 'Weka kiasi cha matumizi (nambari pekee):',
    invalidAmount: 'Weka kiasi zaidi ya sifuri, mfano 250 au 250.50:',
    saleSaved: (amount) => `Mauzo ya ${amount} yamerekodiwa. Asante.`,
    expenseSaved: (amount) => `Matumizi ya ${amount} yamerekodiwa. Asante.`,
    audit: (period, sales, expenses) => `${period}\nMauzo: ${sales}\nMatumizi: ${expenses}\nFaida halisi: ${formatAmount(sales - expenses)}`,
    noBusiness: 'Sajili biashara yako kwanza kutumia chaguo hili.',
    languageInvalid: 'Chaguo si sahihi. Chagua 1 kwa Kiingereza au 2 kwa Kiswahili.',
    backToHome: 'Umerudi kwenye menyu kuu ya Bizpoa.',
  },
};

const brandMessage = (message) => String(message).startsWith('Bizpoa') ? String(message) : `Bizpoa\n${message}`;
const con = (message) => `CON ${brandMessage(message)}`;
const end = (message) => `END ${brandMessage(message)}`;
const languageFromChoice = (choice) => (choice === '1' ? 'en' : choice === '2' ? 'sw' : null);

function categoryLabel(language, key) {
  const labels = {
    en: { retail: 'Retail / shop', beauty: 'Beauty / cosmetics', food: 'Food / kiosk', other: 'Jua Kali / other' },
    sw: { retail: 'Rejareja / duka', beauty: 'Urembo / vipodozi', food: 'Chakula / kioski', other: 'Jua Kali / nyingine' },
  };
  return labels[language][key];
}

function promptForStage(session) {
  const messages = copy[session.language];
  if (session.stage === 'language') return con(languageChoices[session.language] ?? languageChoices.en);
  if (session.stage === 'category') return con(`${messages.categoryPrompt}\n${categories[session.language].join('\n')}`);
  if (session.stage === 'businessType') {
    const types = businessTypes[session.language][session.category];
    return con(messages.typePrompt(categoryLabel(session.language, session.category), types));
  }
  if (session.stage === 'businessName') return con(messages.namePrompt);
  if (session.stage === 'manageId') return con(messages.manageIdPrompt);
  if (session.stage === 'saleAmount') return con(messages.saleAmount);
  if (session.stage === 'expenseAmount') return con(messages.expenseAmount);
  if (session.stage === 'auditDays') return con(messages.auditDaysPrompt);
  if (session.stage === 'auditDelivery') return con(messages.auditDeliveryPrompt(Boolean(session.documentAvailable)));
  if (session.stage === 'manage') return con(messages.manageMenu(session.business ?? ''));
  const business = session.business ?? '';
  return con(messages.menu(business));
}

function formatAmount(value) {
  const number = Number(value);
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function validAmount(value) {
  return /^\d{1,9}(?:\.\d{1,2})?$/.test(value) && Number(value) > 0;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function addUtcDays(date, days) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function auditSummary(database, phoneNumber, language, days) {
  const today = todayUtc();
  const firstDay = addUtcDays(today, -(days - 1));
  const totals = database.transactions.reduce((sum, transaction) => {
    const businessKey = transaction.businessCode ?? transaction.phoneNumber;
    const activeBusinessCode = database.businesses?.[phoneNumber]?.code;
    const belongsToUser = activeBusinessCode
      ? businessKey === activeBusinessCode || transaction.phoneNumber === phoneNumber
      : transaction.phoneNumber === phoneNumber;
    if (belongsToUser && transaction.date >= firstDay && transaction.date <= today) {
      sum[transaction.type] += transaction.amount;
    }
    return sum;
  }, { sale: 0, expense: 0 });
  const sales = Number(totals.sale.toFixed(2));
  const expenses = Number(totals.expense.toFixed(2));
  const messages = copy[language];
  const period = days === 1
    ? (language === 'sw' ? 'Ukaguzi wa leo' : "Today's audit")
    : (language === 'sw' ? `Ukaguzi wa siku ${days}` : `Audit for the last ${days} days`);
  return messages.audit(period, sales, expenses);
}

function validBusinessName(value) {
  return value.length >= 2 && value.length <= 40 && /[\p{L}\p{N}]/u.test(value) && !/[<>\u0000-\u001f]/.test(value);
}

function makeBusinessCode(database) {
  let code;
  const used = new Set(Object.values(database.businesses ?? {}).map((business) => business.code));
  do {
    code = `BZ-${randomInt(0, 36 ** 6).toString(36).toUpperCase().padStart(6, '0')}`;
  } while (used.has(code));
  return code;
}

export async function handleUssdAction({ sessionId, phoneNumber, text = '' }, store, statementOptions = {}) {
  if (!sessionId || !phoneNumber) return { response: end('Invalid USSD request.'), outboundSms: null };

  const result = await store.transact(async (database) => {
    database.businesses ??= {};
    database.smsNotes ??= [];
    const user = database.users[phoneNumber] ?? {};
    const savedLanguage = user.language;
    const existingBusiness = database.businesses[phoneNumber];
    const savedSession = database.sessions[sessionId];
    const session = savedSession?.phoneNumber === phoneNumber ? savedSession : {
      phoneNumber,
      language: savedLanguage === 'sw' ? 'sw' : 'en',
      stage: savedLanguage ? 'main' : 'language',
      consumed: 0,
      business: existingBusiness?.code ?? null,
    };

    const inputs = text === '' ? [] : text.split('*');

    while (session.consumed < inputs.length) {
      const value = inputs[session.consumed].trim();
      session.consumed += 1;
      const messages = copy[session.language];

      if (value === '00') {
        const language = database.users[phoneNumber]?.language ?? session.language;
        const consumed = session.consumed;
        Object.assign(session, {
          phoneNumber,
          language,
          stage: database.users[phoneNumber]?.language ? 'main' : 'language',
          consumed,
          business: existingBusiness?.code ?? null,
        });
        delete session.category;
        delete session.businessType;
        delete session.auditDays;
        delete session.documentAvailable;
        delete session.previousStage;
        continue;
      }

      if (value === '0') {
        const backStages = {
          category: 'main',
          businessType: 'category',
          businessName: 'businessType',
          manageId: 'main',
          manage: 'main',
          saleAmount: 'manage',
          expenseAmount: 'manage',
          auditDays: 'main',
          auditDelivery: 'auditDays',
        };
        const previous = session.stage === 'language'
          ? (session.previousStage ?? (savedLanguage ? 'main' : null))
          : backStages[session.stage];
        if (previous) {
          session.stage = previous;
          delete session.previousStage;
          if (previous === 'main') {
            delete session.category;
            delete session.businessType;
            delete session.auditDays;
            session.business = existingBusiness?.code ?? null;
          }
          continue;
        }
        if (session.stage === 'main') continue;
        database.sessions[sessionId] = session;
        return promptForStage(session);
      }

      if (session.stage === 'language') {
        const chosenLanguage = languageFromChoice(value);
        if (!chosenLanguage) {
          database.sessions[sessionId] = session;
          return con(`${languageChoices[session.language]}\n${messages.languageInvalid}`);
        }
        session.language = chosenLanguage;
        session.stage = 'main';
        delete session.previousStage;
        database.users[phoneNumber] = { ...user, language: chosenLanguage, updatedAt: new Date().toISOString() };
        continue;
      }

      if (session.stage === 'main') {
        if (value === '1') {
          session.stage = 'category';
          continue;
        }
        if (value === '2') {
          if (!existingBusiness) {
            delete database.sessions[sessionId];
            return end(messages.noBusiness);
          }
          session.business = existingBusiness.code;
          session.stage = 'manageId';
          continue;
        }
        if (value === '3') {
          if (!existingBusiness) {
            delete database.sessions[sessionId];
            return end(messages.noBusiness);
          }
          session.business = existingBusiness.code;
          session.auditDays = null;
          session.documentAvailable = statementLinkConfigured(statementOptions);
          session.stage = 'auditDays';
          continue;
        }
        if (value === '4') {
          session.previousStage = 'main';
          session.stage = 'language';
          continue;
        }
        database.sessions[sessionId] = session;
        return con(`${messages.menu(existingBusiness?.code ?? '')}\n${messages.invalidMenu}`);
      }

      if (session.stage === 'category') {
        const category = categoryKeys[value];
        if (!category) {
          database.sessions[sessionId] = session;
          return con(`${messages.categoryPrompt}\n${categories[session.language].join('\n')}\n${messages.invalidCategory}`);
        }
        session.category = category;
        session.stage = 'businessType';
        continue;
      }

      if (session.stage === 'businessType') {
        const options = businessTypes[session.language][session.category];
        const selected = Number(value);
        if (!Number.isInteger(selected) || selected < 1 || selected > options.length) {
          database.sessions[sessionId] = session;
          return con(`${messages.typePrompt(categoryLabel(session.language, session.category), options)}\n${messages.invalidType}`);
        }
        session.businessType = options[selected - 1];
        session.stage = 'businessName';
        continue;
      }

      if (session.stage === 'businessName') {
        if (!validBusinessName(value)) {
          database.sessions[sessionId] = session;
          return con(messages.invalidName);
        }
        const previous = database.businesses[phoneNumber];
        const business = {
          code: previous?.code ?? makeBusinessCode(database),
          name: value,
          category: session.category,
          categoryLabel: categoryLabel(session.language, session.category),
          type: session.businessType,
          phoneNumber,
          registeredAt: previous?.registeredAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        database.businesses[phoneNumber] = business;
        session.business = business.code;
        delete database.sessions[sessionId];
        return end(`${messages.registered(business.name, business.type, business.code)}\n${messages.smsDetails(business.code)}`);
      }

      if (session.stage === 'manageId') {
        const submittedCode = value.toUpperCase();
        if (!existingBusiness || existingBusiness.phoneNumber !== phoneNumber || submittedCode !== existingBusiness.code) {
          database.sessions[sessionId] = session;
          return con(`${messages.manageIdPrompt}\n${messages.invalidBusinessId}`);
        }
        session.business = existingBusiness.code;
        session.stage = 'manage';
        continue;
      }

      if (session.stage === 'auditDays') {
        if (!/^\d{1,3}$/.test(value) || Number(value) < 1 || Number(value) > 365) {
          database.sessions[sessionId] = session;
          return con(`${messages.auditDaysPrompt}\n${messages.invalidDays}`);
        }
        session.auditDays = Number(value);
        session.stage = 'auditDelivery';
        continue;
      }

      if (session.stage === 'auditDelivery') {
        const business = database.businesses[phoneNumber];
        if (!business || business.code !== session.business) {
          delete database.sessions[sessionId];
          return end(messages.noBusiness);
        }
        if (value === '1') {
          const message = formatStatementSms(database, business, session.auditDays, session.language);
          if (!message) {
            database.sessions[sessionId] = session;
            return con(`${messages.auditDeliveryPrompt(Boolean(session.documentAvailable))}\n${messages.invalidMenu}`);
          }
          delete database.sessions[sessionId];
          return { response: end(messages.statementSending), outboundSms: { to: phoneNumber, message } };
        }
        if (value === '2') {
          const url = createStatementDownloadUrl({
            businessCode: business.code,
            phoneNumber,
            days: session.auditDays,
            publicUrl: statementOptions.publicUrl,
            secret: statementOptions.secret,
          });
          if (!url) {
            database.sessions[sessionId] = session;
            return con(`${messages.auditDeliveryPrompt(Boolean(session.documentAvailable))}\n${messages.documentUnavailable}`);
          }
          const message = `Bizpoa: ${business.code} ledger for the last ${session.auditDays} days. Download the CSV (expires in 24 hours): ${url}`;
          delete database.sessions[sessionId];
          return { response: end(messages.documentSending), outboundSms: { to: phoneNumber, message } };
        }
        database.sessions[sessionId] = session;
        return con(`${messages.auditDeliveryPrompt(Boolean(session.documentAvailable))}\n${messages.invalidMenu}`);
      }

      if (session.stage === 'manage') {
        if (value === '1') {
          session.stage = 'saleAmount';
          continue;
        }
        if (value === '2') {
          session.stage = 'expenseAmount';
          continue;
        }
        database.sessions[sessionId] = session;
        return con(`${messages.manageMenu(session.business ?? '')}\n${messages.invalidMenu}`);
      }

      if (session.stage === 'saleAmount' || session.stage === 'expenseAmount') {
        if (!validAmount(value)) {
          database.sessions[sessionId] = session;
          return con(messages.invalidAmount);
        }
        const type = session.stage === 'saleAmount' ? 'sale' : 'expense';
        const amount = Number(value);
        const business = database.businesses[phoneNumber];
        if (!business || business.code !== session.business) {
          delete database.sessions[sessionId];
          return end(messages.noBusiness);
        }
        database.transactions.push({
          id: `${sessionId}-${session.consumed}`,
          phoneNumber,
          businessCode: business?.code ?? null,
          type,
          amount,
          date: todayUtc(),
          createdAt: new Date().toISOString(),
        });
        delete database.sessions[sessionId];
        return end(type === 'sale' ? messages.saleSaved(formatAmount(amount)) : messages.expenseSaved(formatAmount(amount)));
      }
    }

    database.sessions[sessionId] = session;
    return promptForStage(session);
  });
  return typeof result === 'string' ? { response: result, outboundSms: null } : result;
}

export async function handleUssd(request, store) {
  const result = await handleUssdAction(request, store);
  return result.response;
}

export async function saveSmsLanguage({ phoneNumber, text = '' }, store) {
  if (!phoneNumber) return null;
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const english = /^(?:lang|language)\s+(?:en|english)$/.test(normalized);
  const swahili = /^(?:lang|language|lugha)\s+(?:sw|swahili|kiswahili)$/.test(normalized);
  const directEnglish = /^(?:english|kiingereza)$/.test(normalized);
  const directSwahili = /^(?:swahili|kiswahili)$/.test(normalized);
  const language = english || directEnglish ? 'en' : swahili || directSwahili ? 'sw' : null;
  if (!language) return null;

  await store.transact((database) => {
    database.users[phoneNumber] = { ...database.users[phoneNumber], language, updatedAt: new Date().toISOString() };
  });
  return language;
}

export async function saveSmsBusinessDetail({ phoneNumber, text = '' }, store, { analysis = null, messageId = null } = {}) {
  const incoming = text.trim();
  if (!phoneNumber || !incoming) return { saved: false, reason: 'empty_message' };
  if (incoming.length > 1000) return { saved: false, reason: 'message_too_long' };

  return store.transact((database) => {
    database.smsNotes ??= [];
    if (messageId && database.smsNotes.some((note) => note.messageId === messageId)) {
      return { saved: false, reason: 'duplicate_message' };
    }
    const codeMatch = incoming.match(/^(BZ-[A-Z0-9]{6})(?:\s*[,;:]\s*|\s+)(.*)$/i);
    const startsWithCode = incoming.match(/^(BZ-[A-Z0-9]{6})\b/i);
    let business = database.businesses?.[phoneNumber] ?? null;
    let detail = incoming;

    if (codeMatch) {
      const submittedCode = codeMatch[1].toUpperCase();
      business = Object.values(database.businesses ?? {}).find((entry) => entry.code === submittedCode) ?? null;
      detail = codeMatch[2].trim();
      if (!business) return { saved: false, reason: 'unknown_code' };
      if (business.phoneNumber !== phoneNumber) return { saved: false, reason: 'sender_mismatch' };
      if (!detail) return { saved: false, reason: 'missing_details', businessCode: business.code };
    } else if (startsWithCode) {
      return { saved: false, reason: 'missing_details' };
    }

    if (!detail) return { saved: false, reason: 'missing_details' };
    database.smsNotes.push({
      id: randomUUID(),
      phoneNumber,
      businessCode: business?.code ?? null,
      text: detail,
      ...(messageId ? { messageId } : {}),
      ...(analysis ? {
        aiTopic: analysis.topic,
        aiSummary: analysis.summary,
        aiReply: analysis.reply,
      } : {}),
      receivedAt: new Date().toISOString(),
    });
    return { saved: true, businessCode: business?.code ?? null };
  });
}
