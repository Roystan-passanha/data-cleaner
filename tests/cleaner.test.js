import test from 'node:test';
import assert from 'node:assert/strict';
import { clean, parseDate, parseNumber, detectDateOrder, detectDecimalComma, detectHeaderRow, catKey, profileColumns } from '../js/cleaner.js';

const col = (out, name) => out.headers.indexOf(name);

test('parseDate handles mixed formats and timestamps', () => {
  for (const s of ['05/03/2027', '05-03-2027', '2027-03-05', '5 Mar 2027', '05.03.2027', 'March 5, 2027', '05-Mar-27', '2027-03-05 00:00:00', '2027-03-05T14:35:00+04:00', '05/03/2027 2:35 PM'])
    assert.equal(parseDate(s), '2027-03-05', s);
  assert.equal(parseDate('03/05/2027', false), '2027-03-05');
  for (const s of ['31/02/2027', 'TBC', '2027-13-01', '12345', '']) assert.equal(parseDate(s), null, s);
});

test('parseNumber reads the ways people write numbers', () => {
  const cases = { '1,234.50': 1234.5, 'AED 1,200': 1200, '(500)': -500, '45%': 0.45, '1,200.00-': -1200, '-AED 1,200': -1200, '(AED 1,200.00)': -1200,
    '-$1,200': -1200, '1,200 CR': -1200, '1,200.00 DR': 1200, 'QAR 500': 500, '−1200': -1200, '12.4K': 12400, '2.5M': 2500000, '1 200': 1200 };
  for (const [text, want] of Object.entries(cases)) assert.equal(parseNumber(text), want, text);
  for (const text of ['pending', '000123', '5 Mar', 'Units', '12:30', '-']) assert.equal(parseNumber(text), null, text);
  assert.equal(parseNumber('1.234,56', true), 1234.56);
  assert.equal(parseNumber('684,45', true), 684.45);
});

test('decimal comma and date order are detected per column', () => {
  assert.equal(detectDecimalComma(['1.234,56', '684,45', '12,5']), true);
  assert.equal(detectDecimalComma(['1,234.56', '684.45']), false);
  assert.equal(detectDecimalComma(['1,200', '3,400']), false);
  assert.deepEqual(detectDateOrder(['03/14/2025', '01/02/2025']), { dayFirst: false, evidence: 'month' });
  assert.deepEqual(detectDateOrder(['14/03/2025', '01/02/2025']), { dayFirst: true, evidence: 'day' });
  assert.equal(detectDateOrder(['01/02/2025']).evidence, 'none');
});

test('US-order dates are not scattered across the year', () => {
  const rows = Array.from({ length: 30 }, (_, i) => [`A${i}`, `03/${String(i + 1).padStart(2, '0')}/2025`, i]);
  const out = clean(['Ref Code', 'Ship Date', 'Qty'], rows);
  const months = new Set(out.rows.map(r => r[col(out, 'Ship Date')].date.slice(0, 7)));
  assert.deepEqual([...months], ['2025-03']);
  assert.ok(out.warnings.some(w => /month\/day\/year/.test(w)));
});

test('European numbers are read correctly and reported', () => {
  const rows = [['a', '1.234,56'], ['b', '684,45'], ['c', '12,50'], ['d', '1.000,00'], ['e', '99,99']];
  const out = clean(['Line', 'Betrag'], rows);
  const sum = out.rows.reduce((a, r) => a + r[col(out, 'Betrag')], 0);
  assert.equal(Math.round(sum * 100) / 100, 3031.5);
  assert.ok(out.warnings.some(w => /decimal comma/.test(w)));
});

test('unreadable numbers are reported, not silently dropped', () => {
  const rows = Array.from({ length: 20 }, (_, i) => [`x${i}`, i < 18 ? `${i * 10}` : 'pending']);
  const out = clean(['Item', 'Amount'], rows);
  assert.ok(out.warnings.some(w => /2 cells in "Amount" could not be read as a number/.test(w)));
});

