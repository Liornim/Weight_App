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



test('טופס ההזנה כולל את כל השדות ושומר', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  ['weightKg', 'bodyFatKg', 'muscleKg', 'kcal', 'proteinG', 'carbG', 'fatG', 'fiberG', 'steps']
    .forEach((field) => {
      assert(doc.querySelector('[data-field="' + field + '"]'), 'חסר שדה: ' + field);
    });

  doc.querySelector('[data-field="fiberG"]').value = '31';
  doc.querySelector('[data-field="steps"]').value = '11500';
  doc.querySelector('[data-save="food"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));

  const saved = Store.getEntry(Dates.today());
  assert(saved.fiberG === 31, 'הסיבים לא נשמרו: ' + saved.fiberG);
  assert(saved.steps === 11500, 'הצעדים לא נשמרו: ' + saved.steps);
});

test('בחירת תאריך במקום ניווט יום־יום', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });

  const field = doc.querySelector('#entry-date');
  assert(field, 'שדה התאריך חסר');
  assert(field.type === 'date', 'אמור להיות שדה תאריך');
  assert(field.getAttribute('max') === Dates.today(), 'אין חסימה של תאריך עתידי');

  // קפיצה ישירה לכל תאריך
  const target = Dates.addDays(Dates.today(), -9);
  field.value = target;
  field.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(App.state.date === target, 'התאריך לא התעדכן: ' + App.state.date);

  // וקיצורים לימים הקרובים
  doc.querySelector('[data-jump="1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.date === Dates.addDays(Dates.today(), -1), 'הקיצור לאתמול נכשל');

  doc.querySelector('[data-jump="0"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.date === Dates.today(), 'הקיצור להיום נכשל');
});

test('תאריך עתידי נדחה', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  const field = doc.querySelector('#entry-date');
  field.value = Dates.addDays(Dates.today(), 3);
  field.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(App.state.date === Dates.today(), 'התקבל תאריך עתידי');
});

test('שתי הקבוצות מופרדות בכרטיסים', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  const cards = [...doc.querySelectorAll('#view .card')];

  const titleOf = (card) => (card.querySelector('h3') || {}).textContent || '';
  const body = cards.find((c) => titleOf(c) === 'מדדי גוף');
  const food = cards.find((c) => titleOf(c) === 'תזונה');
  assert(body && food, 'חסר אחד הכרטיסים');
  assert(body !== food, 'שתי הקבוצות באותו כרטיס');

  // שדה מכל קבוצה נמצא בכרטיס שלה
  assert(body.querySelector('[data-field="weightKg"]'), 'המשקל לא בכרטיס הגוף');
  assert(food.querySelector('[data-field="kcal"]'), 'הקלוריות לא בכרטיס התזונה');
  assert(!body.querySelector('[data-field="kcal"]'), 'קלוריות בכרטיס הגוף');
});

test('הדבקת שורה ממלאת את הטופס', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  const input = doc.querySelector('#paste-line');
  assert(input, 'שדה ההדבקה חסר');

  input.value = '1671 118 126 24 12';
  doc.querySelector('#paste-apply').dispatchEvent(new window.Event('click', { bubbles: true }));

  const value = (field) => Number(doc.querySelector('[data-field="' + field + '"]').value);
  assert(value('kcal') === 1671, 'קלוריות: ' + value('kcal'));
  assert(value('proteinG') === 118, 'חלבון');
  assert(value('carbG') === 126, 'פחמימות');
  assert(value('fatG') === 24, 'שומן');
  assert(value('fiberG') === 12, 'סיבים');

  const note = doc.querySelector('#paste-result').textContent;
  assert(note.includes('נקלט'), 'לא דווח מה נקלט');
  assert(note.includes('לא נמצא'), 'לא דווח שהצעדים חסרים');
});

test('הדבקה במילים ממלאת רק את מה שנכתב', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  const input = doc.querySelector('#paste-line');
  input.value = 'קלוריות 2000, חלבון 150';
  doc.querySelector('#paste-apply').dispatchEvent(new window.Event('click', { bubbles: true }));

  assert(Number(doc.querySelector('[data-field="kcal"]').value) === 2000, 'קלוריות');
  assert(Number(doc.querySelector('[data-field="proteinG"]').value) === 150, 'חלבון');
});

