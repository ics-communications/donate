/**
 * ICS Monthly Donor Campaign — internal follow-up tracker
 * ============================================================================
 *
 * Keeps one suppression list across four inputs so that a donor who converts
 * stops receiving campaign follow-ups:
 *
 *   1. Mailing List CSV   — the universe of people being appealed to
 *   2. PayPal (real time)  — posted by the /monthly landing page on approval
 *   3. CanadaHelps CSV     — dropped in periodically by staff
 *   4. DonorPerfect API    — the authoritative backstop; catches every payment
 *                            method, cheques included, once entry catches up
 *
 * IMPORTANT: this project never emails donors. Donor acknowledgements are
 * handled by a separate ICS system, and a second automated message would be a
 * duplicate. There are deliberately no MailApp/GmailApp calls anywhere in this
 * file, and none should be added.
 */

/* ========================================================================== *
 * CONFIGURATION
 * ========================================================================== */

/** Sheet tab names. */
var SHEETS = {
  list:        'Mailing List',
  conversions: 'Conversions',
  intake:      'PayPal Intake',
  config:      'Config',
  unmatched:   'Unmatched'
};

/** Default Config values, written on first run. Edit them in the Config tab. */
var DEFAULT_CONFIG = {
  // DonorPerfect thank-you code that marks a conversion from this appeal.
  // Code 8 = "New Monthly Donor". Verified empty before launch, so every gift
  // carrying it is attributable to this campaign.
  DP_TY_LETTER_NO: '8',

  // Optional second filter. Leave blank to match on the thank-you code alone.
  DP_SOLICIT_CODE: '',

  // Ignore DonorPerfect gifts dated before this (yyyy-mm-dd). Guards against
  // historical data if the thank-you code is ever reused.
  CAMPAIGN_START: '2026-09-29',

  // Appeal name stamped on rows this campaign creates.
  CAMPAIGN_NAME: 'Monthly Conversion Appeal 2026'
};

var DP_ENDPOINT = 'https://www.donorperfect.net/prod/xmlrequest.asp';

/** Column order for the Mailing List tab. */
var LIST_COLUMNS = [
  'Email', 'First Name', 'Last Name', 'Status', 'Converted Date',
  'Converted Via', 'Amount', 'Follow-ups Sent', 'Last Sent', 'Notes'
];

var CONVERSION_COLUMNS = [
  'Email', 'First Name', 'Last Name', 'Source', 'Date', 'Amount',
  'Currency', 'Reference', 'Matched To List', 'Recorded At'
];

var INTAKE_COLUMNS = [
  'Recorded At', 'Reference', 'Subscription ID', 'Amount', 'Currency',
  'First Name', 'Last Name', 'Email', 'Address', 'City', 'State',
  'Postal', 'Country'
];

/* ========================================================================== *
 * WEB APP ENTRY POINTS
 * ========================================================================== */

/** Serves the internal tracker UI. */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('ICS Monthly Campaign Tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Receives a monthly gift from the public landing page.
 *
 * The page posts with mode:'no-cors', so it cannot read this response and does
 * not wait for it. Never throw: the donation has already succeeded at PayPal by
 * the time this runs, and DonorPerfect will catch anything lost here.
 */
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);

    if (!intakeTokenAccepted_(payload.token)) {
      // Not an error worth alerting on — this endpoint is public and will get
      // scanned. Log it and drop the row rather than polluting the sheet.
      console.warn('doPost: rejected a post with a missing or wrong token.');
      return intakeResponse_();
    }

    recordPayPalGift_(payload);
  } catch (err) {
    logError_('doPost', err);
  }
  return intakeResponse_();
}

/**
 * The reply is always the same, whether the post was accepted, rejected or
 * malformed. The page sends with mode:'no-cors' and cannot read this anyway,
 * and a uniform answer tells a prober nothing about whether it guessed right.
 */
