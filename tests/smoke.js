/**
 * בדיקת עשן: מרים את האפליקציה בדפדפן וירטואלי (jsdom), עובר על כל
 * המסכים במצב ריק ובמצב מלא, ומוודא שאין שגיאות ריצה ושהמספרים מגיעים למסך.
 * הרצה:  node tests/smoke.js     (דורש: npm install jsdom)
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const failures = [];
let passed = 0;

const queue = [];

let started = false;

/** רושם בדיקה. הריצה עצמה בטור בסוף הקובץ, כדי שבדיקות
 *  אסינכרוניות לא ידרסו זו את ה-DOM של זו. */
function test(name, fn) {
  if (started) {
    console.error('בדיקה נרשמה אחרי תחילת הריצה ולא תרוץ: ' + name);
    process.exitCode = 1;
    return;
  }
  queue.push({ name, fn });
}

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

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
  runScripts: 'outside-only',
  url: 'https://example.local/',
  pretendToBeVisual: true
});

const { window } = dom;
const errors = [];
window.addEventListener('error', (e) => errors.push(e.message));
window.console.error = (...args) => errors.push(args.join(' '));

// localStorage אמיתי קיים ב-jsdom, אז נבדקת גם שכבת האחסון
// רשימת הקבצים נקראת מ-index.html ולא מרשימה כפולה כאן.
// כך קובץ שנשכח מהדף ייתפס בבדיקות במקום להישבר רק בדפדפן.
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scriptFiles = [...indexHtml.matchAll(/<script src="([^"?]+)/g)].map((m) => m[1]);
if (!scriptFiles.length) throw new Error('לא נמצאו קבצי סקריפט ב-index.html');

scriptFiles.forEach((rel) => {
  window.eval(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
});

window.scrollTo = () => {}; // jsdom לא מממש גלילה
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

const { App, Store, Dates } = window;
const doc = window.document;
const text = (id) => doc.getElementById(id).textContent;

function noise(i, amplitude) { return Math.sin(i * 2.399963) * amplitude; }

// ---------- מצב ריק ----------

test('האפליקציה עולה ומציגה ארבעה טאבים', () => {
  assert(doc.querySelectorAll('#tabs button').length === 5, 'חמישה טאבים בסרגל');
  assert(doc.getElementById('view-today').classList.contains('is-active'), 'מסך היום פעיל');
});

['today', 'entry', 'calc', 'progress', 'target', 'status', 'trends', 'data'].forEach((view) => {
  test('מסך "' + view + '" נטען בלי נתונים', () => {
    App.setState({ view });
    const host = doc.getElementById('view-' + view);
    assert(host.innerHTML.length > 50, 'המסך ריק לגמרי');
    assert(errors.length === 0, 'שגיאות ריצה: ' + errors.join(' | '));
  });
});

test('מסכי הניתוח מסבירים מה חסר במקום להציג אפסים', () => {
  App.setState({ view: 'status' });
  const html = doc.getElementById('view-status').textContent;
  assert(html.includes('אין עדיין נתונים'), 'צריך מצב ריק מוסבר');
});

// ---------- הזנה דרך הטופס ----------

test('שמירה מהטופס מגיעה לאחסון', () => {
  App.setState({ view: 'entry', date: '2026-03-10' });
  const form = doc.getElementById('entry-form');
  form.elements.weightKg.value = '81.4';
  form.elements.kcal.value = '2150';
  form.elements.note.value = 'בדיקה';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  const entry = Store.getEntry('2026-03-10');
  assert(entry && entry.weightKg === 81.4, 'המשקל נשמר');
  assert(entry.kcal === 2150, 'הקלוריות נשמרו');
  assert(entry.note === 'בדיקה', 'ההערה נשמרה');
});

test('ניווט בין תאריכים משנה את הרשומה המוצגת', () => {
  App.setState({ view: 'entry', date: '2026-03-10' });
  doc.querySelector('[data-step="-1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.date === '2026-03-09', 'יום אחורה: ' + App.state.date);
  assert(doc.getElementById('entry-form').elements.weightKg.value === '', 'טופס ריק ליום ללא נתונים');
});

test('אי אפשר לנווט אל מעבר להיום', () => {
  App.setState({ view: 'entry', date: Dates.today() });
  assert(doc.querySelector('[data-step="1"]').hasAttribute('disabled'), 'כפתור "יום הבא" צריך להיות מנוטרל');
  App.setState({ date: Dates.addDays(Dates.today(), -1) });
  assert(!doc.querySelector('[data-step="1"]').hasAttribute('disabled'), 'ביום קודם הוא צריך לעבוד');
});

test('אזהרה מוצגת על ערך לא הגיוני', () => {
  App.setState({ view: 'entry', date: '2026-03-11' });
  const form = doc.getElementById('entry-form');
  form.elements.weightKg.value = '80';
  form.elements.bodyFatKg.value = '95';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert(doc.getElementById('entry-warnings').textContent.includes('גדול מהמשקל'), 'צריכה להופיע אזהרה');
  Store.remove('2026-03-11');
});

// ---------- מצב מלא ----------

test('טעינת 60 יום של נתוני בדיקה', () => {
  Store.clearAll();
  const end = Dates.today();
  const lossPerDay = 500 / 7700;
  for (let i = 0; i < 60; i++) {
    const date = Dates.addDays(end, -(59 - i));
    Store.upsert({
      date,
      weightKg: (88 - lossPerDay * i + noise(i, 0.35)).toFixed(1),
      bodyFatKg: (26 - lossPerDay * 0.8 * i + noise(i * 1.1, 0.25)).toFixed(1),
      muscleKg: (58 + noise(i * 0.7, 0.2)).toFixed(1),
      waterKg: (44 + noise(i * 1.3, 0.4)).toFixed(1),
      kcal: Math.round(2100 + noise(i * 1.7, 180)),
      proteinG: Math.round(170 + noise(i * 2.1, 25)),
      carbG: Math.round(190 + noise(i * 1.4, 40)),
      fatG: Math.round(65 + noise(i * 0.9, 12)),
      steps: Math.round(9000 + noise(i * 1.2, 2500))
    });
  }
  Store.updateSettings({
    targets: { kcal: 2100, proteinG: 170, carbG: 190, fatG: 65 },
    goal: { ratePerWeekKg: -0.45, targetWeightKg: 80 },
    profile: { heightCm: 178, birthDate: '1990-05-20', sex: 'male' }
  });
  assert(Store.getEntries().length === 60, 'שישים רשומות');
});

test('מסך המצב מציג מגמה, TDEE ופירוק', () => {
  errors.length = 0;
  App.setState({ view: 'status' });
  const body = doc.getElementById('view-status').textContent;
  assert(body.includes('המשקל יורד'), 'משפט המגמה חסר');
  assert(body.includes('שריפה יומית'), 'הערכת TDEE חסרה');
  assert(body.includes('מאיפה מגיע השינוי'), 'כרטיס ההרכב חסר');
  assert(body.includes('מול התקופה הקודמת'), 'כרטיס ההשוואה חסר');
  assert(errors.length === 0, 'שגיאות: ' + errors.join(' | '));
});

test('ה-TDEE שמוצג קרוב לערך האמיתי שבנינו', () => {
  const result = window.Metrics.estimateTDEEMulti(Store.getEntries(), { kcalPerKg: 7700 });
  assert(result.best.ok, 'הערכה נכשלה');
  assert(Math.abs(result.best.tdee - 2600) < 200, 'TDEE ' + Math.round(result.best.tdee) + ' רחוק מ-2600');
  const printed = Math.round(result.best.tdee).toLocaleString('en-US');
  assert(doc.getElementById('view-status').textContent.includes(printed),
    'הערך ' + printed + ' לא הודפס למסך');
});

test('החלפת חלון הניתוח מרעננת את המסך', () => {
  App.setState({ view: 'status' });
  const chip = doc.querySelector('[data-window="28"]');
  chip.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.window === 28, 'החלון התעדכן');
  assert(doc.querySelector('[data-window="28"]').getAttribute('aria-pressed') === 'true', 'הצ׳יפ מסומן');
});

test('מסך המגמות מצייר גרפים עם נתיבים', () => {
  errors.length = 0;
  App.setState({ view: 'trends' });
  const svgs = doc.querySelectorAll('#view-trends svg');
  assert(svgs.length >= 3, 'צריך לפחות שלושה גרפים, יש ' + svgs.length);
  const paths = doc.querySelectorAll('#view-trends svg path');
  assert(paths.length >= 3, 'הקווים לא צוירו');
  assert(doc.querySelectorAll('#view-trends svg rect').length > 10, 'עמודות הקלוריות לא צוירו');
  assert(errors.length === 0, 'שגיאות: ' + errors.join(' | '));
});

test('טווח התצוגה מסנן את הנתונים', () => {
  App.setState({ view: 'trends', range: 30 });
  const dots = doc.querySelectorAll('#chart-weight circle').length;
  App.setState({ range: 0 });
  const allDots = doc.querySelectorAll('#chart-weight circle').length;
  assert(allDots > dots, 'טווח מלא צריך להראות יותר נקודות (' + allDots + ' מול ' + dots + ')');
});

test('מסך הנתונים מציג את כל הרשומות ואת ההגדרות', () => {
  errors.length = 0;
  App.setState({ view: 'data' });
  const rows = doc.querySelectorAll('#view-data table.data tbody tr');
  assert(rows.length === 60, 'שישים שורות, יש ' + rows.length);
  assert(doc.querySelector('#t-kcal').value === '2100', 'יעד הקלוריות טעון');
  assert(doc.querySelector('#g-target').value === '80', 'משקל היעד טעון');
  assert(errors.length === 0, 'שגיאות: ' + errors.join(' | '));
});

test('שמירת הגדרות מהמסך מעדכנת את החנות', () => {
  App.setState({ view: 'data' });
  doc.querySelector('#t-kcal').value = '1950';
  doc.querySelector('#save-settings').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(Store.getSettings().targets.kcal === 1950, 'היעד התעדכן');
});

test('לחיצה על תאריך בטבלה פותחת אותו לעריכה', () => {
  App.setState({ view: 'data' });
  const link = doc.querySelector('#view-data [data-goto]');
  const target = link.dataset.goto;
  link.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  assert(App.state.view === 'today', 'עברנו למסך היום');
  assert(App.state.date === target, 'התאריך הנכון נפתח');
});

test('ייצוא CSV מכיל את כל השורות ואת ה-BOM', () => {
  const csv = Store.exportCSV();
  assert(csv.charCodeAt(0) === 0xFEFF, 'חסר BOM לאקסל');
  assert(csv.trim().split('\n').length === 61, 'כותרת + 60 שורות');
});

test('הנתונים שורדים רענון של הדף', () => {
  const before = Store.getEntries().length;
  window.eval(fs.readFileSync(path.join(ROOT, 'js/core/store.js'), 'utf8'));
  window.Store.init();
  assert(window.Store.getEntries().length === before, 'הנתונים נטענו מחדש מהאחסון');
});

test('אין שגיאות ריצה בכל המעבר', () => {
  assert(errors.length === 0, errors.join(' | '));
});


test('מסך היעד מחשב כמה לאכול היום', () => {
  errors.length = 0;
  Store.updateSettings({ autoTargetFromTdee: true, goal: { ratePerWeekKg: -0.45, targetWeightKg: 80 } });
  App.setState({ view: 'target' });
  const body = doc.getElementById('view-target').textContent;
  assert(body.includes('לאכול היום'), 'התשובה הראשית חסרה');
  assert(doc.querySelector('#view-target .hero-value'), 'המספר הגדול חסר');
  // ברירת המחדל היא תצוגה בלי צעדים
  ['הוצאה בלי צעדים', 'גירעון', 'ירידה משוערת', 'הפרש לסגור', 'חלבון'].forEach((label) => {
    assert(body.includes(label), 'חסרה שורה: ' + label);
  });
  assert(!body.includes('ירידה משוערת הכל'), 'שורות הצעדים לא אמורות להופיע בברירת המחדל');
  assert(errors.length === 0, 'שגיאות: ' + errors.join(' | '));
});

test('החלפת תקופת החישוב במסך היעד', () => {
  App.setState({ view: 'target' });
  const chip = doc.querySelector('[data-period="14"]');
  chip.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.period === 14, 'התקופה התעדכנה');
});

