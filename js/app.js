/* ==========================================================================
   Intelligent Banking System (IBS) — Mock "database" layer
   Everything is stored in localStorage so the prototype behaves like a real
   connected application without needing a backend server.

   User record shape (mirrors the bank's KYC registration payload):
   {
     title, firstName, lastName, initials, maritalStatus, gender, residency,
     nationality, idType, idNumber, ethnicGroup, occupation, incomeSource,
     bankType,
     contact: { primaryNumber, secondaryNumber, emailAddress, prefMethod },
     addresses: [
       { addressType:'PHYSICAL', houseNumber, street, suburb, city, province, postalCode, latitude, longitude },
       { addressType:'POSTAL',   houseNumber, street, suburb, city, province, postalCode, latitude, longitude }
     ],
     username, password,
     accountType, accountNumber, balance, twoFactorEnabled, locked, transactions
   }
   ========================================================================== */

const IBS_DB_KEY = 'ibs_users';
const IBS_SESSION_KEY = 'ibs_session';
const IBS_ATTEMPTS_KEY = 'ibs_attempts';
const IBS_SCHEMA_VERSION_KEY = 'ibs_schema_version';

// Bump this whenever the user record shape changes. On mismatch, stored
// data from an older version of the prototype (which would otherwise
// crash the app with "Cannot read properties of undefined") is wiped and
// reseeded fresh instead of being trusted as-is.
const IBS_SCHEMA_VERSION = '2';

const IBS_BANK_TYPE_LABELS = {
  CHEQUE: 'Cheque / Everyday Account',
  SAVINGS: 'Savings Account'
};

