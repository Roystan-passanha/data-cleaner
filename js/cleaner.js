// Data cleaning logic. Pure functions, no browser or file APIs, so it runs in Node tests too.
// A cell is: string | number | boolean | null | { date: 'YYYY-MM-DD' } (a real Excel date).

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const PLACEHOLDERS = new Set(['n/a', 'na', 'null', 'none', 'nil', '-', '--', '#n/a', 'nan', '?']);
const SYNONYMS = {
  unitedarabemirates: 'uae', saudiarabia: 'ksa', kingdomofsaudiarabia: 'ksa',
  unitedkingdom: 'uk', greatbritain: 'uk', unitedstates: 'usa', unitedstatesofamerica: 'usa', us: 'usa',
  canceled: 'cancelled', inprogress: 'underprocess', processing: 'underprocess'
};
const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/;

export const isDateCell = v => v !== null && typeof v === 'object' && 'date' in v;
const isBlank = v => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const validYMD = (y, m, d) => {
  if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1)) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const fullYear = y => (y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y);

/** Parse a date string. Returns 'YYYY-MM-DD', or null if it is not a real date. */
export function parseDate(value, dayFirst = true) {
  if (isDateCell(value)) return value.date;
  if (typeof value !== 'string') return null;
  const s = value.trim().replace(/[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(am|pm)?z?$/i, '').trim();
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) {
    return validYMD(+m[1], +m[2], +m[3]) ? iso(+m[1], +m[2], +m[3]) : null;
  }
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) {
    let a = +m[1], b = +m[2];
    const y = fullYear(+m[3]);
    let d = dayFirst ? a : b, mo = dayFirst ? b : a;
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // only one reading is possible
    return validYMD(y, mo, d) ? iso(y, mo, d) : null;
  }
  if ((m = s.match(/^(\d{1,2})[-\s]([a-z]{3,9})\.?[-\s,]+(\d{2}|\d{4})$/i))) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    const y = fullYear(+m[3]);
    return mo && validYMD(y, mo, +m[1]) ? iso(y, mo, +m[1]) : null;
  }
  if ((m = s.match(/^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i))) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    return mo && validYMD(+m[3], mo, +m[2]) ? iso(+m[3], mo, +m[2]) : null;
  }
  return null;
}

const looksLikeDate = v => isDateCell(v) || (typeof v === 'string' && /^\s*(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}|\d{1,2}[-\s][a-z]{3,9}\.?[-\s,]+\d{2,4}|[a-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})/i.test(v));

/** Parse a number written as text ("1,234.50", "AED 1,200", "45%"). Returns a number or null. */
export function parseNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  let s = value.trim().replace(/^(aed|usd|inr|sar|eur|gbp|rs\.?|dhs?\.?|[$€£₹])\s*/i, '').replace(/\s*(aed|usd|inr|sar|eur|gbp)$/i, '');
  const pct = /%$/.test(s);
  s = s.replace(/%$/, '').replace(/,/g, '').trim();
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s) * (neg ? -1 : 1);
  return pct ? n / 100 : n;
}