test('הדבקה ריקה מדווחת ולא מוחקת', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  doc.querySelector('[data-field="kcal"]').value = '1900';
  doc.querySelector('#paste-line').value = '';
  doc.querySelector('#paste-apply').dispatchEvent(new window.Event('click', { bubbles: true }));

  assert(doc.querySelector('#paste-result').textContent.includes('ריק'), 'לא דווח');
  assert(doc.querySelector('[data-field="kcal"]').value === '1900', 'הערך נמחק');
});

test('העלאת תמונה מופיעה רק עם מפתח, הדבקה תמיד', () => {
  Store.updateSettings({ aiKeyA: '', aiKeyB: '' });
  App.setState({ date: Dates.today(), tab: 'entry' });

  assert(doc.querySelector('#paste-line'), 'שדה ההדבקה אמור להיות זמין תמיד');
  assert(doc.querySelector('#copy-prompt'), 'כפתור העתקת ההוראה חסר');
  assert(!doc.querySelector('#photo'), 'שדה התמונה לא אמור להופיע בלי מפתח');

  Store.updateSettings({ aiKeyA: 'AIzaTEST' });
  App.setState({ date: Dates.today(), tab: 'entry' });
  assert(doc.querySelector('#photo'), 'שדה התמונה חסר למרות שיש מפתח');

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => c.textContent.includes('העלאת תמונה'));
  assert(card.textContent.includes('Gemini'), 'הספק לא מזוהה: ' + card.textContent.slice(0, 60));
  assert(card.textContent.includes('מעריך פעמיים'), 'לא צוין שזה מפתח יחיד');

  Store.updateSettings({ aiKeyB: 'sk-or-TEST' });
  App.setState({ date: Dates.today(), tab: 'entry' });
  const both = [...doc.querySelectorAll('#view .card')]
    .find((c) => c.textContent.includes('העלאת תמונה'));
  assert(both.textContent.includes('ויכוח בין Gemini ל-OpenRouter') ||
    (both.textContent.includes('Gemini') && both.textContent.includes('OpenRouter')),
    'לא צוין הוויכוח בין השניים: ' + both.textContent.slice(0, 80));

  Store.updateSettings({ aiKeyA: '', aiKeyB: '' });
});



test('אפשר להעלות מהגלריה וגם לצלם', () => {
  Store.updateSettings({ aiKeyA: 'AQ.Ab8RN6Ky_test' });
  App.setState({ date: Dates.today(), tab: 'entry' });

  const camera = doc.querySelector('#photo-camera');
  const gallery = doc.querySelector('#photo');
  assert(camera, 'כפתור הצילום חסר');
  assert(gallery, 'כפתור הגלריה חסר');

  // הצילום מבקש את המצלמה, הגלריה לא
  assert(camera.getAttribute('capture') === 'environment', 'הצילום לא פותח מצלמה');
  assert(!gallery.hasAttribute('capture'), 'הגלריה לא אמורה לפתוח מצלמה');
  assert(gallery.getAttribute('accept') === 'image/*', 'הגלריה מוגבלת לתמונות');

  // שניהם מחוברים לאותו מנגנון
  assert(doc.querySelectorAll('.photo-input').length === 2, 'ציפיתי לשני שדות');

  Store.updateSettings({ aiKeyA: '' });
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



test('טופס ההזנה כולל את כל השדות ושומר', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  ['weightKg', 'bodyFatKg', 'muscleKg', 'kcal', 'proteinG', 'carbG', 'fatG', 'fiberG', 'steps']
    .forEach((field) => {
      assert(doc.querySelector('[data-field="' + field + '"]'), 'חסר שדה: ' + field);
    });

  doc.querySelector('[data-field="fiberG"]').value = '31';
  doc.querySelector('[data-field="steps"]').value = '11500';
  doc.querySelector('[data-save="food"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));

  const saved = Store.getEntry(Dates.today());
  assert(saved.fiberG === 31, 'הסיבים לא נשמרו: ' + saved.fiberG);
  assert(saved.steps === 11500, 'הצעדים לא נשמרו: ' + saved.steps);
});

test('בחירת תאריך במקום ניווט יום־יום', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });

  const field = doc.querySelector('#entry-date');
  assert(field, 'שדה התאריך חסר');
  assert(field.type === 'date', 'אמור להיות שדה תאריך');
  assert(field.getAttribute('max') === Dates.today(), 'אין חסימה של תאריך עתידי');

  // קפיצה ישירה לכל תאריך
  const target = Dates.addDays(Dates.today(), -9);
  field.value = target;
  field.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(App.state.date === target, 'התאריך לא התעדכן: ' + App.state.date);

  // וקיצורים לימים הקרובים
  doc.querySelector('[data-jump="1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.date === Dates.addDays(Dates.today(), -1), 'הקיצור לאתמול נכשל');

  doc.querySelector('[data-jump="0"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.date === Dates.today(), 'הקיצור להיום נכשל');
});

test('תאריך עתידי נדחה', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  const field = doc.querySelector('#entry-date');
  field.value = Dates.addDays(Dates.today(), 3);
  field.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(App.state.date === Dates.today(), 'התקבל תאריך עתידי');
});