test('גרף מסלול ה-TDEE מצויר', () => {
  App.setState({ view: 'trends', range: 0 });
  const host = doc.getElementById('chart-tdee');
  assert(host, 'הגרף לא נוצר');
  assert(host.querySelectorAll('svg polygon').length >= 1, 'רצועת אי-הוודאות לא צוירה');
  assert(host.querySelectorAll('svg path').length >= 1, 'קו ה-TDEE לא צויר');
});


test('מסך היעד מציג שלוש שיטות, בסיס בלי צעדים ושלוש אפשרויות', () => {
  errors.length = 0;
  App.setState({ view: 'target' });
  const body = doc.getElementById('view-target').textContent;
  const tables = doc.querySelectorAll('#view-target table.data');
  assert(tables.length >= 3, 'ציפיתי לשלוש טבלאות לפחות, יש ' + tables.length);
  assert(errors.length === 0, 'שגיאות: ' + errors.join(' | '));
});

test('היעדים מוצגים עם הפער מהממוצע', () => {
  Store.updateSettings({ targets: { proteinG: 170, steps: 10000, kcal: null } });
  App.setState({ view: 'target' });
  const rows = [...doc.querySelectorAll('#view-target table.data tr')]
    .map((tr) => tr.textContent);
  assert(rows.some((r) => r.includes('חלבון') && r.includes('170')), 'יעד החלבון לא מוצג');
  assert(rows.some((r) => r.includes('צעדים') && r.includes('10,000')), 'יעד הצעדים לא מוצג');
});

test('שינוי העלות לצעד מזיז את הבסיס', () => {
  const before = window.Metrics.baselineWithoutSteps(Store.getEntries(), Store.getSettings());
  Store.updateSettings({ kcalPerStep: 0.040 });
  const after = window.Metrics.baselineWithoutSteps(Store.getEntries(), Store.getSettings());
  assert(after.base < before.base, 'קבוע גבוה יותר -> בסיס נמוך יותר');
  Store.updateSettings({ kcalPerStep: 0.030 });
});


test('מעבר לתצוגה כולל צעדים מוסיף את השורות', () => {
  App.setState({ view: 'target' });
  doc.querySelector('[data-mode="total"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.stepsMode === 'total', 'המצב התעדכן');
  const body = doc.getElementById('view-target').textContent;
  assert(body.includes('ירידה משוערת הכל'), 'חסרה שורת הצעדים');
  assert(body.includes('או להוסיף צעדים'), 'חסרה שורת הצעדים החלופיים');
  doc.querySelector('[data-mode="base"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.stepsMode === 'base', 'חזרה לברירת המחדל');
});

test('היעדים מוצגים עם הפער מהממוצע', () => {
  Store.updateSettings({ targets: { proteinG: 170, steps: 10000, kcal: null } });
  App.setState({ view: 'target' });
  const rows = [...doc.querySelectorAll('#view-target table.data tr')]
    .map((tr) => tr.textContent);
  assert(rows.some((r) => r.includes('חלבון') && r.includes('170')), 'יעד החלבון לא מוצג');
  assert(rows.some((r) => r.includes('צעדים') && r.includes('10,000')), 'יעד הצעדים לא מוצג');
});

test('שינוי העלות לצעד מזיז את הבסיס', () => {
  const before = window.Metrics.baselineWithoutSteps(Store.getEntries(), Store.getSettings());
  Store.updateSettings({ kcalPerStep: 0.040 });
  const after = window.Metrics.baselineWithoutSteps(Store.getEntries(), Store.getSettings());
  assert(after.base < before.base, 'קבוע גבוה יותר -> בסיס נמוך יותר');
  Store.updateSettings({ kcalPerStep: 0.030 });
});


test('מעבר לתצוגה כולל צעדים מוסיף את השורות', () => {
  App.setState({ view: 'target' });
  doc.querySelector('[data-mode="total"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.stepsMode === 'total', 'המצב התעדכן');
  const body = doc.getElementById('view-target').textContent;
  assert(body.includes('ירידה משוערת הכל'), 'חסרה שורת הצעדים');
  assert(body.includes('או להוסיף צעדים'), 'חסרה שורת הצעדים החלופיים');
  doc.querySelector('[data-mode="base"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.stepsMode === 'base', 'חזרה לברירת המחדל');
});

test('בחירת שיטה במסך החישוב משנה את המספרים בסיכום', () => {
  App.setState({ view: 'calc', date: '2026-08-21' });
  const before = Store.getSettings().tdeeMethod;
  const button = doc.querySelector('#view-calc [data-pick]');
  assert(button, 'אין כפתור לבחירת שיטה');
  const picked = button.dataset.pick;
  button.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(Store.getSettings().tdeeMethod === picked, 'הבחירה לא נשמרה');
  assert(picked !== before, 'נבחרה אותה שיטה');

  App.setState({ view: 'today', date: '2026-08-21' });
  const expected = Math.round(
    window.Metrics.tdeeMethods(Store.getEntries(), Store.getSettings(),
      { endDate: '2026-08-21' }).chosen.base
  ).toLocaleString('en-US');
  // מסך הסיכום מציג את היעד, שהוא הבסיס פחות הגירעון
  const report = window.Metrics.windowReport(Store.getEntries(), Store.getSettings(),
    { windowDays: App.state.calcWindow, endDate: '2026-08-21' });
  assert(report.ok, 'הדוח נכשל אחרי החלפת שיטה');
  const shown = Number(doc.querySelector('#view-today .hero-value').textContent.replace(/[^\d]/g, ''));
  assert(Math.abs(shown - Math.round(report.target)) <= 1,
    'היעד לא התעדכן לפי השיטה שנבחרה: מוצג ' + shown + ' מול ' + Math.round(report.target));
  Store.updateSettings({ tdeeMethod: 'kalman' });
});

test('בחירת השיטה זמינה בראש מסך היעד ומשנה את המספרים', () => {
  App.setState({ view: 'target' });
  Store.updateSettings({ tdeeMethod: 'kalman' });
  App.setState({ view: 'target' });
  const chips = doc.querySelectorAll('#view-target [data-method]');
  assert(chips.length >= 3, 'ציפיתי לצ׳יפ לכל שיטה, יש ' + chips.length);
  assert([...chips].some((c) => c.getAttribute('aria-pressed') === 'true'), 'אחד מהם צריך להיות מסומן');

  const other = [...chips].find((c) => c.dataset.method !== 'kalman');
  const before = doc.querySelector('#view-target .hero-value').textContent;
  other.dispatchEvent(new window.Event('click', { bubbles: true }));

  assert(Store.getSettings().tdeeMethod === other.dataset.method, 'הבחירה נשמרה');
  assert(doc.querySelector('#view-target [data-method][aria-pressed="true"]').dataset.method === other.dataset.method,
    'הסימון עבר לצ׳יפ החדש');
  assert(doc.querySelector('#view-target .hero-value').textContent !== before, 'המספר הראשי לא השתנה');
  Store.updateSettings({ tdeeMethod: 'kalman' });
});


test('משיכה מהגיליון ממזגת רשומות חדשות', () => {
  errors.length = 0;
  App.setState({ view: 'data' });
  const before = Store.getEntries().length;

  // רשת מדומה שמחזירה יום אחד חדש
  const original = window.Sheets.pull;
  window.Sheets.pull = () => Promise.resolve({
    entries: [{ date: '2030-01-01', weightKg: 80, kcal: 2000 }],
    nutrition: { action: 'getNutrition', count: 1, span: { from: '2030-01-01', to: '2030-01-01' } },
    body: { action: 'get', count: 1, span: { from: '2030-01-01', to: '2030-01-01' } }
  });

  doc.querySelector('#sync-url').value = 'https://example.test/exec';
  doc.querySelector('#sync-pull').dispatchEvent(new window.Event('click', { bubbles: true }));

  return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
    window.Sheets.pull = original;
    assert(Store.getEntries().length === before + 1, 'הרשומה החדשה לא נוספה');
    assert(Store.getEntry('2030-01-01').weightKg === 80, 'הערכים לא נשמרו');
    assert(Store.getSettings().sync.lastSyncAt, 'זמן המשיכה לא נרשם');
    const report = doc.querySelector('#sync-status');
    assert(report && report.textContent.includes('מדדי גוף'), 'דוח המשיכה לא הוצג');
    assert(report.textContent.includes('ימים חדשים'), 'לא דווח כמה ימים נוספו');
    Store.remove('2030-01-01');
  });
});

test('כשלון משיכה מוצג למשתמש', () => {
  App.setState({ view: 'data' });
  const original = window.Sheets.pull;
  window.Sheets.pull = () => Promise.reject(new Error('נפילה מדומה'));
  doc.querySelector('#sync-url').value = 'https://example.test/exec';
  doc.querySelector('#sync-pull').dispatchEvent(new window.Event('click', { bubbles: true }));

  return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
    window.Sheets.pull = original;
    const box = doc.querySelector('#sync-status');
    assert(box && box.textContent.includes('נפילה מדומה'), 'השגיאה לא הוצגה');
  });
});