test('total, subtotal and footer rows are left out', () => {
  const rows = [['Rent', 'Opex', 100], ['Power', 'Opex', 50], ['Total Opex', null, 150], ['Sales', 'Income', 400], ['Grand Total', null, 550], ['Prepared by Finance', null, null]];
  const out = clean(['Cost Line', 'Group', 'FY Total'], rows);
  assert.equal(out.rows.length, 3);
  assert.equal(out.rows.reduce((a, r) => a + r[col(out, 'FY Total')], 0), 550);
  assert.equal(out.summary.totalRows, 3);
  assert.ok(out.warnings.some(w => /3 total or footer rows were left out/.test(w)));
});

test('a product whose name starts with Total is kept when it repeats', () => {
  const rows = [['Total Care Shampoo', 5], ['Total Care Shampoo', 7], ['Soap', 2], ['Soap', 3], ['Brush', 1]];
  assert.equal(clean(['Product', 'Units'], rows).rows.length, 5);
});

test('identical rows are kept when there is no ID column, removed when there is', () => {
  const lines = Array.from({ length: 40 }, (_, i) => [['North', 'South'][i % 2], 'SKU1', 2]);
  const kept = clean(['Warehouse', 'Item', 'Pallets'], lines);
  assert.equal(kept.rows.length, 40);
  assert.equal(kept.summary.duplicateRows, 0);
  assert.ok(kept.warnings.some(w => /identical to another row/.test(w)));
  const withId = Array.from({ length: 40 }, (_, i) => [`D${i}`, 'North', 2]);
  withId.push(withId[3].slice(), withId[7].slice());
  const removed = clean(['Delivery ID', 'Warehouse', 'Pallets'], withId);
  assert.equal(removed.rows.length, 40);
  assert.equal(removed.summary.duplicateRows, 2);
});

test('values in other scripts and values that differ by a symbol are not merged', () => {
  assert.notEqual(catKey('دبي'), catKey('أبوظبي'));
  assert.notEqual(catKey('A+'), catKey('A-'));
  assert.notEqual(catKey('C++'), catKey('C#'));
  assert.equal(catKey('U.A.E'), catKey('uae '));
  assert.equal(catKey('Abu-Dhabi'), catKey('abu  dhabi'));
  const rows = Array.from({ length: 40 }, (_, i) => [['دبي', 'أبوظبي', 'الشارقة', 'عجمان'][i % 4], ['A+', 'A-', 'B+', 'O-'][i % 4], i]);
  const out = clean(['City', 'Blood', 'Qty'], rows);
  assert.equal(new Set(out.rows.map(r => r[col(out, 'City')])).size, 4);
  assert.equal(new Set(out.rows.map(r => r[col(out, 'Blood')])).size, 4);
  assert.equal(out.summary.categoriesFixed, 0);
});

test('column types: counts are numbers, codes are IDs, questions are not emails', () => {
  const rows = Array.from({ length: 30 }, (_, i) => [i * 3, i % 5, `00${100 + i}`, 4000 + (i % 3) * 100, ['Agree', 'Disagree', 'Neutral'][i % 3], `p${i}@x.com`, 25.2 + i, 55.1]);
  const headers = ['Number of Clicks', 'No of items', 'Invoice No', 'Account Code', 'The emails are relevant to me', 'Email', 'Latitude', 'Postal Code'];
  const types = Object.fromEntries(profileColumns(headers, rows).map(c => [c.name, c.type]));
  assert.deepEqual(types, { 'Number of Clicks': 'number', 'No of items': 'number', 'Invoice No': 'id', 'Account Code': 'id',
    'The emails are relevant to me': 'category', Email: 'email', Latitude: 'number', 'Postal Code': 'id' });
});

test('percent columns are marked', () => {
  const rows = Array.from({ length: 12 }, (_, i) => [`c${i}`, `${30 + i}.5%`, 0.02 + i / 1000, 1000 + i]);
  const out = clean(['Campaign', 'Open Rate', 'CTR', 'Sent'], rows);
  const byName = Object.fromEntries(out.columns.map(c => [c.name, c]));
  assert.equal(byName['Open Rate'].percent, true);
  assert.equal(byName.CTR.percent, true);
  assert.equal(byName.Sent.percent, false);
});