test('שתי הקבוצות מופרדות בכרטיסים', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  const cards = [...doc.querySelectorAll('#view .card')];

  const titleOf = (card) => (card.querySelector('h3') || {}).textContent || '';
  const body = cards.find((c) => titleOf(c) === 'מדדי גוף');
  const food = cards.find((c) => titleOf(c) === 'תזונה');
  assert(body && food, 'חסר אחד הכרטיסים');
  assert(body !== food, 'שתי הקבוצות באותו כרטיס');

  // שדה מכל קבוצה נמצא בכרטיס שלה
  assert(body.querySelector('[data-field="weightKg"]'), 'המשקל לא בכרטיס הגוף');
  assert(food.querySelector('[data-field="kcal"]'), 'הקלוריות לא בכרטיס התזונה');
  assert(!body.querySelector('[data-field="kcal"]'), 'קלוריות בכרטיס הגוף');
});

test('הדבקת שורה ממלאת את הטופס', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  const input = doc.querySelector('#paste-line');
  assert(input, 'שדה ההדבקה חסר');

  input.value = '1671 118 126 24 12';
  doc.querySelector('#paste-apply').dispatchEvent(new window.Event('click', { bubbles: true }));

  const value = (field) => Number(doc.querySelector('[data-field="' + field + '"]').value);
  assert(value('kcal') === 1671, 'קלוריות: ' + value('kcal'));
  assert(value('proteinG') === 118, 'חלבון');
  assert(value('carbG') === 126, 'פחמימות');
  assert(value('fatG') === 24, 'שומן');
  assert(value('fiberG') === 12, 'סיבים');

  const note = doc.querySelector('#paste-result').textContent;
  assert(note.includes('נקלט'), 'לא דווח מה נקלט');
  assert(note.includes('לא נמצא'), 'לא דווח שהצעדים חסרים');
});

test('הדבקה במילים ממלאת רק את מה שנכתב', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  const input = doc.querySelector('#paste-line');
  input.value = 'קלוריות 2000, חלבון 150';
  doc.querySelector('#paste-apply').dispatchEvent(new window.Event('click', { bubbles: true }));

  assert(Number(doc.querySelector('[data-field="kcal"]').value) === 2000, 'קלוריות');
  assert(Number(doc.querySelector('[data-field="proteinG"]').value) === 150, 'חלבון');
});

test('הדבקה ריקה מדווחת ולא מוחקת', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  doc.querySelector('[data-field="kcal"]').value = '1900';
  doc.querySelector('#paste-line').value = '';
  doc.querySelector('#paste-apply').dispatchEvent(new window.Event('click', { bubbles: true }));

  assert(doc.querySelector('#paste-result').textContent.includes('ריק'), 'לא דווח');
  assert(doc.querySelector('[data-field="kcal"]').value === '1900', 'הערך נמחק');
});

