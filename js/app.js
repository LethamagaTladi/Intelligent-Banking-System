/* ==========================================================================
   Intelligent Banking System (IBS) — Application logic
   Implements the screen flow described in the activity diagram:
   Home -> Register / Login / Forgot Password / Forgot Username -> Dashboard
   -> Profile Manager, including validation loops, email/link simulation,
   login attempt lockout, KYC registration details (with an interactive
   pin-drop map for addresses) and profile update validation.
   ========================================================================== */

(function () {

  /* ---------------------------------- helpers ---------------------------------- */
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $all = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const ID_RE = /^\d{13}$/;
  const CELL_RE = /^(0\d{9}|(\+27|27)\d{9})$/;
  const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

  const LABELS = {
    title: { MR: 'Mr', MRS: 'Mrs', MS: 'Ms', MISS: 'Miss', DR: 'Dr', PROF: 'Prof' },
    gender: { MALE: 'Male', FEMALE: 'Female', OTHER: 'Other' },
    marital: { SINGLE: 'Single', MARRIED: 'Married', DIVORCED: 'Divorced', WIDOWED: 'Widowed', LIFE_PARTNER: 'Life partner' },
    residency: {
      BY_BIRTH: 'South African citizen by birth',
      BY_DESCENT: 'South African citizen by descent',
      BY_NATURALISATION: 'South African citizen by naturalisation',
      PERMANENT_RESIDENT: 'Permanent resident'
    },
    ethnic: { BLACK: 'Black African', COLOURED: 'Coloured', INDIAN_ASIAN: 'Indian / Asian', WHITE: 'White', OTHER: 'Other' },
    idType: { SOUTH_AFRICAN_ID: 'South African ID', PASSPORT: 'Passport' },
    prefMethod: { EMAIL: 'Email', SMS: 'SMS', PHONE: 'Phone' },
    incomeSource: {
      SALARY: 'Salary / employment income',
      BUSINESS_INCOME: 'Business income',
      INVESTMENTS: 'Investments / dividends',
      SAVINGS: 'Savings',
      PENSION: 'Pension / retirement funds',
      INHERITANCE: 'Inheritance',
      RENTAL_INCOME: 'Rental income',
      GIFT: 'Gift',
      OTHER: 'Other'
    },
    province: {
      EASTERN_CAPE: 'Eastern Cape', FREE_STATE: 'Free State', GAUTENG: 'Gauteng',
      KWAZULU_NATAL: 'KwaZulu-Natal', LIMPOPO: 'Limpopo', MPUMALANGA: 'Mpumalanga',
      NORTHERN_CAPE: 'Northern Cape', NORTH_WEST: 'North West', WESTERN_CAPE: 'Western Cape'
    }
  };

  function normCell(v) { return String(v || '').replace(/\s/g, ''); }

  function setFieldError(inputEl, errorEl, isInvalid, message) {
    if (!inputEl) return;
    inputEl.classList.toggle('invalid', !!isInvalid);
    if (errorEl) {
      if (message) errorEl.textContent = message;
      errorEl.classList.toggle('show', !!isInvalid);
    }
  }

  function clearForm(formEl) {
    if (!formEl) return;
    $all('input', formEl).forEach(i => { if (i.type !== 'button' && i.type !== 'hidden') i.value = ''; i.classList.remove('invalid'); });
    $all('.field-error', formEl).forEach(e => e.classList.remove('show'));
  }

  function initials(first, last) {
    const a = (first || '?').trim()[0] || '?';
    const b = (last || '').trim()[0] || '';
    return (a + b).toUpperCase();
  }

  // Initials for the registration "Initials" field are derived only from
  // the First name field — one letter per name typed there (e.g. "Thandi
  // Palesa" -> "TP"), never combining in the last name.
  function initialsFromFirstName(firstNameField) {
    return String(firstNameField || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(part => part[0].toUpperCase())
      .join('');
  }

  /* -------- South African ID number parsing (YYMMDDSSSSCAZ) --------
     Digits 1-6 encode the date of birth, digits 7-10 encode gender
     (< 5000 = female, >= 5000 = male). Used to auto-fill Date of birth
     and Gender on the registration form from the ID number captured
     in Step 1, without letting the user type them independently. */
  function parseSaIdNumber(idNumber) {
    if (!/^\d{13}$/.test(idNumber || '')) return null;
    const yy = idNumber.slice(0, 2), mm = idNumber.slice(2, 4), dd = idNumber.slice(4, 6);
    const month = parseInt(mm, 10), day = parseInt(dd, 10);
    const genderDigits = parseInt(idNumber.slice(6, 10), 10);
    const gender = genderDigits < 5000 ? 'FEMALE' : 'MALE';

    let dob = null;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const currentYY = new Date().getFullYear() % 100;
      const century = parseInt(yy, 10) > currentYY ? 1900 : 2000;
      const fullYear = century + parseInt(yy, 10);
      const d = new Date(fullYear, month - 1, day);
      if (d.getFullYear() === fullYear && d.getMonth() === month - 1 && d.getDate() === day) {
        dob = `${fullYear}-${mm}-${dd}`;
      }
    }
    return { dob, gender };
  }

  /* -------- South African ID number validation (format + Luhn checksum) --------
     A genuine SA ID number must: be 13 digits, encode a real calendar date in
     its first 6 digits, carry a valid citizenship digit (0 = citizen, 1 =
     permanent resident) in position 11, and pass the Luhn checksum that
     protects the final digit. */
  function luhnValid(digits) {
    let sum = 0;
    let alternate = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = parseInt(digits.charAt(i), 10);
      if (alternate) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      alternate = !alternate;
    }
    return sum % 10 === 0;
  }

  function isValidSaId(idNumber) {
    const id = String(idNumber || '');
    if (!ID_RE.test(id)) return false;
    const parsed = parseSaIdNumber(id);
    if (!parsed || !parsed.dob) return false;
    const citizenshipDigit = id.charAt(10);
    if (citizenshipDigit !== '0' && citizenshipDigit !== '1') return false;
    return luhnValid(id);
  }

  function formatCurrency(n) {
    const v = Number(n || 0);
    return 'R ' + v.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatAddress(addr) {
    if (!addr) return '—';
    return `${addr.houseNumber} ${addr.street}, ${addr.suburb}, ${addr.city}, ${LABELS.province[addr.province] || addr.province} ${addr.postalCode}`;
  }

  function addressesEqual(a, b) {
    if (!a || !b) return false;
    return ['houseNumber', 'street', 'suburb', 'city', 'province', 'postalCode'].every(k => (a[k] || '') === (b[k] || ''));
  }

  let toastTimer = null;
  function showToast(message, type) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.classList.remove('show'); }, 3200);
  }

  /* ============================================================
     MAP PICKER (Leaflet) — click-to-drop-a-pin address picker
     ============================================================ */
  const mapInstances = {};

  function ensureMap(containerId, lat, lng) {
    if (typeof L === 'undefined') return null;
    let entry = mapInstances[containerId];
    if (!entry) {
      const hasCoords = lat != null && !isNaN(lat) && lng != null && !isNaN(lng);
      const center = hasCoords ? [lat, lng] : [-29.0, 24.0];
      const zoom = hasCoords ? 13 : 5;
      const map = L.map(containerId, { attributionControl: false }).setView(center, zoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, subdomains: 'abc' }).addTo(map);
      entry = { map, marker: hasCoords ? L.marker(center).addTo(map) : null };
      mapInstances[containerId] = entry;
    }
    return entry;
  }

  function initAddressMap(containerId, lat, lng, onPick) {
    const entry = ensureMap(containerId, lat, lng);
    if (!entry) return;
    entry.map.off('click');
    entry.map.on('click', (e) => {
      const { lat: la, lng: ln } = e.latlng;
      if (entry.marker) entry.marker.setLatLng(e.latlng);
      else entry.marker = L.marker(e.latlng).addTo(entry.map);
      onPick(la, ln);
    });
    if (lat != null && !isNaN(lat) && lng != null && !isNaN(lng)) {
      if (entry.marker) entry.marker.setLatLng([lat, lng]); else entry.marker = L.marker([lat, lng]).addTo(entry.map);
      entry.map.setView([lat, lng], 13);
    }
    setTimeout(() => entry.map.invalidateSize(), 150);
  }

  function makeCoordsHandler(latInputId, lngInputId, coordsElId) {
    return (lat, lng) => {
      $('#' + latInputId).value = lat;
      $('#' + lngInputId).value = lng;
      const el = $('#' + coordsElId);
      el.textContent = `Selected location: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      el.classList.remove('empty');
    };
  }

  function fillAddressBlock(prefix, addr) {
    addr = addr || {};
    $(`#${prefix}-house`).value = addr.houseNumber || '';
    $(`#${prefix}-street`).value = addr.street || '';
    $(`#${prefix}-suburb`).value = addr.suburb || '';
    $(`#${prefix}-city`).value = addr.city || '';
    $(`#${prefix}-province`).value = addr.province || 'GAUTENG';
    $(`#${prefix}-postal`).value = addr.postalCode || '';
  }

  function setCoordsInputs(latInputId, lngInputId, coordsElId, lat, lng) {
    const hasCoords = lat != null && !isNaN(lat) && lng != null && !isNaN(lng);
    $('#' + latInputId).value = hasCoords ? lat : '';
    $('#' + lngInputId).value = hasCoords ? lng : '';
    const el = $('#' + coordsElId);
    if (hasCoords) {
      el.textContent = `Selected location: ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
      el.classList.remove('empty');
    } else {
      el.textContent = 'No location selected yet.';
      el.classList.add('empty');
    }
  }

  function validateAddressBlock(fieldPrefix, latId, lngId, coordsElId) {
    let valid = true;
    const vals = {};
    ['house', 'street', 'suburb', 'city', 'postal'].forEach(f => {
      const el = $(`#${fieldPrefix}-${f}`);
      const err = $(`#${fieldPrefix}-${f}-error`);
      if (!el.value.trim()) { setFieldError(el, err, true); valid = false; }
      else setFieldError(el, err, false);
      vals[f] = el.value.trim();
    });
    vals.province = $(`#${fieldPrefix}-province`).value;

    const latVal = $('#' + latId).value;
    const lngVal = $('#' + lngId).value;
    const coordsEl = $('#' + coordsElId);
    if (!latVal || !lngVal) {
      coordsEl.textContent = 'Please select a location on the map.';
      coordsEl.classList.add('empty');
      valid = false;
    } else {
      coordsEl.classList.remove('empty');
    }

    return {
      valid,
      address: {
        houseNumber: vals.house, street: vals.street, suburb: vals.suburb, city: vals.city,
        province: vals.province, postalCode: vals.postal,
        latitude: latVal ? parseFloat(latVal) : null, longitude: lngVal ? parseFloat(lngVal) : null
      }
    };
  }

  /* -------- Postal code fields: digits only -------- */
  $all('.js-digits-only').forEach(el => {
    el.addEventListener('input', () => {
      const cleaned = el.value.replace(/\D/g, '');
      if (cleaned !== el.value) el.value = cleaned;
    });
  });

  /* ---------------------------------- screen router ---------------------------------- */
  const AUTH_REQUIRED = ['dashboard', 'profile', 'placeholder'];

  function goTo(screenId, opts) {
    opts = opts || {};
    if (AUTH_REQUIRED.includes(screenId) && !IBSDb.getSession()) {
      screenId = 'login';
    }
    $all('.screen').forEach(s => s.classList.remove('active'));
    const target = $('#screen-' + screenId);
    if (!target) return;
    target.classList.add('active');
    window.scrollTo(0, 0);
    onEnterScreen(screenId, opts);
  }

  function onEnterScreen(screenId, opts) {
    if (screenId === 'login') {
      $('#login-locked-alert').hidden = true;
      $('#login-error-alert').hidden = true;
      $('#login-info-alert').hidden = !opts.infoMessage;
      if (opts.infoMessage) $('#login-info-text').textContent = opts.infoMessage;
    }
    if (screenId === 'register-step1') {
      $('#reg1-error-alert').hidden = true;
    }
    if (screenId === 'register-details') {
      applyIdDerivedFields();
      initAddressMap('reg2-map-physical', null, null, makeCoordsHandler('reg2-phys-lat', 'reg2-phys-lng', 'reg2-phys-coords'));
      if (!$('#reg2-postal-same').checked) {
        initAddressMap('reg2-map-postal', null, null, makeCoordsHandler('reg2-post-lat', 'reg2-post-lng', 'reg2-post-coords'));
      }
    }
    if (screenId === 'forgot-password') {
      resetForgotPasswordScreen();
    }
    if (screenId === 'forgot-username') {
      $('#fu-not-found').hidden = true;
      clearForm($('#forgot-username-form'));
    }
    if (screenId === 'reset-username') {
      enterResetUsername();
    }
    if (screenId === 'dashboard') {
      renderDashboard();
    }
    if (screenId === 'profile') {
      renderProfile();
    }
    if (screenId === 'placeholder') {
      const title = opts.title || 'Coming soon';
      $('#placeholder-title').textContent = title;
      $('#placeholder-title-2').textContent = title;
      updateTitlebar(currentUser());
    }
  }

  /* click delegation for [data-goto] and [data-placeholder] */
  document.addEventListener('click', (e) => {
    const gotoEl = e.target.closest('[data-goto]');
    if (gotoEl) {
      e.preventDefault();
      goTo(gotoEl.getAttribute('data-goto'));
      return;
    }
    const phEl = e.target.closest('[data-placeholder]');
    if (phEl) {
      e.preventDefault();
      goTo('placeholder', { title: phEl.getAttribute('data-placeholder') });
      return;
    }
  });

  /* delegated logout (titlebar dropdown + sidebar) */
  document.addEventListener('click', (e) => {
    if (e.target.closest('.js-logout')) doLogout();
  });

  /* mobile sidebar drawer (hamburger toggle + backdrop) */
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.js-sidebar-toggle')) return;
    e.preventDefault();
    const shell = e.target.closest('.app-shell');
    if (!shell) return;
    const sidebar = shell.querySelector('.sidebar');
    const backdrop = shell.querySelector('.sidebar-backdrop');
    const opening = !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', opening);
    if (backdrop) backdrop.classList.toggle('open', opening);
  });

  /* titlebar avatar dropdown */
  document.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('.js-tb-toggle');
    if (toggleBtn) {
      e.stopPropagation();
      const dropdown = toggleBtn.parentElement.querySelector('.tb-dropdown');
      const wasOpen = dropdown.classList.contains('open');
      $all('.tb-dropdown.open').forEach(d => d.classList.remove('open'));
      if (!wasOpen) dropdown.classList.add('open');
      return;
    }
    $all('.tb-dropdown.open').forEach(d => d.classList.remove('open'));
  });

  /* password show/hide toggles */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-visibility');
    if (!btn) return;
    const input = document.getElementById(btn.getAttribute('data-toggle-for'));
    if (!input) return;
    const isPw = input.type === 'password';
    input.type = isPw ? 'text' : 'password';
    btn.innerHTML = `<svg class="icon"><use href="#icon-${isPw ? 'eye-off' : 'eye'}"/></svg>`;
  });

  function updateTitlebar(user) {
    if (!user) return;
    const av = initials(user.firstName, user.lastName);
    $all('.tb-avatar-initials').forEach(el => el.textContent = av);
    $all('.tb-user-name-text').forEach(el => el.textContent = user.firstName);
  }

  /* ============================================================
     LOGIN
     ============================================================ */
  $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    $('#login-locked-alert').hidden = true;
    $('#login-error-alert').hidden = true;
    $('#login-info-alert').hidden = true;

    const username = $('#login-username').value.trim();
    const password = $('#login-password').value;

    if (!username || !password) {
      $('#login-error-text').textContent = 'Please enter both your username and password.';
      $('#login-error-alert').hidden = false;
      return;
    }

    const user = IBSDb.findByUsername(username);

    if (user && user.locked) {
      $('#login-locked-alert').hidden = false;
      return;
    }

    if (!user || user.password !== password) {
      const attempts = IBSDb.registerFailedAttempt(username);
      if (user && attempts >= 3) {
        IBSDb.updateUser(user.username, { locked: true });
        $('#login-locked-alert').hidden = false;
      } else {
        $('#login-error-text').textContent = user
          ? `Incorrect username or password. Attempt ${attempts} of 3 before your account is locked.`
          : 'Incorrect username or password.';
        $('#login-error-alert').hidden = false;
      }
      $('#login-password').value = '';
      return;
    }

    // Valid credentials
    IBSDb.clearAttempts(username);
    IBSDb.startSession(user.username);
    fuState.user = null;
    showToast(`Welcome back, ${user.firstName}!`, 'success');
    goTo('dashboard');
    clearForm($('#login-form'));
  });

  function doLogout() {
    IBSDb.endSession();
    showToast('You have been signed out.');
    goTo('home');
  }

  /* ============================================================
     REGISTER — Step 1: Enter Email, ID Type & ID/Passport Number
     ============================================================ */
  const regState = {};

  $('#register-step1-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const emailInput = $('#reg1-email'), idInput = $('#reg1-id');
    const email = emailInput.value.trim();
    const idNumber = idInput.value.trim();

    const emailValid = EMAIL_RE.test(email);
    const idValid = isValidSaId(idNumber);

    setFieldError(emailInput, $('#reg1-email-error'), !emailValid);
    setFieldError(idInput, $('#reg1-id-error'), !idValid);
    if (!emailValid || !idValid) return;

    const existing = IBSDb.findByEmailOrId(email, idNumber);
    if (existing) {
      $('#reg1-error-text').textContent = 'An account with this email or ID number already exists. Redirecting you to sign in…';
      $('#reg1-error-alert').hidden = false;
      setTimeout(() => goTo('login', { infoMessage: 'This account already exists. Please sign in below.' }), 1400);
      return;
    }

    regState.email = email;
    regState.idNumber = idNumber;
    regState.idType = 'SOUTH_AFRICAN_ID';
    goTo('register-details');
    $('#reg2-email').value = email;
  });

  /* ============================================================
     REGISTER — Step 2: Enter Details (KYC)
     ============================================================ */
  let initialsEdited = false;
  $('#reg2-initials').addEventListener('input', () => { initialsEdited = true; });
  function autoInitials() {
    if (initialsEdited) return;
    $('#reg2-initials').value = initialsFromFirstName($('#reg2-first').value);
  }
  $('#reg2-first').addEventListener('input', autoInitials);

  /* -------- ID number (read-only) + auto-filled Date of birth / Gender -------- */
  function applyIdDerivedFields() {
    const idNumber = regState.idNumber || '';
    $('#reg2-idnumber').value = idNumber ? `${idNumber} (South African ID)` : '';

    const dobInput = $('#reg2-dob');
    const genderSelect = $('#reg2-gender');
    const dobHint = $('#reg2-dob-hint');

    const parsed = parseSaIdNumber(idNumber);
    if (parsed && parsed.dob) {
      dobInput.value = parsed.dob;
      dobInput.readOnly = true;
    } else {
      dobInput.value = '';
      dobInput.readOnly = false;
    }
    genderSelect.value = parsed ? parsed.gender : genderSelect.value;
    genderSelect.disabled = !!parsed;
    dobHint.textContent = 'Auto-filled from your South African ID number.';
  }

  $('#reg2-postal-same').addEventListener('change', (e) => {
    const show = !e.target.checked;
    $('#reg2-postal-fields').style.display = show ? '' : 'none';
    if (show) {
      initAddressMap('reg2-map-postal', null, null, makeCoordsHandler('reg2-post-lat', 'reg2-post-lng', 'reg2-post-coords'));
    }
  });

  $('#register-details-form').addEventListener('submit', (e) => {
    e.preventDefault();
    let valid = true;

    function req(input, errorId) {
      const el = $(input), err = $(errorId);
      if (!el.value.trim()) { setFieldError(el, err, true); valid = false; return false; }
      setFieldError(el, err, false);
      return true;
    }

    req('#reg2-first', '#reg2-first-error');
    req('#reg2-last', '#reg2-last-error');
    req('#reg2-initials', '#reg2-initials-error');
    req('#reg2-occupation', '#reg2-occupation-error');
    req('#reg2-income', '#reg2-income-error');
    req('#reg2-dob', '#reg2-dob-error');

    const emailEl = $('#reg2-email');
    if (!EMAIL_RE.test(emailEl.value.trim())) { setFieldError(emailEl, $('#reg2-email-error'), true); valid = false; }
    else setFieldError(emailEl, $('#reg2-email-error'), false);

    const cellEl = $('#reg2-cell');
    if (!CELL_RE.test(normCell(cellEl.value))) { setFieldError(cellEl, $('#reg2-cell-error'), true); valid = false; }
    else setFieldError(cellEl, $('#reg2-cell-error'), false);

    const cell2El = $('#reg2-cell2');
    if (cell2El.value.trim() && !CELL_RE.test(normCell(cell2El.value))) { setFieldError(cell2El, $('#reg2-cell2-error'), true); valid = false; }
    else setFieldError(cell2El, $('#reg2-cell2-error'), false);

    const usernameEl = $('#reg2-username');
    const usernameVal = usernameEl.value.trim();
    if (usernameVal.length < 4 || IBSDb.findByUsername(usernameVal)) {
      setFieldError(usernameEl, $('#reg2-username-error'), true,
        usernameVal.length < 4 ? 'Username must be at least 4 characters.' : 'This username is already taken.');
      valid = false;
    } else {
      setFieldError(usernameEl, $('#reg2-username-error'), false);
    }

    const passwordEl = $('#reg2-password'), confirmEl = $('#reg2-confirm');
    if (!PASSWORD_RE.test(passwordEl.value)) { setFieldError(passwordEl, $('#reg2-password-error'), true); valid = false; }
    else setFieldError(passwordEl, $('#reg2-password-error'), false);
    if (confirmEl.value !== passwordEl.value || !confirmEl.value) { setFieldError(confirmEl, $('#reg2-confirm-error'), true); valid = false; }
    else setFieldError(confirmEl, $('#reg2-confirm-error'), false);

    const physResult = validateAddressBlock('reg2-phys', 'reg2-phys-lat', 'reg2-phys-lng', 'reg2-phys-coords');
    if (!physResult.valid) valid = false;

    const postalSame = $('#reg2-postal-same').checked;
    let postalAddress;
    if (!postalSame) {
      const postResult = validateAddressBlock('reg2-post', 'reg2-post-lat', 'reg2-post-lng', 'reg2-post-coords');
      if (!postResult.valid) valid = false;
      postalAddress = postResult.address;
    }

    const termsEl = $('#reg2-terms');
    if (!termsEl.checked) { setFieldError(termsEl, $('#reg2-terms-error'), true); valid = false; }
    else setFieldError(termsEl, $('#reg2-terms-error'), false);

    $('#reg2-error-alert').hidden = valid;
    if (!valid) return; // loop back to Enter Details (stay on this screen)

    regState.title = $('#reg2-title').value;
    regState.firstName = $('#reg2-first').value.trim();
    regState.lastName = $('#reg2-last').value.trim();
    regState.initials = $('#reg2-initials').value.trim().toUpperCase();
    regState.dateOfBirth = $('#reg2-dob').value;
    regState.gender = $('#reg2-gender').value;
    regState.maritalStatus = $('#reg2-marital').value;
    regState.nationality = $('#reg2-nationality').value.trim();
    regState.residency = $('#reg2-residency').value;
    regState.ethnicGroup = $('#reg2-ethnic').value;
    regState.bankType = $('#reg2-banktype').value;
    regState.occupation = $('#reg2-occupation').value.trim();
    regState.incomeSource = $('#reg2-income').value.trim();

    regState.email = emailEl.value.trim();
    regState.prefMethod = $('#reg2-prefmethod').value;
    regState.primaryNumber = cellEl.value.trim();
    regState.secondaryNumber = cell2El.value.trim();

    regState.physicalAddress = Object.assign({ addressType: 'PHYSICAL' }, physResult.address);
    regState.postalAddress = postalSame
      ? Object.assign({}, regState.physicalAddress, { addressType: 'POSTAL' })
      : Object.assign({ addressType: 'POSTAL' }, postalAddress);

    regState.username = usernameVal;
    regState.password = passwordEl.value;

    $('#verify-email-target').textContent = regState.email;
    goTo('register-verify');
  });

  /* ============================================================
     REGISTER — Step 3: Receive Email / Create Profile
     ============================================================ */
  $('#verify-receive-email-btn').addEventListener('click', () => {
    const accountNumber = '62' + Math.floor(10000000 + Math.random() * 89999999);
    const newUser = {
      title: regState.title,
      firstName: regState.firstName,
      lastName: regState.lastName,
      initials: regState.initials,
      dateOfBirth: regState.dateOfBirth,
      maritalStatus: regState.maritalStatus,
      gender: regState.gender,
      residency: regState.residency,
      nationality: regState.nationality,
      idType: regState.idType,
      idNumber: regState.idNumber,
      ethnicGroup: regState.ethnicGroup,
      occupation: regState.occupation,
      incomeSource: regState.incomeSource,
      bankType: regState.bankType,

      contact: {
        primaryNumber: regState.primaryNumber,
        secondaryNumber: regState.secondaryNumber,
        emailAddress: regState.email,
        prefMethod: regState.prefMethod
      },
      addresses: [regState.physicalAddress, regState.postalAddress],

      username: regState.username,
      password: regState.password,

      accountType: IBS_BANK_TYPE_LABELS[regState.bankType] || 'Everyday Account',
      accountNumber: accountNumber.slice(0, 4) + ' ' + accountNumber.slice(4, 8) + ' ' + accountNumber.slice(8, 12),
      balance: 500.00,
      twoFactorEnabled: false,
      locked: false,
      transactions: [
        { merchant: 'Welcome bonus — Intelligent Banking System', category: 'Income', date: 'Today', amount: 500.00 }
      ]
    };
    IBSDb.addUser(newUser);
    goTo('register-success');
    clearForm($('#register-step1-form'));
    clearForm($('#register-details-form'));
    initialsEdited = false;
    $('#reg2-terms').checked = false;
    $('#reg2-postal-same').checked = true;
    $('#reg2-postal-fields').style.display = 'none';
    setCoordsInputs('reg2-phys-lat', 'reg2-phys-lng', 'reg2-phys-coords', null, null);
    setCoordsInputs('reg2-post-lat', 'reg2-post-lng', 'reg2-post-coords', null, null);
  });

  $('#verify-fail-btn').addEventListener('click', () => {
    goTo('register-failed');
  });

  /* ============================================================
     FORGOT PASSWORD
     ============================================================ */
  const fpState = {};

  function resetForgotPasswordScreen() {
    $('#fp-request-state').style.display = '';
    $('#fp-sent-state').style.display = 'none';
    $('#fp-expired-state').style.display = 'none';
    $('#fp-update-state').style.display = 'none';
    $('#fp-success-state').style.display = 'none';
    $('#fp-email-not-found').hidden = true;
    clearForm($('#forgot-password-form'));
    clearForm($('#fp-update-form'));
  }

  $('#forgot-password-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('#fp-email').value.trim();
    const idNumber = $('#fp-id').value.trim();
    $('#fp-email-not-found').hidden = true;

    if (!email || !idNumber) {
      $('#fp-email-not-found span').textContent = 'Enter both your email address and ID number.';
      $('#fp-email-not-found').hidden = false;
      return;
    }

    const user = IBSDb.findByEmailAndId(email, idNumber);
    if (!user) {
      $('#fp-email-not-found span').textContent = "We couldn't find an account matching that email and ID number. Please check your details and try again.";
      $('#fp-email-not-found').hidden = false;
      return;
    }
    fpState.username = user.username;
    fpState.email = user.contact.emailAddress;
    $('#fp-sent-email').textContent = user.contact.emailAddress;
    $('#fp-request-state').style.display = 'none';
    $('#fp-sent-state').style.display = '';
  });

  $('#fp-click-link-btn').addEventListener('click', () => {
    // Validate The Link -> Link Valid? (always valid in this simulation)
    $('#fp-sent-state').style.display = 'none';
    $('#fp-update-state').style.display = '';
  });

  $('#fp-simulate-expired-btn').addEventListener('click', () => {
    $('#fp-sent-state').style.display = 'none';
    $('#fp-expired-state').style.display = '';
  });

  $('#fp-resend-btn').addEventListener('click', () => {
    $('#fp-expired-state').style.display = 'none';
    $('#fp-sent-state').style.display = '';
  });

  $('#fp-update-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const pw = $('#fp-new-password'), cpw = $('#fp-confirm-password');
    const pwValid = PASSWORD_RE.test(pw.value);
    const matchValid = cpw.value === pw.value && cpw.value !== '';
    setFieldError(pw, $('#fp-new-password-error'), !pwValid);
    setFieldError(cpw, $('#fp-confirm-password-error'), !matchValid);
    if (!pwValid || !matchValid) return;

    IBSDb.updateUser(fpState.username, { password: pw.value, locked: false });
    IBSDb.clearAttempts(fpState.username);
    $('#fp-update-state').style.display = 'none';
    $('#fp-success-state').style.display = '';
  });

  /* ============================================================
     FORGOT USERNAME
     ============================================================ */
  const fuState = { user: null };

  $('#forgot-username-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('#fu-email').value.trim();
    const idNumber = $('#fu-id').value.trim();
    $('#fu-not-found').hidden = true;

    if (!email || !idNumber) {
      $('#fu-not-found span').textContent = 'Enter both your email address and ID number.';
      $('#fu-not-found').hidden = false;
      return;
    }

    const user = IBSDb.findByEmailAndId(email, idNumber);
    if (!user) {
      $('#fu-not-found span').textContent = "We couldn't find an account matching that email and ID number. Please check your details and try again.";
      $('#fu-not-found').hidden = false;
      return;
    }

    fuState.user = user;
    goTo('reset-username');
  });

  /* ============================================================
     RESET USERNAME  (reachable from Forgot Username, or from
     Profile Management -> Security -> Reset Username)
     ============================================================ */
  let ruContext = 'forgot';

  function enterResetUsername() {
    $('#ru-form-state').style.display = '';
    $('#ru-success-state').style.display = 'none';
    clearForm($('#reset-username-form'));

    let user = fuState.user;
    const session = IBSDb.getSession();
    const fromProfile = !user && session;
    if (fromProfile) user = IBSDb.findByUsername(session.username);

    if (!user) { goTo('home'); return; }

    $('#ru-current').value = user.username;

    if (fromProfile) {
      ruContext = 'profile';
      $('#ru-found-alert').className = 'alert alert-info';
      $('#ru-found-text').textContent = 'Choose a new username for your account below.';
    } else {
      ruContext = 'forgot';
      $('#ru-found-alert').className = 'alert alert-success';
      $('#ru-found-text').innerHTML = `We found your account. Your current username is <strong>${user.username}</strong>.`;
    }
  }

  $('#ru-back-btn').addEventListener('click', () => {
    goTo(ruContext === 'profile' ? 'profile' : 'forgot-username');
  });

  $('#reset-username-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const user = fuState.user || IBSDb.findByUsername((IBSDb.getSession() || {}).username);
    if (!user) { goTo('home'); return; }

    const newInput = $('#ru-new'), confirmInput = $('#ru-confirm');
    const newUsername = newInput.value.trim();
    const confirmUsername = confirmInput.value.trim();

    const lengthValid = newUsername.length >= 4;
    const taken = lengthValid && newUsername.toLowerCase() !== user.username.toLowerCase() && IBSDb.findByUsername(newUsername);
    let valid = true;

    if (!lengthValid) {
      setFieldError(newInput, $('#ru-new-error'), true, 'Username must be at least 4 characters.');
      valid = false;
    } else if (taken) {
      setFieldError(newInput, $('#ru-new-error'), true, 'This username is already taken.');
      valid = false;
    } else {
      setFieldError(newInput, $('#ru-new-error'), false);
    }

    if (confirmUsername !== newUsername || !confirmUsername) {
      setFieldError(confirmInput, $('#ru-confirm-error'), true);
      valid = false;
    } else {
      setFieldError(confirmInput, $('#ru-confirm-error'), false);
    }

    if (!valid) return; // loop back, stay on Reset Username form

    IBSDb.updateUser(user.username, { username: newUsername });
    IBSDb.endSession(); // require re-authentication with the new username
    fuState.user = null;

    $('#ru-form-state').style.display = 'none';
    $('#ru-success-state').style.display = '';
  });

  /* ============================================================
     DASHBOARD
     ============================================================ */
  function currentUser() {
    const session = IBSDb.getSession();
    return session ? IBSDb.findByUsername(session.username) : null;
  }

  function renderDashboard() {
    const user = currentUser();
    if (!user) { goTo('login'); return; }
    updateTitlebar(user);
    $('#dash-welcome').textContent = `Welcome, ${user.firstName}`;
    $('#dash-acc-label').textContent = `${user.accountType} · ${user.accountNumber.slice(-4)}`;
    $('#dash-balance').textContent = formatCurrency(user.balance);

    const list = $('#dash-txn-list');
    list.innerHTML = '';
    const txns = user.transactions || [];
    if (txns.length === 0) {
      list.innerHTML = '<li class="txn-item" style="justify-content:center; color:var(--grey);">No transactions yet.</li>';
    } else {
      txns.forEach(t => {
        const positive = t.amount >= 0;
        const li = document.createElement('li');
        li.className = 'txn-item';
        li.innerHTML = `
          <div class="txn-left">
            <span class="txn-icon"><svg class="icon"><use href="#icon-repeat"/></svg></span>
            <div>
              <div class="txn-name">${t.merchant}</div>
              <div class="txn-meta">${t.category} · ${t.date}</div>
            </div>
          </div>
          <div class="txn-amount ${positive ? 'positive' : 'negative'}">${positive ? '+' : '-'}${formatCurrency(Math.abs(t.amount))}</div>
        `;
        list.appendChild(li);
      });
    }
  }

  /* ============================================================
     PROFILE MANAGEMENT
     ============================================================ */
  function renderProfile() {
    const user = currentUser();
    if (!user) { goTo('login'); return; }

    exitEditMode();
    exitSofEditMode();
    $('#profile-save-success').hidden = true;
    $('#profile-save-error').hidden = true;
    updateTitlebar(user);

    const av = initials(user.firstName, user.lastName);
    $('#profile-summary-avatar').textContent = av;
    $('#profile-summary-name').textContent = `${LABELS.title[user.title] || ''} ${user.firstName} ${user.lastName}`.trim();
    $('#profile-summary-type').textContent = user.accountType;
    $('#profile-summary-accno').textContent = user.accountNumber;

    // Personal & identification (read-only, KYC-locked)
    $('#pv-title').textContent = LABELS.title[user.title] || user.title;
    $('#pv-fullname').textContent = `${user.firstName} ${user.lastName}`;
    $('#pv-initials').textContent = user.initials;
    $('#pv-dob').textContent = user.dateOfBirth || '—';
    $('#pv-gender').textContent = LABELS.gender[user.gender] || user.gender;
    $('#pv-marital').textContent = LABELS.marital[user.maritalStatus] || user.maritalStatus;
    $('#pv-nationality').textContent = user.nationality;
    $('#pv-residency').textContent = LABELS.residency[user.residency] || user.residency;
    $('#pv-ethnic').textContent = LABELS.ethnic[user.ethnicGroup] || user.ethnicGroup;
    $('#pv-idtype').textContent = LABELS.idType[user.idType] || user.idType;
    $('#pv-id').textContent = user.idNumber;

    // Source of Funds
    $('#pv-acctype').textContent = user.accountType;
    $('#pv-occupation').textContent = user.occupation;
    $('#pv-income').textContent = LABELS.incomeSource[user.incomeSource] || user.incomeSource;

    // Contact
    $('#pv-email').textContent = user.contact.emailAddress;
    $('#pv-prefmethod').textContent = LABELS.prefMethod[user.contact.prefMethod] || user.contact.prefMethod;
    $('#pv-cell').textContent = user.contact.primaryNumber;
    $('#pv-cell2').textContent = user.contact.secondaryNumber || '—';

    // Addresses
    const physAddr = IBSDb.getAddress(user, 'PHYSICAL');
    const postAddr = IBSDb.getAddress(user, 'POSTAL');
    $('#pv-phys-address').textContent = formatAddress(physAddr);
    $('#pv-phys-coords').textContent = (physAddr && physAddr.latitude != null)
      ? `${physAddr.latitude.toFixed(5)}, ${physAddr.longitude.toFixed(5)}` : '—';
    $('#pv-post-address').textContent = addressesEqual(physAddr, postAddr)
      ? 'Same as residential address' : formatAddress(postAddr);

    $('#sec-username').textContent = user.username;
  }

  function exitEditMode() {
    $('#profile-view-mode').style.display = '';
    $('#profile-edit-form').style.display = 'none';
  }

  function exitSofEditMode() {
    $('#profile-sof-view-mode').style.display = '';
    $('#profile-sof-edit-form').style.display = 'none';
  }

  /* -------- Source of Funds (editable) -------- */
  $('#profile-sof-edit-btn').addEventListener('click', () => {
    const user = currentUser();
    if (!user) return;

    $('#pe-banktype').value = user.bankType;
    $('#pe-occupation').value = user.occupation;
    $('#pe-income').value = user.incomeSource;
    $all('#profile-sof-edit-form .field-error').forEach(el => el.classList.remove('show'));
    $all('#profile-sof-edit-form input, #profile-sof-edit-form select').forEach(el => el.classList.remove('invalid'));

    $('#profile-sof-view-mode').style.display = 'none';
    $('#profile-sof-edit-form').style.display = '';
    $('#profile-save-success').hidden = true;
  });

  $('#profile-sof-cancel-edit').addEventListener('click', () => {
    exitSofEditMode();
  });

  $('#profile-sof-edit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const user = currentUser();
    if (!user) return;

    let valid = true;
    const occEl = $('#pe-occupation'), incomeEl = $('#pe-income');
    if (!occEl.value.trim()) { setFieldError(occEl, $('#pe-occupation-error'), true); valid = false; }
    else setFieldError(occEl, $('#pe-occupation-error'), false);
    if (!incomeEl.value.trim()) { setFieldError(incomeEl, $('#pe-income-error'), true); valid = false; }
    else setFieldError(incomeEl, $('#pe-income-error'), false);

    if (!valid) {
      $('#profile-save-error').hidden = false;
      $('#profile-save-success').hidden = true;
      return;
    }

    const bankType = $('#pe-banktype').value;
    IBSDb.updateUser(user.username, {
      bankType: bankType,
      accountType: IBS_BANK_TYPE_LABELS[bankType] || user.accountType,
      occupation: occEl.value.trim(),
      incomeSource: incomeEl.value.trim()
    });

    $('#profile-save-error').hidden = true;
    renderProfile();
    $('#profile-save-success').hidden = false;
    showToast('Source of funds updated successfully', 'success');
    setTimeout(() => { $('#profile-save-success').hidden = true; }, 3500);
  });

  $('#profile-edit-btn').addEventListener('click', () => {
    const user = currentUser();
    if (!user) return;

    $('#pe-email').value = user.contact.emailAddress;
    $('#pe-prefmethod').value = user.contact.prefMethod;
    $('#pe-cell').value = user.contact.primaryNumber;
    $('#pe-cell2').value = user.contact.secondaryNumber || '';
    $all('#profile-edit-form .field-error').forEach(el => el.classList.remove('show'));
    $all('#profile-edit-form input, #profile-edit-form select').forEach(el => el.classList.remove('invalid'));

    const physAddr = IBSDb.getAddress(user, 'PHYSICAL');
    const postAddr = IBSDb.getAddress(user, 'POSTAL');
    const same = addressesEqual(physAddr, postAddr);

    fillAddressBlock('pe-phys', physAddr);
    setCoordsInputs('pe-phys-lat', 'pe-phys-lng', 'pe-phys-coords-display', physAddr && physAddr.latitude, physAddr && physAddr.longitude);
    initAddressMap('pe-map-physical', physAddr && physAddr.latitude, physAddr && physAddr.longitude,
      makeCoordsHandler('pe-phys-lat', 'pe-phys-lng', 'pe-phys-coords-display'));

    fillAddressBlock('pe-post', postAddr || physAddr);
    setCoordsInputs('pe-post-lat', 'pe-post-lng', 'pe-post-coords-display', postAddr && postAddr.latitude, postAddr && postAddr.longitude);
    $('#pe-postal-same').checked = same;
    $('#pe-postal-fields').style.display = same ? 'none' : '';
    if (!same) {
      initAddressMap('pe-map-postal', postAddr && postAddr.latitude, postAddr && postAddr.longitude,
        makeCoordsHandler('pe-post-lat', 'pe-post-lng', 'pe-post-coords-display'));
    }

    $('#profile-view-mode').style.display = 'none';
    $('#profile-edit-form').style.display = '';
    $('#profile-save-success').hidden = true;
  });

  $('#pe-postal-same').addEventListener('change', (e) => {
    const show = !e.target.checked;
    $('#pe-postal-fields').style.display = show ? '' : 'none';
    if (show) {
      const lat = parseFloat($('#pe-post-lat').value), lng = parseFloat($('#pe-post-lng').value);
      initAddressMap('pe-map-postal', isNaN(lat) ? null : lat, isNaN(lng) ? null : lng,
        makeCoordsHandler('pe-post-lat', 'pe-post-lng', 'pe-post-coords-display'));
    }
  });

  $('#profile-cancel-edit').addEventListener('click', () => {
    exitEditMode();
  });

  $('#profile-edit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const user = currentUser();
    if (!user) return;

    let valid = true;

    const emailEl = $('#pe-email');
    if (!EMAIL_RE.test(emailEl.value.trim())) { setFieldError(emailEl, $('#pe-email-error'), true); valid = false; }
    else setFieldError(emailEl, $('#pe-email-error'), false);

    const cellEl = $('#pe-cell');
    if (!CELL_RE.test(normCell(cellEl.value))) { setFieldError(cellEl, $('#pe-cell-error'), true); valid = false; }
    else setFieldError(cellEl, $('#pe-cell-error'), false);

    const cell2El = $('#pe-cell2');
    if (cell2El.value.trim() && !CELL_RE.test(normCell(cell2El.value))) { setFieldError(cell2El, $('#pe-cell2-error'), true); valid = false; }
    else setFieldError(cell2El, $('#pe-cell2-error'), false);

    const physResult = validateAddressBlock('pe-phys', 'pe-phys-lat', 'pe-phys-lng', 'pe-phys-coords-display');
    if (!physResult.valid) valid = false;

    const postalSame = $('#pe-postal-same').checked;
    let postalAddress;
    if (!postalSame) {
      const postResult = validateAddressBlock('pe-post', 'pe-post-lat', 'pe-post-lng', 'pe-post-coords-display');
      if (!postResult.valid) valid = false;
      postalAddress = postResult.address;
    }

    // "Changes Valid?" decision
    if (!valid) {
      $('#profile-save-error').hidden = false;
      $('#profile-save-success').hidden = true;
      return; // loop back to Update Profile (stay in edit mode)
    }

    const physicalAddress = Object.assign({ addressType: 'PHYSICAL' }, physResult.address);
    const finalPostal = postalSame
      ? Object.assign({}, physicalAddress, { addressType: 'POSTAL' })
      : Object.assign({ addressType: 'POSTAL' }, postalAddress);

    IBSDb.updateUser(user.username, {
      contact: {
        emailAddress: emailEl.value.trim(),
        prefMethod: $('#pe-prefmethod').value,
        primaryNumber: cellEl.value.trim(),
        secondaryNumber: cell2El.value.trim()
      },
      addresses: [physicalAddress, finalPostal]
    });

    $('#profile-save-error').hidden = true;
    renderProfile();
    $('#profile-save-success').hidden = false;
    showToast('Profile updated successfully', 'success');
    setTimeout(() => { $('#profile-save-success').hidden = true; }, 3500);
  });

  /* -------- Edit username modal -------- */
  $('#sec-edit-username-btn').addEventListener('click', () => {
    const user = currentUser();
    if (!user) return;
    clearForm($('#edit-username-form'));
    $('#eu-current').value = user.username;
    $('#username-modal').classList.add('active');
  });
  $('#eu-cancel').addEventListener('click', closeUsernameModal);
  $('#username-modal').addEventListener('click', (e) => {
    if (e.target.id === 'username-modal') closeUsernameModal();
  });
  function closeUsernameModal() { $('#username-modal').classList.remove('active'); }

  $('#edit-username-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const user = currentUser();
    if (!user) return;

    const newInput = $('#eu-new'), confirmInput = $('#eu-confirm');
    const newUsername = newInput.value.trim();
    const confirmUsername = confirmInput.value.trim();

    const lengthValid = newUsername.length >= 4;
    const unchanged = lengthValid && newUsername.toLowerCase() === user.username.toLowerCase();
    const taken = lengthValid && !unchanged && IBSDb.findByUsername(newUsername);
    let valid = true;

    if (!lengthValid) {
      setFieldError(newInput, $('#eu-new-error'), true, 'Username must be at least 4 characters.');
      valid = false;
    } else if (taken) {
      setFieldError(newInput, $('#eu-new-error'), true, 'This username is already taken.');
      valid = false;
    } else {
      setFieldError(newInput, $('#eu-new-error'), false);
    }

    if (confirmUsername !== newUsername || !confirmUsername) {
      setFieldError(confirmInput, $('#eu-confirm-error'), true);
      valid = false;
    } else {
      setFieldError(confirmInput, $('#eu-confirm-error'), false);
    }

    if (!valid) return;

    IBSDb.updateUser(user.username, { username: newUsername });
    IBSDb.startSession(newUsername); // keep the user signed in under the new username
    closeUsernameModal();
    renderProfile();
    showToast('Username updated successfully', 'success');
  });

  /* -------- Change password modal -------- */
  $('#sec-change-password-btn').addEventListener('click', () => {
    clearForm($('#change-password-form'));
    $('#password-modal').classList.add('active');
  });
  $('#cp-cancel').addEventListener('click', closePasswordModal);
  $('#password-modal').addEventListener('click', (e) => {
    if (e.target.id === 'password-modal') closePasswordModal();
  });
  function closePasswordModal() { $('#password-modal').classList.remove('active'); }

  $('#change-password-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const user = currentUser();
    if (!user) return;

    const cur = $('#cp-current'), next = $('#cp-new'), conf = $('#cp-confirm');
    let valid = true;

    if (cur.value !== user.password) { setFieldError(cur, $('#cp-current-error'), true); valid = false; } else setFieldError(cur, $('#cp-current-error'), false);
    if (!PASSWORD_RE.test(next.value)) { setFieldError(next, $('#cp-new-error'), true); valid = false; } else setFieldError(next, $('#cp-new-error'), false);
    if (conf.value !== next.value || !conf.value) { setFieldError(conf, $('#cp-confirm-error'), true); valid = false; } else setFieldError(conf, $('#cp-confirm-error'), false);

    if (!valid) return;

    IBSDb.updateUser(user.username, { password: next.value });
    closePasswordModal();
    showToast('Password updated successfully', 'success');
  });

  /* ============================================================
     INITIAL ROUTE
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    const session = IBSDb.getSession();
    if (session && IBSDb.findByUsername(session.username)) {
      goTo('dashboard');
    } else {
      goTo('home');
    }
  });

})();