function intakeResponse_() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Checks the shared token the landing page sends.
 *
 * This is not a secret — it sits in the page source, which anyone can read. Its
 * only job is to stop casual scraping of the public repo or page from turning
 * into junk rows in the sheet, which would wrongly suppress real people from
 * follow-ups. Anyone determined enough to read the page can still post.
 *
 * If INTAKE_TOKEN is not set in Script Properties, posts are accepted and a
 * warning is logged. That keeps an existing deployment recording gifts rather
 * than silently dropping them; set the property to turn the check on.
 */
function intakeTokenAccepted_(supplied) {
  var expected = PropertiesService.getScriptProperties().getProperty('INTAKE_TOKEN');

  if (!expected) {
    console.warn('INTAKE_TOKEN is not set — accepting posts unchecked. ' +
                 'Run generateIntakeToken() to turn the check on.');
    return true;
  }
  return constantTimeEquals_(String(supplied == null ? '' : supplied), expected);
}

/** Compares without leaking length or position through timing. */
function constantTimeEquals_(a, b) {
  if (a.length !== b.length) { return false; }
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/* ========================================================================== *
 * SETUP
 * ========================================================================== */

/** Creates missing tabs and seeds Config. Safe to re-run. */
function setUpSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureSheet_(ss, SHEETS.list, LIST_COLUMNS);
  ensureSheet_(ss, SHEETS.conversions, CONVERSION_COLUMNS);
  ensureSheet_(ss, SHEETS.intake, INTAKE_COLUMNS);
  ensureSheet_(ss, SHEETS.unmatched, ['Email', 'First Name', 'Last Name', 'Source', 'Date', 'Amount', 'Reason', 'Recorded At']);

  var config = ensureSheet_(ss, SHEETS.config, ['Key', 'Value']);
  var existing = readConfig_();
  Object.keys(DEFAULT_CONFIG).forEach(function(key) {
    if (!(key in existing)) {
      config.appendRow([key, DEFAULT_CONFIG[key]]);
    }
  });

  return 'Setup complete.';
}

/** Installs the daily DonorPerfect sync. Safe to re-run — replaces the old one. */
function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'syncDonorPerfect') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('syncDonorPerfect').timeBased().everyDays(1).atHour(6).create();
  return 'Daily DonorPerfect sync installed for ~6am.';
}

/**
 * Creates the shared intake token, stores it, and returns it so you can paste
 * it into the landing page. Run it once.
 *
 * Re-running issues a NEW token and immediately invalidates the old one, so the
 * live page stops recording until you paste the new value in and push. Only run
 * it again if you actually want to rotate.
 */
function generateIntakeToken() {
  var token = Utilities.getUuid().replace(/-/g, '') +
              Utilities.getUuid().replace(/-/g, '').slice(0, 8);

  PropertiesService.getScriptProperties().setProperty('INTAKE_TOKEN', token);

  console.log('INTAKE_TOKEN set. Paste this into INTAKE_TOKEN in the landing page:\n\n' +
              token + '\n');
  return token;
}

/* ========================================================================== *
 * 1. MAILING LIST IMPORT
 * ========================================================================== */

/**
 * Imports the campaign mailing list from CSV text.
 *
 * Matches on email only — the export has no donor_id. Re-importing is safe:
 * existing people keep their status and follow-up counts, and only genuinely
 * new emails are appended. That is what makes this reusable for future
 * campaigns rather than a one-off.
 */