// ---------- מסך הבית וההתקדמות ----------

test('משיכה שמביאה רק תזונה לא מוחקת שקילה קיימת', () => {
  Store.upsert({ date: '2029-05-05', weightKg: 85, bodyFatKg: 21, muscleKg: 34 });
  App.setState({ view: 'data' });

  const original = window.Sheets.pull;
  window.Sheets.pull = () => Promise.resolve({
    entries: [{ date: '2029-05-05', kcal: 2400, proteinG: 180 }],
    nutrition: { action: 'getNutrition', count: 1, span: { from: '2029-05-05', to: '2029-05-05' } },
    body: { action: null, count: 0, span: null }
  });

  doc.querySelector('#sync-url').value = 'https://example.test/exec';
  doc.querySelector('#sync-pull').dispatchEvent(new window.Event('click', { bubbles: true }));

  return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
    window.Sheets.pull = original;
    const entry = Store.getEntry('2029-05-05');
    assert(entry.weightKg === 85, 'המשקל נמחק! ' + JSON.stringify(entry));
    assert(entry.bodyFatKg === 21 && entry.muscleKg === 34, 'שדות גוף נמחקו');
    assert(entry.kcal === 2400, 'הקלוריות לא נוספו');
    Store.remove('2029-05-05');
  });
});

test('מסך הבית מציג מספר אחד גדול ובלי מונחים', () => {
  errors.length = 0;
  Store.updateSettings({ goal: { ratePerWeekKg: -0.5 } });
  App.setState({ view: 'today', date: '2026-08-21', calcWindow: 'adaptive' });
  const host = doc.getElementById('view-today');
  const hero = host.querySelector('.hero');
  assert(hero, 'אין תשובה ראשית');
  assert(hero.querySelector('.hero-label').textContent === 'לאכול היום', 'כותרת לא נכונה');
  const value = Number(hero.querySelector('.hero-value').textContent.replace(/[^\d]/g, ''));
  assert(value > 1200 && value < 4000, 'מספר לא סביר: ' + value);

  const text = host.textContent;
  ['רגרסיה', 'רווח סמך', 'קלמן', 'סטיית תקן', 'R²'].forEach((jargon) => {
    assert(!text.includes(jargon), 'מונח שלא אמור להופיע במסך הבית: ' + jargon);
  });
  assert(errors.length === 0, 'שגיאות: ' + errors.join(' | '));
});

test('היעד היומי הוא שמירת משקל פחות הגירעון, בלי צעדים', () => {
  App.setState({ view: 'today', date: '2026-08-21', calcWindow: 'adaptive' });
  const report = window.Metrics.windowReport(Store.getEntries(), Store.getSettings(),
    { windowDays: 'adaptive', endDate: '2026-08-21' });
  const expected = Math.round(report.base - report.deficitPerDay);
  const shown = Number(doc.querySelector('#view-today .hero-value').textContent.replace(/[^\d]/g, ''));
  assert(Math.abs(shown - expected) <= 1, 'ציפיתי ל-' + expected + ', מוצג ' + shown);
});

test('בחירת חלון החישוב משנה את היעד היומי', () => {
  errors.length = 0;
  App.setState({ view: 'calc', date: '2026-08-21', calcWindow: 'adaptive' });
  const adaptive = doc.querySelector('#view-calc .hero-value').textContent;

  const chip = doc.querySelector('#controls [data-calc="7"]');
  assert(chip, 'אין כפתור לחלון 7');
  chip.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.calcWindow === 7, 'החלון לא התעדכן');
  assert(doc.querySelector('#controls [data-calc="7"]').getAttribute('aria-pressed') === 'true',
    'הכפתור לא סומן');
  assert(doc.querySelector('#view-calc .hero-value').textContent !== adaptive,
    'המספר הראשי לא השתנה (' + adaptive + ')');

  App.setState({ calcWindow: 'adaptive' });
  assert(errors.length === 0, 'שגיאות: ' + errors.join(' | '));
});

test('כל אורכי החלון נטענים בלי שגיאה', () => {
  errors.length = 0;
  ['adaptive', 3, 5, 7, 10, 14, 21, 28].forEach((w) => {
    App.setState({ view: 'today', date: '2026-08-21', calcWindow: w });
    const host = doc.getElementById('view-today');
    assert(host.innerHTML.length > 500, 'חלון ' + w + ' החזיר מסך ריק');
    assert(!host.textContent.includes('NaN'), 'חלון ' + w + ' הציג NaN');
  });
  App.setState({ calcWindow: 'adaptive' });
  assert(errors.length === 0, 'שגיאות: ' + errors.join(' | '));
});

test('מצב הכפתורים תואם בדיוק את זמינות החלונות', () => {
  App.setState({ view: 'calc', date: '2026-08-21', calcWindow: 'adaptive' });
  const status = window.Metrics.availableWindows(Store.getEntries(), { endDate: '2026-08-21' });
  const byValue = {};
  doc.querySelectorAll('#controls [data-calc]').forEach((c) => { byValue[c.dataset.calc] = c; });

  status.forEach((w) => {
    const chip = byValue[String(w.days)];
    assert(chip, 'חסר כפתור לחלון ' + w.days);
    assert(chip.hasAttribute('disabled') === !w.available,
      'חלון ' + w.days + ': המודל אומר ' + (w.available ? 'זמין' : 'לא זמין') +
      ' אבל הכפתור ' + (chip.hasAttribute('disabled') ? 'מנוטרל' : 'פעיל'));
    if (!w.available) {
      assert(chip.getAttribute('title').includes('צריך'), 'חסר הסבר על חלון ' + w.days);
    }
  });
});

test('בחירת חלון לא זמין מסבירה במקום להציג מספר שגוי', () => {
  // חלון גדול מספיק כדי שלא יהיה לו כיסוי בשום מצב נתונים סביר
  const entries = Store.getEntries();
  const span = entries.length;
  const tooLong = Math.max(28, span);
  const report = window.Metrics.windowReport(entries, Store.getSettings(),
    { windowDays: tooLong, endDate: '2026-08-21' });
  assert(!report.ok && report.reason === 'window', 'המודל היה צריך לפסול את החלון');

  App.setState({ view: 'today', date: '2026-08-21', calcWindow: tooLong });
  const host = doc.getElementById('view-today');
  assert(host.querySelector('.hero-value').textContent.trim() === '—', 'לא אמור להופיע מספר');
  assert(host.textContent.includes('חסרים עוד'), 'חסר הסבר כמה ימים נדרשים');
  App.setState({ calcWindow: 'adaptive' });
});

test('מסך הבית מציג את הלוח בלי טופס ובלי כרטיסים שהוסרו', () => {
  App.setState({ view: 'today', date: '2026-08-21', calcWindow: 14 });
  const host = doc.getElementById('view-today');
  const text = host.textContent;

  ['התמונה הכללית', 'מה קרה בפועל', 'גירעון מול מציאות',
   'כמה אפשר לאכול ולהישאר בירוק'].forEach((label) => {
    assert(text.includes(label), 'חסר: ' + label);
  });

  ['מה קורה', 'לסגור את הפער'].forEach((removed) => {
    assert(!text.includes(removed), 'כרטיס שהוסר עדיין מופיע: ' + removed);
  });
  assert(!host.querySelector('#entry-form'), 'טופס הרישום עדיין במסך הבית');
});

test('טבלת מה קרה בפועל מציגה טווחי תאריכים לשלושה חלונות', () => {
  App.setState({ view: 'today', date: '2026-08-21' });
  const table = [...doc.querySelectorAll('#view-today table.data')]
    .find((t) => t.textContent.includes('שריר'));
  assert(table, 'הטבלה חסרה');

  const headers = [...table.querySelectorAll('th')].map((th) => th.textContent.trim());
  ['תקופה', 'משקל', 'שומן', 'שריר', 'מול'].forEach((h) => {
    assert(headers.indexOf(h) !== -1, 'חסרה עמודה: ' + h);
  });

  const rows = [...table.querySelectorAll('tbody tr')];
  assert(rows.length === 3, 'ציפיתי לשלושה חלונות, יש ' + rows.length);
  [7, 10, 14].forEach((n, i) => {
    assert(rows[i].children[0].textContent.indexOf(n + ' ימים') === 0,
      'שורה ' + i + ' אינה ' + n + ' ימים');
    // טווחי התאריכים בעמודה נפרדת, כדי שהמספרים יישארו מיושרים
    assert(/\d{2}\/\d{2}/.test(rows[i].children[4].textContent),
      n + ' ימים: חסר טווח תאריכים');
    assert(rows[i].children.length === 5, n + ' ימים: מספר תאים שגוי');
  });

  const summary = window.Metrics.bodyChangeSummary(Store.getEntries(),
    { endDate: '2026-08-21', windows: [7, 10, 14] });
  summary.rows.forEach((row, i) => {
    if (!row.covered) return;
    const shown = Number(rows[i].children[1].textContent.replace(/[^\d.\-−]/g, '').replace('−', '-'));
    assert(Math.abs(shown - row.fields.weightKg.change) < 0.02,
      row.days + ' ימים: המשקל לא תואם את המודל');
  });
});

