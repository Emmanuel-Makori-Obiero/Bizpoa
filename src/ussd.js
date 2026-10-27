import { randomInt } from 'node:crypto';

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
    menu: (code) => `Bizpoa${code ? ` (${code})` : ''}\n1. Register business\n2. Get today's audit\n3. Manage business\n4. Get 7-day audit\n5. Change language`,
    manageMenu: 'Manage business\n1. Record sale\n2. Record expense\n3. Back to main menu',
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
    smsDetails: 'You can text extra business details to this number after registration.',
    noBusiness: 'Register your business first to use this option.',
    languageInvalid: 'Invalid choice. Choose 1 for English or 2 for Kiswahili.',
  },
  sw: {
    menu: (code) => `Bizpoa${code ? ` (${code})` : ''}\n1. Sajili biashara\n2. Ukaguzi wa leo\n3. Simamia biashara\n4. Ukaguzi wa siku 7\n5. Badili lugha`,
    manageMenu: 'Simamia biashara\n1. Rekodi mauzo\n2. Rekodi matumizi\n3. Rudi kwenye menyu kuu',
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
    smsDetails: 'Baada ya kusajili biashara, unaweza kutuma maelezo zaidi kwa SMS kwa nambari hii.',
    noBusiness: 'Sajili biashara yako kwanza kutumia chaguo hili.',
    languageInvalid: 'Chaguo si sahihi. Chagua 1 kwa Kiingereza au 2 kwa Kiswahili.',
  },
};

const con = (message) => `CON ${message}`;
const end = (message) => `END ${message}`;
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
  if (session.stage === 'saleAmount') return con(messages.saleAmount);
  if (session.stage === 'expenseAmount') return con(messages.expenseAmount);
  if (session.stage === 'manage') return con(messages.manageMenu);
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
    : (language === 'sw' ? 'Ukaguzi wa siku 7' : '7-day audit');
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

export async function handleUssd({ sessionId, phoneNumber, text = '' }, store) {
  if (!sessionId || !phoneNumber) return end('Invalid USSD request.');

  return store.transact(async (database) => {
    database.businesses ??= {};
    database.smsNotes ??= [];
    const user = database.users[phoneNumber] ?? {};
    const savedLanguage = user.language;
    const existingBusiness = database.businesses[phoneNumber];
    const session = database.sessions[sessionId] ?? {
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

      if (session.stage === 'language') {
        const chosenLanguage = languageFromChoice(value);
        if (!chosenLanguage) {
          database.sessions[sessionId] = session;
          return con(`${languageChoices[session.language]}\n${messages.languageInvalid}`);
        }
        session.language = chosenLanguage;
        session.stage = 'main';
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
          delete database.sessions[sessionId];
          return end(auditSummary(database, phoneNumber, session.language, 1));
        }
        if (value === '3') {
          if (!existingBusiness) {
            delete database.sessions[sessionId];
            return end(messages.noBusiness);
          }
          session.stage = 'manage';
          continue;
        }
        if (value === '4') {
          if (!existingBusiness) {
            delete database.sessions[sessionId];
            return end(messages.noBusiness);
          }
          delete database.sessions[sessionId];
          return end(`${auditSummary(database, phoneNumber, session.language, 7)}\n${messages.smsDetails}`);
        }
        if (value === '5') {
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
        return end(`${messages.registered(business.name, business.type, business.code)}\n${messages.smsDetails}`);
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
        if (value === '3') {
          session.stage = 'main';
          continue;
        }
        database.sessions[sessionId] = session;
        return con(`${messages.manageMenu}\n${messages.invalidMenu}`);
      }

      if (session.stage === 'saleAmount' || session.stage === 'expenseAmount') {
        if (!validAmount(value)) {
          database.sessions[sessionId] = session;
          return con(messages.invalidAmount);
        }
        const type = session.stage === 'saleAmount' ? 'sale' : 'expense';
        const amount = Number(value);
        const business = database.businesses[phoneNumber];
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

export async function saveSmsBusinessDetail({ phoneNumber, text = '' }, store) {
  const incoming = text.trim();
  if (!phoneNumber || !incoming) return { saved: false, reason: 'empty_message' };
  if (incoming.length > 1000) return { saved: false, reason: 'message_too_long' };

  return store.transact((database) => {
    database.smsNotes ??= [];
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
      phoneNumber,
      businessCode: business?.code ?? null,
      text: detail,
      receivedAt: new Date().toISOString(),
    });
    return { saved: true, businessCode: business?.code ?? null };
  });
}
