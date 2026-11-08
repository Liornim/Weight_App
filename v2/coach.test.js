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

test('הגיליון הפשוט מציג יום בשורה', () => {
  const box = w.document.createElement('div');
  box.innerHTML = Coach.card();
  const cells = [...box.querySelectorAll('tbody tr td')].map((td) => td.textContent);
  assert(cells.length === 10, 'תאים: ' + cells.length);
  assert(cells[1].includes('90.8'), cells.join('|'));
});

test('הליכה מוצגת בעמודה משלה ולא נכנסת לצעדים', async () => {
  file = base({ updatedAt: 't0', entries: [{ date: '2026-11-02', weightKg: 90.8,
    walks: [{ minutes: 34, steps: 3461 }, { minutes: 10, steps: 900 }] }] });
  await Coach.load();
  const box = w.document.createElement('div');
  box.innerHTML = Coach.card();
  const cells = [...box.querySelectorAll('tbody tr td')].map((td) => td.textContent);
  assert(cells[7].includes('44'), cells.join('|'));
  assert(!cells[6].match(/\d/), 'הליכה נכנסה לצעדים: ' + cells[6]);
  assert(Store.getEntry('2026-11-02').steps === undefined);
});

test('יום פתוח מציג סכום ארוחות, בלי לכתוב למאגר', async () => {
  file = base({ updatedAt: 't00', entries: [{ date: '2026-11-02', weightKg: 90.8,
    meals: [{ kcal: 235, proteinG: 27 }, { kcal: 605, proteinG: 62 }] }] });
  await Coach.load();
  const box = w.document.createElement('div');
  box.innerHTML = Coach.card();
  const cells = [...box.querySelectorAll('tbody tr td')].map((td) => td.textContent.replace(/\D/g, ''));
  assert(cells[2] === '840' && cells[3] === '89', cells.join('|'));
  assert(Store.getEntry('2026-11-02').kcal === undefined, 'נכנס למאגר');
});

test('הכרטיס הגדול מציג נאכל, יעד ונשאר', async () => {
  file = base({ updatedAt: 't01', targets: { kcal: 1900, proteinG: 170 },
    entries: [{ date: '2026-11-02', weightKg: 90.8, meals: [{ kcal: 840, proteinG: 89 }] }] });
  await Coach.load();
  const text = w.document.getElementById('view').textContent;
  assert(text.includes('840') && text.includes('1,060') && text.includes('81'), text.slice(0, 200));
});

test('הארוחות של היום מוצגות, בלי להזריק HTML', async () => {
  file = base({ updatedAt: 't03', targets: { kcal: 1900, proteinG: 170 },
    entries: [{ date: '2026-11-02', meals: [{ name: '<b>סלט</b>', kcal: 760, proteinG: 93 }] }] });
  await Coach.load();
  const html = Coach.today();
  assert(html.includes('סלט') && html.includes('760') && !html.includes('<b>סלט'), html);
});

test('פחמימות ושומן מוצגים מול היעד', async () => {
  file = base({ updatedAt: 't04', targets: { kcal: 1900, proteinG: 170, carbG: 160, fatG: 65 },
    entries: [{ date: '2026-11-02', meals: [{ name: 'א', kcal: 500, proteinG: 20, carbG: 52, fatG: 80 }] }] });
  await Coach.load();
  const html = Coach.today();
  assert(html.includes('פחמימות') && html.includes('נשארו 108'), html);
  assert(html.includes('מעל היעד ב-15'), html);
});

test('מאזן מצטבר סופר רק ימים סגורים', () => {
  const cfg = { baseBurn: 2450, kcalPerStep: 0.045, plannedDeficit: 550 };
  const b = Coach.balanceOf([
    { date: 'a', kcal: 2490, steps: 11870 },
    { date: 'b', kcal: 3127, steps: 8627 },
    { date: 'c', weightKg: 91.2, meals: [{ kcal: 100 }] }
  ], cfg);
  assert(b.days === 2, 'ימים: ' + b.days);
  assert(b.total === -205, 'מאזן: ' + b.total);
  assert(b.gap === 895, 'פער: ' + b.gap);
});

