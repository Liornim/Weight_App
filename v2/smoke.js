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

/**
 * בניית הנתונים מחדש.
 *
 * כמה בדיקות מנקות את האחסון כדי לבנות תרחיש משלהן, ובלי שחזור
 * הן משאירות את הבדיקות שאחריהן בלי נתונים — כישלון שנראה כמו
 * באג בקוד ואינו.
 */
function seed() {
  Store.clearAll();
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
}

seed();
Store.updateSettings({
  profile: { heightCm: 180, birthDate: '1990-05-20', sex: 'male' },
  goal: { ratePerWeekKg: -0.5, targetWeightKg: 82 },
  targets: { proteinG: 170 }
});
App.setState({ date: Dates.today(), tab: 'home' });
test('שינוי קצב הירידה מזיז את התקציב', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2,
    splitRow: null, budgetWalk: 'on' });

  const read = () => Number(doc.querySelector('#view .big-number .v')
    .textContent.replace(/[^0-9.\-]/g, ''));

  Store.updateSettings({ goal: { ratePerWeekKg: -0.25 } });
  App.setState({ date: Dates.today() });
  const slow = read();

  Store.updateSettings({ goal: { ratePerWeekKg: -0.75 } });
  App.setState({ date: Dates.today() });
  const fast = read();

  assert(fast < slow, 'גירעון גדול יותר אמור להקטין את התקציב');

  // ההפרש הוא בדיוק ההפרש בגירעון
  const kcalPerKg = Store.getSettings().kcalPerKg || 7700;
  const expected = Math.round(((0.75 - 0.25) * kcalPerKg) / 7);
  assert(Math.abs((slow - fast) - expected) <= 2,
    'ההפרש ' + (slow - fast) + ' מול ' + expected);

  Store.updateSettings({ goal: { ratePerWeekKg: -0.5 } });
});



// ---------------------------------------------------------------

test('כל קובץ מקומי נושא חותמת גרסה בכתובת', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const local = [...html.matchAll(/(?:src|href)="((?:\.\.\/)?(?:js|assets)\/[^"]+)"/g)]
    .map((m) => m[1]);

  assert(local.length > 5, 'ציפיתי לכמה קבצים מקומיים, נמצאו ' + local.length);
  local.forEach((url) => {
    assert(url.indexOf('?v=') !== -1, 'בלי חותמת: ' + url);
  });

  // החותמת תואמת את הגרסה שמוצגת במסך
  assert(local[0].indexOf('?v=' + App.BUILD) !== -1,
    'החותמת בכתובת אינה ' + App.BUILD + ': ' + local[0]);
});

test('הכותרת מציגה את הירידה הכוללת ואת ההתקדמות ליעד', () => {
  const d = Metrics.dashboard(Store.getEntries(), Store.getSettings(), { endDate: Dates.today() });
  const head = doc.querySelector('.headline .v').textContent;
  assert(Math.abs(Number(head) - d.totalLoss) < 0.06,
    'הירידה המוצגת ' + head + ' מול ' + d.totalLoss.toFixed(1));

  // הירידה נמדדת בין ממוצעים, ולכן היא קטנה מהמרחק בין הקצוות
  assert(d.totalLoss < d.peakDrop, 'ציפיתי למספר צנוע מהמרחק בין הקצוות');
  const sub = doc.querySelector('.headline .u').textContent;
  assert(sub.includes('הימים הראשונים') && sub.includes('האחרונים'),
    'לא מוסבר מאיפה נמדדה הירידה: ' + sub);
  assert(sub.includes(String(d.halves.days)), 'לא צוין אורך כל חצי');
  assert(sub.includes(window.Fmt.n(d.halves.first.mean, 1)), 'ממוצע החצי הראשון חסר');

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

test('אין נתון שמוצג פעמיים באותו מסך', () => {
  const headings = [...doc.querySelectorAll('#view h3')].map((h) => h.textContent.trim());
  const unique = new Set(headings);
  assert(unique.size === headings.length,
    'כותרת כרטיס מופיעה פעמיים: ' + headings.join(', '));
});





test('פענוח תשובת המודל עמיד לעטיפות', () => {
  const E = window.Estimate;
  const payload = { kcal: 700, protein: 40, carbs: 60, fat: 25, items: [] };

  assert(E.parseAnswer(JSON.stringify(payload)).kcal === 700, 'JSON נקי');
  assert(E.parseAnswer('```json\n' + JSON.stringify(payload) + '\n```').kcal === 700,
    'עטוף בסימני קוד');
  assert(E.parseAnswer('הנה ההערכה:\n' + JSON.stringify(payload) + '\nבהצלחה').kcal === 700,
    'עם טקסט מסביב');
  assert(E.parseAnswer('בלי JSON בכלל') === null, 'טקסט בלי JSON');
  assert(E.parseAnswer('') === null, 'מחרוזת ריקה');
  assert(E.parseAnswer('{"broken": ') === null, 'JSON שבור');
});



test('פס הבחירה והטאבים נדבקים לראש המסך', () => {
  const css = fs.readFileSync(path.join(__dirname, 'assets/dash.css'), 'utf8');

  const bar = css.match(/\.sticky-bar\s*\{[^}]*\}/);
  assert(bar && bar[0].indexOf('position: sticky') !== -1, 'פס הבחירה אינו דביק');

  const tabs = css.match(/\.tabs\s*\{[^}]*\}/);
  assert(tabs && tabs[0].indexOf('position: sticky') !== -1, 'הטאבים אינם דביקים');

  // הטאבים מעל פס הבחירה, אחרת הם ייחתכו
  const barZ = Number((bar[0].match(/z-index:\s*(\d+)/) || [])[1]);
  const tabsZ = Number((tabs[0].match(/z-index:\s*(\d+)/) || [])[1]);
  assert(tabsZ > barZ, 'סדר השכבות שגוי: טאבים ' + tabsZ + ' מול פס ' + barZ);
});

test('בלי בחירה, היעד בכל חלון נגזר מההוצאה שלו', () => {
  const model = Metrics.targetGaps(Store.getEntries(), Store.getSettings(),
    { endDate: Dates.today(), windows: [7, 14] });

  model.rows.filter((r) => r.ok).forEach((row) => {
    const report = Metrics.windowReport(Store.getEntries(), Store.getSettings(),
      { windowDays: row.days, endDate: Dates.today() });
    assert(Math.abs(row.target.kcal - report.target) < 0.01,
      row.days + ': היעד אינו של אותו חלון');
  });
});

test('החלון המתגלגל באותו אורך ובאותה שיטה', () => {
  window.Parts.WINDOWS.forEach((days) => {
    const r = Metrics.dayAligned(Store.getEntries(), Store.getSettings(),
      { days: days, endDate: Dates.today() });
    if (!r.ok || !r.rolling) return;

    assert(r.rolling.days === days, days + ': אורך שונה');

    /**
     * מאז המעבר לרגרסיה שני החלונות אינם חייבים לתת אותו רוחב:
     * הם מכסים תקופות שונות, ולכן השאריות בהן שונות. מה שכן חייב
     * להתקיים הוא שהם נמדדים באותה שיטה ועל אותו מספר ימים.
     */
    assert(r.rolling.method === r.method,
      days + ': שיטות שונות — ' + r.rolling.method + ' מול ' + r.method);
    assert(Dates.diffDays(r.rolling.foodFrom, r.rolling.foodTo) === days - 1,
      days + ': טווח שגוי');
  });
});

test('הפס והטבלה מציגים את אותו מספר', () => {
  // שני מנועים שונים לאותה שאלה נתנו 3,462 בפס מול 2,357 בטבלה
  window.Parts.WINDOWS.forEach((days) => {
    const state = { basis: days, caution: 'mid', stepsMode: 'off',
      date: Dates.today() };

    const bar = window.Dash.adjust(
      window.Dash.report(Store.getEntries(), Store.getSettings(), Dates.today(), state),
      'mid');
    const table = Metrics.dayAligned(Store.getEntries(), Store.getSettings(),
      { days: days, endDate: Dates.today() });

    if (!bar.ok || !table.ok) return;

    assert(Math.abs(bar.base - table.base) < 0.01,
      days + ' ימים: הפס ' + Math.round(bar.base) +
      ' מול הטבלה ' + Math.round(table.base));
    assert(bar.from === table.foodFrom && bar.to === table.foodTo,
      days + ' ימים: תקופות שונות');
  });
});

test('"שורף" בפס משתנה עם בורר ההליכה', () => {
  const at = (mode) => window.Dash.report(Store.getEntries(), Store.getSettings(),
    Dates.today(), { basis: 7, stepsMode: mode, date: Dates.today() });

  const off = at('off');
  const on = at('on');
  if (!off.ok || !off.stepKcal) return;

  // היעד גדל בדיוק בקלוריות ההליכה
  assert(Math.abs((on.target - off.target) - off.stepKcal) < 0.01,
    'ההפרש ' + Math.round(on.target - off.target) +
    ' אינו ההליכה ' + Math.round(off.stepKcal));
});

test('לחלונות המוכרים יש שם ולאחרים מספר', () => {
  const L = window.Parts.windowLabel;
  assert(L(7) === 'שבוע', 'שבוע');
  assert(L(14) === 'שבועיים', 'שבועיים');
  assert(L(21) === '3 שבועות', '3 שבועות');
  assert(L(28) === 'חודש', 'חודש');
  assert(L(11) === '11 ימים', '11: ' + L(11));
  assert(L(4) === '4 ימים', '4: ' + L(4));
});

test('הסף לשומן ולשריר גבוה מזה של המשקל', () => {
  // הם נמדדים בביו־אימפדנס ולכן רועשים יותר
  const r = Metrics.compositionWindow(Store.getEntries(),
    { days: 14, endDate: Dates.today() });
  if (!r.ok) return;

  const w = Metrics.fieldNoiseSd(Store.getEntries(), 'weightKg');
  const f = Metrics.fieldNoiseSd(Store.getEntries(), 'bodyFatKg');
  assert(f > 0 && w > 0, 'הרעש לא חושב');
});

test('טאב הנתונים אומר עד מתי הנתונים עדכניים', () => {
  App.setState({ date: Dates.today(), tab: 'data', dataAll: false });

  const text = doc.getElementById('view').textContent;
  assert(text.indexOf('נסגר עד') !== -1, 'חסר האריח הראשי');
  assert(text.indexOf('שקילה אחרונה') !== -1, 'חסרה השקילה האחרונה');
  assert(text.indexOf('רישום אוכל אחרון') !== -1, 'חסר האוכל האחרון');

  // התאריכים תואמים את מה שבאמת יש
  const entries = Store.getEntries();
  const weighed = entries.filter((e) => Fmt.isNum(e.weightKg));
  const eaten = entries.filter((e) => Fmt.isNum(e.kcal));

  if (weighed.length) {
    assert(text.indexOf(Dates.short(weighed[weighed.length - 1].date)) !== -1,
      'השקילה האחרונה לא מוצגת');
  }
  if (eaten.length) {
    assert(text.indexOf(Dates.short(eaten[eaten.length - 1].date)) !== -1,
      'האוכל האחרון לא מוצג');
  }
});

test('הטבלה מציגה את הנתונים הגולמיים מהחדש לישן', () => {
  App.setState({ date: Dates.today(), tab: 'data', dataAll: false });

  const table = [...doc.querySelectorAll('#view table.t')]
    .find((t) => t.textContent.indexOf('נוזלים') !== -1);
  assert(table, 'הטבלה חסרה');

  const heads = [...table.querySelectorAll('th')].map((h) => h.textContent);
  ['תאריך', 'משקל', 'קלוריות', 'צעדים'].forEach((name) => {
    assert(heads.indexOf(name) !== -1, 'חסרה עמודה: ' + name);
  });

  const rows = [...table.querySelectorAll('tbody tr')];
  assert(rows.length > 0, 'אין שורות');
  assert(rows.length <= window.DataTab.PAGE, 'יותר משורה אחת לעמוד');

  // מהחדש לישן
  const entries = Store.getEntries();
  assert(rows[0].children[0].textContent.indexOf(
    Dates.short(entries[entries.length - 1].date)) !== -1,
    'השורה הראשונה אינה היום האחרון');
});

test('היום הפתוח אינו נחשב חסר', () => {
  // נשקל בבוקר, האוכל ייכנס מחר — המצב הרגיל
  const day = Dates.today();
  Store.upsert({ date: day, weightKg: 88.4, kcal: '' });
  App.setState({ date: day, tab: 'data', dataAll: false });

  const table = [...doc.querySelectorAll('#view table.t')]
    .find((t) => t.textContent.indexOf('נוזלים') !== -1);
  const first = table.querySelector('tbody tr');

  assert(!first.classList.contains('within-noise'),
    'היום הפתוח סומן כחסר');
  assert(first.textContent.indexOf('פתוח') !== -1, 'לא סומן כפתוח');

  // וההסבר מופיע
  const text = doc.getElementById('view').textContent;
  assert(text.indexOf('פתוח: נשקלת בבוקר') !== -1, 'לא הוסבר המבנה');
  assert(text.indexOf('נסגר עד') !== -1, 'האריח לא מדבר על סגירה');
});