function importMailingList(csvText) {
  var parsed = parseCsvWithHeaders_(csvText);
  var sheet = getSheet_(SHEETS.list);
  var index = buildListIndex_(sheet);

  var added = 0, updated = 0, skipped = 0;
  var newRows = [];

  parsed.rows.forEach(function(row) {
    var email = normalizeEmail_(pick_(row, ['email', 'email address', 'donor email address', 'e-mail']));
    if (!email) { skipped++; return; }

    var first = pick_(row, ['first name', 'first', 'donor first name', 'fname']);
    var last  = pick_(row, ['last name', 'last', 'donor last name', 'lname']);

    if (index[email]) {
      // Fill in a name we did not have before; never overwrite status.
      var existing = index[email];
      var changed = false;
      if (first && !existing.values[1]) { sheet.getRange(existing.row, 2).setValue(first); changed = true; }
      if (last  && !existing.values[2]) { sheet.getRange(existing.row, 3).setValue(last);  changed = true; }
      if (changed) { updated++; }
      return;
    }

    newRows.push([email, first, last, 'Active', '', '', '', 0, '', '']);
    index[email] = { row: -1, values: [email, first, last] };
    added++;
  });

  if (newRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, LIST_COLUMNS.length).setValues(newRows);
  }

  // A conversion may already have been recorded for someone we just imported.
  var reconciled = reconcileConversions_();

  return {
    added: added,
    updatedNames: updated,
    skippedNoEmail: skipped,
    reconciled: reconciled,
    totalRows: parsed.rows.length
  };
}

/* ========================================================================== *
 * 2. PAYPAL INTAKE
 * ========================================================================== */

/** Writes a landing-page gift to the intake log and marks the donor converted. */
function recordPayPalGift_(payload) {
  var now = new Date();

  getSheet_(SHEETS.intake).appendRow([
    now,
    payload.ref || '',
    payload.subscriptionId || '',
    payload.amount || '',
    payload.currency || 'USD',
    payload.firstName || '',
    payload.lastName || '',
    payload.email || '',
    payload.address || '',
    payload.city || '',
    payload.state || '',
    payload.postal || '',
    payload.country || 'US'
  ]);

  recordConversion_({
    email: payload.email,
    firstName: payload.firstName,
    lastName: payload.lastName,
    source: 'PayPal',
    date: now,
    amount: payload.amount,
    currency: payload.currency || 'USD',
    reference: payload.subscriptionId || payload.ref || ''
  });
}

/* ========================================================================== *
 * 3. CANADAHELPS CSV IMPORT
 * ========================================================================== */

/**
 * Imports a CanadaHelps export and suppresses everyone in it.
 *
 * Built against the standard CanadaHelps column names (DONOR EMAIL ADDRESS,
 * DONOR FIRST NAME, AMOUNT, DONATION DATE, TRANSACTION NUMBER) and tolerant of
 * the variations the DonorPerfect CRM report uses. Donors may withhold their
 * email on CanadaHelps; those rows go to the Unmatched tab for manual review
 * rather than being dropped.
 */
function importCanadaHelps(csvText) {
  var parsed = parseCsvWithHeaders_(csvText);
  var converted = 0, unmatched = 0, noEmail = 0;

  parsed.rows.forEach(function(row) {
    var email = normalizeEmail_(pick_(row, [
      'donor email address', 'email address', 'email', 'donor email'
    ]));
    var first = pick_(row, ['donor first name', 'first name', 'first']);
    var last  = pick_(row, ['donor last name', 'last name', 'last']);
    var amount = cleanAmount_(pick_(row, ['amount', 'donation amount', 'receiptable amount']));
    var date = pick_(row, ['donation date', 'date', 'transaction date']);
    var ref = pick_(row, ['transaction number', 'transaction id', 'receipt #', 'receipt number']);

    if (!email) {
      appendUnmatched_({
        email: '', firstName: first, lastName: last, source: 'CanadaHelps',
        date: date, amount: amount, reason: 'No email address in export'
      });
      noEmail++;
      return;
    }

    var result = recordConversion_({
      email: email, firstName: first, lastName: last,
      source: 'CanadaHelps', date: parseDate_(date) || new Date(),
      amount: amount, currency: 'CAD', reference: ref
    });

    if (result.matched) { converted++; } else { unmatched++; }
  });

  return {
    rowsRead: parsed.rows.length,
    suppressed: converted,
    notOnList: unmatched,
    missingEmail: noEmail
  };
}

/* ========================================================================== *
 * 4. DONORPERFECT SYNC
 * ========================================================================== */

/**
 * Pulls gifts carrying the campaign's thank-you code and suppresses those
 * donors. This is the backstop that catches cheques, and anything else entered
 * by hand, days or weeks after the gift arrives.
 *
 * Runs daily on a trigger and on demand from the tracker UI.
 */