test('מסך הרישום מכיל את הטופס', () => {
  App.setState({ view: 'entry', date: '2026-08-21' });
  const host = doc.getElementById('view-entry');
  assert(host.querySelector('#entry-form'), 'הטופס חסר');
  assert(host.querySelector('#f-weightKg'), 'שדה המשקל חסר');
  assert(host.querySelector('#f-kcal'), 'שדה הקלוריות חסר');
  assert(host.textContent.includes('שאכלת אתמול'), 'חסרה ההערה על ההיסט');
});

test('המחוון בפס הבקרה משנה את היעד בכל המסכים', () => {
  const heroValue = (view) => {
    const el = doc.querySelector('#view-' + view + ' .hero-value');
    assert(el, 'אין תשובה ראשית ב-' + view);
    return Number(el.textContent.replace(/[^\d]/g, ''));
  };

  const setRate = (kg) => {
    const slider = doc.querySelector('#rate-slider');
    assert(slider, 'המחוון חסר');
    slider.value = String(kg);
    slider.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert(Math.abs(Store.getSettings().goal.ratePerWeekKg + kg) < 1e-9,
      'הקצב ' + kg + ' לא נשמר');
  };

  App.setState({ view: 'today', date: '2026-08-21', calcWindow: 14 });
  setRate(0.25);
  const gentle = heroValue('today');

  setRate(1);
  const steep = heroValue('today');
  assert(gentle - steep > 500,
    'ההפרש בין 0.25 ל-1 ק"ג צריך להיות גדול (' + gentle + ' מול ' + steep + ')');

  setRate(0);
  const report = window.Metrics.windowReport(Store.getEntries(), Store.getSettings(),
    { windowDays: 14, endDate: '2026-08-21' });
  assert(Math.abs(heroValue('today') - Math.round(report.base)) <= 1,
    'שמירה צריכה להיות בדיוק הבסיס');

  Store.updateSettings({ goal: { ratePerWeekKg: -0.5 } });
});

test('המחוון מוגבל לטווח 0 עד 1.5 ק"ג', () => {
  App.setState({ view: 'today' });
  const slider = doc.querySelector('#rate-slider');
  assert(slider.getAttribute('min') === '0', 'מינימום שגוי');
  assert(slider.getAttribute('max') === '1.5', 'מקסימום שגוי');
  assert(slider.getAttribute('step') === '0.05', 'צעד שגוי');
});

test('גירעון קלורי לשבוע וליום מסונכרנים עם הקצב', () => {
  App.setState({ view: 'today' });
  const kcalPerKg = Store.getSettings().kcalPerKg;

  const weekly = doc.querySelector('#rate-week');
  weekly.value = '3850';
  weekly.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(Math.abs(Store.getSettings().goal.ratePerWeekKg + 3850 / kcalPerKg) < 1e-9,
    'גירעון שבועי לא הומר לקצב');

  const daily = doc.querySelector('#rate-day');
  daily.value = '500';
  daily.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(Math.abs(Store.getSettings().goal.ratePerWeekKg + (500 * 7) / kcalPerKg) < 1e-9,
    'גירעון יומי לא הומר לקצב');

  Store.updateSettings({ goal: { ratePerWeekKg: -0.5 } });
});

test('הצעדים מוצגים כבונוס ולא נכנסים ליעד', () => {
  Store.upsert({ date: '2026-08-21', steps: 10000 });
  App.setState({ view: 'today', date: '2026-08-21', calcWindow: 'adaptive' });
  const withSteps = Number(doc.querySelector('#view-today .hero-value').textContent.replace(/[^\d]/g, ''));
  assert(doc.getElementById('view-today').textContent.includes('בונוס מהליכה'), 'חסר כרטיס הבונוס');

  Store.upsert({ date: '2026-08-21', steps: '' });
  App.setState({ view: 'today' });
  const withoutSteps = Number(doc.querySelector('#view-today .hero-value').textContent.replace(/[^\d]/g, ''));
  assert(withSteps === withoutSteps, 'הצעדים השפיעו על היעד (' + withSteps + ' מול ' + withoutSteps + ')');
});

test('מסך ההתקדמות מציג שינויים לפי תקופות', () => {
  errors.length = 0;
  App.setState({ view: 'progress', date: '2026-08-21' });
  const text = doc.getElementById('view-progress').textContent;
  ['השבוע האחרון', 'התוכנית', 'כמה ירדת'].forEach((label) => {
    assert(text.includes(label), 'חסר: ' + label);
  });
  ['3 ימים', '5 ימים', '7 ימים', '14 ימים'].forEach((label) => {
    assert(text.includes(label), 'חסרה תקופה: ' + label);
  });
  assert(text.includes('טווח קצר'), 'חסרה האזהרה על טווח קצר');
  assert(!text.includes('NaN'), 'הוצג NaN');
  assert(errors.length === 0, 'שגיאות: ' + errors.join(' | '));
});

test('בחירת קצב היעד בכפתור במסך הנתונים', () => {
  App.setState({ view: 'data' });
  const chip = doc.querySelector('#view-data [data-rate="-0.25"]');
  assert(chip, 'אין כפתור לקצב 0.25');
  chip.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(Store.getSettings().goal.ratePerWeekKg === -0.25, 'היעד לא התעדכן');
  Store.updateSettings({ goal: { ratePerWeekKg: -0.5 } });
});


// ---------- דוח ----------
// הריצה מופעלת בסוף הקובץ בלבד. אם היא תופעל באמצע, בדיקות שנרשמו
// אחריה לא ייכנסו לתור וייעלמו בשקט — קרה בפועל.
test('גרפים: שומן ושריר בנפרד, כל אחד בסקאלה משלו', () => {
  errors.length = 0;
  App.setState({ view: 'trends', range: 0 });
  const fat = doc.getElementById('chart-fat');
  const muscle = doc.getElementById('chart-muscle');
  assert(fat && fat.querySelector('svg'), 'גרף השומן חסר');
  assert(muscle && muscle.querySelector('svg'), 'גרף השריר חסר');
  assert(!doc.getElementById('chart-comp'), 'הגרף המשולב היה צריך להיעלם');

  // סקאלה נפרדת: תוויות ציר ה-Y של השניים לא זהות
  const labels = (host) => [...host.querySelectorAll('.axis-label')].map((t) => t.textContent).join(',');
  assert(labels(fat) !== labels(muscle), 'שני הגרפים חולקים סקאלה');
  assert(!doc.getElementById('view-trends').textContent.includes('מסה רזה'), 'המונח "מסה רזה" עדיין מופיע');
  assert(errors.length === 0, 'שגיאות: ' + errors.join(' | '));
});

test('גרף ההוצאה מציג גם את הצריכה בפועל ומציין את השיטה', () => {
  App.setState({ view: 'trends', range: 0 });
  const host = doc.getElementById('chart-tdee');
  assert(host, 'גרף ההוצאה חסר');
  assert(host.querySelectorAll('svg polygon').length >= 1, 'רצועת אי־הוודאות חסרה');
  assert(host.querySelectorAll('svg path').length >= 2, 'חסר קו הצריכה לצד קו ההוצאה');
  const legendText = doc.getElementById('chart-tdee-legend').textContent;
  const tdeeCard = host.closest('.card');
  assert(tdeeCard.querySelector('.card-note').textContent.includes('קלמן'), 'לא צוין איזו שיטה מוצגת');
  assert(legendText.includes('אוכל'), 'לא מצוינת הצריכה בפועל');

  // הרצועה נחתכת לסקאלה ולא מוחצת את הקווים
  const rect = host.querySelector('svg').getAttribute('viewBox').split(' ');
  const height = Number(rect[3]);
  [...host.querySelectorAll('polygon')].forEach((p) => {
    p.getAttribute('points').split(' ').forEach((pair) => {
      const y = Number(pair.split(',')[1]);
      assert(y >= -1 && y <= height + 1, 'נקודת רצועה מחוץ לגרף: ' + y);
    });
  });
});

test('גרף הקלוריות משתמש ביעד של השיטה שנבחרה', () => {
  App.setState({ view: 'today', calcWindow: 'adaptive' });
  App.setState({ view: 'trends', range: 0 });
  const legendText = doc.getElementById('chart-kcal-legend').textContent;
  assert(legendText.includes('יעד לפי'), 'לא מצוין לאיזה יעד הכוונה: ' + legendText);

  const report = window.Metrics.windowReport(Store.getEntries(), Store.getSettings(),
    { windowDays: 'adaptive', endDate: window.Dates.today() });
  assert(report.ok, 'הדוח נכשל');

  // עמודות אדומות מופיעות בדיוק כשיש חריגה של יותר מ-10% מהיעד
  const overDays = window.Metrics.series(Store.getEntries(), 'kcal')
    .filter((p) => p.y > report.target * 1.1).length;
  const redBars = [...doc.querySelectorAll('#chart-kcal rect')]
    .filter((r) => r.getAttribute('fill') === '#A32F4B').length;
  assert(redBars === overDays, 'ציפיתי ל-' + overDays + ' עמודות אדומות, יש ' + redBars);
});

test('גרף החלבון מסמן את המינימום', () => {
  Store.updateSettings({ targets: { proteinMinG: 160 } });
  App.setState({ view: 'trends', range: 0 });
  const legendText = doc.getElementById('chart-protein-legend').textContent;
  assert(legendText.includes('מינימום 160'), 'קו המינימום לא מסומן: ' + legendText);
});

