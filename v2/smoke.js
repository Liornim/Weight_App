/**
 * בדיקות ממשק ללוח החדש.
 * מרימות את הדף ב-jsdom עם נתונים מלאכותיים, ומוודאות שכל מקטע
 * מוצג, שהמספרים תואמים את המנוע, ושאין שגיאות בקונסול.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const queue = [];
let passed = 0;
const failures = [];
let started = false;

function test(name, fn) {
  if (started) {
    console.error('בדיקה נרשמה אחרי תחילת הריצה: ' + name);
    process.exitCode = 1;
    return;
  }
  queue.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://x.local/v2/', pretendToBeVisual: true });
const window = dom.window;
const doc = window.document;
const errors = [];

window.scrollTo = () => {};
window.console.error = (...args) => errors.push(args.join(' '));
window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));

const scripts = [...html.matchAll(/<script src="([^"?]+)/g)].map((m) => m[1]);
assert(scripts.length > 0, 'לא נמצאו סקריפטים ב-index.html');

scripts.forEach((rel) => {
  const file = rel.indexOf('../') === 0
    ? path.join(ROOT, rel.replace('../', ''))
    : path.join(__dirname, rel);
  window.eval(fs.readFileSync(file, 'utf8'));
});

doc.dispatchEvent(new window.Event('DOMContentLoaded'));

const { App, Store, Metrics, Dates, Fmt } = window;

// נתונים מלאכותיים: ירידה אמיתית עם רעש שקילה
const noise = (i, amp) => Math.sin(i * 2.399963) * amp;
for (let i = 0; i < 40; i++) {
  const date = Dates.addDays(Dates.today(), -(39 - i));
  Store.upsert({
    date,
    weightKg: Number((90 - 0.05 * i + noise(i, 0.4)).toFixed(1)),
    bodyFatKg: Number((24 - 0.04 * i + noise(i * 0.7, 0.3)).toFixed(1)),
    muscleKg: Number((36 + noise(i * 1.3, 0.2)).toFixed(1)),
    waterKg: Number((48 + noise(i * 1.1, 0.4)).toFixed(1)),
    kcal: 2300 + Math.round(noise(i * 1.7, 450)),
    proteinG: 165,
    carbG: 200,
    fatG: 95,
    steps: 9000
  });
}
Store.updateSettings({
  profile: { heightCm: 180, birthDate: '1990-05-20', sex: 'male' },
  goal: { ratePerWeekKg: -0.5, targetWeightKg: 82 },
  targets: { proteinG: 170 }
});
App.setState({ date: Dates.today() });

// ---------------------------------------------------------------

test('כל המקטעים מוצגים בלי שגיאות', () => {
  errors.length = 0;
  App.setState({ date: Dates.today() });
  const text = doc.getElementById('view').textContent;
  ['ירדת עד עכשיו', 'כמה לאכול היום', 'מה קרה למשקל', 'שומן ושריר', 'מה אכלתי', 'הגדרות']
    .forEach((label) => assert(text.includes(label), 'חסר מקטע: ' + label));
  assert(errors.length === 0, 'שגיאות: ' + errors.join(' | '));
});

test('הכותרת מציגה את הירידה הכוללת ואת ההתקדמות ליעד', () => {
  const d = Metrics.dashboard(Store.getEntries(), Store.getSettings(), { endDate: Dates.today() });
  const head = doc.querySelector('.headline .v').textContent;
  assert(Math.abs(Number(head) - d.totalLoss) < 0.06,
    'הירידה המוצגת ' + head + ' מול ' + d.totalLoss.toFixed(1));

  const fill = doc.querySelector('.progress-fill');
  assert(fill, 'מד ההתקדמות חסר');
  const pct = Number(fill.style.width.replace('%', ''));
  assert(pct > 0 && pct <= 100, 'אחוז לא תקין: ' + pct);
});

test('הזנת נתונים לא מייצרת שגיאות בקונסול', () => {
  // רינדור חוזר בזמן שהנתונים נצברים — מיכלי גרפים חסרים בשלבים
  // מוקדמים, וזה בדיוק המקום שבו נשברו הציורים
  errors.length = 0;
  Store.upsert({ date: Dates.addDays(Dates.today(), -1), kcal: 2200 });
  Store.upsert({ date: Dates.today(), weightKg: 88 });
  assert(errors.length === 0, 'שגיאות בזמן הזנה: ' + errors.join(' | '));
});

test('חריגה מוצגת כמספר החריגה ולא כאפס', () => {
  const before = Metrics.windowReport(Store.getEntries(), Store.getSettings(),
    { windowDays: 'adaptive', endDate: Dates.today() });
  Store.upsert({ date: Dates.today(), kcal: Math.round(before.target + 600) });
  App.setState({ date: Dates.today() });

  // הרישום עצמו מזיז מעט את ההערכה, ולכן משווים מול המצב שאחריו
  const after = Metrics.windowReport(Store.getEntries(), Store.getSettings(),
    { windowDays: 'adaptive', endDate: Dates.today() });
  const eaten = Store.getEntry(Dates.today()).kcal;

  const big = doc.querySelector('#view .big');
  assert(big.classList.contains('big--bad'), 'החריגה אמורה להיות מסומנת');
  assert(big.textContent.includes('מעל היעד'), 'חסר הכיתוב: ' + big.textContent);
  const shown = Number(big.textContent.replace(/[^\d]/g, ''));
  assert(Math.abs(shown - Math.round(eaten - after.target)) <= 2,
    'מוצג ' + shown + ' מול ' + Math.round(eaten - after.target));

  Store.upsert({ date: Dates.today(), kcal: '' });
});

test('המספר של היום תואם את המנוע', () => {
  Store.upsert({ date: Dates.today(), kcal: '' });
  App.setState({ date: Dates.today() });

  const report = Metrics.windowReport(Store.getEntries(), Store.getSettings(),
    { windowDays: 'adaptive', endDate: Dates.today() });
  assert(report.ok, 'הדוח נכשל');

  const big = doc.querySelector('#view .big').textContent.replace(/[^\d]/g, '');
  assert(Math.abs(Number(big) - Math.round(report.target)) <= 1,
    'מוצג ' + big + ' מול ' + Math.round(report.target));
});

test('טבלת השבועות מדברת בשמות ולא במספרים טכניים', () => {
  App.setState({ date: Dates.today() });
  const section = [...doc.querySelectorAll('#view .section')]
    .find((s) => s.querySelector('h2').textContent === 'מה קרה למשקל');
  assert(section, 'המקטע חסר');

  const labels = [...section.querySelectorAll('tbody tr')]
    .map((tr) => tr.children[0].textContent);
  assert(labels[0].indexOf('השבוע') === 0, 'השורה הראשונה: ' + labels[0]);
  assert(labels.some((l) => l.indexOf('שבוע שעבר') === 0), 'חסרה שורת "שבוע שעבר"');

  // הערכים תואמים את המנוע
  const model = Metrics.weightBlocks(Store.getEntries(), { days: 7, endDate: Dates.today() });
  const recent = model.rows.slice(-4).reverse();
  const rows = [...section.querySelectorAll('tbody tr')];
  recent.forEach((row, i) => {
    const shown = Number(rows[i].children[1].textContent.trim());
    assert(Math.abs(shown - row.mean) < 0.06,
      i + ': מוצג ' + shown + ' מול ' + row.mean.toFixed(1));
  });
});

test('אין מונחים טכניים בשום מקום במסך', () => {
  App.setState({ date: Dates.today() });
  const text = doc.getElementById('view').textContent;
  ['חלון', 'תרחיש', 'זהיר', 'נדיב', 'מסתגל', 'קלמן', 'רגרסיה', 'סטיית תקן',
   'רווח סמך', 'מעריכי', 'TDEE', '±'].forEach((term) => {
    assert(!text.includes(term), 'מונח טכני על המסך: ' + term);
  });
});

test('כל כרטיס עם מספרים נפתח במשפט או בכותרת', () => {
  App.setState({ date: Dates.today() });
  [...doc.querySelectorAll('#view .card')].forEach((card) => {
    if (!card.querySelector('table.t')) return;
    const hasLead = card.querySelector('.lead') || card.querySelector('h3');
    assert(hasLead, 'טבלה בלי משפט פתיחה: ' + card.textContent.slice(0, 40));
  });
});

test('שינוי משקל היעד מזיז את מד ההתקדמות', () => {
  const before = Number(doc.querySelector('.progress-fill').style.width.replace('%', ''));
  const input = doc.querySelector('#goal-weight');
  input.value = '86';
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(Store.getSettings().goal.targetWeightKg === 86, 'היעד לא נשמר');
  const after = Number(doc.querySelector('.progress-fill').style.width.replace('%', ''));
  assert(after > before, 'ההתקדמות אמורה לגדול כשהיעד קרוב יותר');
  Store.updateSettings({ goal: { targetWeightKg: 82 } });
});

test('שינוי קצב הירידה מזיז את היעד היומי', () => {
  // נקרא מהיעד שבפס האכילה ולא מהמספר הגדול, כי זה נחתך באפס
  const value = () => {
    const hint = doc.querySelector('#view .hint').textContent;
    const match = hint.match(/היעד היומי שלך הוא ([\d,]+)/);
    assert(match, 'לא נמצא היעד: ' + hint);
    return Number(match[1].replace(/,/g, ''));
  };
  const slider = doc.querySelector('#rate');

  slider.value = '0.25';
  slider.dispatchEvent(new window.Event('change', { bubbles: true }));
  const gentle = value();

  slider.value = '1';
  slider.dispatchEvent(new window.Event('change', { bubbles: true }));
  const steep = value();

  assert(gentle - steep > 400, 'ההפרש קטן מדי: ' + gentle + ' מול ' + steep);
  Store.updateSettings({ goal: { ratePerWeekKg: -0.5 } });
});

test('שני הגרפים מצוירים', () => {
  App.setState({ date: Dates.today() });
  ['chart-weight', 'chart-kcal'].forEach((id) => {
    const host = doc.getElementById(id);
    assert(host, 'חסר מיכל ' + id);
    assert(host.querySelector('svg'), 'הגרף ' + id + ' לא צויר');
    assert(doc.getElementById(id + '-keys').textContent.trim().length > 0,
      'חסר מקרא ל-' + id);
  });
});

test('פיצול המאקרו מסתכם תמיד ל-100 אחוז', () => {
  App.setState({ date: Dates.today() });
  const total = () => [...doc.querySelectorAll('.split-seg')]
    .reduce((sum, el) => sum + Number(el.style.width.replace('%', '')), 0);

  assert(Math.abs(total() - 100) < 1.5, 'סכום המקטעים ' + total().toFixed(1) + '%');

  // גם כשהמאקרו מסביר יותר קלוריות משדווחו, הפס לא חורג
  Store.getEntries().slice(-5).forEach((e) => {
    Store.upsert({ date: e.date, kcal: 1200, proteinG: 200, carbG: 200, fatG: 100 });
  });
  App.setState({ date: Dates.today() });
  assert(Math.abs(total() - 100) < 1.5, 'הפס חרג: ' + total().toFixed(1) + '%');

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => c.textContent.includes('מאיפה מגיעות הקלוריות'));
  assert(card.textContent.includes('לא מסתדרים') || card.textContent.includes('בפער של'),
    'לא דווח על הפער');
});

test('אין נתון שמוצג פעמיים באותו מסך', () => {
  const headings = [...doc.querySelectorAll('#view h3')].map((h) => h.textContent.trim());
  const unique = new Set(headings);
  assert(unique.size === headings.length,
    'כותרת כרטיס מופיעה פעמיים: ' + headings.join(', '));
});

test('הלוח עומד גם בלי נתונים', () => {
  errors.length = 0;
  Store.clearAll();
  App.setState({ date: Dates.today() });
  const text = doc.getElementById('view').textContent;
  assert(text.includes('עוד אין נתונים'), 'חסרה הודעת מצב ריק');
  assert(doc.querySelector('#goal-weight'), 'ההגדרות אמורות להישאר זמינות');
  assert(errors.length === 0, 'שגיאות: ' + errors.join(' | '));
});

// ---------------------------------------------------------------

function runAll() {
  started = true;
  return queue.reduce(function (chain, item) {
    return chain.then(function () {
      return Promise.resolve()
        .then(item.fn)
        .then(function () { passed++; },
              function (err) { failures.push({ name: item.name, message: err.message }); });
    });
  }, Promise.resolve());
}

runAll().then(function () {
  console.log('');
  failures.forEach(function (f) {
    console.log('\u2717 ' + f.name);
    console.log('   ' + f.message);
  });
  console.log('\n' + passed + ' עברו, ' + failures.length + ' נכשלו\n');
  process.exit(failures.length ? 1 : 0);
});