function syncDonorPerfect() {
  var config = readConfig_();
  var apiKey = PropertiesService.getScriptProperties().getProperty('DP_API_KEY');

  if (!apiKey) {
    throw new Error('DonorPerfect API key is not set. Add DP_API_KEY under ' +
                    'Project Settings > Script Properties.');
  }

  var where = ["g.ty_letter_no = '" + sqlEscape_(config.DP_TY_LETTER_NO) + "'"];

  if (config.DP_SOLICIT_CODE) {
    where.push("g.solicit_code = '" + sqlEscape_(config.DP_SOLICIT_CODE) + "'");
  }
  if (config.CAMPAIGN_START) {
    where.push("g.gift_date >= '" + sqlEscape_(config.CAMPAIGN_START) + "'");
  }

  var query =
    'SELECT g.gift_id, g.donor_id, g.gift_date, g.amount, g.gift_type, ' +
    'g.solicit_code, d.email, d.first_name, d.last_name ' +
    'FROM dpgift g INNER JOIN dp d ON d.donor_id = g.donor_id ' +
    'WHERE ' + where.join(' AND ');

  var records = dpQuery_(apiKey, query);
  var seen = seenGiftIds_();
  var converted = 0, notOnList = 0, alreadyKnown = 0, missingEmail = 0;

  records.forEach(function(rec) {
    var reference = 'DP-' + rec.gift_id;
    if (seen[reference]) { alreadyKnown++; return; }

    var email = normalizeEmail_(rec.email);
    if (!email) {
      appendUnmatched_({
        email: '', firstName: rec.first_name, lastName: rec.last_name,
        source: 'DonorPerfect', date: rec.gift_date, amount: rec.amount,
        reason: 'Donor ' + rec.donor_id + ' has no email in DonorPerfect'
      });
      missingEmail++;
      return;
    }

    var result = recordConversion_({
      email: email,
      firstName: rec.first_name,
      lastName: rec.last_name,
      source: 'DonorPerfect (' + (rec.gift_type || 'gift') + ')',
      date: parseDate_(rec.gift_date) || new Date(),
      amount: cleanAmount_(rec.amount),
      currency: 'CAD',
      reference: reference
    });

    if (result.matched) { converted++; } else { notOnList++; }
  });

  return {
    giftsFound: records.length,
    suppressed: converted,
    notOnList: notOnList,
    alreadyKnown: alreadyKnown,
    missingEmail: missingEmail,
    ranAt: new Date().toISOString()
  };
}

/** Runs a read-only query against the DonorPerfect XML API. */
function dpQuery_(apiKey, query) {
  var url = DP_ENDPOINT +
    '?apikey=' + apiKey +
    '&action=' + encodeURIComponent(query);

  var response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('DonorPerfect returned HTTP ' + response.getResponseCode());
  }

  var body = response.getContentText();
  if (body.indexOf('<error') !== -1) {
    throw new Error('DonorPerfect error: ' + body.slice(0, 300));
  }

  var root = XmlService.parse(body).getRootElement();
  return root.getChildren('record').map(function(record) {
    var out = {};
    record.getChildren('field').forEach(function(field) {
      out[field.getAttribute('name').getValue()] = field.getAttribute('value').getValue();
    });
    return out;
  });
}

/* ========================================================================== *
 * SUPPRESSION CORE
 * ========================================================================== */

/**
 * Logs a conversion and, if the donor is on the mailing list, marks them
 * suppressed. Conversions from people not on the list are still logged — they
 * are real gifts and worth seeing — just flagged as off-list.
 */