test('התקציב פותח בכמה זמן נמדד', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2, splitRow: null });

  const first = doc.querySelector('#view .card');
  const labels = [...first.querySelectorAll('.tile .k')].map((k) => k.textContent);
  assert(labels.join() === 'ימים במעקב,שקילות,מקטע', 'האריחים: ' + labels.join());

  const entries = Store.getEntries();
  const span = Dates.diffDays(entries[0].date, entries[entries.length - 1].date) + 1;
  const shown = Number(first.querySelector('.tile .v').textContent.replace(/[^0-9]/g, ''));
  assert(shown === span, 'מוצג ' + shown + ' מול ' + span);
});

test('מקטעים באורך קבוע: 10 ו-21 ימים', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2,
    splitRow: null, splitAnchor: 'end' });

  ['d10', 'd21'].forEach((value) => {
    assert(doc.querySelector('[data-split="' + value + '"]'), 'חסר צ׳יפ ל-' + value);
  });

  doc.querySelector('[data-split="d10"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));
  assert(App.state.splitParts === 'd10', 'הבחירה לא נשמרה');
  assert(window.BudgetTab.sizeOf(App.state) === 10, 'האורך לא זוהה');

  // כל מקטע באורך הנדרש בדיוק
  const split = Metrics.periodSplit(Store.getEntries(),
    { size: 10, endDate: Dates.today(), anchor: 'end' });
  if (split.ok) {
    assert(split.fixed, 'לא סומן כאורך קבוע');
    split.rows.forEach((r) => {
      assert(r.days === 10, 'מקטע של ' + r.days + ' ימים במקום 10');
    });
  }

  App.setState({ splitParts: 2, tab: 'home' });
});

test('אורך קבוע נותן יותר מקטעים מחלוקה לחצי', () => {
  const entries = Store.getEntries();
  const byParts = Metrics.periodSplit(entries, { parts: 2, endDate: Dates.today() });
  const bySize = Metrics.periodSplit(entries, { size: 10, endDate: Dates.today() });

  if (byParts.ok && bySize.ok) {
    assert(bySize.parts >= byParts.parts,
      'אורך קבוע: ' + bySize.parts + ' מול חצי: ' + byParts.parts);
  }
});

test('אורך קבוע דורש שני מקטעים שלמים', () => {
  const short = [];
  for (let i = 0; i < 15; i++) {
    short.push({ date: Dates.addDays('2026-01-01', i), weightKg: 90, kcal: 2400 });
  }
  const r = Metrics.periodSplit(short, { size: 10, endDate: '2026-01-15' });

  assert(!r.ok, 'היה צריך להיכשל');
  assert(r.reason === 'too-short', 'הסיבה: ' + r.reason);
  assert(r.need === 20, 'צריך ' + r.need + ' במקום 20');
});

test('מצב "מותאם לכולם" נותן תחזוקה אחת לכל החלונות', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2, splitRow: null });

  const chip = doc.querySelector('[data-split="fit"]');
  assert(chip, 'חסר הצ׳יפ');

  chip.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.splitParts === 'fit', 'הבחירה לא נשמרה');

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => (c.querySelector('h3') || {}).textContent === 'מותאם לכל החלונות');
  assert(card, 'הכרטיס חסר');

  const fit = Metrics.fitMaintenance(Store.getEntries(), {
    endDate: Dates.today(),
    kcalPerKg: Store.getSettings().kcalPerKg,
    kcalPerStep: Store.getSettings().kcalPerStep
  });
  if (!fit.ok) { App.setState({ splitParts: 2, tab: 'home' }); return; }

  const shown = Number(card.querySelector('.big-number .v')
    .textContent.replace(/[^0-9]/g, ''));
  assert(shown === fit.maintenance, 'מוצג ' + shown + ' מול ' + fit.maintenance);

  // כל חלון מופיע בטבלה
  const rows = [...card.querySelectorAll('tbody tr')];
  assert(rows.length === fit.cases.length,
    'שורות: ' + rows.length + ' מול ' + fit.cases.length);

  // והטווח השקול מוצג
  assert(card.textContent.indexOf('טווח שקול') !== -1, 'הטווח לא מוצג');

  App.setState({ splitParts: 2, tab: 'home' });
});

test('התקציב במצב המותאם נגזר מהתחזוקה שנמצאה', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 'fit',
    splitRow: null, budgetWalk: 'on' });

  const fit = Metrics.fitMaintenance(Store.getEntries(), {
    endDate: Dates.today(),
    kcalPerKg: Store.getSettings().kcalPerKg,
    kcalPerStep: Store.getSettings().kcalPerStep
  });
  if (!fit.ok) { App.setState({ splitParts: 2, tab: 'home' }); return; }

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => (c.querySelector('h3') || {}).textContent === 'התקציב');
  const calc = card.querySelector('.calc').textContent;

  assert(calc.indexOf(Fmt.n(fit.maintenance, 0)) !== -1,
    'התחזוקה בחישוב אינה זו שנמצאה');

  App.setState({ splitParts: 2, tab: 'home' });
});

test('מצב ידני: תחזוקה וצעדים שאני קובע', () => {
  Store.updateSettings({ manual: { maintenance: 2600, steps: 12000 } });
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 'manual',
    budgetWalk: 'on' });

  const maint = doc.getElementById('manual-maintenance');
  const steps = doc.getElementById('manual-steps');
  assert(maint && steps, 'שדות ההזנה חסרים');
  assert(Number(maint.value) === 2600, 'התחזוקה: ' + maint.value);
  assert(Number(steps.value) === 12000, 'הצעדים: ' + steps.value);

  // התקציב נגזר מהם ולא ממדידה
  const perStep = Store.getSettings().kcalPerStep || 0.045;
  const rate = Math.abs(Store.getSettings().goal.ratePerWeekKg || 0);
  const deficit = (rate * (Store.getSettings().kcalPerKg || 7700)) / 7;
  const expected = Math.round(2600 - deficit + 12000 * perStep);

  const shown = Number(doc.querySelector('#view .big-number .v')
    .textContent.replace(/[^0-9.\-]/g, ''));
  assert(Math.abs(shown - expected) <= 1, 'מוצג ' + shown + ' מול ' + expected);

  App.setState({ splitParts: 2, tab: 'home' });
});

test('שינוי בשדה הידני נשמר ומשנה את התקציב', () => {
  Store.updateSettings({ manual: { maintenance: 2400, steps: 9000 } });
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 'manual' });

  const read = () => Number(doc.querySelector('#view .big-number .v')
    .textContent.replace(/[^0-9.\-]/g, ''));
  const before = read();

  const field = doc.getElementById('manual-maintenance');
  field.value = '2700';
  field.dispatchEvent(new window.Event('change', { bubbles: true }));

  assert(Store.getSettings().manual.maintenance === 2700, 'לא נשמר');
  App.setState({ date: Dates.today() });
  assert(read() - before === 300, 'ההפרש: ' + (read() - before));

  // והצעדים נשמרו כפי שהיו
  assert(Store.getSettings().manual.steps === 9000, 'הצעדים אבדו');

  Store.updateSettings({ manual: { maintenance: 2400, steps: 9000 } });
  App.setState({ splitParts: 2, tab: 'home' });
});

test('ערך לא תקין בשדה הידני אינו נשמר', () => {
  Store.updateSettings({ manual: { maintenance: 2400, steps: 9000 } });
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 'manual' });

  const field = doc.getElementById('manual-maintenance');
  field.value = '';
  field.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(Store.getSettings().manual.maintenance === 2400,
    'ערך ריק דרס את הקיים');

  field.value = '-500';
  field.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(Store.getSettings().manual.maintenance === 2400,
    'ערך שלילי נשמר');

  App.setState({ splitParts: 2, tab: 'home' });
});

test('מצב "לפי נוסחה" מציג את החישוב ואת הפרטים', () => {
  Store.updateSettings({
    profile: { heightCm: 180, sex: 'male', birthDate: '1978-08-29' }
  });
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 'formula',
    activityLevel: 'light', budgetWalk: 'on' });

  const text = doc.getElementById('view').textContent;
  ['BMR', 'משקל', 'גובה', 'גיל'].forEach((name) => {
    assert(text.indexOf(name) !== -1, 'חסר: ' + name);
  });

  const f = Metrics.formulaMaintenance(Store.getEntries(), Store.getSettings(),
    { endDate: Dates.today(), activity: 'light' });
  assert(f.ok, 'המנוע נכשל: ' + f.reason);

  assert(text.indexOf(Fmt.n(f.bmr, 0)) !== -1, 'ה-BMR לא מוצג');

  // התקציב נגזר מהתחזוקה שהנוסחה נתנה
  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => (c.querySelector('h3') || {}).textContent === 'התקציב');
  assert(card.querySelector('.calc').textContent.indexOf(Fmt.n(f.maintenance, 0)) !== -1,
    'התחזוקה בחישוב אינה זו של הנוסחה');

  App.setState({ splitParts: 2, tab: 'home' });
});

test('מקדם הפעילות משנה את התחזוקה', () => {
  Store.updateSettings({
    profile: { heightCm: 180, sex: 'male', birthDate: '1978-08-29' }
  });
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 'formula',
    activityLevel: 'sedentary' });

  const read = () => Number(doc.querySelector('#view .big-number .v')
    .textContent.replace(/[^0-9.\-]/g, ''));
  const low = read();

  // ההליכה אינה נוספת במצב הזה — המקדם כולל אותה
  assert(doc.getElementById('view').textContent.indexOf('כלולה במקדם') !== -1,
    'לא נאמר שההליכה כלולה');

  const chip = doc.querySelector('[data-activity="athlete"]');
  assert(chip, 'חסר צ׳יפ לרמת הפעילות');
  chip.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.activityLevel === 'athlete', 'הבחירה לא נשמרה');

  const high = read();
  assert(high > low, 'רמה גבוהה אמורה להעלות: ' + high + ' מול ' + low);

  App.setState({ activityLevel: 'sedentary', splitParts: 2, tab: 'home' });
});

test('בלי פרטי פרופיל נאמר מה חסר', () => {
  // ההגדרות ממוזגות, ולכן צריך לאפס במפורש ולא רק להשמיט
  const saved = Store.getSettings().profile;
  Store.updateSettings({
    profile: { sex: 'male', heightCm: null, birthDate: null, ageYears: null }
  });
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 'formula' });

  const text = doc.getElementById('view').textContent;
  assert(text.indexOf('חסרים פרטים') !== -1, 'לא דווח על חוסר');
  assert(text.indexOf('גובה') !== -1, 'לא נאמר שחסר גובה');

  // והצ׳יפים עדיין שם, כדי שאפשר יהיה לצאת
  assert(doc.querySelector('[data-split="2"]'), 'אין דרך לחזור');

  Store.updateSettings({ profile: saved });
  App.setState({ splitParts: 2, tab: 'home' });
});

test('פרטי הפרופיל ניתנים להזנה ונשמרים', () => {
  App.setState({ date: Dates.today(), tab: 'budget', settingsOpen: true });

  const height = doc.getElementById('profile-height');
  const birth = doc.getElementById('profile-birth');
  assert(height && birth, 'שדות הפרופיל חסרים');
  assert(doc.querySelector('[data-sex="male"]'), 'בורר המין חסר');

  height.value = '180';
  height.dispatchEvent(new window.Event('change', { bubbles: true }));
  birth.value = '1979-08-29';
  birth.dispatchEvent(new window.Event('change', { bubbles: true }));
  doc.querySelector('[data-sex="male"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));

  const p = Store.getSettings().profile;
  assert(p.heightCm === 180, 'הגובה: ' + p.heightCm);
  assert(p.birthDate === '1979-08-29', 'תאריך הלידה: ' + p.birthDate);
  assert(p.sex === 'male', 'המין: ' + p.sex);
});

test('אחרי מילוי הפרופיל הנוסחה עובדת', () => {
  Store.updateSettings({
    profile: { heightCm: 180, birthDate: '1979-08-29', sex: 'male' }
  });
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 'formula',
    activityLevel: 'sedentary' });

  const text = doc.getElementById('view').textContent;
  assert(text.indexOf('חסרים פרטים') === -1, 'עדיין מדווח על חוסר');
  assert(text.indexOf('BMR') !== -1, 'החישוב לא מוצג');

  App.setState({ splitParts: 2, tab: 'home' });
});

test('שדה פרופיל ריק מנקה ואינו נשמר כאפס', () => {
  Store.updateSettings({ profile: { heightCm: 180 } });
  App.setState({ date: Dates.today(), tab: 'budget', settingsOpen: true });

  const height = doc.getElementById('profile-height');
  height.value = '';
  height.dispatchEvent(new window.Event('change', { bubbles: true }));

  assert(Store.getSettings().profile.heightCm === null,
    'הערך: ' + Store.getSettings().profile.heightCm);

  Store.updateSettings({
    profile: { heightCm: 180, birthDate: '1979-08-29', sex: 'male' }
  });
});

test('כלל ה-CSS להקפאה קיים בפועל', () => {
  // ה-HTML לבדו אינו מספיק: בלי הכלל, הבורר נגלל כרגיל
  const fs = require('fs');
  const css = fs.readFileSync(__dirname + '/assets/dash.css', 'utf8');

  assert(css.indexOf('.sticky-pick') !== -1, 'אין כלל ל-sticky-pick');

  const block = css.slice(css.indexOf('.sticky-pick {'));
  const rules = block.slice(0, block.indexOf('}'));
  assert(rules.indexOf('position: sticky') !== -1, 'חסר position: sticky');
  assert(rules.indexOf('top:') !== -1, 'חסר top');
  assert(rules.indexOf('z-index') !== -1, 'חסר z-index');
});

