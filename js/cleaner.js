// Data cleaning logic. Pure functions, no browser or file APIs, so it runs in Node tests too.
// A cell is: string | number | boolean | null | { date: 'YYYY-MM-DD' } (a real Excel date).

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const PLACEHOLDERS = new Set(['n/a', 'na', 'null', 'none', 'nil', '-', '--', '#n/a', 'nan', '?']);
const SYNONYMS = {
  unitedarabemirates: 'uae', saudiarabia: 'ksa', kingdomofsaudiarabia: 'ksa',
  unitedkingdom: 'uk', greatbritain: 'uk', unitedstates: 'usa', unitedstatesofamerica: 'usa', us: 'usa',
  canceled: 'cancelled', inprogress: 'underprocess', processing: 'underprocess', m: 'male', f: 'female'
};
const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/;
const ID_HEADER = /(^|[\s_])(id|code|ref|no\.?|number|num|#)$|passport|iban|phone|mobile|postal|zip|barcode|sku/;
const PERCENT_HEADER = /%|percent|\brate\b|\bctr\b|margin/;
const TOTAL_EXACT = /^(grand\s*totals?|sub\s*-?\s*totals?|totals?)\s*:?$/i;
const TOTAL_PREFIX = /^(grand\s*total|sub\s*-?\s*total|total)\s+\S/i;

const isCurrency = t => /^[$€£₹¥]$/.test(t) || /^(aed|usd|eur|gbp|inr|sar|qar|omr|kwd|bhd|rs|dhs?)\.?$/i.test(t) || (/^[A-Z]{3}\.?$/.test(t) && !/^(MN|BN)/.test(t));

export const isDateCell = v => v !== null && typeof v === 'object' && 'date' in v;
const isBlank = v => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const validYMD = (y, m, d) => {
  if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1)) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const fullYear = y => (y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y);
const stripTime = s => s.trim().replace(/[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(am|pm)?\s*(z|[+-]\d{2}:?\d{2})?$/i, '').trim();
const NUMERIC_DATE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/;

/** Parse a date string. Returns 'YYYY-MM-DD', or null if it is not a real date. */
export function parseDate(value, dayFirst = true) {
  if (isDateCell(value)) return value.date;
  if (typeof value !== 'string') return null;
  const s = stripTime(value);
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) {
    return validYMD(+m[1], +m[2], +m[3]) ? iso(+m[1], +m[2], +m[3]) : null;
  }
  if ((m = s.match(NUMERIC_DATE))) {
    const a = +m[1], b = +m[2], y = fullYear(+m[3]);
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

/**
 * Work out whether a column writes dates day first (31/12) or month first (12/31).
 * @returns { dayFirst, evidence: 'day' | 'month' | 'both' | 'none' }
 */
export function detectDateOrder(values, fallback = true) {
  let day = 0, month = 0;
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const m = stripTime(v).match(NUMERIC_DATE);
    if (!m) continue;
    if (+m[1] > 12 && +m[2] <= 12) day++;
    else if (+m[2] > 12 && +m[1] <= 12) month++;
  }
  if (day && month) return { dayFirst: day >= month, evidence: 'both' };
  if (day) return { dayFirst: true, evidence: 'day' };
  if (month) return { dayFirst: false, evidence: 'month' };
  return { dayFirst: fallback, evidence: 'none' };
}

const looksLikeDate = v => isDateCell(v) || (typeof v === 'string' && /^\s*(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}|\d{1,2}[-\s][a-z]{3,9}\.?[-\s,]+\d{2,4}|[a-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})/i.test(v));

/**
 * Parse a number written as text: "1,234.50", "AED 1,200", "(500)", "1,200.00-", "1,200 CR", "45%", "12.4K".
 * With decimalComma, "1.234,56" is read the European way. Returns a number or null.
 */