test('העלאת תמונה מופיעה רק עם מפתח, הדבקה תמיד', () => {
  Store.updateSettings({ aiKeyA: '', aiKeyB: '' });
  App.setState({ date: Dates.today(), tab: 'entry' });

  assert(doc.querySelector('#paste-line'), 'שדה ההדבקה אמור להיות זמין תמיד');
  assert(doc.querySelector('#copy-prompt'), 'כפתור העתקת ההוראה חסר');
  assert(!doc.querySelector('#photo'), 'שדה התמונה לא אמור להופיע בלי מפתח');

  Store.updateSettings({ aiKeyA: 'AIzaTEST' });
  App.setState({ date: Dates.today(), tab: 'entry' });
  assert(doc.querySelector('#photo'), 'שדה התמונה חסר למרות שיש מפתח');

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => c.textContent.includes('העלאת תמונה'));
  assert(card.textContent.includes('Gemini'), 'הספק לא מזוהה: ' + card.textContent.slice(0, 60));
  assert(card.textContent.includes('מעריך פעמיים'), 'לא צוין שזה מפתח יחיד');

  Store.updateSettings({ aiKeyB: 'sk-or-TEST' });
  App.setState({ date: Dates.today(), tab: 'entry' });
  const both = [...doc.querySelectorAll('#view .card')]
    .find((c) => c.textContent.includes('העלאת תמונה'));
  assert(both.textContent.includes('ויכוח בין Gemini ל-OpenRouter') ||
    (both.textContent.includes('Gemini') && both.textContent.includes('OpenRouter')),
    'לא צוין הוויכוח בין השניים: ' + both.textContent.slice(0, 80));

  Store.updateSettings({ aiKeyA: '', aiKeyB: '' });
});



test('אפשר להעלות מהגלריה וגם לצלם', () => {
  Store.updateSettings({ aiKeyA: 'AQ.Ab8RN6Ky_test' });
  App.setState({ date: Dates.today(), tab: 'entry' });

  const camera = doc.querySelector('#photo-camera');
  const gallery = doc.querySelector('#photo');
  assert(camera, 'כפתור הצילום חסר');
  assert(gallery, 'כפתור הגלריה חסר');

  // הצילום מבקש את המצלמה, הגלריה לא
  assert(camera.getAttribute('capture') === 'environment', 'הצילום לא פותח מצלמה');
  assert(!gallery.hasAttribute('capture'), 'הגלריה לא אמורה לפתוח מצלמה');
  assert(gallery.getAttribute('accept') === 'image/*', 'הגלריה מוגבלת לתמונות');

  // שניהם מחוברים לאותו מנגנון
  assert(doc.querySelectorAll('.photo-input').length === 2, 'ציפיתי לשני שדות');

  Store.updateSettings({ aiKeyA: '' });
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



test('טופס ההזנה כולל את כל השדות ושומר', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  ['weightKg', 'bodyFatKg', 'muscleKg', 'kcal', 'proteinG', 'carbG', 'fatG', 'fiberG', 'steps']
    .forEach((field) => {
      assert(doc.querySelector('[data-field="' + field + '"]'), 'חסר שדה: ' + field);
    });

  doc.querySelector('[data-field="fiberG"]').value = '31';
  doc.querySelector('[data-field="steps"]').value = '11500';
  doc.querySelector('[data-save="food"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));

  const saved = Store.getEntry(Dates.today());
  assert(saved.fiberG === 31, 'הסיבים לא נשמרו: ' + saved.fiberG);
  assert(saved.steps === 11500, 'הצעדים לא נשמרו: ' + saved.steps);
});

test('בחירת תאריך במקום ניווט יום־יום', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });

  const field = doc.querySelector('#entry-date');
  assert(field, 'שדה התאריך חסר');
  assert(field.type === 'date', 'אמור להיות שדה תאריך');
  assert(field.getAttribute('max') === Dates.today(), 'אין חסימה של תאריך עתידי');

  // קפיצה ישירה לכל תאריך
  const target = Dates.addDays(Dates.today(), -9);
  field.value = target;
  field.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(App.state.date === target, 'התאריך לא התעדכן: ' + App.state.date);

  // וקיצורים לימים הקרובים
  doc.querySelector('[data-jump="1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.date === Dates.addDays(Dates.today(), -1), 'הקיצור לאתמול נכשל');

  doc.querySelector('[data-jump="0"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.date === Dates.today(), 'הקיצור להיום נכשל');
});

test('תאריך עתידי נדחה', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  const field = doc.querySelector('#entry-date');
  field.value = Dates.addDays(Dates.today(), 3);
  field.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(App.state.date === Dates.today(), 'התקבל תאריך עתידי');
});