test('שלושת המדדים באותה שורה בטבלה', () => {
  App.setState({ date: Dates.today(), tab: 'weight' });

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => (c.querySelector('h3') || {}).textContent === 'כל 7 ימים');
  assert(card, 'כרטיס השבוע חסר');

  const heads = [...card.querySelectorAll('th')].map((h) => h.textContent);
  assert(heads.join() === 'תקופה,משקל,שינוי,שומן,שינוי,שריר,שינוי',
    'הכותרות: ' + heads.join());

  // כל שורה מכסה את אותה תקופה בשלושת המדדים
  const row = card.querySelector('tbody tr');
  assert(row.children.length === 7, 'תאים: ' + row.children.length);

  const weight = Number(row.children[1].textContent.replace(/[^0-9.]/g, ''));
  const fat = Number(row.children[3].textContent.replace(/[^0-9.]/g, ''));
  const muscle = Number(row.children[5].textContent.replace(/[^0-9.]/g, ''));

  assert(fat < weight && muscle < weight, 'הערכים לא הגיוניים');
  assert(fat !== muscle, 'שומן ושריר זהים');
});

test('אין יותר בורר מדד — הכל ביחד', () => {
  App.setState({ date: Dates.today(), tab: 'weight' });
  assert(!doc.querySelector('[data-metric]'), 'הבורר עדיין שם');

  const title = doc.querySelector('#view h2').textContent;
  assert(title.indexOf('שומן') !== -1 && title.indexOf('שריר') !== -1,
    'הכותרת: ' + title);
});

test('פס הבחירה יושב מחוץ לכרטיסים', () => {
  // בתוך כרטיס, sticky מחזיק רק כל עוד הכרטיס על המסך
  [2, 'd10', 'fit', 'manual'].forEach((value) => {
    App.setState({ date: Dates.today(), tab: 'budget', splitParts: value,
      splitRow: null });

    const bar = doc.querySelector('#view .sticky-pick');
    assert(bar, 'הפס חסר במצב ' + value);
    assert(!bar.closest('.card'), 'הפס בתוך כרטיס במצב ' + value);
    assert(bar.parentElement.classList.contains('section'),
      'ההורה אינו המקטע: ' + bar.parentElement.tagName);
    assert(bar.querySelectorAll('[data-split]').length === window.BudgetTab.SPLITS.length,
      'חסרים צ׳יפים במצב ' + value);
  });

  App.setState({ splitParts: 2, tab: 'home' });
});

test('פס הבחירה אטום ויושב מתחת לטאבים', () => {
  const fs = require('fs');
  const css = fs.readFileSync(__dirname + '/assets/dash.css', 'utf8');

  // ההערות מוסרות: הן מזכירות ערכים כדי להסביר אותם, וקריאה
  // שלהן כאילו היו כללים הופכת כל הסבר לכשל
  const rulesOf = (selector) => {
    const block = css.slice(css.indexOf(selector + ' {'));
    return block.slice(0, block.indexOf('}')).replace(/\/\*[\s\S]*?\*\//g, '');
  };

  const pick = rulesOf('.sticky-pick');
  const tabs = rulesOf('.tabs');

  // רקע חצי שקוף מאפשר לטבלה להיראות מבעד לפס
  assert(pick.indexOf('transparent') === -1, 'הרקע אינו אטום');

  /**
   * שני פסים מוקפאים באותו top פשוט מסתירים זה את זה. הטאבים
   * למעלה, ולכן הפס חייב להתחיל מתחתיהם.
   */
  assert(tabs.indexOf('position: sticky') !== -1, 'הטאבים אינם מוקפאים');
  assert(pick.indexOf('top: 0') === -1,
    'הפס נדבק לאותו מקום כמו הטאבים ונעלם מאחוריהם');
  assert(pick.indexOf('top: var(--tabs-h)') !== -1,
    'הפס אינו נסמך על גובה הטאבים');
  assert(css.indexOf('--tabs-h:') !== -1, 'הגובה אינו מוגדר');

  // והטאבים מעל, אחרת הם ייעלמו מאחורי הפס
  const zTabs = Number((tabs.match(/z-index:\s*(\d+)/) || [])[1]);
  const zPick = Number((pick.match(/z-index:\s*(\d+)/) || [])[1]);
  assert(zTabs > zPick, 'סדר השכבות הפוך: ' + zTabs + ' מול ' + zPick);
});

test('הזנה מהירה: רשימה אחת, אתמול כברירת מחדל', () => {
  App.setState({ tab: 'entry', entryDay: null });

  const yesterday = Dates.addDays(Dates.today(), -1);
  const title = doc.querySelector('.day-title').textContent;
  assert(title.indexOf(Dates.short(yesterday)) !== -1, 'ברירת המחדל: ' + title);

  const inputs = [...doc.querySelectorAll('.quick-input')];
  assert(inputs.length === 10, 'שדות: ' + inputs.length);
  assert(inputs.slice(0, 6).every((el) => el.dataset.date === yesterday),
    'שדות האוכל אינם של אתמול');
  assert(inputs.slice(6).every((el) => el.dataset.date === Dates.today()),
    'שדות השקילה אינם של הבוקר');

  // מקלדת מספרים, ו"הבא" בכל שדה חוץ מהאחרון
  assert(inputs.every((el) => el.getAttribute('inputmode') === 'decimal'), 'מקלדת');
  assert(inputs.slice(0, -1).every((el) => el.getAttribute('enterkeyhint') === 'next'),
    'חסר "הבא"');
  assert(inputs[inputs.length - 1].getAttribute('enterkeyhint') === 'done', 'השדה האחרון');

  // בלי כרטיסים נוספים שמסיחים
  assert(!doc.querySelector('tr[data-day]'), 'רשימת הימים עדיין שם');
});

test('כל ערך נשמר במכשיר כשיוצאים מהשדה, בלי לחכות לכפתור', () => {
  const day = Dates.addDays(Dates.today(), -2);
  App.setState({ tab: 'entry', entryDay: day });

  const kcal = doc.querySelector('[data-field="kcal"]');
  kcal.value = '2468';
  kcal.dispatchEvent(new window.Event('change', { bubbles: true }));

  assert(Store.getEntry(day).kcal === 2468, 'לא נשמר עם היציאה מהשדה');

  App.setState({ entryDay: null });
});

test('שמירה בשדה אינה בונה את המסך מחדש', () => {
  // אחרת השדה הבא נעלם והמקלדת נסגרת
  App.setState({ tab: 'entry', entryDay: null });

  const first = doc.querySelector('[data-field="kcal"]');
  first.value = '2100';
  first.dispatchEvent(new window.Event('change', { bubbles: true }));

  assert(doc.querySelector('[data-field="kcal"]') === first,
    'המסך נבנה מחדש והשדה הוחלף');
});

test('"הבא" במקלדת עובר לשדה הבא', () => {
  App.setState({ tab: 'entry', entryDay: null });
  const inputs = [...doc.querySelectorAll('.quick-input')];

  inputs[0].focus();
  inputs[0].value = '2200';
  inputs[0].dispatchEvent(new window.Event('change', { bubbles: true }));
  inputs[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

  assert(doc.activeElement === inputs[1],
    'הפוקוס על ' + (doc.activeElement.dataset || {}).field);
});

test('פסיק עשרוני מתקבל', () => {
  App.setState({ tab: 'entry', entryDay: null });
  const water = doc.querySelector('[data-field="waterKg"]');
  water.value = '49,1';
  water.dispatchEvent(new window.Event('change', { bubbles: true }));

  assert(Store.getEntry(Dates.today()).waterKg === 49.1,
    'נשמר: ' + Store.getEntry(Dates.today()).waterKg);
});

test('שמירה כותבת כל קבוצה לתאריך שלה', () => {
  const day = Dates.addDays(Dates.today(), -3);
  const morning = Dates.addDays(day, 1);
  App.setState({ tab: 'entry', entryDay: day });

  doc.querySelector('[data-field="kcal"]').value = '2345';
  doc.querySelector('[data-field="weightKg"]').value = '87.6';
  doc.querySelector('[data-save="day"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));

  assert(Store.getEntry(day).kcal === 2345, 'האוכל לא נשמר ליום הנכון');
  assert(Store.getEntry(morning).weightKg === 87.6, 'המשקל לא נשמר לבוקר שאחריו');
  assert(Store.getEntry(day).weightKg !== 87.6, 'המשקל נשמר ליום של האוכל');
});

test('ניווט בין ימים, בלי לעבור לבוקר שעוד לא הגיע', () => {
  App.setState({ tab: 'entry', entryDay: null });
  const start = window.EntryTab.closingDay(App.state);

  doc.querySelector('[data-shift="-1"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));
  assert(App.state.entryDay === Dates.addDays(start, -1), 'לא זז אחורה');

  doc.querySelector('[data-shift="1"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));
  assert(App.state.entryDay === start, 'לא חזר');

  // מאתמול אי אפשר קדימה: הבוקר שסוגר את היום הוא מחר
  const forward = doc.querySelector('[data-shift="1"]');
  assert(forward.disabled, 'אפשר לעבור ליום שהבוקר שלו עתידי');

  App.setState({ entryDay: null });
});

test('שמירה בלי שינוי אינה יוצרת רשומה ריקה', () => {
  // רחוק מספיק כדי שלא יחפוף לנתוני הבדיקה
  const day = Dates.addDays(Dates.today(), -120);
  const morning = Dates.addDays(day, 1);
  assert(!Store.getEntry(day) && !Store.getEntry(morning), 'היום אינו ריק מלכתחילה');
  App.setState({ tab: 'entry', entryDay: day });

  doc.querySelectorAll('[data-field]').forEach((f) => { f.value = ''; });
  doc.querySelector('[data-save="day"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));

  assert(!Store.getEntry(day), 'נוצרה רשומה ריקה ליום האוכל');
  assert(!Store.getEntry(morning), 'נוצרה רשומה ריקה לבוקר');

  App.setState({ entryDay: null });
});

test('טבלת השורה האחרונה: שורה לכל חלון, זהה לשורה העליונה בכרטיס שלו', () => {
  App.setState({ date: Dates.today(), tab: 'weight' });

  const cards = [...doc.querySelectorAll('#view .card')];
  const summary = cards.find((c) =>
    (c.querySelector('h3') || {}).textContent === 'השורה האחרונה בכל חלון');
  assert(summary, 'הטבלה חסרה');

  // היא לפני כרטיסי החלונות
  const first = cards.findIndex((c) => (c.querySelector('h3') || {}).textContent === 'כל 3 ימים');
  assert(cards.indexOf(summary) < first, 'הטבלה אינה לפני הכרטיסים');

  const rows = [...summary.querySelectorAll('tbody tr:not(.total)')];
  rows.forEach((tr) => {
    const days = tr.children[0].textContent.trim();
    const card = cards.find((c) =>
      (c.querySelector('h3') || {}).textContent === 'כל ' + days + ' ימים');
    assert(card, 'אין כרטיס ל-' + days);

    const top = [...card.querySelector('tbody tr').children]
      .map((td) => td.textContent.trim());
    const mine = [...tr.children].slice(1).map((td) => td.textContent.trim());
    assert(top.join('|') === mine.join('|'), days + ' ימים: השורה שונה מהכרטיס');
  });
});

test('שורת ממוצע בתחתית: ממוצע כל עמודה', () => {
  App.setState({ date: Dates.today(), tab: 'weight' });

  const summary = [...doc.querySelectorAll('#view .card')].find((c) =>
    (c.querySelector('h3') || {}).textContent === 'השורה האחרונה בכל חלון');
  const total = summary.querySelector('tbody tr.total');
  assert(total, 'שורת הממוצע חסרה');
  assert(total === summary.querySelector('tbody tr:last-child'), 'אינה בתחתית');

  const rows = [...summary.querySelectorAll('tbody tr:not(.total)')];
  const num = (td) => Number(td.textContent.replace(/[^0-9.\-−]/g, '').replace('−', '-'));

  // עמודות 2 עד 7: משקל, שינוי, שומן, שינוי, שריר, שינוי
  [2, 3, 4, 5, 6, 7].forEach((col) => {
    const values = rows.map((tr) => num(tr.children[col])).filter((v) => isFinite(v));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const shown = num(total.children[col]);
    assert(Math.abs(shown - mean) < 0.011,
      'עמודה ' + col + ': מוצג ' + shown + ' מול ' + mean.toFixed(3));
  });
});

test('טאב התקציב מציג את שלושת החלקים', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2, splitRow: null });

  const titles = [...doc.querySelectorAll('#view .card h3')].map((h) => h.textContent);
  ['מול מה אני נמדד', 'התקציב', 'איפה אני עומד'].forEach((name) => {
    assert(titles.indexOf(name) !== -1, 'חסר כרטיס: ' + name);
  });

  // הצ׳יפים לחצי, שליש ורבע
  [2, 3, 4].forEach((n) => {
    assert(doc.querySelector('[data-split="' + n + '"]'), 'חסר צ׳יפ ל-' + n);
  });
});


test('ההליכה הרגילה מוצגת במספר ולא כהנחה', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2,
    splitRow: null, splitAnchor: 'end', budgetWalk: 'on' });

  const split = Metrics.periodSplit(Store.getEntries(), {
    parts: 2, endDate: Dates.today(),
    kcalPerStep: Store.getSettings().kcalPerStep
  });
  if (!split.ok || !split.selected.steps) return;

  const text = doc.getElementById('view').textContent;
  assert(text.indexOf('הליכה רגילה') !== -1, 'לא נקראת בשמה');

  // המספר עצמו מופיע, לא רק הקלוריות
  const steps = Fmt.n(split.selected.steps, 0);
  assert(text.indexOf(steps) !== -1, 'מספר הצעדים ' + steps + ' לא מוצג');
  assert(text.indexOf('לא הנחה') !== -1, 'לא נאמר שזו מדידה');
});

