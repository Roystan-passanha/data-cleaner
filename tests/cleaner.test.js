import test from 'node:test';
import assert from 'node:assert/strict';
import { clean, parseDate, parseNumber, profileColumns } from '../js/cleaner.js';
import { makeSample } from '../js/sample.js';

test('parseDate handles mixed formats, day first', () => {
  for (const s of ['05/03/2027', '05-03-2027', '2027-03-05', '5 Mar 2027', '05.03.2027', 'March 5, 2027', '05-Mar-27', '2027-03-05 00:00:00'])
    assert.equal(parseDate(s), '2027-03-05', s);
  assert.equal(parseDate('03/05/2027', false), '2027-03-05');
  assert.equal(parseDate('25/12/2026', false), '2026-12-25'); // only one valid reading
});

test('parseDate rejects impossible dates and text', () => {
  for (const s of ['31/02/2027', 'TBC', '2027-13-01', '12345', '']) assert.equal(parseDate(s), null, s);
  assert.equal(parseDate('29/02/2028'), '2028-02-29');
});

test('parseNumber reads numbers stored as text', () => {
  assert.equal(parseNumber('1,234.50'), 1234.5);
  assert.equal(parseNumber('AED 1,200'), 1200);
  assert.equal(parseNumber('(500)'), -500);
  assert.equal(parseNumber('45%'), 0.45);
  assert.equal(parseNumber('pending'), null);
});

test('profileColumns detects types', () => {
  const { headers, rows } = makeSample(200);
  const types = Object.fromEntries(profileColumns(headers, rows).map(c => [c.name, c.type]));
  assert.deepEqual(types, {
    'Employee ID': 'id', 'Full Name': 'name', Department: 'category', 'Work Country': 'category', Email: 'email',
    'Monthly Salary': 'number', 'Passport Number': 'id', 'Passport Issue Date': 'date', 'Passport Expiry Date': 'date',
    'Visa Status': 'category', 'Visa Expiry Date': 'date'
  });
});

test('clean fixes and flags the sample file', () => {
  const { headers, rows } = makeSample(300);
  const out = clean(headers, rows);
  const problems = new Set(out.issues.map(i => i.problem));
  for (const p of ['Not a valid date', 'Invalid email', 'Not a number', 'Exact duplicate row (removed)', 'Same Employee ID on more than one row', 'Passport expired'])
    assert.ok(problems.has(p), p);
  assert.equal(out.summary.emptyRows, 1);
  assert.ok(out.summary.duplicateRows >= 1);
  const col = name => out.headers.indexOf(name);
  const countries = new Set(out.rows.map(r => r[col('Work Country')]));
  assert.equal(countries.size, 4);
  assert.ok(countries.has('India') && countries.has('Qatar'));
  assert.ok(out.rows.every(r => r[col('Visa Status')] === null || ['Valid', 'Active', 'Under Process', 'In progress', 'Cancelled', 'Expired'].includes(r[col('Visa Status')])));
  assert.ok(out.rows.every(r => { const v = r[col('Monthly Salary')]; return typeof v === 'number' || v === 'pending'; }));
  assert.ok(out.rows.every(r => { const v = r[col('Full Name')]; return v === v.trim() && v !== v.toUpperCase(); }));
  assert.ok(out.issues.every(i => i.row >= 2));
  assert.ok(out.headers.includes('Visa Days Left'));
});

test('clean works on a non-HR table and reports source rows', () => {
  const headers = ['Order No', ' Customer ', 'City', 'Order Date', 'Amount', ''];
  const rows = [
    ['A1', 'acme ltd', 'Dubai', '01/02/2026', '1,000', null], ['A2', 'Beta', 'dubai ', '2026-02-03', 250, null],
    ['A2', 'Gamma', 'Abu Dhabi', '32/01/2026', 'n/a', null], ['A1', 'acme ltd', 'Dubai', '01/02/2026', '1,000', null],
    [null, null, null, null, null, null], ['A5', 'Delta', 'DUBAI', '5 Feb 2026', '300', null], ['A6', 'Eps', 'Abu Dhabi', '06.02.2026', '75.5', null]
  ];
  const out = clean(headers, rows);
  assert.deepEqual(out.headers, ['Source Row', 'Order No', 'Customer', 'City', 'Order Date', 'Amount', 'Issue Count', 'Status']);
  assert.equal(out.summary.rowsOut, 5);
  assert.deepEqual(out.rows.map(r => r[3]), ['Dubai', 'Dubai', 'Abu Dhabi', 'Dubai', 'Abu Dhabi']);
  assert.deepEqual(out.rows[0][4], { date: '2026-02-01' });
  assert.equal(out.rows[0][5], 1000);
  const bad = out.issues.find(i => i.problem === 'Not a valid date');
  assert.equal(bad.row, 4);
  assert.equal(out.summary.hrChecks, false);
});
