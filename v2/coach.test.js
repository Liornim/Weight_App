/**
 * בדיקות לקובץ של Claude: מיזוג חד-פעמי, ובלי כפילויות בגיליון.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://x.local/v2/' });
const w = dom.window;
w.scrollTo = () => {};
[...html.matchAll(/<script src="([^"?]+)/g)].map((m) => m[1]).forEach((rel) => {
  const file = rel.indexOf('../') === 0
    ? path.join(ROOT, rel.replace('../', ''))
    : path.join(__dirname, rel);
  w.eval(fs.readFileSync(file, 'utf8'));
});

const { Store, Coach, Sheets } = w;
let file = null;
w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(JSON.stringify(file))) });

let sheetState = 'missing';
let saves = [];
Sheets.verify = () => Promise.resolve({ state: sheetState, count: sheetState === 'missing' ? 0 : 1 });
Sheets.save = (url, row, group) => {
  saves.push({ row, group });
  sheetState = 'verified';
  return Promise.resolve({ state: 'verified', sent: true });
};

let passed = 0;
const failures = [];
const queue = [];
const test = (name, fn) => queue.push({ name, fn });
const assert = (ok, msg) => { if (!ok) throw new Error(msg || 'assertion failed'); };

const base = (over) => Object.assign({
  updatedAt: 't1',
  entries: [{ date: '2026-11-02', weightKg: 90.8 }],
  summary: { date: '2026-11-02', headline: 'כותרת', lines: ['<b>שורה</b>'],
    tiles: [{ label: 'משקל', value: '90.8' }] }
}, over);

test('ערך מהקובץ נכנס למאגר, והסיכום מוצג', async () => {
  file = base();
  await Coach.load();
  assert(Store.getEntry('2026-11-02').weightKg === 90.8);
  assert(w.document.getElementById('view').textContent.includes('כותרת'), 'אין סיכום במסך');
});

test('תיקון ידני לא נדרס בטעינה הבאה', async () => {
  Store.upsert({ date: '2026-11-02', weightKg: 90.5 });
  await Coach.load();
  assert(Store.getEntry('2026-11-02').weightKg === 90.5);
});

test('ערך חדש בקובץ כן נכנס', async () => {
  file = base({ entries: [{ date: '2026-11-02', weightKg: 90.7 }] });
  await Coach.load();
  assert(Store.getEntry('2026-11-02').weightKg === 90.7);
});

test('נתוני אוכל לא מוחקים שקילה', async () => {
  file = base({ entries: [{ date: '2026-11-02', weightKg: 90.7, kcal: 1850, proteinG: 175 }] });
  await Coach.load();
  const e = Store.getEntry('2026-11-02');
  assert(e.weightKg === 90.7 && e.kcal === 1850 && e.proteinG === 175);
});

test('הסיכום לא מזריק HTML', () => {
  assert(!Coach.card().includes('<b>שורה'));
});

test('בלי כתובת גיליון אין כתיבה', () => { assert(saves.length === 0); });

test('כותב לגיליון פעם אחת בלבד, גם בטעינות חוזרות', async () => {
  Store.updateSettings({ sync: { url: 'https://script.google.com/x' } });
  file = base({ updatedAt: 't2', entries: [{ date: '2026-11-03', weightKg: 90.4 }] });
  sheetState = 'missing';
  await Coach.load();
  await Coach.load();
  assert(saves.length === 1, 'נכתבו ' + saves.length);
  assert(saves[0].group === 'body' && saves[0].row.weightKg === 90.4);
});

test('שורה קיימת עם ערכים אחרים: מדווח ולא מוסיף', async () => {
  saves = [];
  sheetState = 'mismatch';
  file = base({ updatedAt: 't3', entries: [{ date: '2026-11-04', weightKg: 90.1 }] });
  await Coach.load();
  assert(saves.length === 0);
  assert(Coach.card().includes('ערכים אחרים'), 'אין אזהרה');
});

test('תקלה בבדיקה: לא כותב, ומנסה שוב בפעם הבאה', async () => {
  saves = [];
  sheetState = 'unknown';
  file = base({ updatedAt: 't4', entries: [{ date: '2026-11-05', weightKg: 90 }] });
  await Coach.load();
  assert(saves.length === 0);
  sheetState = 'missing';
  await Coach.load();
  assert(saves.length === 1);
});

test('קובץ שבור לא מפיל את הדף', async () => {
  const before = Store.getEntries().length;
  file = { entries: [{ date: 'לא תאריך', weightKg: 1 }, null], updatedAt: 't5' };
  await Coach.load();
  assert(Store.getEntries().length === before);
  const saved = w.fetch;
  w.fetch = () => Promise.reject(new Error('רשת'));
  await Coach.load();
  w.fetch = saved;
});

// jsdom מפעיל את init בעצמו, וזה חייב להסתיים לפני הבדיקה הראשונה
const ready = new Promise((done) => setTimeout(done, 200));
queue.reduce((chain, item) => chain.then(() => item.fn()).then(() => { passed++; },
  (error) => failures.push({ name: item.name, message: error.message })), ready)
  .then(() => {
    failures.forEach((f) => console.log('✗ ' + f.name + '\n   ' + f.message));
    console.log('\n' + passed + ' עברו, ' + failures.length + ' נכשלו\n');
    process.exit(failures.length ? 1 : 0);
  });