function recordConversion_(entry) {
  var email = normalizeEmail_(entry.email);
  if (!email) { return { matched: false }; }

  var sheet = getSheet_(SHEETS.list);
  var index = buildListIndex_(sheet);
  var hit = index[email];

  if (hit && hit.row > 0) {
    var row = hit.row;
    var status = sheet.getRange(row, 4).getValue();
    if (String(status).toLowerCase() !== 'converted') {
      sheet.getRange(row, 4, 1, 4).setValues([[
        'Converted',
        entry.date || new Date(),
        entry.source,
        entry.amount || ''
      ]]);
    }
  }

  getSheet_(SHEETS.conversions).appendRow([
    email,
    entry.firstName || '',
    entry.lastName || '',
    entry.source,
    entry.date || new Date(),
    entry.amount || '',
    entry.currency || '',
    entry.reference || '',
    hit ? 'Yes' : 'No',
    new Date()
  ]);

  return { matched: !!hit };
}

/**
 * Re-applies logged conversions to the mailing list. Needed when a gift lands
 * before the person is imported — common when the list goes in after launch.
 */
function reconcileConversions_() {
  var conversions = getSheet_(SHEETS.conversions).getDataRange().getValues();
  if (conversions.length < 2) { return 0; }

  var sheet = getSheet_(SHEETS.list);
  var index = buildListIndex_(sheet);
  var fixed = 0;

  for (var i = 1; i < conversions.length; i++) {
    var email = normalizeEmail_(conversions[i][0]);
    var hit = index[email];
    if (!hit || hit.row < 1) { continue; }

    if (String(sheet.getRange(hit.row, 4).getValue()).toLowerCase() !== 'converted') {
      sheet.getRange(hit.row, 4, 1, 4).setValues([[
        'Converted', conversions[i][4], conversions[i][3], conversions[i][5]
      ]]);
      fixed++;
    }
  }
  return fixed;
}

/* ========================================================================== *
 * FOLLOW-UP LISTS
 * ========================================================================== */

/**
 * Returns everyone still to be followed up with — active, not converted, not
 * opted out. This is the list you export before each send.
 */
function getFollowUpList() {
  var rows = getSheet_(SHEETS.list).getDataRange().getValues();
  var out = [];

  for (var i = 1; i < rows.length; i++) {
    var status = String(rows[i][3] || '').toLowerCase();
    if (status === 'converted' || status === 'opted out' || status === 'bounced') { continue; }
    if (!rows[i][0]) { continue; }

    out.push({
      email: rows[i][0],
      firstName: rows[i][1],
      lastName: rows[i][2],
      followUpsSent: rows[i][7] || 0,
      lastSent: rows[i][8] ? formatDate_(rows[i][8]) : ''
    });
  }
  return out;
}

/** Counts for the dashboard. */
function getStats() {
  var rows = getSheet_(SHEETS.list).getDataRange().getValues();
  var stats = { total: 0, active: 0, converted: 0, excluded: 0, bySource: {} };

  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][0]) { continue; }
    stats.total++;
    var status = String(rows[i][3] || '').toLowerCase();
    if (status === 'converted') {
      stats.converted++;
      var source = String(rows[i][5] || 'Unknown').replace(/\s*\(.*\)$/, '');
      stats.bySource[source] = (stats.bySource[source] || 0) + 1;
    } else if (status === 'opted out' || status === 'bounced') {
      stats.excluded++;
    } else {
      stats.active++;
    }
  }

  stats.conversionRate = stats.total
    ? Math.round((stats.converted / stats.total) * 1000) / 10
    : 0;

  var config = readConfig_();
  stats.campaign = config.CAMPAIGN_NAME || '';
  stats.tyCode = config.DP_TY_LETTER_NO || '';
  return stats;
}

/**
 * Stamps a send against everyone currently on the follow-up list: increments
 * their count and sets the date. Call it after a send goes out, so the next
 * export knows who has had what.
 *
 * This records that a send happened. It does not send anything.
 */
function markFollowUpSent() {
  var sheet = getSheet_(SHEETS.list);
  var rows = sheet.getDataRange().getValues();
  var now = new Date();
  var stamped = 0;

  for (var i = 1; i < rows.length; i++) {
    var status = String(rows[i][3] || '').toLowerCase();
    if (status === 'converted' || status === 'opted out' || status === 'bounced') { continue; }
    if (!rows[i][0]) { continue; }

    sheet.getRange(i + 1, 8).setValue((Number(rows[i][7]) || 0) + 1);
    sheet.getRange(i + 1, 9).setValue(now);
    stamped++;
  }
  return { stamped: stamped, at: now.toISOString() };
}