const cleanText = s => s.replace(/[   ]/g, ' ').replace(/[​‌‍﻿]/g, '').replace(/\s+/g, ' ').trim();
const catKey = s => { const k = String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); return SYNONYMS[k] || k; };
const titleCase = s => s.toLowerCase().replace(/(^|[\s\-'])([a-z])/g, (_, p, c) => p + c.toUpperCase());

/** Guess what each column holds. Returns [{ name, type, filled, distinct }]. */
export function profileColumns(headers, rows) {
  return headers.map((name, c) => {
    const vals = rows.map(r => r[c]).filter(v => !isBlank(v) && !(typeof v === 'string' && PLACEHOLDERS.has(v.trim().toLowerCase())));
    const n = vals.length || 1;
    const h = String(name || '').toLowerCase();
    const share = fn => vals.filter(fn).length / n;
    const distinct = new Set(vals.map(v => (isDateCell(v) ? v.date : catKey(v)))).size;
    const avgLen = vals.reduce((a, v) => a + String(isDateCell(v) ? v.date : v).length, 0) / n;
    let type = 'text';
    const dateHint = /date|dob|birth|expiry|expire|issue|joined|joining|start|end/.test(h);
    if (vals.length === 0) type = 'text';
    else if (share(looksLikeDate) >= (dateHint ? 0.4 : 0.7)) type = 'date';
    else if (/e-?mail/.test(h) || share(v => typeof v === 'string' && v.includes('@')) >= 0.6) type = 'email';
    else if (/(^|\b|_)(id|code|ref|number|no)(\b|_|$)|passport|iban|phone|mobile/.test(h) && distinct / n > 0.5) type = 'id';
    else if (share(v => parseNumber(v) !== null) >= 0.8) type = 'number';
    else if (/name/.test(h) && distinct / n > 0.5) type = 'name';
    else if (distinct <= Math.max(12, rows.length * 0.05) && avgLen <= 30 && rows.length >= 5) type = 'category';
    else if (/name/.test(h)) type = 'name';
    return { name, type, filled: vals.length, distinct };
  });
}

const find = (headers, re) => headers.findIndex(h => re.test(String(h).toLowerCase()));

/** Columns the HR checks need, found by header name. Any may be -1. */
export function findHrColumns(headers) {
  return {
    ppIssue: find(headers, /passport.*issue/),
    ppExpiry: find(headers, /passport.*(expiry|expire|valid)/),
    visaExpiry: find(headers, /visa.*(expiry|expire|valid until)/),
    visaStatus: find(headers, /visa.*status/)
  };
}

export const DEFAULT_OPTIONS = {
  trim: true, placeholders: true, dropEmpty: true, dedupe: true, dates: true, dayFirst: true,
  numbers: true, emails: true, categories: true, names: true, missing: true, ids: true, hr: true,
  passportMinDays: 180, expiryWarnDays: 90, today: null, firstDataRow: 2
};

/**
 * Clean a table.
 * @param headers string[]  @param rows cell[][]  @param types optional per-column type overrides
 * @returns { headers, rows, columns, issues, summary, byProblem }
 */
export function clean(headers, rows, opts = {}, types = null) {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const issues = [];
  const counts = { trimmed: 0, placeholders: 0, datesFixed: 0, numbersFixed: 0, categoriesFixed: 0, namesFixed: 0, emailsFixed: 0 };

  // headers: trim, fill blanks, make unique
  const seen = {};
  let H = headers.map((h, i) => {
    let name = isBlank(h) ? `Column ${i + 1}` : cleanText(String(h));
    if (seen[name]) name = `${name} (${++seen[name]})`; else seen[name] = 1;
    return name;
  });
  const width = H.length;
  let R = rows.map((r, i) => ({ src: i + o.firstDataRow, cells: Array.from({ length: width }, (_, c) => (r[c] === undefined ? null : r[c])) }));

  // text tidy and placeholders
  for (const row of R) {
    row.cells = row.cells.map(v => {
      if (typeof v !== 'string') return v;
      let t = v;
      if (o.trim) { t = cleanText(v); if (t !== v) counts.trimmed++; }
      if (o.placeholders && PLACEHOLDERS.has(t.toLowerCase())) { counts.placeholders++; return null; }
      return t === '' ? null : t;
    });
  }

  let emptyRows = 0, emptyCols = 0;
  if (o.dropEmpty) {
    const before = R.length;
    R = R.filter(r => r.cells.some(v => !isBlank(v)));
    emptyRows = before - R.length;
    const keep = H.map((_, c) => R.some(r => !isBlank(r.cells[c])) || !/^Column \d+$/.test(H[c]));
    emptyCols = keep.filter(k => !k).length;
    if (emptyCols) {
      H = H.filter((_, c) => keep[c]);
      for (const r of R) r.cells = r.cells.filter((_, c) => keep[c]);
      if (types) types = types.filter((_, c) => keep[c]);
    }
  }

  const columns = profileColumns(H, R.map(r => r.cells));
  if (types) columns.forEach((col, c) => { if (types[c]) col.type = types[c]; });
  const idCol = columns.findIndex(c => c.type === 'id');
  const nameCol = columns.findIndex(c => c.type === 'name');
  const original = R.map(r => r.cells.slice());
  const show = v => (v === null ? '' : isDateCell(v) ? v.date : v);
  const flag = (i, c, problem, severity = 'Medium') => issues.push({
    row: R[i].src, id: idCol >= 0 ? show(R[i].cells[idCol]) : '', name: nameCol >= 0 ? show(R[i].cells[nameCol]) : '',
    column: H[c], problem, value: show(original[i][c]), severity
  });

  columns.forEach((col, c) => {
    if (col.type === 'date') {
      R.forEach((r, i) => {
        const v = r.cells[c];
        if (isBlank(v)) return;
        const d = parseDate(typeof v === 'number' ? String(v) : v, o.dayFirst);
        if (d) { if (o.dates) { if (!isDateCell(v)) counts.datesFixed++; r.cells[c] = { date: d }; } }
        else flag(i, c, 'Not a valid date', 'High');
      });
    } else if (col.type === 'number') {
      R.forEach((r, i) => {
        const v = r.cells[c];
        if (isBlank(v) || typeof v === 'number') return;
        const n = parseNumber(v);
        if (n === null) flag(i, c, 'Not a number', 'Medium');
        else if (o.numbers) { r.cells[c] = n; counts.numbersFixed++; }
      });
    } else if (col.type === 'email') {
      R.forEach((r, i) => {
        const v = r.cells[c];
        if (isBlank(v)) return;
        const e = String(v).toLowerCase().replace(/\s+/g, '');
        if (o.emails && e !== v) { r.cells[c] = e; counts.emailsFixed++; }
        if (!EMAIL.test(e)) flag(i, c, 'Invalid email', 'Medium');
      });
    } else if (col.type === 'category' && o.categories) {
      const groups = new Map();
      R.forEach(r => {
        const v = r.cells[c];
        if (isBlank(v)) return;
        const k = catKey(v);
        if (!groups.has(k)) groups.set(k, new Map());
        const g = groups.get(k);
        g.set(String(v), (g.get(String(v)) || 0) + 1);
      });
      const canon = new Map();
      for (const [k, g] of groups) {
        // prefer a properly cased spelling (not all lowercase, not ALL CAPS for longer words), then the most common
        const style = t => (t === t.toLowerCase() && /[a-z]/.test(t) ? 2 : t === t.toUpperCase() && t.length > 4 ? 1 : 0);
        const best = [...g.entries()].sort((a, b) => style(a[0]) - style(b[0]) || b[1] - a[1] || a[0].length - b[0].length)[0][0];
        canon.set(k, best);
      }
      R.forEach(r => {
        const v = r.cells[c];
        if (isBlank(v)) return;
        const best = canon.get(catKey(v));
        if (best !== String(v)) { r.cells[c] = best; counts.categoriesFixed++; }
      });
      col.distinctAfter = canon.size;
    } else if (col.type === 'name' && o.names) {
      R.forEach(r => {
        const v = r.cells[c];
        if (typeof v !== 'string' || !/[a-z]/i.test(v)) return;
        if (v === v.toUpperCase() || v === v.toLowerCase()) { r.cells[c] = titleCase(v); counts.namesFixed++; }
      });
    } else if (col.type === 'id') {
      R.forEach(r => { const v = r.cells[c]; if (typeof v === 'string' && /^[a-z0-9\s-]+$/i.test(v) && v !== v.toUpperCase().replace(/\s+/g, '')) r.cells[c] = v.toUpperCase().replace(/\s+/g, ''); });
    }
  });

  // missing values: flag cell by cell only where the column is mostly filled
  if (o.missing) {
    columns.forEach((col, c) => {
      const missing = R.filter(r => isBlank(r.cells[c])).length;
      col.missing = missing;
      if (missing && missing / R.length <= 0.2) R.forEach((r, i) => { if (isBlank(r.cells[c])) flag(i, c, 'Missing value', col.type === 'date' || col.type === 'id' ? 'High' : 'Medium'); });
    });
  }

  // HR document checks
  const hr = findHrColumns(H);
  const hrActive = o.hr && (hr.ppExpiry >= 0 || hr.visaExpiry >= 0);
  if (hrActive) {
    const now = o.today ? new Date(o.today + 'T00:00:00Z') : new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const days = v => (isDateCell(v) ? Math.round((Date.parse(v.date + 'T00:00:00Z') - today) / 86400000) : null);
    const get = (r, c) => (c >= 0 ? r.cells[c] : null);
    if (hr.ppExpiry >= 0) H.push('Passport Days Left');
    if (hr.visaExpiry >= 0) H.push('Visa Days Left');
    R.forEach((r, i) => {
      const pe = get(r, hr.ppExpiry), pi = get(r, hr.ppIssue), ve = get(r, hr.visaExpiry);
      const status = String(get(r, hr.visaStatus) || '').toLowerCase();
      const pd = days(pe), vd = days(ve);
      if (pd !== null) {
        if (isDateCell(pi) && pe.date <= pi.date) flag(i, hr.ppExpiry, 'Expiry not after issue date', 'High');
        if (pd < 0) flag(i, hr.ppExpiry, 'Passport expired', 'High');
        else if (pd <= o.passportMinDays) flag(i, hr.ppExpiry, `Passport valid for under ${o.passportMinDays} days`, 'Medium');
      }
      if (vd !== null) {
        const valid = status === 'valid' || status === 'active';
        if (valid && vd < 0) flag(i, hr.visaStatus, 'Status says valid but visa expiry date has passed', 'High');
        else if ((valid || hr.visaStatus < 0) && vd >= 0 && vd <= o.expiryWarnDays) flag(i, hr.visaExpiry, `Visa expires within ${o.expiryWarnDays} days`, 'Medium');
        if (isDateCell(pe) && ve.date > pe.date) flag(i, hr.visaExpiry, 'Visa outlasts passport', 'Low');
      }
      if (hr.ppExpiry >= 0) r.cells.push(pd);
      if (hr.visaExpiry >= 0) r.cells.push(vd);
    });
  }

  // duplicates
  let duplicateRows = 0;
  if (o.dedupe) {
    const keys = new Set();
    const dropped = new Set();
    R.forEach((r, i) => {
      const k = JSON.stringify(r.cells.slice(0, columns.length));
      if (keys.has(k)) { dropped.add(i); flag(i, idCol >= 0 ? idCol : 0, 'Exact duplicate row (removed)', 'Low'); } else keys.add(k);
    });
    duplicateRows = dropped.size;
    R = R.filter((_, i) => !dropped.has(i));
  }
  if (o.ids) {
    columns.forEach((col, c) => {
      if (col.type !== 'id') return;
      const tally = new Map();
      R.forEach(r => { const v = r.cells[c]; if (!isBlank(v)) tally.set(String(v), (tally.get(String(v)) || 0) + 1); });
      R.forEach(r => {
        const v = r.cells[c];
        if (!isBlank(v) && tally.get(String(v)) > 1) issues.push({ row: r.src, id: idCol >= 0 ? show(r.cells[idCol]) : '', name: nameCol >= 0 ? show(r.cells[nameCol]) : '', column: H[c], problem: `Same ${H[c]} on more than one row`, value: show(v), severity: 'High' });
      });
    });
  }

  const order = { High: 0, Medium: 1, Low: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity] || a.row - b.row);
  const perRow = new Map();
  for (const it of issues) if (!/removed/.test(it.problem)) perRow.set(it.row, (perRow.get(it.row) || 0) + 1);
  H.unshift('Source Row'); H.push('Issue Count', 'Status');
  const outRows = R.map(r => [r.src, ...r.cells, perRow.get(r.src) || 0, perRow.get(r.src) ? 'Needs review' : 'OK']);

  const tally = new Map();
  for (const it of issues) { const k = it.severity + '|' + it.problem; tally.set(k, (tally.get(k) || 0) + 1); }
  const byProblem = [...tally.entries()].map(([k, count]) => ({ severity: k.split('|')[0], problem: k.split('|')[1], count }))
    .sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);

  const needReview = outRows.filter(r => r[r.length - 1] !== 'OK').length;
  const summary = {
    rowsIn: rows.length, rowsOut: outRows.length, columns: columns.length, emptyRows, emptyCols, duplicateRows,
    rowsOk: outRows.length - needReview, rowsNeedReview: needReview, issues: issues.length,
    highIssues: issues.filter(i => i.severity === 'High').length, hrChecks: hrActive, ...counts
  };
  return { headers: H, rows: outRows, columns, issues, byProblem, summary };
}