test('גרף ההוצאה מציין שיטה, מסביר, ומראה את ההפרש', () => {
  App.setState({ view: 'trends', range: 0 });
  const card = [...doc.querySelectorAll('#view-trends .card')]
    .find((c) => c.textContent.includes('כמה שורף מול כמה אוכל'));
  assert(card, 'הכרטיס חסר');

  assert(card.querySelector('.card-note').textContent.includes('קלמן'), 'לא מצוינת השיטה');
  assert(card.querySelector('.card-note').textContent.includes('כולל הליכה'), 'לא מצוין אם הצעדים נכללים');
  assert(card.querySelector('.finding').textContent.includes('הרווח ביניהם הוא הגירעון'),
    'חסר משפט ההסבר מעל הגרף');

  const legendText = doc.getElementById('chart-tdee-legend').textContent;
  assert(legendText.includes('הפער כרגע'), 'ההפרש לא מוצג במקרא');
  assert(legendText.includes('ק״ג'), 'ההפרש לא מתורגם לקילוגרמים');
});

test('מונחים סטטיסטיים לא מופיעים בשמות שהמשתמש רואה', () => {
  App.setState({ view: 'trends', range: 0 });
  const text = doc.getElementById('view-trends').textContent;
  ['מעריכי', 'EWMA', "Hacker"].forEach((jargon) => {
    assert(!text.includes(jargon), 'מונח שלא אמור להופיע: ' + jargon);
  });
  assert(doc.getElementById('chart-weight-legend').textContent.includes('מגמה מהירה'),
    'הקו לא קיבל שם מובן');
});


