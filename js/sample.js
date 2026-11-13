// Builds a fake, deliberately messy employee file so people can try the tool without real data.
export function makeSample(n = 300, seed = 42) {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const first = ['Aarav', 'Fatima', 'John', 'Maria', 'Wei', 'Omar', 'Priya', 'Ahmed', 'Sara', 'Rahul', 'Aisha', 'David', 'Noura', 'Carlos', 'Anita', 'Yusuf', 'Elena', 'Ravi', 'Hana', 'Li'];
  const last = ['Sharma', 'Khan', 'Smith', 'Garcia', 'Zhang', 'Ali', 'Nair', 'Hassan', 'Lopez', 'Patel', 'Fernandes', 'Chen', 'Mansour', 'Silva', 'Iyer', 'Rossi', 'Kumar', 'Lee', 'Saeed', 'Dsouza'];
  const countries = { UAE: ['UAE', 'U.A.E', 'United Arab Emirates', 'uae '], KSA: ['KSA', 'Saudi Arabia', 'ksa'], Qatar: ['Qatar', 'QATAR'], India: ['India', 'india'] };
  const depts = ['Finance', 'Operations', 'IT', 'HR', 'Sales', 'Marketing', 'Logistics'];
  const visa = { Valid: ['Valid', 'valid', 'VALID', 'Active'], 'Under Process': ['Under Process', 'In progress'], Cancelled: ['Cancelled', 'canceled'], Expired: ['Expired', 'expired'] };
  const now = new Date();
  const day = off => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + off));
  const p2 = x => String(x).padStart(2, '0');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmt = (d, messy) => {
    const [y, m, dd] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
    if (!messy) return { date: `${y}-${p2(m)}-${p2(dd)}` };
    return pick([`${p2(dd)}/${p2(m)}/${y}`, `${p2(dd)}-${p2(m)}-${y}`, `${y}-${p2(m)}-${p2(dd)}`, `${dd} ${mon[m - 1]} ${y}`, `${p2(dd)}.${p2(m)}.${y}`]);
  };
  const headers = ['Employee ID', 'Full Name', 'Department', 'Work Country', 'Email', 'Monthly Salary', 'Passport Number', 'Passport Issue Date', 'Passport Expiry Date', 'Visa Status', 'Visa Expiry Date'];
  const rows = [];
  for (let i = 1; i <= n; i++) {
    const c = pick(Object.keys(countries));
    const issue = day(-int(200, 3700));
    const pexp = new Date(issue.getTime() + 3652 * 86400000);
    let vs = pick(['Valid', 'Valid', 'Valid', 'Under Process', 'Cancelled', 'Expired']);
    let vexp = day(vs === 'Expired' ? -int(1, 200) : int(-60, 900));
    const messy = rnd() < 0.35;
    const sal = int(40, 250) * 100;
    rows.push([`EMP${String(i).padStart(5, '0')}`, `${pick(first)} ${pick(last)}`, pick(depts), pick(countries[c]), `emp${String(i).padStart(5, '0')}@company.com`,
      messy ? pick([`${sal.toLocaleString('en-US')}`, `AED ${sal}`, String(sal)]) : sal,
      `${pick('ABCKLMNPZ'.split(''))}${int(1000000, 9999999)}`, fmt(issue, messy), fmt(pexp, messy), pick(visa[vs]), fmt(vexp, messy)]);
  }
  const some = k => Array.from({ length: k }, () => int(0, n - 1));
  for (const r of some(8)) rows[r][8] = '31/02/2027';
  for (const r of some(6)) rows[r][8] = null;
  for (const r of some(6)) rows[r][10] = 'TBC';
  for (const r of some(5)) rows[r][6] = 'N/A';
  for (const r of some(8)) rows[r][1] = '  ' + rows[r][1].toUpperCase() + ' ';
  for (const r of some(5)) rows[r][4] = rows[r][4].replace('@', '');
  for (const r of some(5)) rows[r][5] = 'pending';
  for (const r of some(4)) rows[r][0] = rows[(r + 7) % n][0];
  for (const r of some(6)) rows.push(rows[r].slice());
  rows.splice(20, 0, headers.map(() => null));
  return { headers, rows };
}