test('שדה חדש נקלט גם כש-updatedAt לא השתנה', async () => {
  const entries = [{ date: '2026-11-02', kcal: 2490, steps: 11870 }];
  const targets = { kcal: 1900, proteinG: 170 };
  file = base({ updatedAt: 'same', targets, entries });
  await Coach.load();
  assert(!Coach.today().includes('מצטבר'), 'מאזן בלי הגדרה');
  file = base({ updatedAt: 'same', targets, entries,
    balance: { baseBurn: 2450, kcalPerStep: 0.045, plannedDeficit: 550 } });
  await Coach.load();
  assert(Coach.today().includes('מצטבר'), 'המאזן לא נקלט');
});

test('עודף וחוסר מצטבר של חלבון, פחמימות ושומן', () => {
  const list = Coach.macroTotals([
    { kcal: 2490, steps: 11870, proteinG: 163, carbG: 180, fatG: 106 },
    { kcal: 3127, steps: 8627, proteinG: 232, carbG: 52, fatG: 163 },
    { weightKg: 91.2, meals: [{ proteinG: 50 }] }
  ], { kcal: 1900, proteinG: 170, carbG: 160, fatG: 65 });
  const got = list.map((m) => m.diff).join(',');
  assert(got === '55,-88,139', got);
});

test('ממוצע משקל: 7 אחרונות, והשוואה רק עם 14', () => {
  const short = Coach.weightAverage([{ weightKg: 90.8 }, { weightKg: 90.8 }, {}, { weightKg: 91.2 }]);
  assert(short.count === 3 && Math.abs(short.average - 90.933) < 0.01, JSON.stringify(short));
  assert(short.change === null, 'השוואה מוקדמת');
  const rows = [];
  for (let i = 0; i < 7; i++) rows.push({ weightKg: 91 });
  for (let i = 0; i < 7; i++) rows.push({ weightKg: 90 });
  const full = Coach.weightAverage(rows);
  assert(full.count === 7 && full.average === 90 && full.change === -1, JSON.stringify(full));
  assert(Coach.weightAverage([{}]) === null);
});

test('צעדים מול המינימום, בימים סגורים בלבד', () => {
  const diff = Coach.stepsDiff([
    { kcal: 2490, steps: 11870 }, { kcal: 3127, steps: 8627 }, { steps: 1000 }
  ], 6700);
  assert(diff === 7097, String(diff));
});

test('צעדים לסגירת הפער', () => {
  const cfg = { kcalPerStep: 0.045 };
  assert(Coach.stepsForGap(1495, cfg) === 33222, String(Coach.stepsForGap(1495, cfg)));
  assert(Coach.stepsForGap(-100, cfg) === 0);
});

test('צעדים מול שני היעדים, זה לצד זה', async () => {
  file = base({ updatedAt: 't05',
    targets: { kcal: 1900, proteinG: 170, steps: 6700, stepsGoal: 10000 },
    balance: { baseBurn: 2150, kcalPerStep: 0.045, plannedDeficit: 550 },
    entries: [{ date: '2026-11-02', kcal: 2490, steps: 11870 }, { date: '2026-11-03', kcal: 3127, steps: 8627 }] });
  await Coach.load();
  const html = Coach.today();
  assert(html.includes('7,097') && html.includes('497'), html);
});

test('הליכה ואורביטרק בעמודות נפרדות', async () => {
  file = base({ updatedAt: 't06', entries: [{ date: '2026-11-06', weightKg: 89.6,
    walks: [{ minutes: 20 }, { type: 'אליפטיקל', minutes: 45 }] }] });
  await Coach.load();
  const box = w.document.createElement('div');
  box.innerHTML = Coach.card();
  const cells = [...box.querySelectorAll('tbody tr td')].map((td) => td.textContent);
  assert(cells[7].includes('20') && cells[8].includes('45'), cells.join('|'));
});

test('המצטבר: גרף, צבעים ושעת רענון', async () => {
  file = base({ updatedAt: '2026-11-07T01:04:00+02:00',
    targets: { kcal: 1900, proteinG: 150, carbG: 180, fatG: 65, steps: 6700, stepsGoal: 10000 },
    balance: { baseBurn: 2150, kcalPerStep: 0.045, plannedDeficit: 550 },
    entries: [{ date: '2026-11-02', kcal: 2490, steps: 11870, proteinG: 163, carbG: 180, fatG: 106 },
      { date: '2026-11-03', kcal: 3127, steps: 8627, proteinG: 232, carbG: 52, fatG: 163 }] });
  await Coach.load();
  const html = Coach.today();
  assert(html.includes('<svg') && html.includes('cumul__bar--bad') && html.includes('cumul__bar--good'), 'אין גרף');
  assert(html.includes('cumul__tile--bad') && html.includes('רענון אחרון') && html.includes('נתונים מ-01:04'), 'אין צבע או שעה');
});