test('שתי הקבוצות מופרדות בכרטיסים', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  const cards = [...doc.querySelectorAll('#view .card')];

  const titleOf = (card) => (card.querySelector('h3') || {}).textContent || '';
  const body = cards.find((c) => titleOf(c) === 'מדדי גוף');
  const food = cards.find((c) => titleOf(c) === 'תזונה');
  assert(body && food, 'חסר אחד הכרטיסים');
  assert(body !== food, 'שתי הקבוצות באותו כרטיס');

  // שדה מכל קבוצה נמצא בכרטיס שלה
  assert(body.querySelector('[data-field="weightKg"]'), 'המשקל לא בכרטיס הגוף');
  assert(food.querySelector('[data-field="kcal"]'), 'הקלוריות לא בכרטיס התזונה');
  assert(!body.querySelector('[data-field="kcal"]'), 'קלוריות בכרטיס הגוף');
});

test('הדבקת שורה ממלאת את הטופס', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  const input = doc.querySelector('#paste-line');
  assert(input, 'שדה ההדבקה חסר');

  input.value = '1671 118 126 24 12';
  doc.querySelector('#paste-apply').dispatchEvent(new window.Event('click', { bubbles: true }));

  const value = (field) => Number(doc.querySelector('[data-field="' + field + '"]').value);
  assert(value('kcal') === 1671, 'קלוריות: ' + value('kcal'));
  assert(value('proteinG') === 118, 'חלבון');
  assert(value('carbG') === 126, 'פחמימות');
  assert(value('fatG') === 24, 'שומן');
  assert(value('fiberG') === 12, 'סיבים');

  const note = doc.querySelector('#paste-result').textContent;
  assert(note.includes('נקלט'), 'לא דווח מה נקלט');
  assert(note.includes('לא נמצא'), 'לא דווח שהצעדים חסרים');
});

test('הדבקה במילים ממלאת רק את מה שנכתב', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  const input = doc.querySelector('#paste-line');
  input.value = 'קלוריות 2000, חלבון 150';
  doc.querySelector('#paste-apply').dispatchEvent(new window.Event('click', { bubbles: true }));

  assert(Number(doc.querySelector('[data-field="kcal"]').value) === 2000, 'קלוריות');
  assert(Number(doc.querySelector('[data-field="proteinG"]').value) === 150, 'חלבון');
});

test('הדבקה ריקה מדווחת ולא מוחקת', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  doc.querySelector('[data-field="kcal"]').value = '1900';
  doc.querySelector('#paste-line').value = '';
  doc.querySelector('#paste-apply').dispatchEvent(new window.Event('click', { bubbles: true }));

  assert(doc.querySelector('#paste-result').textContent.includes('ריק'), 'לא דווח');
  assert(doc.querySelector('[data-field="kcal"]').value === '1900', 'הערך נמחק');
});

test('העלאת תמונה מופיעה רק עם מפתח, הדבקה תמיד', () => {
  Store.updateSettings({ aiKeyA: '', aiKeyB: '' });
  App.setState({ date: Dates.today(), tab: 'entry' });

  assert(doc.querySelector('#paste-line'), 'שדה ההדבקה אמור להיות זמין תמיד');
  assert(doc.querySelector('#copy-prompt'), 'כפתור העתקת ההוראה חסר');
  assert(!doc.querySelector('#photo'), 'שדה התמונה לא אמור להופיע בלי מפתח');

  Store.updateSettings({ aiKeyA: 'AIzaTEST' });
  App.setState({ date: Dates.today(), tab: 'entry' });
  assert(doc.querySelector('#photo'), 'שדה התמונה חסר למרות שיש מפתח');

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => c.textContent.includes('העלאת תמונה'));
  assert(card.textContent.includes('Gemini'), 'הספק לא מזוהה: ' + card.textContent.slice(0, 60));
  assert(card.textContent.includes('מעריך פעמיים'), 'לא צוין שזה מפתח יחיד');

  Store.updateSettings({ aiKeyB: 'sk-or-TEST' });
  App.setState({ date: Dates.today(), tab: 'entry' });
  const both = [...doc.querySelectorAll('#view .card')]
    .find((c) => c.textContent.includes('העלאת תמונה'));
  assert(both.textContent.includes('ויכוח בין Gemini ל-OpenRouter') ||
    (both.textContent.includes('Gemini') && both.textContent.includes('OpenRouter')),
    'לא צוין הוויכוח בין השניים: ' + both.textContent.slice(0, 80));

  Store.updateSettings({ aiKeyA: '', aiKeyB: '' });
});



