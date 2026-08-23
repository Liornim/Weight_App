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
[
  'js/lib/stats.js', 'js/lib/dates.js', 'js/lib/kalman.js', 'js/lib/bodycomp.js', 'js/core/metrics.js', 'js/core/store.js', 'js/core/sheets.js',
  'js/ui/format.js', 'js/ui/chart.js', 'js/ui/components.js',
  'js/views/home.js', 'js/views/progress.js', 'js/views/target.js', 'js/views/methods.js', 'js/views/status.js', 'js/views/trends.js', 'js/views/data.js',
  'js/app.js'
].forEach((rel) => {
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
  assert(doc.querySelectorAll('#tabs button').length === 4, 'ארבעה טאבים בסרגל');
  assert(doc.getElementById('view-today').classList.contains('is-active'), 'מסך היום פעיל');
});

['today', 'progress', 'target', 'methods', 'status', 'trends', 'data'].forEach((view) => {
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
  App.setState({ view: 'today', date: '2026-03-10' });
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
  App.setState({ view: 'today', date: '2026-03-10' });
  doc.querySelector('[data-step="-1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.date === '2026-03-09', 'יום אחורה: ' + App.state.date);
  assert(doc.getElementById('entry-form').elements.weightKg.value === '', 'טופס ריק ליום ללא נתונים');
});

test('אי אפשר לנווט אל מעבר להיום', () => {
  App.setState({ view: 'today', date: Dates.today() });
  assert(doc.querySelector('[data-step="1"]').hasAttribute('disabled'), 'כפתור "יום הבא" צריך להיות מנוטרל');
  App.setState({ date: Dates.addDays(Dates.today(), -1) });
  assert(!doc.querySelector('[data-step="1"]').hasAttribute('disabled'), 'ביום קודם הוא צריך לעבוד');
});

test('אזהרה מוצגת על ערך לא הגיוני', () => {
  App.setState({ view: 'today', date: '2026-03-11' });
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

test('מסך השיטות נפתח מתוך מסך הבית וחוזר אליו', () => {
  App.setState({ view: 'today' });
  doc.querySelector('#open-methods').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.view === 'methods', 'לא עברנו למסך השיטות');
  assert(doc.querySelector('#tabs button[data-view="today"]').getAttribute('aria-selected') === 'true',
    'הטאב "היום" צריך להישאר מסומן');
  doc.querySelector('#back-to-target').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.view === 'today', 'החזרה לא עבדה');
});

test('מסך השיטות מציג את החשבון של כל שיטה', () => {
  errors.length = 0;
  App.setState({ view: 'methods' });
  const host = doc.getElementById('view-methods');
  const folds = host.querySelectorAll('details.fold');
  assert(folds.length >= 3, 'ציפיתי לשיטה לכל מקטע, יש ' + folds.length);
  assert(host.querySelectorAll('.formula').length >= 3, 'חסרות נוסחאות');
  const body = host.textContent;
  ['מסנן קלמן', 'רגרסיה', 'בלוקים', 'צריכה ממוצעת', 'רווח סמך', 'בלי צעדים'].forEach((label) => {
    assert(body.includes(label), 'חסר: ' + label);
  });
  assert(errors.length === 0, 'שגיאות: ' + errors.join(' | '));
});

test('בחירת שיטה משנה את המספרים במסך היעד', () => {
  App.setState({ view: 'methods' });
  const before = Store.getSettings().tdeeMethod;
  const button = doc.querySelector('#view-methods [data-pick]');
  const picked = button.dataset.pick;
  button.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(Store.getSettings().tdeeMethod === picked, 'הבחירה נשמרה');
  assert(picked !== before, 'נבחרה שיטה אחרת');

  App.setState({ view: 'target' });
  const shown = doc.getElementById('view-target').textContent;
  const expected = Math.round(
    window.Metrics.tdeeMethods(Store.getEntries(), Store.getSettings()).chosen.base
  ).toLocaleString('en-US');
  assert(shown.includes(expected), 'מסך היעד לא מציג את הבסיס של השיטה שנבחרה (' + expected + ')');
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

test('בחירת חלון החישוב משנה את כל המספרים במסך', () => {
  errors.length = 0;
  App.setState({ view: 'today', date: '2026-08-21', calcWindow: 'adaptive' });
  const adaptive = doc.querySelector('#view-today .hero-value').textContent;

  const chip = doc.querySelector('[data-calc="7"]');
  assert(chip, 'אין כפתור לחלון 7');
  chip.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.calcWindow === 7, 'החלון לא התעדכן');
  assert(doc.querySelector('[data-calc="7"]').getAttribute('aria-pressed') === 'true', 'הכפתור לא סומן');

  const seven = doc.querySelector('#view-today .hero-value').textContent;
  assert(seven !== adaptive, 'המספר הראשי לא השתנה (' + adaptive + ')');
  assert(doc.getElementById('view-today').textContent.includes('7 הימים האחרונים'), 'הכותרת לא התעדכנה');

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
  App.setState({ view: 'today', date: '2026-08-21', calcWindow: 'adaptive' });
  const status = window.Metrics.availableWindows(Store.getEntries(), { endDate: '2026-08-21' });
  const byValue = {};
  doc.querySelectorAll('#view-today [data-calc]').forEach((c) => { byValue[c.dataset.calc] = c; });

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

test('חלון מלא מציג את פירוק החישוב תקופה מול תקופה', () => {
  App.setState({ view: 'today', date: '2026-08-21', calcWindow: 7 });
  const text = doc.getElementById('view-today').textContent;
  ['איך חושב', 'תקופה נוכחית', 'תקופה קודמת', 'משקל ממוצע נוכחי',
   'משקל ממוצע קודם', 'קלוריות מירידת המשקל'].forEach((label) => {
    assert(text.includes(label), 'חסר: ' + label);
  });
  assert(text.includes('חלון מלא של 7 ימים'), 'חסרה כותרת החלון המלא');
  App.setState({ calcWindow: 'adaptive' });
});

test('מסך הבית מציג את כל המדדים שהתבקשו', () => {
  App.setState({ view: 'today', date: '2026-08-21', calcWindow: 14 });
  const text = doc.getElementById('view-today').textContent;
  ['עמידה ביעד', 'ירידה צפויה לפי החשבון', 'מהתזונה בלבד', 'כולל ההליכה',
   'מה קרה בפועל', 'שומן', 'שריר', 'מגמת משקל', 'לסגור את הפער'].forEach((label) => {
    assert(text.includes(label), 'חסר: ' + label);
  });

  // בטבלת הפיצוי מוצגות רק פריסות שאפשר לחיות איתן
  const card = [...doc.querySelectorAll('#view-today .card')]
    .find((c) => c.textContent.includes('לסגור את הפער'));
  assert(card, 'חסר כרטיס הפיצוי');
  const options = card.querySelectorAll('tbody tr');
  const labels = ['מחר', 'מחר ומחרתיים', 'שלושה ימים', 'חמישה ימים', 'שבוע'];
  if (options.length) {
    [...options].forEach((tr) => {
      const name = tr.children[0].textContent.trim();
      assert(labels.indexOf(name) !== -1, 'תווית פריסה לא מוכרת: ' + name);
      const value = Number(tr.children[1].textContent.replace(/[^\d-]/g, ''));
      assert(value >= 1200, 'הוצגה אפשרות נמוכה מדי: ' + value);
    });
  } else {
    assert(card.textContent.includes('גדול מכדי'), 'אין אפשרויות ואין הסבר');
  }
});

test('בחירת קצב הירידה זמינה במסך הבית', () => {
  App.setState({ view: 'today', date: '2026-08-21', calcWindow: 14 });
  doc.querySelector('#view-today [data-rate="-0.25"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(Store.getSettings().goal.ratePerWeekKg === -0.25, 'הקצב לא נשמר');
  const gentle = Number(doc.querySelector('#view-today .hero-value').textContent.replace(/[^\d]/g, ''));

  doc.querySelector('#view-today [data-rate="-1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  const steep = Number(doc.querySelector('#view-today .hero-value').textContent.replace(/[^\d]/g, ''));
  assert(gentle - steep > 500, 'ההפרש בין 0.25 ל-1 ק"ג צריך להיות גדול (' + gentle + ' מול ' + steep + ')');

  doc.querySelector('#view-today [data-rate="0"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  const maintain = Number(doc.querySelector('#view-today .hero-value').textContent.replace(/[^\d]/g, ''));
  const report = window.Metrics.windowReport(Store.getEntries(), Store.getSettings(),
    { windowDays: 14, endDate: '2026-08-21' });
  assert(Math.abs(maintain - Math.round(report.base)) <= 1, 'שמירה צריכה להיות בדיוק הבסיס');

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


runAll().then(function () {
  



console.log('');
  failures.forEach(function (f) {
    console.log('\u2717 ' + f.name);
    console.log('   ' + f.message);
  });
  console.log('\n' + passed + ' \u05e2\u05d1\u05e8\u05d5, ' + failures.length + ' \u05e0\u05db\u05e9\u05dc\u05d5\n');
  process.exit(failures.length ? 1 : 0);
});