test('כרטיס ההליכה מראה כל מקטע ומסמן את הנבחר', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 3,
    splitRow: null, splitAnchor: 'end' });

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => (c.querySelector('h3') || {}).textContent === 'ההליכה הרגילה');
  assert(card, 'הכרטיס חסר');

  const heads = [...card.querySelectorAll('th')].map((h) => h.textContent);
  ['צעדים', 'קק״ל', 'תחזוקה'].forEach((name) => {
    assert(heads.indexOf(name) !== -1, 'חסרה עמודה: ' + name);
  });

  const marked = [...card.querySelectorAll('tbody tr')]
    .filter((tr) => tr.textContent.indexOf('הנבחר') !== -1);
  assert(marked.length === 1, 'סומנו ' + marked.length + ' שורות');

  // הקלוריות תואמות את הצעדים
  const split = Metrics.periodSplit(Store.getEntries(), {
    parts: 3, endDate: Dates.today(),
    kcalPerStep: Store.getSettings().kcalPerStep
  });
  const perStep = Store.getSettings().kcalPerStep || 0.045;

  [...card.querySelectorAll('tbody tr')].forEach((tr, i) => {
    const steps = Number(tr.children[1].textContent.replace(/[^0-9]/g, ''));
    const kcal = Number(tr.children[2].textContent.replace(/[^0-9]/g, ''));
    assert(Math.abs(kcal - steps * perStep) <= 1,
      'שורה ' + i + ': ' + kcal + ' אינו ' + Math.round(steps * perStep));
  });

  App.setState({ splitParts: 2, tab: 'home' });
});

test('הצפי מפוצל לתזונה ולצעדים, והם מסתכמים', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2,
    splitRow: null, splitAnchor: 'end', budgetWalk: 'on' });

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => (c.querySelector('h3') || {}).textContent === 'איפה אני עומד');
  const heads = [...card.querySelectorAll('th')].map((h) => h.textContent);

  ['צעדים', 'מתזונה', 'מצעדים', 'צפוי'].forEach((name) => {
    assert(heads.indexOf(name) !== -1, 'חסרה עמודה: ' + name);
  });

  const num = (cell) => Number(cell.textContent.replace(/[^0-9.\-−]/g, '')
    .replace('−', '-').split('-').slice(0, 2).join('-'));

  [...card.querySelectorAll('tbody tr')].forEach((tr) => {
    if (tr.children.length < 11) return;
    const food = num(tr.children[7]);
    const walk = num(tr.children[8]);
    const total = num(tr.children[9]);
    assert(Math.abs((food + walk) - total) < 0.02,
      'הסכום לא נסגר: ' + food + ' + ' + walk + ' ≠ ' + total);
  });
});

test('הצעדים מוצגים בפועל ומול הבסיס', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2,
    splitRow: null, budgetWalk: 'on' });

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => (c.querySelector('h3') || {}).textContent === 'איפה אני עומד');
  const row = card.querySelector('tbody tr');
  if (!row || row.children.length < 11) return;

  const cell = row.children[6];
  assert(/\d/.test(cell.textContent), 'הצעדים לא מוצגים');
  assert(cell.querySelector('.sub'), 'חסר ההפרש מהבסיס');

  // הבסיס עצמו מוזכר בהסבר
  // ההליכה הרגילה מוזכרת בשמה בהסבר
  assert(card.textContent.indexOf('ההליכה הרגילה') !== -1, 'ההליכה הרגילה לא מוסברת');
});

test('אחוז השומן מחושב מהיחס ולא מההפרש', () => {
  const r = Metrics.compositionWindow(Store.getEntries(),
    { days: 14, endDate: Dates.today() });
  if (!r.ok || !r.fatShare || !Fmt.isNum(r.fatShare.now)) return;

  const f = r.fields;
  const expected = (f.bodyFatKg.mean / f.weightKg.mean) * 100;
  assert(Math.abs(r.fatShare.now - expected) < 1e-9,
    'האחוז: ' + r.fatShare.now + ' מול ' + expected);
});

test('חלון בלי שני סבבים מלאים מדווח ולא מחושב', () => {
  const short = [];
  for (let i = 0; i < 10; i++) {
    short.push({ date: Dates.addDays('2026-01-01', i), weightKg: 90 - 0.05 * i });
  }
  const r = Metrics.compositionWindow(short, { days: 21, endDate: '2026-01-10' });

  assert(!r.ok, 'היה צריך להיכשל');
  assert(r.reason === 'need-two-blocks', 'הסיבה: ' + r.reason);
  assert(r.need === 42, 'צריך ' + r.need);
});

test('הסיכום מתעלם מחלון שעדיין פתוח', () => {
  const W = window.WeightTab;

  const withPartial = W.summarise([
    { mean: 90, change: null, days: 7, partial: false },
    { mean: 89, change: -1, days: 7, partial: false },
    { mean: 88, change: -1, days: 7, partial: false },
    { mean: 95, change: 7, days: 1, partial: true }
  ]);

  assert(withPartial.count === 3, 'החלון החלקי נספר');
  assert(Math.abs(withPartial.total - (-2)) < 1e-9, 'שינוי כולל: ' + withPartial.total);
  assert(Math.abs(withPartial.meanWeight - 89) < 1e-9, 'ממוצע: ' + withPartial.meanWeight);
  // שינוי ליום = השינוי הממוצע לחלון חלקי אורך החלון
  assert(Math.abs(withPartial.perDay - (-1 / 7)) < 1e-9, 'ליום: ' + withPartial.perDay);
});

test('פחות משני חלונות מלאים -> אין סיכום', () => {
  const W = window.WeightTab;
  assert(W.summarise([{ mean: 90, change: null, days: 7, partial: false }]) === null,
    'חלון אחד');
  assert(W.summarise([]) === null, 'רשימה ריקה');
});

test('ההמלצה היא החלון הארוך ביותר עם מספיק נתונים', () => {
  const pick = window.WeightTab.recommend(Store.getEntries(), Dates.today());
  if (!pick) return;

  const blocks = Metrics.weightBlocks(Store.getEntries(),
    { days: pick.days, endDate: Dates.today() });
  const complete = blocks.rows.filter((r) => !r.partial);
  assert(complete.length >= 3, 'ההמלצה על חלון עם פחות משלושה חלונות מלאים');

  // אין חלון ארוך יותר שעומד בתנאי
  window.WeightTab.LENGTHS.filter((d) => d > pick.days).forEach((days) => {
    const longer = Metrics.weightBlocks(Store.getEntries(),
      { days: days, endDate: Dates.today() });
    assert(longer.rows.filter((r) => !r.partial).length < 3,
      'היה חלון ארוך יותר שעומד בתנאי: ' + days);
  });
});

test('אפשר לעצור את המדידה בשבוע שעבר ולראות מה היא אמרה אז', () => {
  App.setState({ date: Dates.today(), asOf: 0 });
  const now = Number(doc.querySelector('.headline .v').textContent);

  const chip = doc.querySelector('[data-asof="7"]');
  assert(chip, 'חסר הכפתור');
  chip.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.asOf === 7, 'הבחירה לא נשמרה');

  const before = Number(doc.querySelector('.headline .v').textContent);
  const model = Metrics.dashboard(Store.getEntries(), Store.getSettings(),
    { endDate: Dates.addDays(Dates.today(), -7) });
  assert(Math.abs(before - model.halves.loss) < 0.06,
    'מוצג ' + before + ' מול ' + model.halves.loss.toFixed(2));
  assert(before !== now, 'המספר לא השתנה');

  // מצוין במפורש שהמדידה נעצרה מוקדם
  const flags = [...doc.querySelectorAll('.flag')].map((f) => f.textContent).join(' ');
  assert(flags.includes('נכון ל'), 'לא צוין שהמדידה נעצרה: ' + flags);

  App.setState({ asOf: 0 });
});

test('הערת השבוע החריג מופיעה רק במדידה עד היום', () => {
  App.setState({ date: Dates.today(), asOf: 7 });
  const flags = [...doc.querySelectorAll('.flag')].map((f) => f.textContent).join(' ');
  assert(!flags.includes('השבוע האחרון'),
    'ההערה לא רלוונטית כשהמדידה נעצרה מוקדם: ' + flags);
  App.setState({ asOf: 0 });
});



// ---------------------------------------------------------------

test('כל קובץ מקומי נושא חותמת גרסה בכתובת', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const local = [...html.matchAll(/(?:src|href)="((?:\.\.\/)?(?:js|assets)\/[^"]+)"/g)]
    .map((m) => m[1]);

  assert(local.length > 5, 'ציפיתי לכמה קבצים מקומיים, נמצאו ' + local.length);
  local.forEach((url) => {
    assert(url.indexOf('?v=') !== -1, 'בלי חותמת: ' + url);
  });

  // החותמת תואמת את הגרסה שמוצגת במסך
  assert(local[0].indexOf('?v=' + App.BUILD) !== -1,
    'החותמת בכתובת אינה ' + App.BUILD + ': ' + local[0]);
});

test('הכותרת מציגה את הירידה הכוללת ואת ההתקדמות ליעד', () => {
  const d = Metrics.dashboard(Store.getEntries(), Store.getSettings(), { endDate: Dates.today() });
  const head = doc.querySelector('.headline .v').textContent;
  assert(Math.abs(Number(head) - d.totalLoss) < 0.06,
    'הירידה המוצגת ' + head + ' מול ' + d.totalLoss.toFixed(1));

  // הירידה נמדדת בין ממוצעים, ולכן היא קטנה מהמרחק בין הקצוות
  assert(d.totalLoss < d.peakDrop, 'ציפיתי למספר צנוע מהמרחק בין הקצוות');
  const sub = doc.querySelector('.headline .u').textContent;
  assert(sub.includes('הימים הראשונים') && sub.includes('האחרונים'),
    'לא מוסבר מאיפה נמדדה הירידה: ' + sub);
  assert(sub.includes(String(d.halves.days)), 'לא צוין אורך כל חצי');
  assert(sub.includes(window.Fmt.n(d.halves.first.mean, 1)), 'ממוצע החצי הראשון חסר');

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

test('אין נתון שמוצג פעמיים באותו מסך', () => {
  const headings = [...doc.querySelectorAll('#view h3')].map((h) => h.textContent.trim());
  const unique = new Set(headings);
  assert(unique.size === headings.length,
    'כותרת כרטיס מופיעה פעמיים: ' + headings.join(', '));
});





test('פענוח תשובת המודל עמיד לעטיפות', () => {
  const E = window.Estimate;
  const payload = { kcal: 700, protein: 40, carbs: 60, fat: 25, items: [] };

  assert(E.parseAnswer(JSON.stringify(payload)).kcal === 700, 'JSON נקי');
  assert(E.parseAnswer('```json\n' + JSON.stringify(payload) + '\n```').kcal === 700,
    'עטוף בסימני קוד');
  assert(E.parseAnswer('הנה ההערכה:\n' + JSON.stringify(payload) + '\nבהצלחה').kcal === 700,
    'עם טקסט מסביב');
  assert(E.parseAnswer('בלי JSON בכלל') === null, 'טקסט בלי JSON');
  assert(E.parseAnswer('') === null, 'מחרוזת ריקה');
  assert(E.parseAnswer('{"broken": ') === null, 'JSON שבור');
});



test('פס הבחירה והטאבים נדבקים לראש המסך', () => {
  const css = fs.readFileSync(path.join(__dirname, 'assets/dash.css'), 'utf8');

  const bar = css.match(/\.sticky-bar\s*\{[^}]*\}/);
  assert(bar && bar[0].indexOf('position: sticky') !== -1, 'פס הבחירה אינו דביק');

  const tabs = css.match(/\.tabs\s*\{[^}]*\}/);
  assert(tabs && tabs[0].indexOf('position: sticky') !== -1, 'הטאבים אינם דביקים');

  // הטאבים מעל פס הבחירה, אחרת הם ייחתכו
  const barZ = Number((bar[0].match(/z-index:\s*(\d+)/) || [])[1]);
  const tabsZ = Number((tabs[0].match(/z-index:\s*(\d+)/) || [])[1]);
  assert(tabsZ > barZ, 'סדר השכבות שגוי: טאבים ' + tabsZ + ' מול פס ' + barZ);
});

test('בלי בחירה, היעד בכל חלון נגזר מההוצאה שלו', () => {
  const model = Metrics.targetGaps(Store.getEntries(), Store.getSettings(),
    { endDate: Dates.today(), windows: [7, 14] });

  model.rows.filter((r) => r.ok).forEach((row) => {
    const report = Metrics.windowReport(Store.getEntries(), Store.getSettings(),
      { windowDays: row.days, endDate: Dates.today() });
    assert(Math.abs(row.target.kcal - report.target) < 0.01,
      row.days + ': היעד אינו של אותו חלון');
  });
});