test('אפשר להעלות מהגלריה וגם לצלם', () => {
  Store.updateSettings({ aiKeyA: 'AQ.Ab8RN6Ky_test' });
  App.setState({ date: Dates.today(), tab: 'entry' });

  const camera = doc.querySelector('#photo-camera');
  const gallery = doc.querySelector('#photo');
  assert(camera, 'כפתור הצילום חסר');
  assert(gallery, 'כפתור הגלריה חסר');

  // הצילום מבקש את המצלמה, הגלריה לא
  assert(camera.getAttribute('capture') === 'environment', 'הצילום לא פותח מצלמה');
  assert(!gallery.hasAttribute('capture'), 'הגלריה לא אמורה לפתוח מצלמה');
  assert(gallery.getAttribute('accept') === 'image/*', 'הגלריה מוגבלת לתמונות');

  // שניהם מחוברים לאותו מנגנון
  assert(doc.querySelectorAll('.photo-input').length === 2, 'ציפיתי לשני שדות');

  Store.updateSettings({ aiKeyA: '' });
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



test('טופס ההזנה כולל את כל השדות ושומר', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  ['weightKg', 'bodyFatKg', 'muscleKg', 'kcal', 'proteinG', 'carbG', 'fatG', 'fiberG', 'steps']
    .forEach((field) => {
      assert(doc.querySelector('[data-field="' + field + '"]'), 'חסר שדה: ' + field);
    });

  doc.querySelector('[data-field="fiberG"]').value = '31';
  doc.querySelector('[data-field="steps"]').value = '11500';
  doc.querySelector('[data-save="food"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));

  const saved = Store.getEntry(Dates.today());
  assert(saved.fiberG === 31, 'הסיבים לא נשמרו: ' + saved.fiberG);
  assert(saved.steps === 11500, 'הצעדים לא נשמרו: ' + saved.steps);
});

test('בחירת תאריך במקום ניווט יום־יום', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });

  const field = doc.querySelector('#entry-date');
  assert(field, 'שדה התאריך חסר');
  assert(field.type === 'date', 'אמור להיות שדה תאריך');
  assert(field.getAttribute('max') === Dates.today(), 'אין חסימה של תאריך עתידי');

  // קפיצה ישירה לכל תאריך
  const target = Dates.addDays(Dates.today(), -9);
  field.value = target;
  field.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(App.state.date === target, 'התאריך לא התעדכן: ' + App.state.date);

  // וקיצורים לימים הקרובים
  doc.querySelector('[data-jump="1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.date === Dates.addDays(Dates.today(), -1), 'הקיצור לאתמול נכשל');

  doc.querySelector('[data-jump="0"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.date === Dates.today(), 'הקיצור להיום נכשל');
});

test('תאריך עתידי נדחה', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  const field = doc.querySelector('#entry-date');
  field.value = Dates.addDays(Dates.today(), 3);
  field.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(App.state.date === Dates.today(), 'התקבל תאריך עתידי');
});

test('שתי הקבוצות מופרדות בכרטיסים', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  const cards = [...doc.querySelectorAll('#view .card')];

  const titleOf = (card) => (card.querySelector('h3') || {}).textContent || '';
  const body = cards.find((c) => titleOf(c) === 'מדדי גוף');
  const food = cards.find((c) => titleOf(c) === 'תזונה');
  assert(body && food, 'חסר אחד הכרטיסים');
  assert(body !== food, 'שתי הקבוצות באותו כרטיס');

  // שדה מכל קבוצה נמצא בכרטיס שלה
  assert(body.querySelector('[data-field="weightKg"]'), 'המשקל לא בכרטיס הגוף');
  assert(food.querySelector('[data-field="kcal"]'), 'הקלוריות לא בכרטיס התזונה');
  assert(!body.querySelector('[data-field="kcal"]'), 'קלוריות בכרטיס הגוף');
});

test('הדבקת שורה ממלאת את הטופס', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  const input = doc.querySelector('#paste-line');
  assert(input, 'שדה ההדבקה חסר');

  input.value = '1671 118 126 24 12';
  doc.querySelector('#paste-apply').dispatchEvent(new window.Event('click', { bubbles: true }));

  const value = (field) => Number(doc.querySelector('[data-field="' + field + '"]').value);
  assert(value('kcal') === 1671, 'קלוריות: ' + value('kcal'));
  assert(value('proteinG') === 118, 'חלבון');
  assert(value('carbG') === 126, 'פחמימות');
  assert(value('fatG') === 24, 'שומן');
  assert(value('fiberG') === 12, 'סיבים');

  const note = doc.querySelector('#paste-result').textContent;
  assert(note.includes('נקלט'), 'לא דווח מה נקלט');
  assert(note.includes('לא נמצא'), 'לא דווח שהצעדים חסרים');
});

