import { clean, profileColumns, isDateCell, detectHeaderRow, DEFAULT_OPTIONS } from './cleaner.js';
import { makeSample } from './sample.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) n.append(k);
  return n;
};
const show = (node, on = true) => { node.hidden = !on; };

// ---------- reading files ----------
const state = { workbook: null, fileName: '', headers: [], rows: [], types: [], result: null, tab: 'problems' };

const serialToIso = n => {
  const d = XLSX.SSF.parse_date_code(n);
  return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null;
};
const isoToSerial = s => Math.round(Date.parse(s + 'T00:00:00Z') / 86400000) + 25569;

function sheetToMatrix(ws, csv) {
  // Use the cells that exist. A sheet's declared range can run to row 1,048,576 because of one stray cell.
  let maxR = -1, maxC = -1;
  const cells = [];
  for (const addr in ws) {
    if (addr[0] === '!') continue;
    const cell = ws[addr];
    if (!cell || cell.t === 'z' || cell.t === 'e' || cell.v === undefined || cell.v === '') continue;
    const { r, c } = XLSX.utils.decode_cell(addr);
    cells.push([r, c, cell]);
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  if (maxR < 0) return [];
  if (maxR > 400000 && cells.length < maxR / 3) maxR = cells.map(x => x[0]).sort((x, y) => x - y)[Math.floor(cells.length * 0.999)]; // ignore a stray cell far below the data
  const out = Array.from({ length: maxR + 1 }, () => new Array(maxC + 1).fill(null));
  for (const [r, c, cell] of cells) {
    if (r > maxR) continue;
    let v;
    if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
      if (cell.v < 1) v = XLSX.SSF.format('hh:mm', cell.v); // a time of day with no date
      else { const d = serialToIso(cell.v); v = d ? { date: d } : cell.v; }
    } else if (cell.t === 'd') v = { date: cell.v.toISOString().slice(0, 10) };
    else v = cell.v;
    // CSV cells are read as text so dates are not guessed in US order; turn plain numbers back into numbers
    if (csv && typeof v === 'string' && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v.trim()) && v.trim().length < 16) v = Number(v);
    out[r][c] = v;
  }
  return out;
}

async function openFile(file) {
  show($('file-error'), false);
  try {
    if (file.size > 30 * 1024 * 1024) throw new Error('That file is over 30 MB, which is too large to clean in a browser.');
    const csv = /\.(csv|tsv|txt)$/i.test(file.name);
    state.csv = csv;
    if (!csv) {
      const sig = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      const zip = sig[0] === 0x50 && sig[1] === 0x4b, ole = sig[0] === 0xd0 && sig[1] === 0xcf;
      if (!zip && !ole) throw new Error('not a workbook');
    }
    state.workbook = csv ? XLSX.read(await file.text(), { type: 'string', raw: true }) : XLSX.read(await file.arrayBuffer(), { type: 'array', cellNF: true });
    state.fileName = file.name;
    state.matrices = {};
    fillSheets();
  } catch (e) {
    $('file-error').textContent = e.message && /MB/.test(e.message) ? e.message : 'That file could not be read. Check it is an Excel or CSV file and is not password protected.';
    show($('file-error'));
  }
}

function fillSheets() {
  const sel = $('sheet');
  sel.replaceChildren(...state.workbook.SheetNames.map(n => el('option', { value: n, textContent: n })));
  // start on the sheet with the most data, which is rarely a cover or notes sheet
  const size = n => Object.keys(state.workbook.Sheets[n]).length;
  sel.value = state.workbook.SheetNames.reduce((a, b) => (size(b) > size(a) ? b : a));
  $('file-name').textContent = state.fileName;
  show($('file-info'));
  $('header-row').value = '';
  loadSheet();
}

function loadSheet() {
  const name = $('sheet').value;
  const m = state.matrices[name] || (state.matrices[name] = sheetToMatrix(state.workbook.Sheets[name], state.csv));
  const filled = r => r.filter(v => v !== null && v !== '').length;
  let hr = Number($('header-row').value);
  if (!hr) { hr = detectHeaderRow(m).row + 1; $('header-row').value = hr; }
  const header = m[hr - 1] || [];
  state.headers = header.map(v => (v === null ? '' : isDateCell(v) ? v.date : String(v)));
  state.rows = m.slice(hr);
  state.firstDataRow = hr + 1;
  state.types = profileColumns(state.headers, state.rows).map(c => c.type);
  renderColumns();
  show($('panel-options'), state.headers.length > 0);
  show($('panel-results'), false);
}

function useTable(headers, rows, name) {
  state.workbook = null;
  state.fileName = name;
  state.headers = headers; state.rows = rows; state.firstDataRow = 2;
  state.types = profileColumns(headers, rows).map(c => c.type);
  $('file-name').textContent = name;
  $('sheet').replaceChildren(el('option', { textContent: 'Sample' }));
  $('header-row').value = 1;
  show($('file-info'));
  renderColumns();
  show($('panel-options'));
  show($('panel-results'), false);
}