test('טאב הארוחות מציג כל יום עם הארוחות שלו', async () => {
  file = base({ updatedAt: 't07', entries: [
    { date: '2026-11-05', meals: [{ time: '10:37', name: '<i>GO</i>', kcal: 190, proteinG: 20, carbG: 12, fatG: 6 }] },
    { date: '2026-11-06', meals: [] }] });
  await Coach.load();
  const html = Coach.meals();
  assert(html.includes('GO') && !html.includes('<i>GO') && html.includes('190'), html);
  assert(html.indexOf('06/11') < html.indexOf('05/11'), 'סדר');
  assert(html.includes('לא נרשמו ארוחות ביום הזה'), 'יום ריק');
  assert(html.includes('06/11 · יום שישי') && html.includes('05/11 · יום חמישי'), 'שם היום');
});

test('קבוצות: סכום לכל קבוצה, וארוחה בלי פירוק נספרת בנפרד', async () => {
  const t = Coach.catTotals([{ date: '2026-11-06', meals: [
    { kcal: 1210, items: [{ cat: 'meat', kcal: 750, proteinG: 64 }, { cat: 'grains', kcal: 390, proteinG: 13 }, { cat: 'fat', kcal: 70 }] },
    { kcal: 625, items: [{ cat: 'alcohol', kcal: 625 }] },
    { kcal: 100, proteinG: 5 }] }]);
  assert(t.meat.kcal === 750 && t.alcohol.kcal === 625 && t.other.kcal === 100 && t.meat.proteinG === 64, JSON.stringify(t));
  file = base({ updatedAt: 't08', entries: [{ date: '2026-11-06', meals: [{ kcal: 625, items: [{ cat: 'alcohol', kcal: 625 }] }] }] });
  await Coach.load();
  const html = Coach.groups();
  assert(html.includes('אלכוהול') && html.includes('100%') && html.includes('groups__c--alcohol'), html);
});

test('פירוק: תזונה וצעדים בנפרד, יום פתוח לא נספר', async () => {
  const cfg = { baseBurn: 2150, kcalPerStep: 0.045, plannedDeficit: 550 };
  const s = Coach.splitOf([
    { date: '2026-11-07', kcal: 3600, steps: 11219 },
    { date: '2026-11-08', meals: [{ kcal: 1419 }] }], cfg, { kcal: 1900 });
  assert(s.days === 1 && s.diet === -1450 && s.steps === 505 && s.dietPlan === 250 && s.stepsPlan === 300, JSON.stringify(s));
  assert(s.list[1].diet === 731 && !s.list[1].closed, 'יום פתוח');
  file = base({ updatedAt: 't09', balance: cfg, entries: [{ date: '2026-11-07', kcal: 3600, steps: 11219 }] });
  await Coach.load();
  const html = Coach.split();
  assert(html.includes('פירוק הגירעון') && html.includes('1,450') && html.includes('505') && html.includes('ק״ג') && html.includes('0.12'), html);
});

test('בלי יעדים אין כרטיס גדול', async () => {
  file = base({ updatedAt: 't02', entries: [{ date: '2026-11-02', weightKg: 90.8 }] });
  await Coach.load();
  assert(Coach.today() === '');
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

test('תאריך התחלה מסתיר היסטוריה בלי למחוק אותה', async () => {
  Store.upsert({ date: '2026-01-01', weightKg: 95 });
  file = base({ updatedAt: 't6', startDate: '2026-11-02', entries: [] });
  await Coach.load();
  assert(!Store.getEntries().some((e) => e.date === '2026-01-01'), 'ההיסטוריה מוצגת');
  assert(Store.getEntry('2026-01-01').weightKg === 95, 'ההיסטוריה נמחקה');
  assert(JSON.parse(Store.exportJSON()).entries.some((e) => e.date === '2026-01-01'), 'חסר בגיבוי');
  file = base({ updatedAt: 't7', entries: [] });
  await Coach.load();
  assert(Store.getEntries().some((e) => e.date === '2026-01-01'), 'לא חזר');
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
