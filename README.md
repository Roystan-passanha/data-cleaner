# Data Cleaner

![tests](https://github.com/Roystan-passanha/data-cleaner/actions/workflows/tests.yml/badge.svg)

A website that cleans messy Excel and CSV files. You drop a file and download a cleaned workbook with a list of every problem found and the row it came from.

**Live site:** https://roystan-passanha.github.io/data-cleaner/

Files are read and cleaned inside the browser. They are never uploaded, so the tool is safe to use on files that hold personal data such as passport numbers.

## What it does

- Works out what each column holds (date, number, email, ID, category, name) and lets you correct the guess
- Converts dates typed in mixed formats (`05/03/2027`, `5 Mar 2027`, `2027-03-05`) to real dates, and flags impossible ones like `31/02/2027`
- Turns numbers stored as text (`1,200`, `AED 1200`) into numbers
- Merges different spellings of the same value (`UAE`, `U.A.E`, `uae `)
- Trims spaces and hidden characters, clears placeholders like `N/A`, removes empty rows and exact duplicates
- Flags missing values, invalid emails and IDs used on more than one row
- For HR files with passport and visa columns: expired passports, passports with under 180 days left, visas marked valid after their expiry date, visas expiring within 90 days

The download has three sheets: `Clean_Data`, `Issues` (with the row number in the original file) and `Summary`.

## How it is built

Plain HTML, CSS and JavaScript with no build step.

| File | What it is |
| --- | --- |
| `js/cleaner.js` | All cleaning logic as pure functions |
| `js/app.js` | File reading, screens and downloads |
| `js/sample.js` | Generates a fake messy file to try the tool |
| `tests/` | Tests for the cleaning logic (`npm test`, Node 20+) |
| `vendor/` | SheetJS, which reads and writes Excel files |

## Run it locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
npm test
```

## Licence

MIT. SheetJS Community Edition is Apache-2.0.