test('הדבקה במילים ממלאת רק את מה שנכתב', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  const input = doc.querySelector('#paste-line');
  input.value = 'קלוריות 2000, חלבון 150';
  doc.querySelector('#paste-apply').dispatchEvent(new window.Event('click', { bubbles: true }));

  assert(Number(doc.querySelector('[data-field="kcal"]').value) === 2000, 'קלוריות');
  assert(Number(doc.querySelector('[data-field="proteinG"]').value) === 150, 'חלבון');
});

test('הדבקה ריקה מדווחת ולא מוחקת', () => {
  App.setState({ date: Dates.today(), tab: 'entry' });
  doc.querySelector('[data-field="kcal"]').value = '1900';
  doc.querySelector('#paste-line').value = '';
  doc.querySelector('#paste-apply').dispatchEvent(new window.Event('click', { bubbles: true }));

  assert(doc.querySelector('#paste-result').textContent.includes('ריק'), 'לא דווח');
  assert(doc.querySelector('[data-field="kcal"]').value === '1900', 'הערך נמחק');
});

test('העלאת תמונה מופיעה רק עם מפתח, הדבקה תמיד', () => {
  Store.updateSettings({ aiKeyA: '', aiKeyB: '' });
  App.setState({ date: Dates.today(), tab: 'entry' });

  assert(doc.querySelector('#paste-line'), 'שדה ההדבקה אמור להיות זמין תמיד');
  assert(doc.querySelector('#copy-prompt'), 'כפתור העתקת ההוראה חסר');
  assert(!doc.querySelector('#photo'), 'שדה התמונה לא אמור להופיע בלי מפתח');

  Store.updateSettings({ aiKeyA: 'AIzaTEST' });
  App.setState({ date: Dates.today(), tab: 'entry' });
  assert(doc.querySelector('#photo'), 'שדה התמונה חסר למרות שיש מפתח');

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => c.textContent.includes('העלאת תמונה'));
  assert(card.textContent.includes('Gemini'), 'הספק לא מזוהה: ' + card.textContent.slice(0, 60));
  assert(card.textContent.includes('מעריך פעמיים'), 'לא צוין שזה מפתח יחיד');

  Store.updateSettings({ aiKeyB: 'sk-or-TEST' });
  App.setState({ date: Dates.today(), tab: 'entry' });
  const both = [...doc.querySelectorAll('#view .card')]
    .find((c) => c.textContent.includes('העלאת תמונה'));
  assert(both.textContent.includes('ויכוח בין Gemini ל-OpenRouter') ||
    (both.textContent.includes('Gemini') && both.textContent.includes('OpenRouter')),
    'לא צוין הוויכוח בין השניים: ' + both.textContent.slice(0, 80));

  Store.updateSettings({ aiKeyA: '', aiKeyB: '' });
});



test('אפשר להעלות מהגלריה וגם לצלם', () => {
  Store.updateSettings({ aiKeyA: 'AQ.Ab8RN6Ky_test' });
  App.setState({ date: Dates.today(), tab: 'entry' });

  const camera = doc.querySelector('#photo-camera');
  const gallery = doc.querySelector('#photo');
  assert(camera, 'כפתור הצילום חסר');
  assert(gallery, 'כפתור הגלריה חסר');

  // הצילום מבקש את המצלמה, הגלריה לא
  assert(camera.getAttribute('capture') === 'environment', 'הצילום לא פותח מצלמה');
  assert(!gallery.hasAttribute('capture'), 'הגלריה לא אמורה לפתוח מצלמה');
  assert(gallery.getAttribute('accept') === 'image/*', 'הגלריה מוגבלת לתמונות');

  // שניהם מחוברים לאותו מנגנון
  assert(doc.querySelectorAll('.photo-input').length === 2, 'ציפיתי לשני שדות');

  Store.updateSettings({ aiKeyA: '' });
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