// ---------- step 2 ----------
const TYPES = { text: 'Text', name: 'Name', category: 'Category (repeated values)', date: 'Date', number: 'Number', email: 'Email', id: 'ID / code' };
const OPTIONS = [
  ['trim', 'Trim extra spaces and hidden characters'],
  ['placeholders', 'Treat N/A, null, - and similar as empty'],
  ['dropEmpty', 'Remove empty rows and columns'],
  ['dropTotals', 'Leave out total, subtotal and footer rows'],
  ['dedupe', 'Remove exact duplicate rows (only when the file has an ID column)'],
  ['dates', 'Convert dates to one format'],
  ['dayFirst', 'Read 03/04/2026 as 3 April (day first)'],
  ['numbers', 'Turn numbers stored as text into numbers'],
  ['categories', 'Merge different spellings of the same value (UAE, U.A.E, uae)'],
  ['names', 'Fix names typed in ALL CAPS or lowercase'],
  ['emails', 'Lowercase emails and flag invalid ones'],
  ['missing', 'Flag missing values'],
  ['ids', 'Flag IDs used on more than one row'],
  ['hr', 'Passport and visa expiry checks (when those columns exist)']
];

const display = v => (v === null || v === undefined ? '' : isDateCell(v) ? v.date : String(v));

function renderColumns() {
  const prof = profileColumns(state.headers, state.rows);
  const head = el('tr', {}, ...['Column', 'Type', 'Filled', 'Different values', 'Examples'].map(t => el('th', { textContent: t })));
  const body = prof.map((c, i) => {
    const sel = el('select', { ariaLabel: `Type for ${c.name || 'column ' + (i + 1)}` }, ...Object.entries(TYPES).map(([v, t]) => el('option', { value: v, textContent: t })));
    sel.value = state.types[i];
    sel.addEventListener('change', () => { state.types[i] = sel.value; });
    const examples = [...new Set(state.rows.map(r => display(r[i])).filter(Boolean))].slice(0, 3).join('  ·  ');
    return el('tr', {}, el('td', { textContent: c.name || `(blank ${i + 1})` }), el('td', {}, sel),
      el('td', { textContent: `${c.filled} of ${state.rows.length}` }), el('td', { textContent: c.distinct }), el('td', { className: 'muted', textContent: examples }));
  });
  $('columns').replaceChildren(el('thead', {}, head), el('tbody', {}, ...body));
  if (!$('options').children.length) {
    $('options').replaceChildren(...OPTIONS.map(([key, label]) => {
      const box = el('input', { type: 'checkbox', id: 'opt-' + key, checked: DEFAULT_OPTIONS[key] });
      return el('label', { className: 'check' }, box, label);
    }));
  }
}

function runClean() {
  const opts = Object.fromEntries(OPTIONS.map(([k]) => [k, $('opt-' + k).checked]));
  opts.firstDataRow = state.firstDataRow;
  state.result = clean(state.headers, state.rows, opts, state.types.slice());
  renderResults();
}