test('header row is found under title rows and group rows, and a missing header is noticed', () => {
  assert.deepEqual(detectHeaderRow([['Company HR'], ['Exported', 'today'], [], ['ID', 'Name', 'Dept', 'Salary'], [1, 'a', 'b', 3]]), { row: 3, hasHeader: true });
  assert.deepEqual(detectHeaderRow([['Group', null, null, 'Pay'], ['ID', 'Name', 'Dept', 'Salary'], [1, 'a', 'b', 3]]), { row: 1, hasHeader: true });
  assert.equal(detectHeaderRow([['North', 10, '2024-01-01'], ['South', 5, '2024-01-02']]).hasHeader, false);
  assert.equal(detectHeaderRow([['Line', 2023, 2024, 2025], ['Rent', 1, 2, 3]]).hasHeader, true);
});

test('odd headers do not break the table', () => {
  const out = clean(['constructor', 'A', 'A', 'A (2)', 'toString'], [[1, 2, 3, 4, 5], [1, 2, 3, 4, 5]]);
  assert.equal(new Set(out.headers).size, out.headers.length);
  assert.ok(out.headers.includes('constructor'));
});

test('source rows are reported against the original file', () => {
  const headers = ['Order No', ' Customer ', 'City', 'Order Date', 'Amount', ''];
  const rows = [['A1', 'acme ltd', 'Dubai', '01/02/2026', '1,000', null], ['A2', 'Beta', 'dubai ', '2026-02-03', 250, null],
    ['A3', 'Gamma', 'Abu Dhabi', '32/01/2026', 'n/a', null], ['A1', 'acme ltd', 'Dubai', '01/02/2026', '1,000', null],
    [null, null, null, null, null, null], ['A5', 'Delta', 'DUBAI', '5 Feb 2026', '300', null], ['A6', 'Eps', 'Abu Dhabi', '06.02.2026', '75.5', null]];
  const out = clean(headers, rows);
  assert.deepEqual(out.headers, ['Source Row', 'Order No', 'Customer', 'City', 'Order Date', 'Amount', 'Issue Count', 'Status']);
  assert.deepEqual(out.rows.map(r => r[3]), ['Dubai', 'Dubai', 'Abu Dhabi', 'Dubai', 'Dubai', 'Abu Dhabi']);
  assert.equal(out.issues.find(i => i.problem === 'Not a valid date').row, 4);
  assert.equal(out.summary.duplicatesKept, 1); // Order No repeats, so it is not trusted as a unique ID
});

import { makeSample } from '../js/sample.js';

test('sample HR file: types are detected', () => {
  const { headers, rows } = makeSample(200);
  const types = Object.fromEntries(profileColumns(headers, rows).map(c => [c.name, c.type]));
  assert.deepEqual(types, {
    'Employee ID': 'id', 'Full Name': 'name', Department: 'category', 'Work Country': 'category', Email: 'email',
    'Monthly Salary': 'number', 'Passport Number': 'id', 'Passport Issue Date': 'date', 'Passport Expiry Date': 'date',
    'Visa Status': 'category', 'Visa Expiry Date': 'date'
  });
});

test('sample HR file: problems are fixed and flagged', () => {
  const { headers, rows } = makeSample(300);
  const out = clean(headers, rows);
  const problems = new Set(out.issues.map(i => i.problem));
  for (const p of ['Not a valid date', 'Invalid email', 'Not a number', 'Exact duplicate row (removed)', 'Same Employee ID on more than one row', 'Passport expired'])
    assert.ok(problems.has(p), p);
  assert.equal(out.summary.emptyRows, 1);
  assert.ok(out.summary.duplicateRows >= 1);
  const countries = new Set(out.rows.map(r => r[col(out, 'Work Country')]));
  assert.equal(countries.size, 4);
  assert.ok(out.rows.every(r => { const v = r[col(out, 'Monthly Salary')]; return typeof v === 'number' || v === 'pending'; }));
  assert.ok(out.rows.every(r => { const v = r[col(out, 'Full Name')]; return v === v.trim() && v !== v.toUpperCase(); }));
  assert.ok(out.issues.every(i => i.row >= 2));
  assert.ok(out.headers.includes('Visa Days Left'));
});