const IBSDb = (function () {

  function resetIfSchemaStale() {
    const storedVersion = localStorage.getItem(IBS_SCHEMA_VERSION_KEY);

    // Treat data as stale either if the version marker doesn't match, or
    // if the data underneath doesn't actually look like the current shape
    // — belt and braces against partial/corrupted writes, checked even
    // when the version marker itself looks up to date.
    let looksCurrent = true;
    try {
      const users = JSON.parse(localStorage.getItem(IBS_DB_KEY) || '[]');
      looksCurrent = users.every(u => u && u.contact && Array.isArray(u.addresses));
    } catch (e) {
      looksCurrent = false;
    }

    if (storedVersion !== IBS_SCHEMA_VERSION || !looksCurrent) {
      localStorage.removeItem(IBS_DB_KEY);
      localStorage.removeItem(IBS_SESSION_KEY);
      localStorage.removeItem(IBS_ATTEMPTS_KEY);
      localStorage.setItem(IBS_SCHEMA_VERSION_KEY, IBS_SCHEMA_VERSION);
    }
  }

  function seedIfEmpty() {
    const existing = localStorage.getItem(IBS_DB_KEY);
    if (existing) return;

    const demoUser = {
      title: 'MS',
      firstName: 'Thandi',
      lastName: 'Ndlovu',
      initials: 'TN',
      maritalStatus: 'SINGLE',
      gender: 'FEMALE',
      residency: 'RSA_RESIDENT',
      nationality: 'South African',
      idType: 'SOUTH_AFRICAN_ID',
      idNumber: '9203155800083',
      ethnicGroup: 'BLACK',
      occupation: 'Software Engineer',
      incomeSource: 'Salary',
      bankType: 'CHEQUE',

      contact: {
        primaryNumber: '0821234567',
        secondaryNumber: '',
        emailAddress: 'thandi.ndlovu@ibsmail.co.za',
        prefMethod: 'EMAIL'
      },

      addresses: [
        {
          addressType: 'PHYSICAL',
          houseNumber: '12',
          street: 'Baobab Street',
          suburb: 'Sandton',
          city: 'Johannesburg',
          province: 'GAUTENG',
          postalCode: '2196',
          latitude: -26.10757,
          longitude: 28.05613
        },
        {
          addressType: 'POSTAL',
          houseNumber: '12',
          street: 'Baobab Street',
          suburb: 'Sandton',
          city: 'Johannesburg',
          province: 'GAUTENG',
          postalCode: '2196',
          latitude: -26.10757,
          longitude: 28.05613
        }
      ],

      username: 'thandi.ndlovu',
      password: 'Password123!',

      accountType: 'Everyday Account',
      accountNumber: '6281 2345 4821',
      balance: 24560.75,
      twoFactorEnabled: true,
      locked: false,
      transactions: [
        { merchant: 'Woolworths', category: 'Groceries', date: '18 Aug 2026', amount: -842.50 },
        { merchant: 'Salary — Geeks4Learning (Pty) Ltd', category: 'Income', date: '15 Aug 2026', amount: 24560.75 },
        { merchant: 'Netflix', category: 'Subscription', date: '14 Aug 2026', amount: -199.00 },
        { merchant: 'Uber', category: 'Transport', date: '12 Aug 2026', amount: -156.30 },
        { merchant: 'Takealot', category: 'Shopping', date: '09 Aug 2026', amount: -1240.00 }
      ]
    };

    localStorage.setItem(IBS_DB_KEY, JSON.stringify([demoUser]));
  }

  function getUsers() {
    return JSON.parse(localStorage.getItem(IBS_DB_KEY) || '[]');
  }

  function saveUsers(users) {
    localStorage.setItem(IBS_DB_KEY, JSON.stringify(users));
  }

  function findByEmailOrId(email, idNumber) {
    const users = getUsers();
    return users.find(u =>
      (email && u.contact && u.contact.emailAddress && u.contact.emailAddress.toLowerCase() === String(email).toLowerCase()) ||
      (idNumber && u.idNumber === idNumber)
    );
  }

  function findByUsername(username) {
    const users = getUsers();
    return users.find(u => u.username && u.username.toLowerCase() === String(username || '').toLowerCase());
  }

  // Used by Forgot Password / Forgot Username — both the email AND the ID
  // number must belong to the same account before we reveal anything.
  function findByEmailAndId(email, idNumber) {
    const users = getUsers();
    const emailNorm = String(email || '').toLowerCase();
    const idNorm = String(idNumber || '').trim();
    if (!emailNorm || !idNorm) return null;
    return users.find(u =>
      u.contact && u.contact.emailAddress && u.contact.emailAddress.toLowerCase() === emailNorm &&
      u.idNumber && String(u.idNumber).trim() === idNorm
    ) || null;
  }

  function addUser(user) {
    const users = getUsers();
    users.push(user);
    saveUsers(users);
  }

  function updateUser(username, patch) {
    const users = getUsers();
    const idx = users.findIndex(u => u.username.toLowerCase() === String(username).toLowerCase());
    if (idx === -1) return null;
    users[idx] = Object.assign({}, users[idx], patch);
    saveUsers(users);
    return users[idx];
  }

  function getAddress(user, type) {
    return (user.addresses || []).find(a => a.addressType === type) || null;
  }

  /* -------- login attempt / lockout tracking -------- */
  function getAttempts() {
    return JSON.parse(localStorage.getItem(IBS_ATTEMPTS_KEY) || '{}');
  }

  function registerFailedAttempt(username) {
    const key = String(username || '').toLowerCase();
    const attempts = getAttempts();
    attempts[key] = (attempts[key] || 0) + 1;
    localStorage.setItem(IBS_ATTEMPTS_KEY, JSON.stringify(attempts));
    return attempts[key];
  }

  function clearAttempts(username) {
    const key = String(username || '').toLowerCase();
    const attempts = getAttempts();
    delete attempts[key];
    localStorage.setItem(IBS_ATTEMPTS_KEY, JSON.stringify(attempts));
  }

  /* -------- fake JWT (header.payload.signature, base64) purely for the demo -------- */
  function generateToken(username) {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({ sub: username, iss: 'IBS', iat: Date.now() }));
    const signature = btoa(String(Math.random()).slice(2) + username).slice(0, 24);
    return `${header}.${payload}.${signature}`;
  }

  function startSession(username) {
    const token = generateToken(username);
    const session = { username, token, createdAt: Date.now() };
    localStorage.setItem(IBS_SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function getSession() {
    const raw = localStorage.getItem(IBS_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  function endSession() {
    localStorage.removeItem(IBS_SESSION_KEY);
  }

  resetIfSchemaStale();
  seedIfEmpty();

  return {
    getUsers, saveUsers, findByEmailOrId, findByUsername, findByEmailAndId,
    addUser, updateUser, getAddress,
    getAttempts, registerFailedAttempt, clearAttempts,
    generateToken, startSession, getSession, endSession
  };
})();