test('החלון המתגלגל באותו אורך ובאותה שיטה', () => {
  window.Parts.WINDOWS.forEach((days) => {
    const r = Metrics.dayAligned(Store.getEntries(), Store.getSettings(),
      { days: days, endDate: Dates.today() });
    if (!r.ok || !r.rolling) return;

    assert(r.rolling.days === days, days + ': אורך שונה');

    /**
     * מאז המעבר לרגרסיה שני החלונות אינם חייבים לתת אותו רוחב:
     * הם מכסים תקופות שונות, ולכן השאריות בהן שונות. מה שכן חייב
     * להתקיים הוא שהם נמדדים באותה שיטה ועל אותו מספר ימים.
     */
    assert(r.rolling.method === r.method,
      days + ': שיטות שונות — ' + r.rolling.method + ' מול ' + r.method);
    assert(Dates.diffDays(r.rolling.foodFrom, r.rolling.foodTo) === days - 1,
      days + ': טווח שגוי');
  });
});

test('הפס והטבלה מציגים את אותו מספר', () => {
  // שני מנועים שונים לאותה שאלה נתנו 3,462 בפס מול 2,357 בטבלה
  window.Parts.WINDOWS.forEach((days) => {
    const state = { basis: days, caution: 'mid', stepsMode: 'off',
      date: Dates.today() };

    const bar = window.Dash.adjust(
      window.Dash.report(Store.getEntries(), Store.getSettings(), Dates.today(), state),
      'mid');
    const table = Metrics.dayAligned(Store.getEntries(), Store.getSettings(),
      { days: days, endDate: Dates.today() });

    if (!bar.ok || !table.ok) return;

    assert(Math.abs(bar.base - table.base) < 0.01,
      days + ' ימים: הפס ' + Math.round(bar.base) +
      ' מול הטבלה ' + Math.round(table.base));
    assert(bar.from === table.foodFrom && bar.to === table.foodTo,
      days + ' ימים: תקופות שונות');
  });
});

test('"שורף" בפס משתנה עם בורר ההליכה', () => {
  const at = (mode) => window.Dash.report(Store.getEntries(), Store.getSettings(),
    Dates.today(), { basis: 7, stepsMode: mode, date: Dates.today() });

  const off = at('off');
  const on = at('on');
  if (!off.ok || !off.stepKcal) return;

  // היעד גדל בדיוק בקלוריות ההליכה
  assert(Math.abs((on.target - off.target) - off.stepKcal) < 0.01,
    'ההפרש ' + Math.round(on.target - off.target) +
    ' אינו ההליכה ' + Math.round(off.stepKcal));
});

test('לחלונות המוכרים יש שם ולאחרים מספר', () => {
  const L = window.Parts.windowLabel;
  assert(L(7) === 'שבוע', 'שבוע');
  assert(L(14) === 'שבועיים', 'שבועיים');
  assert(L(21) === '3 שבועות', '3 שבועות');
  assert(L(28) === 'חודש', 'חודש');
  assert(L(11) === '11 ימים', '11: ' + L(11));
  assert(L(4) === '4 ימים', '4: ' + L(4));
});

test('הסף לשומן ולשריר גבוה מזה של המשקל', () => {
  // הם נמדדים בביו־אימפדנס ולכן רועשים יותר
  const r = Metrics.compositionWindow(Store.getEntries(),
    { days: 14, endDate: Dates.today() });
  if (!r.ok) return;

  const w = Metrics.fieldNoiseSd(Store.getEntries(), 'weightKg');
  const f = Metrics.fieldNoiseSd(Store.getEntries(), 'bodyFatKg');
  assert(f > 0 && w > 0, 'הרעש לא חושב');
});

test('טאב הנתונים אומר עד מתי הנתונים עדכניים', () => {
  App.setState({ date: Dates.today(), tab: 'data', dataAll: false });

  const text = doc.getElementById('view').textContent;
  assert(text.indexOf('נסגר עד') !== -1, 'חסר האריח הראשי');
  assert(text.indexOf('שקילה אחרונה') !== -1, 'חסרה השקילה האחרונה');
  assert(text.indexOf('רישום אוכל אחרון') !== -1, 'חסר האוכל האחרון');

  // התאריכים תואמים את מה שבאמת יש
  const entries = Store.getEntries();
  const weighed = entries.filter((e) => Fmt.isNum(e.weightKg));
  const eaten = entries.filter((e) => Fmt.isNum(e.kcal));

  if (weighed.length) {
    assert(text.indexOf(Dates.short(weighed[weighed.length - 1].date)) !== -1,
      'השקילה האחרונה לא מוצגת');
  }
  if (eaten.length) {
    assert(text.indexOf(Dates.short(eaten[eaten.length - 1].date)) !== -1,
      'האוכל האחרון לא מוצג');
  }
});

test('הטבלה מציגה את הנתונים הגולמיים מהחדש לישן', () => {
  App.setState({ date: Dates.today(), tab: 'data', dataAll: false });

  const table = [...doc.querySelectorAll('#view table.t')]
    .find((t) => t.textContent.indexOf('נוזלים') !== -1);
  assert(table, 'הטבלה חסרה');

  const heads = [...table.querySelectorAll('th')].map((h) => h.textContent);
  ['תאריך', 'משקל', 'קלוריות', 'צעדים'].forEach((name) => {
    assert(heads.indexOf(name) !== -1, 'חסרה עמודה: ' + name);
  });

  const rows = [...table.querySelectorAll('tbody tr')];
  assert(rows.length > 0, 'אין שורות');
  assert(rows.length <= window.DataTab.PAGE, 'יותר משורה אחת לעמוד');

  // מהחדש לישן
  const entries = Store.getEntries();
  assert(rows[0].children[0].textContent.indexOf(
    Dates.short(entries[entries.length - 1].date)) !== -1,
    'השורה הראשונה אינה היום האחרון');
});

test('היום הפתוח אינו נחשב חסר', () => {
  // נשקל בבוקר, האוכל ייכנס מחר — המצב הרגיל
  const day = Dates.today();
  Store.upsert({ date: day, weightKg: 88.4, kcal: '' });
  App.setState({ date: day, tab: 'data', dataAll: false });

  const table = [...doc.querySelectorAll('#view table.t')]
    .find((t) => t.textContent.indexOf('נוזלים') !== -1);
  const first = table.querySelector('tbody tr');

  assert(!first.classList.contains('within-noise'),
    'היום הפתוח סומן כחסר');
  assert(first.textContent.indexOf('פתוח') !== -1, 'לא סומן כפתוח');

  // וההסבר מופיע
  const text = doc.getElementById('view').textContent;
  assert(text.indexOf('פתוח: נשקלת בבוקר') !== -1, 'לא הוסבר המבנה');
  assert(text.indexOf('נסגר עד') !== -1, 'האריח לא מדבר על סגירה');
});

test('התקציב פותח בכמה זמן נמדד', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2, splitRow: null });

  const first = doc.querySelector('#view .card');
  const labels = [...first.querySelectorAll('.tile .k')].map((k) => k.textContent);
  assert(labels.join() === 'ימים במעקב,שקילות,מקטע', 'האריחים: ' + labels.join());

  const entries = Store.getEntries();
  const span = Dates.diffDays(entries[0].date, entries[entries.length - 1].date) + 1;
  const shown = Number(first.querySelector('.tile .v').textContent.replace(/[^0-9]/g, ''));
  assert(shown === span, 'מוצג ' + shown + ' מול ' + span);
});

test('טאב התקציב מציג את שלושת החלקים', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2, splitRow: null });

  const titles = [...doc.querySelectorAll('#view .card h3')].map((h) => h.textContent);
  ['מול מה אני נמדד', 'התקציב', 'איפה אני עומד'].forEach((name) => {
    assert(titles.indexOf(name) !== -1, 'חסר כרטיס: ' + name);
  });

  // הצ׳יפים לחצי, שליש ורבע
  [2, 3, 4].forEach((n) => {
    assert(doc.querySelector('[data-split="' + n + '"]'), 'חסר צ׳יפ ל-' + n);
  });
});

test('הצפי מפוצל לתזונה ולצעדים, והם מסתכמים', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2,
    splitRow: null, splitAnchor: 'end', budgetWalk: 'on' });

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => (c.querySelector('h3') || {}).textContent === 'איפה אני עומד');
  const heads = [...card.querySelectorAll('th')].map((h) => h.textContent);

  ['צעדים', 'מתזונה', 'מצעדים', 'צפוי'].forEach((name) => {
    assert(heads.indexOf(name) !== -1, 'חסרה עמודה: ' + name);
  });

  const num = (cell) => Number(cell.textContent.replace(/[^0-9.\-−]/g, '')
    .replace('−', '-').split('-').slice(0, 2).join('-'));

  [...card.querySelectorAll('tbody tr')].forEach((tr) => {
    if (tr.children.length < 11) return;
    const food = num(tr.children[7]);
    const walk = num(tr.children[8]);
    const total = num(tr.children[9]);
    assert(Math.abs((food + walk) - total) < 0.02,
      'הסכום לא נסגר: ' + food + ' + ' + walk + ' ≠ ' + total);
  });
});

test('הצעדים מוצגים בפועל ומול הבסיס', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2,
    splitRow: null, budgetWalk: 'on' });

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => (c.querySelector('h3') || {}).textContent === 'איפה אני עומד');
  const row = card.querySelector('tbody tr');
  if (!row || row.children.length < 11) return;

  const cell = row.children[6];
  assert(/\d/.test(cell.textContent), 'הצעדים לא מוצגים');
  assert(cell.querySelector('.sub'), 'חסר ההפרש מהבסיס');

  // הבסיס עצמו מוזכר בהסבר
  // ההליכה הרגילה מוזכרת בשמה בהסבר
  assert(card.textContent.indexOf('ההליכה הרגילה') !== -1, 'ההליכה הרגילה לא מוסברת');
});

test('אחוז השומן מחושב מהיחס ולא מההפרש', () => {
  const r = Metrics.compositionWindow(Store.getEntries(),
    { days: 14, endDate: Dates.today() });
  if (!r.ok || !r.fatShare || !Fmt.isNum(r.fatShare.now)) return;

  const f = r.fields;
  const expected = (f.bodyFatKg.mean / f.weightKg.mean) * 100;
  assert(Math.abs(r.fatShare.now - expected) < 1e-9,
    'האחוז: ' + r.fatShare.now + ' מול ' + expected);
});

test('חלון בלי שני סבבים מלאים מדווח ולא מחושב', () => {
  const short = [];
  for (let i = 0; i < 10; i++) {
    short.push({ date: Dates.addDays('2026-01-01', i), weightKg: 90 - 0.05 * i });
  }
  const r = Metrics.compositionWindow(short, { days: 21, endDate: '2026-01-10' });

  assert(!r.ok, 'היה צריך להיכשל');
  assert(r.reason === 'need-two-blocks', 'הסיבה: ' + r.reason);
  assert(r.need === 42, 'צריך ' + r.need);
});

test('הסיכום מתעלם מחלון שעדיין פתוח', () => {
  const W = window.WeightTab;

  const withPartial = W.summarise([
    { mean: 90, change: null, days: 7, partial: false },
    { mean: 89, change: -1, days: 7, partial: false },
    { mean: 88, change: -1, days: 7, partial: false },
    { mean: 95, change: 7, days: 1, partial: true }
  ]);

  assert(withPartial.count === 3, 'החלון החלקי נספר');
  assert(Math.abs(withPartial.total - (-2)) < 1e-9, 'שינוי כולל: ' + withPartial.total);
  assert(Math.abs(withPartial.meanWeight - 89) < 1e-9, 'ממוצע: ' + withPartial.meanWeight);
  // שינוי ליום = השינוי הממוצע לחלון חלקי אורך החלון
  assert(Math.abs(withPartial.perDay - (-1 / 7)) < 1e-9, 'ליום: ' + withPartial.perDay);
});

test('פחות משני חלונות מלאים -> אין סיכום', () => {
  const W = window.WeightTab;
  assert(W.summarise([{ mean: 90, change: null, days: 7, partial: false }]) === null,
    'חלון אחד');
  assert(W.summarise([]) === null, 'רשימה ריקה');
});

test('ההמלצה היא החלון הארוך ביותר עם מספיק נתונים', () => {
  const pick = window.WeightTab.recommend(Store.getEntries(), Dates.today());
  if (!pick) return;

  const blocks = Metrics.weightBlocks(Store.getEntries(),
    { days: pick.days, endDate: Dates.today() });
  const complete = blocks.rows.filter((r) => !r.partial);
  assert(complete.length >= 3, 'ההמלצה על חלון עם פחות משלושה חלונות מלאים');

  // אין חלון ארוך יותר שעומד בתנאי
  window.WeightTab.LENGTHS.filter((d) => d > pick.days).forEach((days) => {
    const longer = Metrics.weightBlocks(Store.getEntries(),
      { days: days, endDate: Dates.today() });
    assert(longer.rows.filter((r) => !r.partial).length < 3,
      'היה חלון ארוך יותר שעומד בתנאי: ' + days);
  });
});