test('גרף ההוצאה: מעבר בין יומי למצטבר', () => {
  errors.length = 0;
  App.setState({ view: 'trends', range: 0, tdeeMode: 'daily' });
  const dailyLegend = doc.getElementById('chart-tdee-legend').textContent;
  assert(dailyLegend.includes('ממוצע 7 ימים'), 'לא צוין שהממוצע הוא לשבעה ימים');
  assert(dailyLegend.includes('קלוריות ליום'), 'הפער היומי לא מוצג');

  doc.querySelector('[data-tdee-mode="cumulative"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));
  assert(App.state.tdeeMode === 'cumulative', 'המצב לא התעדכן');

  const cumLegend = doc.getElementById('chart-tdee-legend').textContent;
  assert(cumLegend.includes('מצטבר'), 'המקרא לא עודכן למצטבר');
  assert(cumLegend.includes('קלוריות מצטברות'), 'הפער המצטבר לא מוצג');
  assert(doc.querySelectorAll('#chart-tdee polygon').length >= 1, 'השטח בין הקווים חסר');
  assert(errors.length === 0, 'שגיאות: ' + errors.join(' | '));
});

test('גבולות ההערכה מסומנים בקווים, והפער מוצג לשלושתם', () => {
  ['daily', 'cumulative'].forEach((mode) => {
    App.setState({ view: 'trends', range: 0, tdeeMode: mode });
    const legendText = doc.getElementById('chart-tdee-legend').textContent;
    assert(legendText.includes('גבול עליון'), mode + ': חסר קו הגבול העליון');
    assert(legendText.includes('גבול תחתון'), mode + ': חסר קו הגבול התחתון');
    assert(legendText.includes('אם אתה שורף יותר'), mode + ': חסר הפער מול הגבול העליון');
    assert(legendText.includes('אם פחות'), mode + ': חסר הפער מול הגבול התחתון');

    const colors = [...doc.querySelectorAll('#chart-tdee path')]
      .map((p) => p.getAttribute('stroke'));
    assert(colors.indexOf('#A32F4B') !== -1, mode + ': הגבול התחתון לא אדום');
    assert(colors.indexOf('#2E6B4F') !== -1, mode + ': הגבול העליון לא ירוק');
  });
  App.setState({ tdeeMode: 'daily' });
});

test('המצטבר מסתכם לגירעון הנכון', () => {
  App.setState({ view: 'trends', range: 0, tdeeMode: 'cumulative' });
  const text = doc.getElementById('chart-tdee-legend').textContent;
  const match = text.match(/הפער כרגע: ([\d,]+)/);
  assert(match, 'לא נמצא הפער המצטבר');
  const gap = Number(match[1].replace(/,/g, ''));

  // הגירעון המצטבר חייב להיות עקבי עם הירידה שנמדדה בפועל
  const entries = Store.getEntries();
  const first = entries.find((e) => e.weightKg);
  const last = [...entries].reverse().find((e) => e.weightKg);
  const measuredKg = first.weightKg - last.weightKg;
  const impliedKg = gap / 7700;
  assert(Math.abs(impliedKg - measuredKg) < 3,
    'הגירעון המצטבר (' + impliedKg.toFixed(1) + ' ק"ג) רחוק מהירידה שנמדדה (' + measuredKg.toFixed(1) + ')');
  App.setState({ tdeeMode: 'daily' });
});

test('ההסבר על שיטת החישוב זמין ובלי מונחים', () => {
  App.setState({ view: 'trends', range: 0 });
  const fold = [...doc.querySelectorAll('#view-trends details.fold')]
    .find((d) => d.querySelector('summary').textContent.includes('איך מחושב'));
  assert(fold, 'ההסבר חסר');
  const text = fold.textContent;
  ['מנבא', 'משווה', 'מתקן', '7700'].forEach((label) => {
    assert(text.includes(label), 'חסר בהסבר: ' + label);
  });
  assert(text.includes('בלי הליכה'), 'לא מוסבר ההבדל מהמספר במסך הבית');
});



test('טבלת ההפרשים מציגה שלושה תרחישים לכל יום', () => {
  errors.length = 0;
  App.setState({ view: 'trends', range: 0, tdeeMode: 'daily' });
  const host = doc.getElementById('view-trends');
  const table = [...host.querySelectorAll('table.data')]
    .find((t) => t.textContent.includes('גבול תחתון') && t.textContent.includes('גבול עליון'));
  assert(table, 'טבלת ההפרשים חסרה');

  const headers = [...table.querySelectorAll('th')].map((th) => th.textContent.trim());
  ['יום', 'אכלת', 'שורף', 'גבול תחתון', 'הערכה', 'גבול עליון'].forEach((h) => {
    assert(headers.indexOf(h) !== -1, 'חסרה עמודה: ' + h);
  });

  const rows = table.querySelectorAll('tbody tr:not(.summary)');
  assert(rows.length >= 5, 'ציפיתי לכמה ימים, יש ' + rows.length);

  // כל שורה: שלושת ההפרשים עקביים עם "אכלת" ו"שורף"
  [...rows].forEach((tr) => {
    const cells = [...tr.children].map((td) => Number(td.textContent.replace(/[^\d.\-−]/g, '').replace('−', '-')));
    const eaten = cells[1], burn = cells[2], low = cells[3], mid = cells[4], high = cells[5];
    assert(Math.abs(mid - (burn - eaten)) <= 1,
      'ההערכה האמצעית לא שווה שורף פחות אכלת: ' + mid + ' מול ' + (burn - eaten));
    assert(low < mid && mid < high, 'התרחישים לא מסודרים: ' + low + ' ' + mid + ' ' + high);
  });
  assert(errors.length === 0, 'שגיאות: ' + errors.join(' | '));
});

test('ההסבר כולל את החשבון היומי: ניבוי, מדידה ותיקון', () => {
  App.setState({ view: 'trends', range: 0 });
  const fold = [...doc.querySelectorAll('#view-trends details.fold')]
    .find((d) => d.querySelector('summary').textContent.includes('איך מחושב'));
  assert(fold, 'ההסבר חסר');
  const table = fold.querySelector('table.data');
  assert(table, 'חסרה טבלת החשבון');
  const headers = [...table.querySelectorAll('th')].map((th) => th.textContent.trim());
  ['יום', 'ניבוי', 'נמדד', 'הפרש', 'שורף אחרי התיקון'].forEach((h) => {
    assert(headers.indexOf(h) !== -1, 'חסרה עמודה: ' + h);
  });
  assert(table.querySelectorAll('tbody tr').length >= 5, 'מעט מדי ימים בטבלה');
});

test('בגרף נשאר קו מקווקו אחד לכל היותר', () => {
  ['daily', 'cumulative'].forEach((mode) => {
    App.setState({ view: 'trends', range: 0, tdeeMode: mode });
    const dashed = [...doc.querySelectorAll('#chart-tdee path')]
      .filter((p) => {
        const d = p.getAttribute('stroke-dasharray');
        return d && d !== 'none';
      });
    assert(dashed.length <= 1, mode + ': יש ' + dashed.length + ' קווים מקווקוים, מבלבל');
  });
  App.setState({ tdeeMode: 'daily' });
});



test('שורת הסה"כ מסכמת בדיוק את הימים שמעליה', () => {
  App.setState({ view: 'trends', range: 0 });
  const table = [...doc.querySelectorAll('#view-trends table.data')]
    .find((t) => t.textContent.includes('גבול תחתון'));
  const num = (td) => Number(td.textContent.replace(/[^\d.\-−]/g, '').replace('−', '-'));

  const dayRows = [...table.querySelectorAll('tbody tr:not(.summary)')];
  const totalRow = table.querySelector('tbody tr.summary');
  assert(totalRow, 'חסרה שורת סה״כ');
  assert(totalRow.textContent.includes('סה״כ'), 'שורת הסה״כ לא מסומנת');

  [1, 2, 3, 4, 5].forEach((col) => {
    const expected = dayRows.reduce((sum, tr) => sum + num(tr.children[col]), 0);
    const shown = num(totalRow.children[col]);
    assert(Math.abs(shown - expected) <= dayRows.length,
      'עמודה ' + col + ': סה״כ ' + shown + ' מול סכום השורות ' + Math.round(expected));
  });

  const kgRow = [...table.querySelectorAll('tbody tr.summary')][1];
  assert(kgRow && kgRow.textContent.includes('בקילוגרמים'), 'חסרה שורת הקילוגרמים');
});

test('טבלת הקצבה אומרת כמה אפשר לאכול ולהישאר בירוק', () => {
  App.setState({ view: 'trends', range: 0 });
  const table = [...doc.querySelectorAll('#view-trends table.data')]
    .find((t) => t.textContent.includes('זהיר') && t.textContent.includes('נדיב'));
  assert(table, 'טבלת הקצבה חסרה');

  const headers = [...table.querySelectorAll('th')].map((th) => th.textContent.trim());
  ['טווח', 'זהיר', 'הערכה', 'נדיב'].forEach((h) => {
    assert(headers.indexOf(h) !== -1, 'חסרה עמודה: ' + h);
  });

  const rows = [...table.querySelectorAll('tbody tr')];
  const labels = rows.map((tr) => tr.children[0].textContent.trim());
  ['מחר', 'יומיים', 'שלושה ימים', 'חמישה ימים', 'שבוע'].forEach((l) => {
    assert(labels.indexOf(l) !== -1, 'חסר טווח: ' + l);
  });

  const num = (td) => Number(td.textContent.replace(/[^\d.\-−]/g, '').replace('−', '-'));
  rows.forEach((tr) => {
    const low = num(tr.children[1]), mid = num(tr.children[2]), high = num(tr.children[3]);
    assert(low <= mid && mid <= high,
      tr.children[0].textContent + ': התרחישים לא מסודרים ' + low + ' ' + mid + ' ' + high);
    assert(low >= 0, 'הקצבה שלילית: ' + low);
  });

  // ככל שפורסים על יותר ימים, הקצבה היומית מתקרבת להוצאה עצמה
  const tomorrow = num(rows[0].children[1]);
  const week = num(rows[rows.length - 1].children[1]);
  assert(tomorrow !== week, 'הקצבה לא משתנה עם אורך הפריסה');
});



test('כשההוצאה יציבה, המסך אומר זאת במקום להיראות שבור', () => {
  App.setState({ view: 'trends', range: 0, tdeeMode: 'daily' });
  const report = window.Metrics.adaptiveTDEE(Store.getEntries(), Store.getSettings());
  const values = report.states.slice(7).map((s) => s.smoothTdee);
  const range = Math.max(...values) - Math.min(...values);

  const text = doc.getElementById('chart-tdee-legend').textContent;
  if (range < 120) {
    assert(text.includes('יציבה'), 'לא הוסבר למה הקו ישר');
    assert(text.includes('ממה שאתה אוכל'), 'לא נאמר מאיפה מגיע השינוי');
  } else {
    assert(text.includes('נעה בטווח'), 'לא צוין טווח התנועה');
  }
});



test('לוח המחוונים מציג את מספרי הפתיחה', () => {
  errors.length = 0;
  App.setState({ view: 'today', date: '2026-08-21', calcWindow: 'adaptive' });
  const host = doc.getElementById('view-today');
  ['ימים במעקב', 'ירדת בסך הכל', 'שקילה אחרונה', 'צעדים בשבוע',
   'משקל מגמה', 'מהשיא לשפל', 'שקילות'].forEach((label) => {
    assert(host.textContent.includes(label), 'חסר: ' + label);
  });

  const d = window.Metrics.dashboard(Store.getEntries(), Store.getSettings(), { endDate: '2026-08-21' });
  assert(host.textContent.includes(String(d.spanDays)), 'מספר הימים לא מוצג');
  assert(errors.length === 0, 'שגיאות: ' + errors.join(' | '));
});

test('טבלת הגירעון מול המציאות, לשלושה חלונות', () => {
  App.setState({ view: 'today', date: '2026-08-21' });
  const table = [...doc.querySelectorAll('#view-today table.data')]
    .find((t) => t.textContent.includes('בפועל'));
  assert(table, 'הטבלה חסרה');

  const headers = [...table.querySelectorAll('th')].map((th) => th.textContent.trim());
  ['תקופה', 'זהיר', 'הערכה', 'נדיב', 'בפועל'].forEach((h) => {
    assert(headers.indexOf(h) !== -1, 'חסרה עמודה: ' + h);
  });

  const labels = [...table.querySelectorAll('tbody tr')].map((tr) => tr.children[0].textContent);
  [7, 10, 14].forEach((n) => {
    assert(labels.some((l) => l.indexOf(n + ' ימים') === 0), 'חסר חלון של ' + n + ' ימים');
  });

  // הערכים תואמים את המודל
  const summary = window.Metrics.deficitSummary(Store.getEntries(), Store.getSettings(),
    { endDate: '2026-08-21', windows: [7, 10, 14] });
  const num = (td) => Number(td.textContent.replace(/[^\d.\-−]/g, '').replace('−', '-'));
  [...table.querySelectorAll('tbody tr')].forEach((tr, i) => {
    if (tr.children.length < 5) return;
    assert(Math.abs(num(tr.children[2]) - summary.rows[i].kg.mid) < 0.02,
      'שורה ' + i + ': ההערכה לא תואמת את המודל');
  });
});

test('טבלת הקצבה נמצאת בדף הבית', () => {
  App.setState({ view: 'today', date: '2026-08-21' });
  const host = doc.getElementById('view-today');
  assert(host.textContent.includes('כמה אפשר לאכול ולהישאר בירוק'), 'הכרטיס חסר');
  const table = [...host.querySelectorAll('table.data')]
    .find((t) => t.textContent.includes('מחר') && t.textContent.includes('שבוע'));
  assert(table, 'טבלת הקצבה חסרה');
  assert(table.querySelectorAll('tbody tr').length === 5, 'ציפיתי לחמישה טווחים');
});



test('אריחי לוח המחוונים צבועים ונבדלים זה מזה', () => {
  App.setState({ view: 'today', date: '2026-08-21' });
  const tiles = doc.querySelectorAll('#view-today .stat');
  assert(tiles.length === 4, 'ציפיתי לארבעה אריחים, יש ' + tiles.length);

  const tones = [...tiles].map((t) => [...t.classList].find((c) => c.indexOf('stat--') === 0));
  assert(new Set(tones).size === 4, 'האריחים לא נבדלים בצבע: ' + tones.join(','));
  tones.forEach((t) => assert(t, 'אריח בלי גוון'));

  [...tiles].forEach((t) => {
    assert(t.querySelector('.k') && t.querySelector('.v'), 'אריח בלי תווית או ערך');
  });
});



test('עמודת "בפועל" היא הפרש ממוצעי המשקל', () => {
  App.setState({ view: 'today', date: '2026-08-21' });
  const summary = window.Metrics.deficitSummary(Store.getEntries(), Store.getSettings(),
    { endDate: '2026-08-21', windows: [7, 10, 14] });

  const table = [...doc.querySelectorAll('#view-today table.data')]
    .find((t) => t.textContent.includes('בפועל'));
  const rows = [...table.querySelectorAll('tbody tr')];

  summary.rows.forEach((row, i) => {
    const cellText = rows[i].children[4].textContent.trim();
    if (row.actualKg === null) {
      assert(cellText.includes('חסרים'), row.days + ': היה צריך לומר שחסרים ימים');
    } else {
      const shown = Number(cellText.replace(/[^\d.\-−]/g, '').replace('−', '-'));
      const expected = row.currentMean - row.previousMean;
      assert(Math.abs(shown - expected) < 0.02,
        row.days + ' ימים: מוצג ' + shown + ' אבל הפרש הממוצעים הוא ' + expected.toFixed(2));
    }
  });
});



test('כל מסך שרשום בסרגל הטאבים באמת נטען', () => {
  const registered = Object.keys(window.Views);
  ['today', 'entry', 'calc', 'progress', 'trends', 'data', 'status', 'target'].forEach((id) => {
    assert(registered.indexOf(id) !== -1, 'המסך ' + id + ' לא נרשם — כנראה חסר בקובץ index.html');
  });

  // כל כפתור בסרגל מצביע על מסך קיים
  doc.querySelectorAll('#tabs button').forEach((b) => {
    const id = b.dataset.view;
    assert(window.Views[id], 'הטאב ' + id + ' מצביע על מסך שלא קיים');
    assert(doc.getElementById('view-' + id), 'חסר מיכל למסך ' + id);
  });
});



test('כל שורה בטבלאות מכילה בדיוק תא לכל כותרת', () => {
  App.setState({ view: 'today', date: '2026-08-21' });
  doc.querySelectorAll('#view-today table.data').forEach((table) => {
    const columns = table.querySelectorAll('thead th').length;
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const cells = [...tr.children].reduce(function (sum, td) {
        return sum + (Number(td.getAttribute('colspan')) || 1);
      }, 0);
      assert(cells === columns,
        'שורה עם ' + cells + ' תאים מול ' + columns + ' כותרות: ' + tr.textContent.slice(0, 40));
    });
  });
});