export function parseNumber(value, decimalComma = false) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  let s = value.trim().replace(/[−–]/g, '-');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = !neg; s = s.slice(1, -1).trim(); }
  const side = s.match(/\s*\b(cr|dr)\.?$/i);
  if (side) { if (side[1].toLowerCase() === 'cr') neg = !neg; s = s.slice(0, side.index).trim(); }
  if (/\d\s*-$/.test(s)) { neg = !neg; s = s.replace(/\s*-$/, ''); }
  const lead = s.match(/^([-+]?)\s*([A-Za-z]{2,4}\.?|[$€£₹¥])?\s*([-+]?)\s*(.*)$/);
  if (lead) {
    if (lead[2] && !isCurrency(lead[2])) return null;
    if (lead[1] === '-' || lead[3] === '-') neg = !neg;
    s = lead[4];
  }
  const tail = s.match(/\s*([A-Za-z]{2,4}|[$€£₹¥])$/);
  if (tail && isCurrency(tail[1])) s = s.slice(0, tail.index);
  const pct = /%$/.test(s);
  s = s.replace(/\s*%$/, '');
  let mult = 1;
  const big = s.match(/^(.*\d)\s*(k|m|mn|b|bn)$/i);
  if (big) { mult = { k: 1e3, m: 1e6, mn: 1e6, b: 1e9, bn: 1e9 }[big[2].toLowerCase()]; s = big[1]; }
  s = decimalComma ? s.replace(/[.\s]/g, '').replace(',', '.') : s.replace(/[,\s]/g, '');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  if (/^0\d/.test(s) && !s.includes('.')) return null; // 000123 is a code, not a quantity
  const n = Number(s) * mult * (neg ? -1 : 1);
  return pct ? n / 100 : n;
}

/** True when a column's numbers are written like 1.234,56 (decimal comma). */
export function detectDecimalComma(values) {
  let euro = 0, us = 0;
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const s = v.replace(/[^\d.,]/g, '');
    if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s) || /^\d+,\d{1,2}$/.test(s) || /^\d{1,3}(\.\d{3}){2,}$/.test(s)) euro++;
    else if (/\.\d{1,2}$/.test(s) || /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) us++;
  }
  return euro > 0 && euro > us;
}