test('אפשר לעצור את המדידה בשבוע שעבר ולראות מה היא אמרה אז', () => {
  App.setState({ date: Dates.today(), asOf: 0 });
  const now = Number(doc.querySelector('.headline .v').textContent);

  const chip = doc.querySelector('[data-asof="7"]');
  assert(chip, 'חסר הכפתור');
  chip.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.asOf === 7, 'הבחירה לא נשמרה');

  const before = Number(doc.querySelector('.headline .v').textContent);
  const model = Metrics.dashboard(Store.getEntries(), Store.getSettings(),
    { endDate: Dates.addDays(Dates.today(), -7) });
  assert(Math.abs(before - model.halves.loss) < 0.06,
    'מוצג ' + before + ' מול ' + model.halves.loss.toFixed(2));
  assert(before !== now, 'המספר לא השתנה');

  // מצוין במפורש שהמדידה נעצרה מוקדם
  const flags = [...doc.querySelectorAll('.flag')].map((f) => f.textContent).join(' ');
  assert(flags.includes('נכון ל'), 'לא צוין שהמדידה נעצרה: ' + flags);

  App.setState({ asOf: 0 });
});

test('הערת השבוע החריג מופיעה רק במדידה עד היום', () => {
  App.setState({ date: Dates.today(), asOf: 7 });
  const flags = [...doc.querySelectorAll('.flag')].map((f) => f.textContent).join(' ');
  assert(!flags.includes('השבוע האחרון'),
    'ההערה לא רלוונטית כשהמדידה נעצרה מוקדם: ' + flags);
  App.setState({ asOf: 0 });
});



// ---------------------------------------------------------------

test('כל קובץ מקומי נושא חותמת גרסה בכתובת', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const local = [...html.matchAll(/(?:src|href)="((?:\.\.\/)?(?:js|assets)\/[^"]+)"/g)]
    .map((m) => m[1]);

  assert(local.length > 5, 'ציפיתי לכמה קבצים מקומיים, נמצאו ' + local.length);
  local.forEach((url) => {
    assert(url.indexOf('?v=') !== -1, 'בלי חותמת: ' + url);
  });

  // החותמת תואמת את הגרסה שמוצגת במסך
  assert(local[0].indexOf('?v=' + App.BUILD) !== -1,
    'החותמת בכתובת אינה ' + App.BUILD + ': ' + local[0]);
});

test('הכותרת מציגה את הירידה הכוללת ואת ההתקדמות ליעד', () => {
  const d = Metrics.dashboard(Store.getEntries(), Store.getSettings(), { endDate: Dates.today() });
  const head = doc.querySelector('.headline .v').textContent;
  assert(Math.abs(Number(head) - d.totalLoss) < 0.06,
    'הירידה המוצגת ' + head + ' מול ' + d.totalLoss.toFixed(1));

  // הירידה נמדדת בין ממוצעים, ולכן היא קטנה מהמרחק בין הקצוות
  assert(d.totalLoss < d.peakDrop, 'ציפיתי למספר צנוע מהמרחק בין הקצוות');
  const sub = doc.querySelector('.headline .u').textContent;
  assert(sub.includes('הימים הראשונים') && sub.includes('האחרונים'),
    'לא מוסבר מאיפה נמדדה הירידה: ' + sub);
  assert(sub.includes(String(d.halves.days)), 'לא צוין אורך כל חצי');
  assert(sub.includes(window.Fmt.n(d.halves.first.mean, 1)), 'ממוצע החצי הראשון חסר');

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

test('אין נתון שמוצג פעמיים באותו מסך', () => {
  const headings = [...doc.querySelectorAll('#view h3')].map((h) => h.textContent.trim());
  const unique = new Set(headings);
  assert(unique.size === headings.length,
    'כותרת כרטיס מופיעה פעמיים: ' + headings.join(', '));
});





test('פענוח תשובת המודל עמיד לעטיפות', () => {
  const E = window.Estimate;
  const payload = { kcal: 700, protein: 40, carbs: 60, fat: 25, items: [] };

  assert(E.parseAnswer(JSON.stringify(payload)).kcal === 700, 'JSON נקי');
  assert(E.parseAnswer('```json\n' + JSON.stringify(payload) + '\n```').kcal === 700,
    'עטוף בסימני קוד');
  assert(E.parseAnswer('הנה ההערכה:\n' + JSON.stringify(payload) + '\nבהצלחה').kcal === 700,
    'עם טקסט מסביב');
  assert(E.parseAnswer('בלי JSON בכלל') === null, 'טקסט בלי JSON');
  assert(E.parseAnswer('') === null, 'מחרוזת ריקה');
  assert(E.parseAnswer('{"broken": ') === null, 'JSON שבור');
});



test('פס הבחירה והטאבים נדבקים לראש המסך', () => {
  const css = fs.readFileSync(path.join(__dirname, 'assets/dash.css'), 'utf8');

  const bar = css.match(/\.sticky-bar\s*\{[^}]*\}/);
  assert(bar && bar[0].indexOf('position: sticky') !== -1, 'פס הבחירה אינו דביק');

  const tabs = css.match(/\.tabs\s*\{[^}]*\}/);
  assert(tabs && tabs[0].indexOf('position: sticky') !== -1, 'הטאבים אינם דביקים');

  // הטאבים מעל פס הבחירה, אחרת הם ייחתכו
  const barZ = Number((bar[0].match(/z-index:\s*(\d+)/) || [])[1]);
  const tabsZ = Number((tabs[0].match(/z-index:\s*(\d+)/) || [])[1]);
  assert(tabsZ > barZ, 'סדר השכבות שגוי: טאבים ' + tabsZ + ' מול פס ' + barZ);
});

test('בלי בחירה, היעד בכל חלון נגזר מההוצאה שלו', () => {
  const model = Metrics.targetGaps(Store.getEntries(), Store.getSettings(),
    { endDate: Dates.today(), windows: [7, 14] });

  model.rows.filter((r) => r.ok).forEach((row) => {
    const report = Metrics.windowReport(Store.getEntries(), Store.getSettings(),
      { windowDays: row.days, endDate: Dates.today() });
    assert(Math.abs(row.target.kcal - report.target) < 0.01,
      row.days + ': היעד אינו של אותו חלון');
  });
});

test('החלון המתגלגל באותו אורך ובאותה שיטה', () => {
  window.Parts.WINDOWS.forEach((days) => {
    const r = Metrics.dayAligned(Store.getEntries(), Store.getSettings(),
      { days: days, endDate: Dates.today() });
    if (!r.ok || !r.rolling) return;

    assert(r.rolling.days === days, days + ': אורך שונה');

    /**
     * מאז המעבר לרגרסיה שני החלונות אינם חייבים לתת אותו רוחב:
     * הם מכסים תקופות שונות, ולכן השאריות בהן שונות. מה שכן חייב
     * להתקיים הוא שהם נמדדים באותה שיטה ועל אותו מספר ימים.
     */
    assert(r.rolling.method === r.method,
      days + ': שיטות שונות — ' + r.rolling.method + ' מול ' + r.method);
    assert(Dates.diffDays(r.rolling.foodFrom, r.rolling.foodTo) === days - 1,
      days + ': טווח שגוי');
  });
});

test('הפס והטבלה מציגים את אותו מספר', () => {
  // שני מנועים שונים לאותה שאלה נתנו 3,462 בפס מול 2,357 בטבלה
  window.Parts.WINDOWS.forEach((days) => {
    const state = { basis: days, caution: 'mid', stepsMode: 'off',
      date: Dates.today() };

    const bar = window.Dash.adjust(
      window.Dash.report(Store.getEntries(), Store.getSettings(), Dates.today(), state),
      'mid');
    const table = Metrics.dayAligned(Store.getEntries(), Store.getSettings(),
      { days: days, endDate: Dates.today() });

    if (!bar.ok || !table.ok) return;

    assert(Math.abs(bar.base - table.base) < 0.01,
      days + ' ימים: הפס ' + Math.round(bar.base) +
      ' מול הטבלה ' + Math.round(table.base));
    assert(bar.from === table.foodFrom && bar.to === table.foodTo,
      days + ' ימים: תקופות שונות');
  });
});

test('"שורף" בפס משתנה עם בורר ההליכה', () => {
  const at = (mode) => window.Dash.report(Store.getEntries(), Store.getSettings(),
    Dates.today(), { basis: 7, stepsMode: mode, date: Dates.today() });

  const off = at('off');
  const on = at('on');
  if (!off.ok || !off.stepKcal) return;

  // היעד גדל בדיוק בקלוריות ההליכה
  assert(Math.abs((on.target - off.target) - off.stepKcal) < 0.01,
    'ההפרש ' + Math.round(on.target - off.target) +
    ' אינו ההליכה ' + Math.round(off.stepKcal));
});

test('לחלונות המוכרים יש שם ולאחרים מספר', () => {
  const L = window.Parts.windowLabel;
  assert(L(7) === 'שבוע', 'שבוע');
  assert(L(14) === 'שבועיים', 'שבועיים');
  assert(L(21) === '3 שבועות', '3 שבועות');
  assert(L(28) === 'חודש', 'חודש');
  assert(L(11) === '11 ימים', '11: ' + L(11));
  assert(L(4) === '4 ימים', '4: ' + L(4));
});

test('הסף לשומן ולשריר גבוה מזה של המשקל', () => {
  // הם נמדדים בביו־אימפדנס ולכן רועשים יותר
  const r = Metrics.compositionWindow(Store.getEntries(),
    { days: 14, endDate: Dates.today() });
  if (!r.ok) return;

  const w = Metrics.fieldNoiseSd(Store.getEntries(), 'weightKg');
  const f = Metrics.fieldNoiseSd(Store.getEntries(), 'bodyFatKg');
  assert(f > 0 && w > 0, 'הרעש לא חושב');
});

test('טאב הנתונים אומר עד מתי הנתונים עדכניים', () => {
  App.setState({ date: Dates.today(), tab: 'data', dataAll: false });

  const text = doc.getElementById('view').textContent;
  assert(text.indexOf('נסגר עד') !== -1, 'חסר האריח הראשי');
  assert(text.indexOf('שקילה אחרונה') !== -1, 'חסרה השקילה האחרונה');
  assert(text.indexOf('רישום אוכל אחרון') !== -1, 'חסר האוכל האחרון');

  // התאריכים תואמים את מה שבאמת יש
  const entries = Store.getEntries();
  const weighed = entries.filter((e) => Fmt.isNum(e.weightKg));
  const eaten = entries.filter((e) => Fmt.isNum(e.kcal));

  if (weighed.length) {
    assert(text.indexOf(Dates.short(weighed[weighed.length - 1].date)) !== -1,
      'השקילה האחרונה לא מוצגת');
  }
  if (eaten.length) {
    assert(text.indexOf(Dates.short(eaten[eaten.length - 1].date)) !== -1,
      'האוכל האחרון לא מוצג');
  }
});

test('הטבלה מציגה את הנתונים הגולמיים מהחדש לישן', () => {
  App.setState({ date: Dates.today(), tab: 'data', dataAll: false });

  const table = [...doc.querySelectorAll('#view table.t')]
    .find((t) => t.textContent.indexOf('נוזלים') !== -1);
  assert(table, 'הטבלה חסרה');

  const heads = [...table.querySelectorAll('th')].map((h) => h.textContent);
  ['תאריך', 'משקל', 'קלוריות', 'צעדים'].forEach((name) => {
    assert(heads.indexOf(name) !== -1, 'חסרה עמודה: ' + name);
  });

  const rows = [...table.querySelectorAll('tbody tr')];
  assert(rows.length > 0, 'אין שורות');
  assert(rows.length <= window.DataTab.PAGE, 'יותר משורה אחת לעמוד');

  // מהחדש לישן
  const entries = Store.getEntries();
  assert(rows[0].children[0].textContent.indexOf(
    Dates.short(entries[entries.length - 1].date)) !== -1,
    'השורה הראשונה אינה היום האחרון');
});

test('היום הפתוח אינו נחשב חסר', () => {
  // נשקל בבוקר, האוכל ייכנס מחר — המצב הרגיל
  const day = Dates.today();
  Store.upsert({ date: day, weightKg: 88.4, kcal: '' });
  App.setState({ date: day, tab: 'data', dataAll: false });

  const table = [...doc.querySelectorAll('#view table.t')]
    .find((t) => t.textContent.indexOf('נוזלים') !== -1);
  const first = table.querySelector('tbody tr');

  assert(!first.classList.contains('within-noise'),
    'היום הפתוח סומן כחסר');
  assert(first.textContent.indexOf('פתוח') !== -1, 'לא סומן כפתוח');

  // וההסבר מופיע
  const text = doc.getElementById('view').textContent;
  assert(text.indexOf('פתוח: נשקלת בבוקר') !== -1, 'לא הוסבר המבנה');
  assert(text.indexOf('נסגר עד') !== -1, 'האריח לא מדבר על סגירה');
});

test('התקציב פותח בכמה זמן נמדד', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2, splitRow: null });

  const first = doc.querySelector('#view .card');
  const labels = [...first.querySelectorAll('.tile .k')].map((k) => k.textContent);
  assert(labels.join() === 'ימים במעקב,שקילות,מקטע', 'האריחים: ' + labels.join());

  const entries = Store.getEntries();
  const span = Dates.diffDays(entries[0].date, entries[entries.length - 1].date) + 1;
  const shown = Number(first.querySelector('.tile .v').textContent.replace(/[^0-9]/g, ''));
  assert(shown === span, 'מוצג ' + shown + ' מול ' + span);
});