test('התגית העגולה מוגבלת ל-span ולא חלה על תאי טבלה', () => {
  // jsdom לא טוען את קובץ ה-CSS, ולכן נבדק המקור עצמו
  const css = fs.readFileSync(path.join(ROOT, 'assets/app.css'), 'utf8');
  const pill = css.match(/span\.delta-up[^{]*\{[\s\S]*?\}/);
  assert(pill, 'כלל התגית חייב להיות מוגבל ל-span');
  assert(pill[0].includes('inline-block'), 'התגית אמורה להיות inline-block');
  assert(!/^\.delta-(up|down)[^{]*\{[^}]*inline-block/m.test(css),
    'יש כלל inline-block שחל על כל אלמנט, כולל תאי טבלה');
});

test('שום תא בטבלה לא נושא מחלקת צבע ישירות', () => {
  // תא עם המחלקה הופך ל-inline-block והטבלה מתפרקת. קרה בפועל.
  ['today', 'calc', 'trends', 'progress', 'status'].forEach((view) => {
    App.setState({ view: view, date: '2026-08-21' });
    doc.querySelectorAll('#view-' + view + ' table.data td').forEach((td) => {
      ['delta-up', 'delta-down', 'delta-flat'].forEach((cls) => {
        assert(!td.classList.contains(cls),
          view + ': תא נושא ' + cls + ' — הצבע צריך להיות על span בתוכו');
      });
    });
  });
  App.setState({ view: 'today' });
});

test('הגרפים חוסמים גלילה ותפריט הקשר במגע', () => {
  const css = fs.readFileSync(path.join(ROOT, 'assets/app.css'), 'utf8');
  const rule = css.match(/\.chart svg \{[\s\S]*?\}/);
  assert(rule, 'חסר כלל לגרף');
  assert(rule[0].includes('touch-action: none'), 'חסר touch-action');
  assert(rule[0].includes('user-select: none'), 'חסר חסימת בחירת טקסט');

  const chartJs = fs.readFileSync(path.join(ROOT, 'js/ui/chart.js'), 'utf8');
  assert(chartJs.includes('preventDefault'), 'המאזין לא מונע את התנהגות ברירת המחדל');
  assert(chartJs.includes('touchmove'), 'אין טיפול בגרירה במגע');
});



test('טבלת הגירעון עוברת בין קילוגרמים לקלוריות', () => {
  App.setState({ view: 'today', date: '2026-08-21', deficitUnit: 'kg' });
  const table = () => [...doc.querySelectorAll('#view-today table.data')]
    .find((t) => t.textContent.includes('בפועל'));
  const num = (tr, i) => Number(tr.children[i].textContent.replace(/[^\d.\-−]/g, '').replace('−', '-'));

  const kgRow = table().querySelector('tbody tr');
  const kgMid = num(kgRow, 2);

  doc.querySelector('#view-today [data-unit="kcal"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));
  assert(App.state.deficitUnit === 'kcal', 'היחידות לא התחלפו');

  const kcalRow = table().querySelector('tbody tr');
  const kcalMid = num(kcalRow, 2);
  const kcalPerKg = Store.getSettings().kcalPerKg;

  // אותו נתון בשתי יחידות: קילוגרם שלילי = גירעון חיובי בקלוריות
  // הערך בק"ג מעוגל לשתי ספרות, ולכן סטייה של עד ~40 קלוריות היא עיגול
  assert(Math.abs(kcalMid - (-kgMid * kcalPerKg)) < 50,
    'ההמרה שגויה: ' + kgMid + ' ק"ג מול ' + kcalMid + ' קלוריות');
  assert(Math.abs(kcalMid) > 100, 'הערך בקלוריות נראה כמו קילוגרמים');

  doc.querySelector('#view-today [data-unit="kg"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));
});

test('פס הבקרה זמין בכל מסך, ולא בתוך מסך מסוים', () => {
  ['today', 'entry', 'calc', 'trends', 'data'].forEach((view) => {
    App.setState({ view: view, date: '2026-08-21' });
    assert(doc.querySelector('#controls #rate-slider'), view + ': המחוון חסר בפס הבקרה');
    assert(doc.querySelector('#controls [data-calc]'), view + ': בורר החלון חסר בפס הבקרה');
    assert(!doc.querySelector('#view-' + view + ' [data-calc]'),
      view + ': בורר החלון שוכפל בתוך המסך');
  });
  App.setState({ view: 'today' });
});



test('הטבלאות משתמשות בחלונות מלאים מעוגנים, לא בחלון נע', () => {
  App.setState({ view: 'today', date: '2026-08-21' });
  const summary = window.Metrics.bodyChangeSummary(Store.getEntries(),
    { endDate: '2026-08-21', windows: [7, 10, 14] });
  const first = Store.getEntries()[0].date;

  summary.rows.forEach((row) => {
    if (!row.ok) return;
    // החלון מעוגן ליום הראשון: המרחק ממנו הוא כפולה שלמה של אורך החלון
    const offset = window.Dates.diffDays(first, row.current.from);
    assert(offset % row.days === 0,
      row.days + ' ימים: החלון לא מעוגן ליום הראשון (מרחק ' + offset + ')');
    // והחלון לא בהכרח מסתיים היום — זה בדיוק ההבדל מחלון נע
    assert(window.Dates.addDays(row.previous.to, 1) === row.current.from,
      row.days + ': החלונות לא צמודים');
  });

  // הטבלה מציגה את הטווחים שהמודל חישב
  const table = [...doc.querySelectorAll('#view-today table.data')]
    .find((t) => t.textContent.includes('שריר'));
  summary.rows.forEach((row, i) => {
    if (!row.ok) return;
    const tr = table.querySelectorAll('tbody tr')[i];
    const shown = tr.children[4].textContent;
    assert(shown.includes(window.Dates.short(row.current.from)),
      row.days + ' ימים: הטווח המוצג לא תואם את המודל');
  });
});



test('הלוח מציג את השקילה האחרונה ומפרט ימים חסרים', () => {
  App.setState({ view: 'today', date: '2026-08-21' });
  const d = window.Metrics.dashboard(Store.getEntries(), Store.getSettings(),
    { endDate: '2026-08-21' });
  const text = doc.getElementById('view-today').textContent;

  assert(text.includes(window.Fmt.n(d.latestWeight, 1)), 'השקילה האחרונה לא מוצגת');
  assert(text.includes(d.weighIns + ' ב-' + d.spanDays + ' ימים'),
    'ספירת השקילות לא מוצגת: ציפיתי ל-' + d.weighIns + ' ב-' + d.spanDays);

  if (d.missingWeighIns.length) {
    assert(text.includes('ימים ללא שקילה'), 'לא פורטו הימים החסרים');
    assert(text.includes(window.Dates.long(d.missingWeighIns[0])),
      'היום החסר הראשון לא מוצג: ' + d.missingWeighIns[0]);
  } else {
    assert(text.includes('בכל יום'), 'לא נאמר שאין ימים חסרים');
  }

  // הספירה חייבת להיות עקבית: ימים בטווח = שקילות + חסרים
  assert(d.weighIns + d.missingWeighIns.length === d.spanDays,
    'ספירה לא עקבית: ' + d.weighIns + ' + ' + d.missingWeighIns.length + ' ≠ ' + d.spanDays);
});



test('טבלת הקצבה מתחילה מהיום כשהקלוריות עוד לא נרשמו', () => {
  const date = '2026-08-21';
  Store.upsert({ date: date, kcal: '' });   // מבטלים את הרישום של אותו יום
  App.setState({ view: 'today', date: date });

  const table = [...doc.querySelectorAll('#view-today table.data')]
    .find((t) => t.textContent.includes('שבוע') && t.textContent.includes('זהיר'));
  assert(table, 'טבלת הקצבה חסרה');
  const first = table.querySelector('tbody tr').children[0].textContent.trim();
  assert(first === 'היום', 'ציפיתי ל"היום", קיבלתי "' + first + '"');

  // ואחרי שנרשמו — הספירה מתחילה ממחר
  Store.upsert({ date: date, kcal: 2400 });
  App.setState({ view: 'today', date: date });
  const table2 = [...doc.querySelectorAll('#view-today table.data')]
    .find((t) => t.textContent.includes('שבוע') && t.textContent.includes('זהיר'));
  const first2 = table2.querySelector('tbody tr').children[0].textContent.trim();
  assert(first2 === 'מחר', 'ציפיתי ל"מחר", קיבלתי "' + first2 + '"');
});

test('עמודת התאריך בטבלאות מסומנת ומיושרת בנפרד', () => {
  App.setState({ view: 'trends', range: 0 });
  const table = [...doc.querySelectorAll('#view-trends table.data')]
    .find((t) => t.textContent.includes('גבול תחתון'));
  assert(table, 'הטבלה חסרה');

  const header = table.querySelector('thead th');
  assert(header.classList.contains('date-cell'), 'כותרת התאריך לא מסומנת');
  table.querySelectorAll('tbody tr:not(.summary)').forEach((tr) => {
    assert(tr.children[0].classList.contains('date-cell'), 'תא תאריך לא מסומן');
    assert(!tr.children[0].classList.contains('n'), 'תא התאריך עדיין מיושר כמספר');
  });

  const css = fs.readFileSync(path.join(ROOT, 'assets/app.css'), 'utf8');
  assert(/table\.data td\.date-cell/.test(css), 'חסר כלל עיצוב לתא התאריך');
});



test('גרף המשקל מציג את קצב התוכנית ומגיב לשינוי שלו', () => {
  const setRate = (kg) => {
    App.setState({ view: 'today' });
    const slider = doc.querySelector('#rate-slider');
    slider.value = String(kg);
    slider.dispatchEvent(new window.Event('change', { bubbles: true }));
    App.setState({ view: 'trends', range: 0 });
  };

  const planPath = () => {
    const paths = [...doc.querySelectorAll('#chart-weight path')]
      .map((p) => p.getAttribute('d')).filter(Boolean);
    // קו התוכנית הוא היחיד המקווקו בכתום
    const el = [...doc.querySelectorAll('#chart-weight path')]
      .find((p) => p.getAttribute('stroke') === '#E07A34');
    assert(el, 'קו התוכנית חסר (' + paths.length + ' קווים בגרף)');
    return el.getAttribute('d');
  };

  setRate(0.25);
  const gentle = planPath();
  assert(doc.getElementById('chart-weight-legend').textContent.includes('קצב מתוכנן'),
    'קו התוכנית לא מופיע במקרא');

  setRate(1);
  const steep = planPath();
  assert(gentle !== steep, 'קו התוכנית לא השתנה עם הקצב');

  // שיפוע חד יותר = הנקודה האחרונה נמוכה יותר, כלומר y גדול יותר בפיקסלים
  const lastY = (d) => Number(d.trim().split(/[ML]/).filter(Boolean).pop().trim().split(' ')[1]);
  assert(lastY(steep) > lastY(gentle),
    'קצב מהיר יותר אמור לייצר קו יורד יותר');

  Store.updateSettings({ goal: { ratePerWeekKg: -0.5 } });
});

test('גרף ההוצאה מציג את יעד הצריכה שנגזר מהקצב', () => {
  App.setState({ view: 'trends', range: 0, tdeeMode: 'daily' });
  const legend = doc.getElementById('chart-tdee-legend').textContent;
  assert(legend.includes('יעד הצריכה'), 'יעד הצריכה חסר במקרא');

  const target = [...doc.querySelectorAll('#chart-tdee path')]
    .find((p) => p.getAttribute('stroke') === '#E07A34');
  assert(target, 'קו יעד הצריכה חסר בגרף');
});



test('החלפת חלון משנה את ה"שורף" בכל הטבלאות', () => {
  const burnFromTable = () => {
    App.setState({ view: 'trends', range: 0 });
    const table = [...doc.querySelectorAll('#view-trends table.data')]
      .find((t) => t.textContent.includes('גבול תחתון'));
    assert(table, 'טבלת הגירעון היומי חסרה');
    const row = table.querySelector('tbody tr:not(.summary)');
    return Number(row.children[2].textContent.replace(/[^\d]/g, ''));
  };

  const setWindow = (value) => {
    App.setState({ view: 'today' });
    const chip = doc.querySelector('#controls [data-calc="' + value + '"]');
    assert(chip && !chip.hasAttribute('disabled'), 'חלון ' + value + ' לא זמין');
    chip.dispatchEvent(new window.Event('click', { bubbles: true }));
  };

  setWindow('adaptive');
  const adaptive = burnFromTable();

  setWindow('14');
  const fixed = burnFromTable();

  assert(adaptive !== fixed,
    'ה"שורף" בטבלה לא השתנה עם החלון (' + adaptive + ' בשניהם)');

  // בחלון מספרי ההערכה קבועה, ולכן כל הימים מציגים אותו ערך
  const table = [...doc.querySelectorAll('#view-trends table.data')]
    .find((t) => t.textContent.includes('גבול תחתון'));
  const values = [...table.querySelectorAll('tbody tr:not(.summary)')]
    .map((tr) => tr.children[2].textContent.trim());
  assert(new Set(values).size === 1, 'בחלון מספרי ההוצאה אמורה להיות קבועה');

  setWindow('adaptive');
});

test('פס הבקרה מציג את הצריכה הצפויה לחלון שנבחר', () => {
  App.setState({ view: 'today', date: '2026-08-21' });
  const summary = doc.querySelector('#controls summary').textContent;
  assert(summary.includes('לאכול'), 'הצריכה הצפויה לא מופיעה בשורת הסיכום');

  const body = doc.querySelector('#controls .fold-body').textContent;
  ['שורף לפי החלון', 'בלי הליכה', 'צריכה צפויה'].forEach((label) => {
    assert(body.includes(label), 'חסר: ' + label);
  });

  const report = window.Metrics.windowReport(Store.getEntries(), Store.getSettings(),
    { windowDays: App.state.calcWindow, endDate: '2026-08-21' });
  assert(body.includes(window.Fmt.n(report.target, 0)), 'הצריכה הצפויה לא תואמת את המודל');
});

test('הגרפים אינם משתנים עם החלון, רק החישובים', () => {
  const weightPath = () => {
    App.setState({ view: 'trends', range: 0 });
    return [...doc.querySelectorAll('#chart-weight path')]
      .find((p) => p.getAttribute('stroke') === '#0D6E67').getAttribute('d');
  };

  App.setState({ view: 'today' });
  doc.querySelector('#controls [data-calc="adaptive"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));
  const before = weightPath();

  App.setState({ view: 'today' });
  doc.querySelector('#controls [data-calc="14"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));
  const after = weightPath();

  assert(before === after, 'קו המשקל השתנה עם החלון, והוא לא אמור');

  App.setState({ view: 'today' });
  doc.querySelector('#controls [data-calc="adaptive"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));
});



test('טבלת ההשוואה מציגה שורה לכל חלון עם שלושת התרחישים', () => {
  App.setState({ view: 'today', date: '2026-08-21', calcWindow: 'adaptive' });
  const table = [...doc.querySelectorAll('#view-today table.data')]
    .find((t) => t.textContent.includes('גירעון ליום'));
  assert(table, 'טבלת ההשוואה חסרה');

  const headers = [...table.querySelectorAll('th')].map((th) => th.textContent.trim());
  ['חלון', 'שורף', '±', 'גירעון ליום', 'זהיר', 'הערכה', 'נדיב'].forEach((h) => {
    assert(headers.indexOf(h) !== -1, 'חסרה עמודה: ' + h);
  });

  const model = window.Metrics.windowComparison(Store.getEntries(), Store.getSettings(),
    { endDate: '2026-08-21' });
  const rows = [...table.querySelectorAll('tbody tr')];
  assert(rows.length === model.rows.length, 'מספר שורות לא תואם');

  const num = (td) => Number(td.textContent.replace(/[^\d.\-−]/g, '').replace('−', '-'));
  model.rows.forEach((row, i) => {
    if (!row.ok) return;
    assert(Math.abs(num(rows[i].children[1]) - Math.round(row.tdee)) <= 1,
      row.label + ': השורף לא תואם');
    assert(Math.abs(num(rows[i].children[2]) - Math.round(row.ci95)) <= 1,
      row.label + ': רווח הסמך לא תואם');
    // שלושת התרחישים מסודרים משמאל לימין בטבלה
    const low = num(rows[i].children[4]), mid = num(rows[i].children[5]), high = num(rows[i].children[6]);
    assert(low > mid && mid > high, row.label + ': התרחישים לא מסודרים');
  });
});

test('החלון הפעיל מסומן בטבלת ההשוואה', () => {
  App.setState({ view: 'today', date: '2026-08-21' });
  doc.querySelector('#controls [data-calc="7"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));

  const table = [...doc.querySelectorAll('#view-today table.data')]
    .find((t) => t.textContent.includes('גירעון ליום'));
  const marked = [...table.querySelectorAll('tbody tr')]
    .filter((tr) => tr.textContent.includes('✓'));
  assert(marked.length === 1, 'ציפיתי לשורה מסומנת אחת, יש ' + marked.length);
  assert(marked[0].children[0].textContent.indexOf('7') === 0,
    'הסימון על החלון הלא נכון: ' + marked[0].children[0].textContent);

  doc.querySelector('#controls [data-calc="adaptive"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));
});

test('טבלת "כמה לאכול" מגיבה לבחירת התרחיש', () => {
  App.setState({ view: 'today', date: '2026-08-21', scenario: 'mid' });
  const table = () => [...doc.querySelectorAll('#view-today table.data')]
    .find((t) => t.textContent.includes('שבוע') && t.textContent.includes('חלון'));
  const firstValue = () => Number(
    table().querySelector('tbody tr').children[1].textContent.replace(/[^\d]/g, ''));

  const mid = firstValue();
  doc.querySelector('[data-scenario="low"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.scenario === 'low', 'התרחיש לא התעדכן');
  const low = firstValue();

  doc.querySelector('[data-scenario="high"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  const high = firstValue();

  assert(low < mid && mid < high,
    'הקצבה לא מסודרת לפי תרחיש: ' + low + ' / ' + mid + ' / ' + high);
  App.setState({ scenario: 'mid' });
});



test('גרף ההוצאה מתעדכן לפי החלון שנבחר', () => {
  const setWindow = (value) => {
    App.setState({ view: 'today' });
    doc.querySelector('#controls [data-calc="' + value + '"]').dispatchEvent(
      new window.Event('click', { bubbles: true }));
    App.setState({ view: 'trends', range: 0, tdeeMode: 'daily' });
  };

  const burnPath = () => {
    const el = [...doc.querySelectorAll('#chart-tdee path')]
      .find((p) => p.getAttribute('stroke') === '#0D6E67' &&
        Number(p.getAttribute('stroke-width')) > 2);
    assert(el, 'קו ההוצאה חסר');
    return el.getAttribute('d');
  };

  setWindow('adaptive');
  const adaptive = burnPath();
  const adaptiveNote = [...doc.querySelectorAll('#view-trends .card-note')]
    .find((n) => n.textContent.includes('שיטה')).textContent;
  assert(adaptiveNote.includes('מסתגל'), 'הכותרת לא מציינת מסתגל');

  setWindow('10');
  const fixed = burnPath();
  assert(adaptive !== fixed, 'קו ההוצאה לא השתנה עם החלון');

  const note = [...doc.querySelectorAll('#view-trends .card-note')]
    .find((n) => n.textContent.includes('שיטה')).textContent;
  assert(note.includes('10 ימים'), 'הכותרת לא מציינת את החלון: ' + note);
  assert(doc.getElementById('chart-tdee-legend').textContent.includes('חלון 10'),
    'המקרא לא מציין את החלון');

  // בחלון מספרי ההערכה קבועה, ולכן הקו אופקי: כל ערכי ה-y זהים
  const ys = fixed.trim().split(/[ML]/).filter(Boolean)
    .map((pair) => Number(pair.trim().split(' ')[1]));
  const spread = Math.max(...ys) - Math.min(...ys);
  assert(spread < 0.5, 'הקו אמור להיות ישר בחלון מספרי, פיזור ' + spread.toFixed(2));

  setWindow('adaptive');
});

test('חלון רועש מסומן בטבלת ההשוואה', () => {
  App.setState({ view: 'today', date: '2026-08-21' });
  const table = [...doc.querySelectorAll('#view-today table.data')]
    .find((t) => t.textContent.includes('גירעון ליום'));
  const model = window.Metrics.windowComparison(Store.getEntries(), Store.getSettings(),
    { endDate: '2026-08-21' });

  const rows = [...table.querySelectorAll('tbody tr')];
  model.rows.forEach((row, i) => {
    if (!row.ok) return;
    const marked = rows[i].children[0].textContent.includes('רועש');
    assert(marked === (row.ci95 > 600),
      row.label + ': סימון "רועש" לא תואם רווח סמך של ±' + Math.round(row.ci95));
  });
});


runAll().then(function () {
  



console.log('');
  failures.forEach(function (f) {
    console.log('\u2717 ' + f.name);
    console.log('   ' + f.message);
  });
  console.log('\n' + passed + ' \u05e2\u05d1\u05e8\u05d5, ' + failures.length + ' \u05e0\u05db\u05e9\u05dc\u05d5\n');
  process.exit(failures.length ? 1 : 0);
});