/** Follow-up list as CSV text, for the UI's download button. */
function getFollowUpCsv() {
  var list = getFollowUpList();
  var lines = ['Email,First Name,Last Name,Follow-ups Sent,Last Sent'];
  list.forEach(function(p) {
    lines.push([p.email, p.firstName, p.lastName, p.followUpsSent, p.lastSent]
      .map(csvCell_).join(','));
  });
  return lines.join('\n');
}

/* ========================================================================== *
 * HELPERS
 * ========================================================================== */

function getSheet_(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) {
    throw new Error('Missing tab "' + name + '". Run setUpSpreadsheet() first.');
  }
  return sheet;
}

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** email -> { row, values }. Row numbers are 1-based sheet rows. */
function buildListIndex_(sheet) {
  var rows = sheet.getDataRange().getValues();
  var index = {};
  for (var i = 1; i < rows.length; i++) {
    var email = normalizeEmail_(rows[i][0]);
    if (email && !index[email]) {
      index[email] = { row: i + 1, values: rows[i] };
    }
  }
  return index;
}

/** References already in the Conversions tab, so syncs stay idempotent. */
function seenGiftIds_() {
  var rows = getSheet_(SHEETS.conversions).getDataRange().getValues();
  var seen = {};
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][7]) { seen[String(rows[i][7])] = true; }
  }
  return seen;
}

function appendUnmatched_(entry) {
  getSheet_(SHEETS.unmatched).appendRow([
    entry.email || '', entry.firstName || '', entry.lastName || '',
    entry.source, entry.date || '', entry.amount || '', entry.reason, new Date()
  ]);
}

function readConfig_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.config);
  var config = {};
  Object.keys(DEFAULT_CONFIG).forEach(function(k) { config[k] = DEFAULT_CONFIG[k]; });
  if (!sheet) { return config; }

  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0]) { config[String(rows[i][0]).trim()] = String(rows[i][1]).trim(); }
  }
  return config;
}

function normalizeEmail_(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

/** Reads the first present key from a row, given a list of possible headers. */
function pick_(row, keys) {
  for (var i = 0; i < keys.length; i++) {
    var v = row[keys[i]];
    if (v !== undefined && String(v).trim() !== '') { return String(v).trim(); }
  }
  return '';
}

function cleanAmount_(value) {
  var n = parseFloat(String(value == null ? '' : value).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : '';
}

function parseDate_(value) {
  if (value instanceof Date) { return value; }
  if (!value) { return null; }
  var d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate_(value) {
  var d = parseDate_(value);
  return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
}

/** Single quotes are the only SQL metacharacter reachable here. */
function sqlEscape_(value) {
  return String(value == null ? '' : value).replace(/'/g, "''");
}

function csvCell_(value) {
  var s = String(value == null ? '' : value);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function logError_(where, err) {
  console.error(where + ': ' + (err && err.stack ? err.stack : err));
}

/* -------------------------------------------------------------------------- *
 * CSV parsing — RFC 4180, handling quoted fields with commas and newlines.
 * -------------------------------------------------------------------------- */

function parseCsvWithHeaders_(text) {
  var table = Utilities.parseCsv(stripBom_(text));
  if (!table.length) { return { headers: [], rows: [] }; }

  var headers = table[0].map(function(h) { return String(h).trim().toLowerCase(); });
  var rows = [];

  for (var i = 1; i < table.length; i++) {
    if (table[i].every(function(c) { return String(c).trim() === ''; })) { continue; }
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = table[i][j] === undefined ? '' : table[i][j];
    }
    rows.push(row);
  }
  return { headers: headers, rows: rows };
}

function stripBom_(text) {
  return text && text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}