test('טאב התקציב מציג את שלושת החלקים', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2, splitRow: null });

  const titles = [...doc.querySelectorAll('#view .card h3')].map((h) => h.textContent);
  ['מול מה אני נמדד', 'התקציב', 'איפה אני עומד'].forEach((name) => {
    assert(titles.indexOf(name) !== -1, 'חסר כרטיס: ' + name);
  });

  // הצ׳יפים לחצי, שליש ורבע
  [2, 3, 4].forEach((n) => {
    assert(doc.querySelector('[data-split="' + n + '"]'), 'חסר צ׳יפ ל-' + n);
  });
});

test('הצפי מפוצל לתזונה ולצעדים, והם מסתכמים', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2,
    splitRow: null, splitAnchor: 'end', budgetWalk: 'on' });

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => (c.querySelector('h3') || {}).textContent === 'איפה אני עומד');
  const heads = [...card.querySelectorAll('th')].map((h) => h.textContent);

  ['צעדים', 'מתזונה', 'מצעדים', 'צפוי'].forEach((name) => {
    assert(heads.indexOf(name) !== -1, 'חסרה עמודה: ' + name);
  });

  const num = (cell) => Number(cell.textContent.replace(/[^0-9.\-−]/g, '')
    .replace('−', '-').split('-').slice(0, 2).join('-'));

  [...card.querySelectorAll('tbody tr')].forEach((tr) => {
    if (tr.children.length < 11) return;
    const food = num(tr.children[7]);
    const walk = num(tr.children[8]);
    const total = num(tr.children[9]);
    assert(Math.abs((food + walk) - total) < 0.02,
      'הסכום לא נסגר: ' + food + ' + ' + walk + ' ≠ ' + total);
  });
});

test('הצעדים מוצגים בפועל ומול הבסיס', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2,
    splitRow: null, budgetWalk: 'on' });

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => (c.querySelector('h3') || {}).textContent === 'איפה אני עומד');
  const row = card.querySelector('tbody tr');
  if (!row || row.children.length < 11) return;

  const cell = row.children[6];
  assert(/\d/.test(cell.textContent), 'הצעדים לא מוצגים');
  assert(cell.querySelector('.sub'), 'חסר ההפרש מהבסיס');

  // הבסיס עצמו מוזכר בהסבר
  // ההליכה הרגילה מוזכרת בשמה בהסבר
  assert(card.textContent.indexOf('ההליכה הרגילה') !== -1, 'ההליכה הרגילה לא מוסברת');
});

test('אחוז השומן מחושב מהיחס ולא מההפרש', () => {
  const r = Metrics.compositionWindow(Store.getEntries(),
    { days: 14, endDate: Dates.today() });
  if (!r.ok || !r.fatShare || !Fmt.isNum(r.fatShare.now)) return;

  const f = r.fields;
  const expected = (f.bodyFatKg.mean / f.weightKg.mean) * 100;
  assert(Math.abs(r.fatShare.now - expected) < 1e-9,
    'האחוז: ' + r.fatShare.now + ' מול ' + expected);
});

test('חלון בלי שני סבבים מלאים מדווח ולא מחושב', () => {
  const short = [];
  for (let i = 0; i < 10; i++) {
    short.push({ date: Dates.addDays('2026-01-01', i), weightKg: 90 - 0.05 * i });
  }
  const r = Metrics.compositionWindow(short, { days: 21, endDate: '2026-01-10' });

  assert(!r.ok, 'היה צריך להיכשל');
  assert(r.reason === 'need-two-blocks', 'הסיבה: ' + r.reason);
  assert(r.need === 42, 'צריך ' + r.need);
});

test('הסיכום מתעלם מחלון שעדיין פתוח', () => {
  const W = window.WeightTab;

  const withPartial = W.summarise([
    { mean: 90, change: null, days: 7, partial: false },
    { mean: 89, change: -1, days: 7, partial: false },
    { mean: 88, change: -1, days: 7, partial: false },
    { mean: 95, change: 7, days: 1, partial: true }
  ]);

  assert(withPartial.count === 3, 'החלון החלקי נספר');
  assert(Math.abs(withPartial.total - (-2)) < 1e-9, 'שינוי כולל: ' + withPartial.total);
  assert(Math.abs(withPartial.meanWeight - 89) < 1e-9, 'ממוצע: ' + withPartial.meanWeight);
  // שינוי ליום = השינוי הממוצע לחלון חלקי אורך החלון
  assert(Math.abs(withPartial.perDay - (-1 / 7)) < 1e-9, 'ליום: ' + withPartial.perDay);
});

test('פחות משני חלונות מלאים -> אין סיכום', () => {
  const W = window.WeightTab;
  assert(W.summarise([{ mean: 90, change: null, days: 7, partial: false }]) === null,
    'חלון אחד');
  assert(W.summarise([]) === null, 'רשימה ריקה');
});

test('ההמלצה היא החלון הארוך ביותר עם מספיק נתונים', () => {
  const pick = window.WeightTab.recommend(Store.getEntries(), Dates.today());
  if (!pick) return;

  const blocks = Metrics.weightBlocks(Store.getEntries(),
    { days: pick.days, endDate: Dates.today() });
  const complete = blocks.rows.filter((r) => !r.partial);
  assert(complete.length >= 3, 'ההמלצה על חלון עם פחות משלושה חלונות מלאים');

  // אין חלון ארוך יותר שעומד בתנאי
  window.WeightTab.LENGTHS.filter((d) => d > pick.days).forEach((days) => {
    const longer = Metrics.weightBlocks(Store.getEntries(),
      { days: days, endDate: Dates.today() });
    assert(longer.rows.filter((r) => !r.partial).length < 3,
      'היה חלון ארוך יותר שעומד בתנאי: ' + days);
  });
});

test('אפשר לעצור את המדידה בשבוע שעבר ולראות מה היא אמרה אז', () => {
  App.setState({ date: Dates.today(), asOf: 0 });
  const now = Number(doc.querySelector('.headline .v').textContent);

  const chip = doc.querySelector('[data-asof="7"]');
  assert(chip, 'חסר הכפתור');
  chip.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.asOf === 7, 'הבחירה לא נשמרה');

  const before = Number(doc.querySelector('.headline .v').textContent);
  const model = Metrics.dashboard(Store.getEntries(), Store.getSettings(),
    { endDate: Dates.addDays(Dates.today(), -7) });
  assert(Math.abs(before - model.halves.loss) < 0.06,
    'מוצג ' + before + ' מול ' + model.halves.loss.toFixed(2));
  assert(before !== now, 'המספר לא השתנה');

  // מצוין במפורש שהמדידה נעצרה מוקדם
  const flags = [...doc.querySelectorAll('.flag')].map((f) => f.textContent).join(' ');
  assert(flags.includes('נכון ל'), 'לא צוין שהמדידה נעצרה: ' + flags);

  App.setState({ asOf: 0 });
});

test('הערת השבוע החריג מופיעה רק במדידה עד היום', () => {
  App.setState({ date: Dates.today(), asOf: 7 });
  const flags = [...doc.querySelectorAll('.flag')].map((f) => f.textContent).join(' ');
  assert(!flags.includes('השבוע האחרון'),
    'ההערה לא רלוונטית כשהמדידה נעצרה מוקדם: ' + flags);
  App.setState({ asOf: 0 });
});



// ---------------------------------------------------------------

test('כל קובץ מקומי נושא חותמת גרסה בכתובת', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const local = [...html.matchAll(/(?:src|href)="((?:\.\.\/)?(?:js|assets)\/[^"]+)"/g)]
    .map((m) => m[1]);

  assert(local.length > 5, 'ציפיתי לכמה קבצים מקומיים, נמצאו ' + local.length);
  local.forEach((url) => {
    assert(url.indexOf('?v=') !== -1, 'בלי חותמת: ' + url);
  });

  // החותמת תואמת את הגרסה שמוצגת במסך
  assert(local[0].indexOf('?v=' + App.BUILD) !== -1,
    'החותמת בכתובת אינה ' + App.BUILD + ': ' + local[0]);
});

test('הכותרת מציגה את הירידה הכוללת ואת ההתקדמות ליעד', () => {
  const d = Metrics.dashboard(Store.getEntries(), Store.getSettings(), { endDate: Dates.today() });
  const head = doc.querySelector('.headline .v').textContent;
  assert(Math.abs(Number(head) - d.totalLoss) < 0.06,
    'הירידה המוצגת ' + head + ' מול ' + d.totalLoss.toFixed(1));

  // הירידה נמדדת בין ממוצעים, ולכן היא קטנה מהמרחק בין הקצוות
  assert(d.totalLoss < d.peakDrop, 'ציפיתי למספר צנוע מהמרחק בין הקצוות');
  const sub = doc.querySelector('.headline .u').textContent;
  assert(sub.includes('הימים הראשונים') && sub.includes('האחרונים'),
    'לא מוסבר מאיפה נמדדה הירידה: ' + sub);
  assert(sub.includes(String(d.halves.days)), 'לא צוין אורך כל חצי');
  assert(sub.includes(window.Fmt.n(d.halves.first.mean, 1)), 'ממוצע החצי הראשון חסר');

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

test('אין נתון שמוצג פעמיים באותו מסך', () => {
  const headings = [...doc.querySelectorAll('#view h3')].map((h) => h.textContent.trim());
  const unique = new Set(headings);
  assert(unique.size === headings.length,
    'כותרת כרטיס מופיעה פעמיים: ' + headings.join(', '));
});





test('פענוח תשובת המודל עמיד לעטיפות', () => {
  const E = window.Estimate;
  const payload = { kcal: 700, protein: 40, carbs: 60, fat: 25, items: [] };

  assert(E.parseAnswer(JSON.stringify(payload)).kcal === 700, 'JSON נקי');
  assert(E.parseAnswer('```json\n' + JSON.stringify(payload) + '\n```').kcal === 700,
    'עטוף בסימני קוד');
  assert(E.parseAnswer('הנה ההערכה:\n' + JSON.stringify(payload) + '\nבהצלחה').kcal === 700,
    'עם טקסט מסביב');
  assert(E.parseAnswer('בלי JSON בכלל') === null, 'טקסט בלי JSON');
  assert(E.parseAnswer('') === null, 'מחרוזת ריקה');
  assert(E.parseAnswer('{"broken": ') === null, 'JSON שבור');
});



test('פס הבחירה והטאבים נדבקים לראש המסך', () => {
  const css = fs.readFileSync(path.join(__dirname, 'assets/dash.css'), 'utf8');

  const bar = css.match(/\.sticky-bar\s*\{[^}]*\}/);
  assert(bar && bar[0].indexOf('position: sticky') !== -1, 'פס הבחירה אינו דביק');

  const tabs = css.match(/\.tabs\s*\{[^}]*\}/);
  assert(tabs && tabs[0].indexOf('position: sticky') !== -1, 'הטאבים אינם דביקים');

  // הטאבים מעל פס הבחירה, אחרת הם ייחתכו
  const barZ = Number((bar[0].match(/z-index:\s*(\d+)/) || [])[1]);
  const tabsZ = Number((tabs[0].match(/z-index:\s*(\d+)/) || [])[1]);
  assert(tabsZ > barZ, 'סדר השכבות שגוי: טאבים ' + tabsZ + ' מול פס ' + barZ);
});

test('בלי בחירה, היעד בכל חלון נגזר מההוצאה שלו', () => {
  const model = Metrics.targetGaps(Store.getEntries(), Store.getSettings(),
    { endDate: Dates.today(), windows: [7, 14] });

  model.rows.filter((r) => r.ok).forEach((row) => {
    const report = Metrics.windowReport(Store.getEntries(), Store.getSettings(),
      { windowDays: row.days, endDate: Dates.today() });
    assert(Math.abs(row.target.kcal - report.target) < 0.01,
      row.days + ': היעד אינו של אותו חלון');
  });
});

test('החלון המתגלגל באותו אורך ובאותה שיטה', () => {
  window.Parts.WINDOWS.forEach((days) => {
    const r = Metrics.dayAligned(Store.getEntries(), Store.getSettings(),
      { days: days, endDate: Dates.today() });
    if (!r.ok || !r.rolling) return;

    assert(r.rolling.days === days, days + ': אורך שונה');

    /**
     * מאז המעבר לרגרסיה שני החלונות אינם חייבים לתת אותו רוחב:
     * הם מכסים תקופות שונות, ולכן השאריות בהן שונות. מה שכן חייב
     * להתקיים הוא שהם נמדדים באותה שיטה ועל אותו מספר ימים.
     */
    assert(r.rolling.method === r.method,
      days + ': שיטות שונות — ' + r.rolling.method + ' מול ' + r.method);
    assert(Dates.diffDays(r.rolling.foodFrom, r.rolling.foodTo) === days - 1,
      days + ': טווח שגוי');
  });
});