const cleanText = s => s.replace(/[   ]/g, ' ').replace(/[​‌‍﻿]/g, '').replace(/\s+/g, ' ').trim();
/** Key used to decide two spellings are the same value. Keeps letters of every script and symbols such as + and #. */
export const catKey = s => {
  const t = String(s).normalize('NFKC').toLowerCase().trim();
  const k = t.replace(/[\s._'’]+/g, '').replace(/(?<=[\p{L}\p{N}])-(?=[\p{L}\p{N}])/gu, '');
  return SYNONYMS[k] || k || t;
};
const titleCase = s => s.toLowerCase().replace(/(^|[\s\-'])([a-z])/g, (_, p, c) => p + c.toUpperCase());

/**
 * Find the row that holds the column names, skipping title rows above it.
 * @returns { row, hasHeader } where hasHeader is false when the first full row already looks like data.
 */
export function detectHeaderRow(matrix) {
  const filled = r => r.filter(v => !isBlank(v)).length;
  const top = matrix.slice(0, 30);
  const width = Math.max(0, ...top.map(filled));
  if (!width) return { row: 0, hasHeader: true };
  const need = Math.max(Math.min(2, width), Math.ceil(width * 0.6));
  const row = Math.max(0, top.findIndex(r => filled(r) >= need));
  const cells = matrix[row].filter(v => !isBlank(v));
  const wordy = cells.filter(v => (typeof v === 'string' && parseNumber(v) === null && !parseDate(v)) || (Number.isInteger(v) && v >= 1900 && v <= 2100)).length;
  return { row, hasHeader: wordy / cells.length >= 0.7 || matrix.length - row < 2 };
}

/** Guess what each column holds. Returns [{ name, type, filled, distinct }]. */
export function profileColumns(headers, rows) {
  return headers.map((name, c) => {
    const vals = rows.map(r => r[c]).filter(v => !isBlank(v) && !(typeof v === 'string' && PLACEHOLDERS.has(v.trim().toLowerCase())));
    const n = vals.length || 1;
    const h = String(name || '').toLowerCase().trim();
    const share = fn => vals.filter(fn).length / n;
    const distinct = new Set(vals.map(v => (isDateCell(v) ? v.date : catKey(v)))).size;
    const avgLen = vals.reduce((a, v) => a + String(isDateCell(v) ? v.date : v).length, 0) / n;
    let type = 'text';
    const dateHint = /date|dob|birth|expiry|expire|issue|joined|joining|start|end/.test(h);
    const at = share(v => typeof v === 'string' && v.includes('@'));
    if (vals.length === 0) type = 'text';
    else if (share(looksLikeDate) >= (dateHint ? 0.4 : 0.7)) type = 'date';
    else if (at >= 0.6 || (/e-?mail/.test(h) && at >= 0.3)) type = 'email';
    else if (ID_HEADER.test(h) && avgLen <= 40) type = 'id';
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
  trim: true, placeholders: true, dropEmpty: true, dropTotals: true, dedupe: true, dates: true, dayFirst: true,
  numbers: true, emails: true, categories: true, names: true, missing: true, ids: true, hr: true,
  passportMinDays: 180, expiryWarnDays: 90, today: null, firstDataRow: 2
};

/**
 * Clean a table.
 * @param headers string[]  @param rows cell[][]  @param types optional per-column type overrides
 * @returns { headers, rows, columns, issues, summary, byProblem, warnings }
 * `warnings` are plain sentences about things the reader should know (rows removed, cells that could not be read).
 */
export function clean(headers, rows, opts = {}, types = null) {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const issues = [];
  const warnings = [];
  const counts = { trimmed: 0, placeholders: 0, datesFixed: 0, numbersFixed: 0, categoriesFixed: 0, namesFixed: 0, emailsFixed: 0 };

  // headers: trim, fill blanks, make unique
  const seen = new Set();
  let H = headers.map((h, i) => {
    const base = isBlank(h) ? `Column ${i + 1}` : cleanText(String(h));
    let name = base;
    for (let k = 2; seen.has(name); k++) name = `${base} (${k})`;
    seen.add(name);
    return name;
  });
  const width = H.length;
  let R = rows.map((r, i) => ({ src: i + o.firstDataRow, cells: Array.from({ length: width }, (_, c) => (r[c] === undefined ? null : r[c])) }));

  // text tidy and placeholders
  for (const row of R) {
    row.cells = row.cells.map(v => {
      if (typeof v === 'number' && !Number.isFinite(v)) return null;
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

  // total, subtotal and footer rows are summaries of the data, not data
  let totalRows = 0;
  if (o.dropTotals && R.length > 2) {
    const labelCount = new Map();
    for (const r of R) for (const v of r.cells.slice(0, 3)) if (typeof v === 'string') labelCount.set(v, (labelCount.get(v) || 0) + 1);
    // "Total" on its own counts in any column; "Total Opex" only as a one-off label in the first three
    const isTotal = r => r.cells.some(v => typeof v === 'string' && TOTAL_EXACT.test(v)) ||
      r.cells.slice(0, 3).some(v => typeof v === 'string' && TOTAL_PREFIX.test(v) && labelCount.get(v) === 1);
    const kept = R.filter(r => !isTotal(r));
    // footer notes: trailing rows with a single filled cell in a wider table
    if (H.length >= 3) while (kept.length > 2 && kept[kept.length - 1].cells.filter(v => !isBlank(v)).length <= 1) kept.pop();
    totalRows = R.length - kept.length;
    if (totalRows && kept.length >= 2) {
      R = kept;
      warnings.push(`${totalRows} total or footer ${totalRows === 1 ? 'row was' : 'rows were'} left out so ${totalRows === 1 ? 'it is' : 'they are'} not counted twice.`);
    } else totalRows = 0;
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
  const example = list => `for example "${String(list[0]).slice(0, 30)}"`;

  columns.forEach((col, c) => {
    if (col.type === 'date') {
      const order = detectDateOrder(R.map(r => r.cells[c]), o.dayFirst);
      const bad = [];
      let ambiguous = 0;
      R.forEach((r, i) => {
        const v = r.cells[c];
        if (isBlank(v)) return;
        const d = parseDate(typeof v === 'number' ? String(v) : v, order.dayFirst);
        if (d) {
          if (typeof v === 'string' && NUMERIC_DATE.test(stripTime(v))) ambiguous++;
          if (o.dates) { if (!isDateCell(v)) counts.datesFixed++; r.cells[c] = { date: d }; }
        } else { flag(i, c, 'Not a valid date', 'High'); bad.push(v); }
      });
      if (bad.length) warnings.push(`${bad.length} ${bad.length === 1 ? 'value' : 'values'} in "${H[c]}" could not be read as a date (${example(bad)}).`);
      if (order.evidence === 'month') warnings.push(`Dates in "${H[c]}" were read as month/day/year, because some only make sense that way.`);
      if (order.evidence === 'both') warnings.push(`"${H[c]}" mixes day/month and month/day dates. Unclear ones were read as ${order.dayFirst ? 'day/month' : 'month/day'}, so some may be in the wrong month.`);
      col.dayFirst = order.dayFirst;
    } else if (col.type === 'number') {
      const strings = R.map(r => r.cells[c]).filter(v => typeof v === 'string');
      const comma = detectDecimalComma(strings);
      const bad = [];
      R.forEach((r, i) => {
        const v = r.cells[c];
        if (isBlank(v) || typeof v === 'number') return;
        const n = parseNumber(v, comma);
        if (n === null) { flag(i, c, 'Not a number', 'Medium'); bad.push(v); }
        else if (o.numbers) { r.cells[c] = n; counts.numbersFixed++; }
      });
      if (bad.length) warnings.push(`${bad.length} ${bad.length === 1 ? 'cell' : 'cells'} in "${H[c]}" could not be read as a number (${example(bad)}) and ${bad.length === 1 ? 'is' : 'are'} left out of totals.`);
      if (comma) warnings.push(`Numbers in "${H[c]}" were read with a decimal comma (1.234,56).`);
      const nums = R.map(r => r.cells[c]).filter(v => typeof v === 'number');
      const pctText = strings.filter(v => /%\s*\)?$/.test(v)).length;
      col.percent = (strings.length > 0 && pctText / strings.length >= 0.3 && pctText / Math.max(1, col.filled) >= 0.1) ||
        (PERCENT_HEADER.test(H[c].toLowerCase()) && nums.length > 0 && nums.every(v => Math.abs(v) <= 1.5));
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

  // Duplicates. Identical rows are only certain to be mistakes when the table has a column that
  // should be unique (an ID). Without one, identical rows can be real (two equal order lines).
  let duplicateRows = 0, duplicatesKept = 0;
  if (o.dedupe) {
    const keys = new Set();
    const dupes = new Set();
    R.forEach((r, i) => { const k = JSON.stringify(r.cells.slice(0, columns.length)); if (keys.has(k)) dupes.add(i); else keys.add(k); });
    const uniqueId = columns.some(col => col.type === 'id' && col.filled > 0 && col.distinct / col.filled >= 0.9);
    if (dupes.size && uniqueId) {
      for (const i of dupes) flag(i, idCol >= 0 ? idCol : 0, 'Exact duplicate row (removed)', 'Low');
      duplicateRows = dupes.size;
      R = R.filter((_, i) => !dupes.has(i));
    } else if (dupes.size) {
      duplicatesKept = dupes.size;
      warnings.push(`${dupes.size.toLocaleString('en-US')} ${dupes.size === 1 ? 'row is' : 'rows are'} identical to another row. They were kept, because the file has no ID column to show they are mistakes.`);
    }
  }
  if (o.ids) {
    columns.forEach((col, c) => {
      if (col.type !== 'id' || col.distinct / Math.max(1, col.filled) < 0.9) return;
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
    rowsIn: rows.length, rowsOut: outRows.length, columns: columns.length, emptyRows, emptyCols, duplicateRows, duplicatesKept, totalRows,
    rowsOk: outRows.length - needReview, rowsNeedReview: needReview, issues: issues.length,
    highIssues: issues.filter(i => i.severity === 'High').length, hrChecks: hrActive, ...counts
  };
  return { headers: H, rows: outRows, columns, issues, byProblem, summary, warnings };
}