// ---------- step 3 ----------
function renderResults() {
  const { summary: s } = state.result;
  const tile = (value, label, tone = '') => el('div', { className: 'tile ' + tone }, el('span', { className: 'tile__value', textContent: value.toLocaleString() }), el('span', { className: 'tile__label', textContent: label }));
  $('tiles').replaceChildren(tile(s.rowsOut, 'rows after cleaning'), tile(s.rowsOk, 'rows OK', 'good'), tile(s.rowsNeedReview, 'rows need review', s.rowsNeedReview ? 'warn' : ''), tile(s.highIssues, 'high severity issues', s.highIssues ? 'bad' : ''));
  const fixed = [[s.datesFixed, 'dates converted'], [s.numbersFixed, 'numbers converted'], [s.categoriesFixed, 'spellings merged'], [s.namesFixed, 'names recased'],
    [s.trimmed, 'cells trimmed'], [s.placeholders, 'placeholders cleared'], [s.duplicateRows, 'duplicate rows removed'], [s.totalRows, 'total or footer rows left out'], [s.emptyRows, 'empty rows removed'], [s.emptyCols, 'empty columns removed']]
    .filter(([n]) => n).map(([n, t]) => `${n.toLocaleString()} ${n === 1 ? t.replace(/(\w)s( |$)/, '$1$2') : t}`);
  $('fixed').textContent = fixed.length ? 'Fixed automatically: ' + fixed.join(', ') + '.' : 'Nothing needed fixing automatically.';
  $('warnings').replaceChildren(...state.result.warnings.map(t => el('li', { textContent: t })));
  show($('warnings-wrap'), state.result.warnings.length > 0);
  show($('panel-results'));
  setTab('problems');
  $('panel-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setTab(tab) {
  state.tab = tab;
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('is-active', b.dataset.tab === tab);
  show($('filter-wrap'), tab !== 'problems');
  $('filter').value = '';
  renderTable();
}

function renderTable() {
  const r = state.result;
  const q = $('filter').value.trim().toLowerCase();
  let headers, rows;
  if (state.tab === 'problems') { headers = ['Severity', 'Problem', 'Count']; rows = r.byProblem.map(p => [p.severity, p.problem, p.count]); }
  else if (state.tab === 'issues') { headers = ['Row in file', 'ID', 'Name', 'Column', 'Problem', 'Original value', 'Severity']; rows = r.issues.map(i => [i.row, i.id, i.name, i.column, i.problem, i.value, i.severity]); }
  else { headers = r.headers; rows = r.rows; }
  if (q) rows = rows.filter(row => row.some(v => display(v).toLowerCase().includes(q)));
  const LIMIT = 200;
  const sevCol = headers.indexOf('Severity');
  const body = rows.slice(0, LIMIT).map(row => el('tr', {}, ...row.map((v, c) => {
    const td = el('td', { textContent: display(v) });
    if (c === sevCol) td.className = 'sev sev--' + String(v).toLowerCase();
    if (v === 'Needs review') td.className = 'sev sev--medium';
    return td;
  })));
  $('result-table').replaceChildren(el('thead', {}, el('tr', {}, ...headers.map(h => el('th', { textContent: h })))), el('tbody', {}, ...body));
  $('result-note').textContent = rows.length === 0 ? (state.tab === 'data' ? 'No rows.' : 'No problems found.') : rows.length > LIMIT ? `Showing the first ${LIMIT} of ${rows.length.toLocaleString()} rows. The download has all of them.` : '';
}

// ---------- downloads ----------
function toSheet(headers, rows) {
  const aoa = [headers, ...rows.map(r => r.map(v => (isDateCell(v) ? { t: 'n', v: isoToSerial(v.date), z: 'dd-mmm-yyyy' } : v)))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = headers.map((h, c) => ({ wch: Math.min(45, Math.max(10, String(h).length + 2, ...rows.slice(0, 200).map(r => display(r[c]).length + 2))) }));
  if (rows.length) ws['!autofilter'] = { ref: ws['!ref'] };
  return ws;
}

const baseName = () => state.fileName.replace(/\.[^.]+$/, '') + '_cleaned';

function downloadXlsx() {
  const r = state.result, s = r.summary;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, toSheet(r.headers, r.rows), 'Clean_Data');
  XLSX.utils.book_append_sheet(wb, toSheet(['Row in file', 'ID', 'Name', 'Column', 'Problem', 'Original value', 'Severity'], r.issues.map(i => [i.row, i.id, i.name, i.column, i.problem, i.value, i.severity])), 'Issues');
  const sum = [['Source file', state.fileName], ['Cleaned on', new Date().toISOString().slice(0, 10)], ['Rows in source', s.rowsIn], ['Rows after cleaning', s.rowsOut], ['Rows OK', s.rowsOk],
    ['Rows needing review', s.rowsNeedReview], ['Total issues', s.issues], ['Duplicate rows removed', s.duplicateRows], ['Empty rows removed', s.emptyRows], ['Dates converted', s.datesFixed],
    ['Numbers converted', s.numbersFixed], ['Spellings merged', s.categoriesFixed], [], ['Severity', 'Problem', 'Count'], ...r.byProblem.map(p => [p.severity, p.problem, p.count])];
  const ws = XLSX.utils.aoa_to_sheet([['Metric', 'Value'], ...sum]);
  ws['!cols'] = [{ wch: 28 }, { wch: 50 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Summary');
  XLSX.writeFile(wb, baseName() + '.xlsx');
}

function downloadCsv() {
  const r = state.result;
  const ws = XLSX.utils.aoa_to_sheet([r.headers, ...r.rows.map(row => row.map(display))]);
  const blob = new Blob(['﻿' + XLSX.utils.sheet_to_csv(ws)], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: baseName() + '.csv' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- wiring ----------
const drop = $('drop');
drop.addEventListener('click', () => $('file').click());
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } });
$('file').addEventListener('change', e => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; });
for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('is-over'); });
for (const t of ['dragleave', 'drop']) drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('is-over'); });
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) openFile(f); });
$('btn-sample').addEventListener('click', () => { const s = makeSample(300); useTable(s.headers, s.rows, 'sample_employees.xlsx'); });
$('sheet').addEventListener('change', () => { if (state.workbook) { $('header-row').value = ''; loadSheet(); } });
$('header-row').addEventListener('change', () => { if (state.workbook) loadSheet(); });
$('btn-clean').addEventListener('click', runClean);
$('btn-xlsx').addEventListener('click', downloadXlsx);
$('btn-csv').addEventListener('click', downloadCsv);
$('filter').addEventListener('input', renderTable);
for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', () => setTab(b.dataset.tab));