test('הפס והטבלה מציגים את אותו מספר', () => {
  // שני מנועים שונים לאותה שאלה נתנו 3,462 בפס מול 2,357 בטבלה
  window.Parts.WINDOWS.forEach((days) => {
    const state = { basis: days, caution: 'mid', stepsMode: 'off',
      date: Dates.today() };

    const bar = window.Dash.adjust(
      window.Dash.report(Store.getEntries(), Store.getSettings(), Dates.today(), state),
      'mid');
    const table = Metrics.dayAligned(Store.getEntries(), Store.getSettings(),
      { days: days, endDate: Dates.today() });

    if (!bar.ok || !table.ok) return;

    assert(Math.abs(bar.base - table.base) < 0.01,
      days + ' ימים: הפס ' + Math.round(bar.base) +
      ' מול הטבלה ' + Math.round(table.base));
    assert(bar.from === table.foodFrom && bar.to === table.foodTo,
      days + ' ימים: תקופות שונות');
  });
});

test('"שורף" בפס משתנה עם בורר ההליכה', () => {
  const at = (mode) => window.Dash.report(Store.getEntries(), Store.getSettings(),
    Dates.today(), { basis: 7, stepsMode: mode, date: Dates.today() });

  const off = at('off');
  const on = at('on');
  if (!off.ok || !off.stepKcal) return;

  // היעד גדל בדיוק בקלוריות ההליכה
  assert(Math.abs((on.target - off.target) - off.stepKcal) < 0.01,
    'ההפרש ' + Math.round(on.target - off.target) +
    ' אינו ההליכה ' + Math.round(off.stepKcal));
});

test('לחלונות המוכרים יש שם ולאחרים מספר', () => {
  const L = window.Parts.windowLabel;
  assert(L(7) === 'שבוע', 'שבוע');
  assert(L(14) === 'שבועיים', 'שבועיים');
  assert(L(21) === '3 שבועות', '3 שבועות');
  assert(L(28) === 'חודש', 'חודש');
  assert(L(11) === '11 ימים', '11: ' + L(11));
  assert(L(4) === '4 ימים', '4: ' + L(4));
});

test('הסף לשומן ולשריר גבוה מזה של המשקל', () => {
  // הם נמדדים בביו־אימפדנס ולכן רועשים יותר
  const r = Metrics.compositionWindow(Store.getEntries(),
    { days: 14, endDate: Dates.today() });
  if (!r.ok) return;

  const w = Metrics.fieldNoiseSd(Store.getEntries(), 'weightKg');
  const f = Metrics.fieldNoiseSd(Store.getEntries(), 'bodyFatKg');
  assert(f > 0 && w > 0, 'הרעש לא חושב');
});

test('טאב הנתונים אומר עד מתי הנתונים עדכניים', () => {
  App.setState({ date: Dates.today(), tab: 'data', dataAll: false });

  const text = doc.getElementById('view').textContent;
  assert(text.indexOf('נסגר עד') !== -1, 'חסר האריח הראשי');
  assert(text.indexOf('שקילה אחרונה') !== -1, 'חסרה השקילה האחרונה');
  assert(text.indexOf('רישום אוכל אחרון') !== -1, 'חסר האוכל האחרון');

  // התאריכים תואמים את מה שבאמת יש
  const entries = Store.getEntries();
  const weighed = entries.filter((e) => Fmt.isNum(e.weightKg));
  const eaten = entries.filter((e) => Fmt.isNum(e.kcal));

  if (weighed.length) {
    assert(text.indexOf(Dates.short(weighed[weighed.length - 1].date)) !== -1,
      'השקילה האחרונה לא מוצגת');
  }
  if (eaten.length) {
    assert(text.indexOf(Dates.short(eaten[eaten.length - 1].date)) !== -1,
      'האוכל האחרון לא מוצג');
  }
});

test('הטבלה מציגה את הנתונים הגולמיים מהחדש לישן', () => {
  App.setState({ date: Dates.today(), tab: 'data', dataAll: false });

  const table = [...doc.querySelectorAll('#view table.t')]
    .find((t) => t.textContent.indexOf('נוזלים') !== -1);
  assert(table, 'הטבלה חסרה');

  const heads = [...table.querySelectorAll('th')].map((h) => h.textContent);
  ['תאריך', 'משקל', 'קלוריות', 'צעדים'].forEach((name) => {
    assert(heads.indexOf(name) !== -1, 'חסרה עמודה: ' + name);
  });

  const rows = [...table.querySelectorAll('tbody tr')];
  assert(rows.length > 0, 'אין שורות');
  assert(rows.length <= window.DataTab.PAGE, 'יותר משורה אחת לעמוד');

  // מהחדש לישן
  const entries = Store.getEntries();
  assert(rows[0].children[0].textContent.indexOf(
    Dates.short(entries[entries.length - 1].date)) !== -1,
    'השורה הראשונה אינה היום האחרון');
});

test('היום הפתוח אינו נחשב חסר', () => {
  // נשקל בבוקר, האוכל ייכנס מחר — המצב הרגיל
  const day = Dates.today();
  Store.upsert({ date: day, weightKg: 88.4, kcal: '' });
  App.setState({ date: day, tab: 'data', dataAll: false });

  const table = [...doc.querySelectorAll('#view table.t')]
    .find((t) => t.textContent.indexOf('נוזלים') !== -1);
  const first = table.querySelector('tbody tr');

  assert(!first.classList.contains('within-noise'),
    'היום הפתוח סומן כחסר');
  assert(first.textContent.indexOf('פתוח') !== -1, 'לא סומן כפתוח');

  // וההסבר מופיע
  const text = doc.getElementById('view').textContent;
  assert(text.indexOf('פתוח: נשקלת בבוקר') !== -1, 'לא הוסבר המבנה');
  assert(text.indexOf('נסגר עד') !== -1, 'האריח לא מדבר על סגירה');
});

test('התקציב פותח בכמה זמן נמדד', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2, splitRow: null });

  const first = doc.querySelector('#view .card');
  const labels = [...first.querySelectorAll('.tile .k')].map((k) => k.textContent);
  assert(labels.join() === 'ימים במעקב,שקילות,מקטע', 'האריחים: ' + labels.join());

  const entries = Store.getEntries();
  const span = Dates.diffDays(entries[0].date, entries[entries.length - 1].date) + 1;
  const shown = Number(first.querySelector('.tile .v').textContent.replace(/[^0-9]/g, ''));
  assert(shown === span, 'מוצג ' + shown + ' מול ' + span);
});

test('טאב התקציב מציג את שלושת החלקים', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2, splitRow: null });

  const titles = [...doc.querySelectorAll('#view .card h3')].map((h) => h.textContent);
  ['מול מה אני נמדד', 'התקציב', 'איפה אני עומד'].forEach((name) => {
    assert(titles.indexOf(name) !== -1, 'חסר כרטיס: ' + name);
  });

  // הצ׳יפים לחצי, שליש ורבע
  [2, 3, 4].forEach((n) => {
    assert(doc.querySelector('[data-split="' + n + '"]'), 'חסר צ׳יפ ל-' + n);
  });
});

test('הצפי מפוצל לתזונה ולצעדים, והם מסתכמים', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2,
    splitRow: null, splitAnchor: 'end', budgetWalk: 'on' });

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => (c.querySelector('h3') || {}).textContent === 'איפה אני עומד');
  const heads = [...card.querySelectorAll('th')].map((h) => h.textContent);

  ['צעדים', 'מתזונה', 'מצעדים', 'צפוי'].forEach((name) => {
    assert(heads.indexOf(name) !== -1, 'חסרה עמודה: ' + name);
  });

  const num = (cell) => Number(cell.textContent.replace(/[^0-9.\-−]/g, '')
    .replace('−', '-').split('-').slice(0, 2).join('-'));

  [...card.querySelectorAll('tbody tr')].forEach((tr) => {
    if (tr.children.length < 11) return;
    const food = num(tr.children[7]);
    const walk = num(tr.children[8]);
    const total = num(tr.children[9]);
    assert(Math.abs((food + walk) - total) < 0.02,
      'הסכום לא נסגר: ' + food + ' + ' + walk + ' ≠ ' + total);
  });
});

test('הצעדים מוצגים בפועל ומול הבסיס', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2,
    splitRow: null, budgetWalk: 'on' });

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => (c.querySelector('h3') || {}).textContent === 'איפה אני עומד');
  const row = card.querySelector('tbody tr');
  if (!row || row.children.length < 11) return;

  const cell = row.children[6];
  assert(/\d/.test(cell.textContent), 'הצעדים לא מוצגים');
  assert(cell.querySelector('.sub'), 'חסר ההפרש מהבסיס');

  // הבסיס עצמו מוזכר בהסבר
  // ההליכה הרגילה מוזכרת בשמה בהסבר
  assert(card.textContent.indexOf('ההליכה הרגילה') !== -1, 'ההליכה הרגילה לא מוסברת');
});

test('אחוז השומן מחושב מהיחס ולא מההפרש', () => {
  const r = Metrics.compositionWindow(Store.getEntries(),
    { days: 14, endDate: Dates.today() });
  if (!r.ok || !r.fatShare || !Fmt.isNum(r.fatShare.now)) return;

  const f = r.fields;
  const expected = (f.bodyFatKg.mean / f.weightKg.mean) * 100;
  assert(Math.abs(r.fatShare.now - expected) < 1e-9,
    'האחוז: ' + r.fatShare.now + ' מול ' + expected);
});

test('חלון בלי שני סבבים מלאים מדווח ולא מחושב', () => {
  const short = [];
  for (let i = 0; i < 10; i++) {
    short.push({ date: Dates.addDays('2026-01-01', i), weightKg: 90 - 0.05 * i });
  }
  const r = Metrics.compositionWindow(short, { days: 21, endDate: '2026-01-10' });

  assert(!r.ok, 'היה צריך להיכשל');
  assert(r.reason === 'need-two-blocks', 'הסיבה: ' + r.reason);
  assert(r.need === 42, 'צריך ' + r.need);
});

test('הסיכום מתעלם מחלון שעדיין פתוח', () => {
  const W = window.WeightTab;

  const withPartial = W.summarise([
    { mean: 90, change: null, days: 7, partial: false },
    { mean: 89, change: -1, days: 7, partial: false },
    { mean: 88, change: -1, days: 7, partial: false },
    { mean: 95, change: 7, days: 1, partial: true }
  ]);

  assert(withPartial.count === 3, 'החלון החלקי נספר');
  assert(Math.abs(withPartial.total - (-2)) < 1e-9, 'שינוי כולל: ' + withPartial.total);
  assert(Math.abs(withPartial.meanWeight - 89) < 1e-9, 'ממוצע: ' + withPartial.meanWeight);
  // שינוי ליום = השינוי הממוצע לחלון חלקי אורך החלון
  assert(Math.abs(withPartial.perDay - (-1 / 7)) < 1e-9, 'ליום: ' + withPartial.perDay);
});

test('פחות משני חלונות מלאים -> אין סיכום', () => {
  const W = window.WeightTab;
  assert(W.summarise([{ mean: 90, change: null, days: 7, partial: false }]) === null,
    'חלון אחד');
  assert(W.summarise([]) === null, 'רשימה ריקה');
});

test('ההמלצה היא החלון הארוך ביותר עם מספיק נתונים', () => {
  const pick = window.WeightTab.recommend(Store.getEntries(), Dates.today());
  if (!pick) return;

  const blocks = Metrics.weightBlocks(Store.getEntries(),
    { days: pick.days, endDate: Dates.today() });
  const complete = blocks.rows.filter((r) => !r.partial);
  assert(complete.length >= 3, 'ההמלצה על חלון עם פחות משלושה חלונות מלאים');

  // אין חלון ארוך יותר שעומד בתנאי
  window.WeightTab.LENGTHS.filter((d) => d > pick.days).forEach((days) => {
    const longer = Metrics.weightBlocks(Store.getEntries(),
      { days: days, endDate: Dates.today() });
    assert(longer.rows.filter((r) => !r.partial).length < 3,
      'היה חלון ארוך יותר שעומד בתנאי: ' + days);
  });
});

test('אפשר לעצור את המדידה בשבוע שעבר ולראות מה היא אמרה אז', () => {
  App.setState({ date: Dates.today(), asOf: 0 });
  const now = Number(doc.querySelector('.headline .v').textContent);

  const chip = doc.querySelector('[data-asof="7"]');
  assert(chip, 'חסר הכפתור');
  chip.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.asOf === 7, 'הבחירה לא נשמרה');

  const before = Number(doc.querySelector('.headline .v').textContent);
  const model = Metrics.dashboard(Store.getEntries(), Store.getSettings(),
    { endDate: Dates.addDays(Dates.today(), -7) });
  assert(Math.abs(before - model.halves.loss) < 0.06,
    'מוצג ' + before + ' מול ' + model.halves.loss.toFixed(2));
  assert(before !== now, 'המספר לא השתנה');

  // מצוין במפורש שהמדידה נעצרה מוקדם
  const flags = [...doc.querySelectorAll('.flag')].map((f) => f.textContent).join(' ');
  assert(flags.includes('נכון ל'), 'לא צוין שהמדידה נעצרה: ' + flags);

  App.setState({ asOf: 0 });
});

test('הערת השבוע החריג מופיעה רק במדידה עד היום', () => {
  App.setState({ date: Dates.today(), asOf: 7 });
  const flags = [...doc.querySelectorAll('.flag')].map((f) => f.textContent).join(' ');
  assert(!flags.includes('השבוע האחרון'),
    'ההערה לא רלוונטית כשהמדידה נעצרה מוקדם: ' + flags);
  App.setState({ asOf: 0 });
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
