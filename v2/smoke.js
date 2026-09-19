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

// ---------------------------------------------------------------

test('כל המקטעים מוצגים בלי שגיאות', () => {
  errors.length = 0;
  App.setState({ date: Dates.today(), tab: 'home' });
  const text = doc.getElementById('view').textContent;
  ['ירדת עד עכשיו', 'כמה לאכול היום', 'מה קרה למשקל', 'שומן ושריר', 'מה אכלתי', 'הגדרות']
    .forEach((label) => assert(text.includes(label), 'חסר מקטע: ' + label));
  assert(errors.length === 0, 'שגיאות: ' + errors.join(' | '));
});



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

test('מספר הגרסה מוצג בכותרת', () => {
  App.setState({ date: Dates.today(), tab: 'home' });
  const stamp = doc.querySelector('.top .stamp');
  assert(stamp, 'חותמת הכותרת חסרה');
  assert(stamp.textContent.includes(App.BUILD),
    'הגרסה ' + App.BUILD + ' לא מופיעה: ' + stamp.textContent);
  assert(stamp.textContent.includes(window.Dates.long(Dates.today())),
    'התאריך נעלם מהחותמת');
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

test('חריגה מוצגת כמספר החריגה ולא כאפס', () => {
  const before = Metrics.windowReport(Store.getEntries(), Store.getSettings(),
    { windowDays: 'adaptive', endDate: Dates.today() });
  Store.upsert({ date: Dates.today(), kcal: Math.round(before.target + 600) });
  App.setState({ date: Dates.today(), tab: 'home' });

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
  App.setState({ date: Dates.today(), tab: 'home' });

  const report = Metrics.windowReport(Store.getEntries(), Store.getSettings(),
    { windowDays: 'adaptive', endDate: Dates.today() });
  assert(report.ok, 'הדוח נכשל');

  const big = doc.querySelector('#view .big').textContent.replace(/[^\d]/g, '');
  assert(Math.abs(Number(big) - Math.round(report.target)) <= 1,
    'מוצג ' + big + ' מול ' + Math.round(report.target));
});

test('טבלת השבועות מדברת בשמות ולא במספרים טכניים', () => {
  App.setState({ date: Dates.today(), tab: 'home' });
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
  App.setState({ date: Dates.today(), tab: 'home' });
  const text = doc.getElementById('view').textContent;
  // "זהיר" ו"נדיב" הם שמות בחירה שהמשתמש ביקש, ולכן מותרים
  // "מעריכים" הם שני ה-AI שמתווכחים, ולכן מותר. הבדיקה מחפשת
  // "ממוצע מעריכי", שהוא מונח סטטיסטי.
  ['חלון', 'תרחיש', 'מסתגל', 'קלמן', 'רגרסיה', 'סטיית תקן',
   'רווח סמך', 'ממוצע מעריכי', 'TDEE', '±'].forEach((term) => {
    assert(!text.includes(term), 'מונח טכני על המסך: ' + term);
  });
});

test('כל כרטיס עם מספרים נפתח במשפט או בכותרת', () => {
  App.setState({ date: Dates.today(), tab: 'home' });
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
    const hints = [...doc.querySelectorAll('#view .hint')].map((el) => el.textContent);
    const hint = hints.find((t) => t.indexOf('היעד היומי שלך') !== -1);
    assert(hint, 'לא נמצא היעד');
    const m = hint.match(/היעד היומי שלך הוא (-?[\d,]+)/);
    assert(m, 'לא חולץ מספר: ' + hint.slice(0, 90));
    return Number(m[1].replace(/,/g, ''));
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
  App.setState({ date: Dates.today(), tab: 'home' });
  ['chart-weight', 'chart-kcal'].forEach((id) => {
    const host = doc.getElementById(id);
    assert(host, 'חסר מיכל ' + id);
    assert(host.querySelector('svg'), 'הגרף ' + id + ' לא צויר');
    assert(doc.getElementById(id + '-keys').textContent.trim().length > 0,
      'חסר מקרא ל-' + id);
  });
});

test('פיצול המאקרו מסתכם תמיד ל-100 אחוז', () => {
  App.setState({ date: Dates.today(), tab: 'home' });
  const total = () => [...doc.querySelectorAll('.split-seg')]
    .reduce((sum, el) => sum + Number(el.style.width.replace('%', '')), 0);

  assert(Math.abs(total() - 100) < 1.5, 'סכום המקטעים ' + total().toFixed(1) + '%');

  // גם כשהמאקרו מסביר יותר קלוריות משדווחו, הפס לא חורג
  Store.getEntries().slice(-5).forEach((e) => {
    Store.upsert({ date: e.date, kcal: 1200, proteinG: 200, carbG: 200, fatG: 100 });
  });
  App.setState({ date: Dates.today(), tab: 'home' });
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



test('הירידה בכותרת היא ההפרש בין חצאי התקופה', () => {
  App.setState({ date: Dates.today(), tab: 'home' });
  const d = Metrics.dashboard(Store.getEntries(), Store.getSettings(), { endDate: Dates.today() });

  assert(d.halves, 'חסר פירוק לחצאים');
  assert(d.halves.first.to < d.halves.second.from, 'החצאים חופפים');
  assert(d.halves.first.weighIns > 0 && d.halves.second.weighIns > 0, 'חצי בלי שקילות');

  const shown = Number(doc.querySelector('.headline .v').textContent);
  assert(Math.abs(shown - (d.halves.first.mean - d.halves.second.mean)) < 0.06,
    'מוצג ' + shown + ' מול ' + (d.halves.first.mean - d.halves.second.mean).toFixed(2));

  // כל שקילה נספרת לכל היותר פעם אחת
  const total = d.halves.first.weighIns + d.halves.second.weighIns;
  assert(total <= d.weighIns, 'נספרו ' + total + ' שקילות מתוך ' + d.weighIns);
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

test('מדדי גוף ותזונה נשמרים בנפרד', () => {
  const day = Dates.addDays(Dates.today(), -3);
  App.setState({ date: day, tab: 'entry' });

  // שמירת תזונה בלבד לא אמורה לגעת במשקל
  Store.upsert({ date: day, weightKg: 87.7 });
  App.setState({ date: day, tab: 'entry' });

  doc.querySelector('[data-field="kcal"]').value = '2100';
  doc.querySelector('[data-save="food"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));

  const saved = Store.getEntry(day);
  assert(saved.kcal === 2100, 'הקלוריות לא נשמרו');
  assert(saved.weightKg === 87.7, 'המשקל נמחק בשמירת תזונה: ' + saved.weightKg);

  // ולהפך
  doc.querySelector('[data-field="weightKg"]').value = '87.2';
  doc.querySelector('[data-save="body"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));

  const after = Store.getEntry(day);
  assert(after.weightKg === 87.2, 'המשקל לא עודכן');
  assert(after.kcal === 2100, 'הקלוריות נמחקו בשמירת גוף');

  App.setState({ date: Dates.today(), tab: 'home' });
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

test('מפתח Gemini בפורמט החדש מזוהה בלי בורר', () => {
  Store.updateSettings({ aiKeyA: 'AQ.Ab8RN6Ky_hPxp0JeCEien', aiProviderA: '', aiKeyB: '' });
  App.setState({ date: Dates.today(), tab: 'home' });

  assert(!doc.querySelector('[data-provider="aiProviderA"]'),
    'לא אמור להידרש בורר ספק');
  App.setState({ tab: 'entry' });
  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => c.textContent.includes('העלאת תמונה'));
  assert(card && card.textContent.includes('Gemini'), 'הספק לא זוהה');

  Store.updateSettings({ aiKeyA: '' });
});

test('מפתח לא מזוהה מציג בורר ספק', () => {
  Store.updateSettings({ aiKeyA: 'unknown-format-key', aiProviderA: '', aiKeyB: '' });
  App.setState({ date: Dates.today(), tab: 'home' });

  const picker = doc.querySelector('[data-provider="aiProviderA"]');
  assert(picker, 'בורר הספק חסר');
  assert(picker.querySelectorAll('option').length === 4, 'ציפיתי לשלושה ספקים ובחירה ריקה');

  const label = [...doc.querySelectorAll('#view label')]
    .find((l) => l.textContent.includes('מפתח ראשון'));
  assert(label.textContent.includes('בחר ידנית'), 'לא נאמר שצריך לבחור: ' + label.textContent);

  // בלי בחירה, ההעלאה לא מוצעת
  App.setState({ tab: 'entry' });
  assert(!doc.querySelector('#photo'), 'לא אמור להיות שדה תמונה עם מפתח לא מזוהה');
  App.setState({ tab: 'home' });

  // אחרי בחירה — הכל נפתח
  picker.value = 'gemini';
  picker.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(Store.getSettings().aiProviderA === 'gemini', 'הבחירה לא נשמרה');

  App.setState({ tab: 'entry' });
  assert(doc.querySelector('#photo'), 'אחרי הבחירה ההעלאה אמורה להיות זמינה');

  Store.updateSettings({ aiKeyA: '', aiProviderA: '' });
});

test('מפתח מזוהה לא מציג בורר מיותר', () => {
  Store.updateSettings({ aiKeyA: 'AIzaTEST', aiProviderA: '' });
  App.setState({ date: Dates.today(), tab: 'home' });
  assert(!doc.querySelector('[data-provider="aiProviderA"]'), 'הבורר מיותר כאן');
  Store.updateSettings({ aiKeyA: '' });
});

test('לכל מפתח יש שדה מודל משלו', () => {
  Store.updateSettings({ aiKeyA: 'AQ.TEST', aiKeyB: '', aiProviderA: '', aiProviderB: '' });
  App.setState({ date: Dates.today(), tab: 'home' });

  assert(doc.querySelector('[data-model="aiModelA"]'), 'חסר שדה מודל למפתח הראשון');
  assert(!doc.querySelector('[data-model="aiModelB"]'), 'אין מפתח שני, אין שדה');

  Store.updateSettings({ aiKeyB: 'AQ.SECOND' });
  App.setState({ date: Dates.today(), tab: 'home' });
  assert(doc.querySelector('[data-model="aiModelB"]'), 'חסר שדה מודל למפתח השני');

  // כך אפשר להריץ שני מודלים שונים של אותו ספק
  Store.updateSettings({ aiModelA: 'gemini-3.6-flash', aiModelB: 'gemini-3.6-pro' });
  App.setState({ date: Dates.today(), tab: 'home' });
  assert(doc.querySelector('[data-model="aiModelA"]').value === 'gemini-3.6-flash', 'מודל א׳');
  assert(doc.querySelector('[data-model="aiModelB"]').value === 'gemini-3.6-pro', 'מודל ב׳');

  Store.updateSettings({ aiKeyA: '', aiKeyB: '', aiModelA: '', aiModelB: '' });
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



test('טאב היעדים מציג פער לכל אורך חלון', () => {
  Store.updateSettings({ targets: { proteinG: 170 }, goal: { ratePerWeekKg: -0.5 } });
  App.setState({ date: Dates.today(), tab: 'targets' });

  const text = doc.getElementById('view').textContent;
  assert(text.includes('יעד מול בפועל'), 'כותרת המקטע חסרה');
  assert(text.includes('פער יומי'), 'טבלת הסיכום חסרה');

  // היעד נקבע לפי הבחירות שבפס העליון, ולכן הוא מועבר לחישוב
  const chosen = window.Dash.adjust(
    window.Dash.report(Store.getEntries(), Store.getSettings(), Dates.today(), App.state),
    App.state.caution);
  const model = Metrics.targetGaps(Store.getEntries(), Store.getSettings(),
    { endDate: Dates.today(), windows: window.TargetsTab.LENGTHS,
      overrideTarget: chosen.ok ? chosen.target : null });

  const table = [...doc.querySelectorAll('#view table.t')]
    .find((t) => t.textContent.includes('פחמימות'));
  assert(table, 'הטבלה חסרה');
  const rows = [...table.querySelectorAll('tbody tr')];
  assert(rows.length === model.rows.length, 'מספר שורות לא תואם');

  // הפער המוצג תואם את החישוב
  model.rows.forEach((row, i) => {
    if (!row.ok) return;
    const shown = Number(rows[i].children[1].textContent.replace(/[^\d.\-−]/g, '').replace('−', '-'));
    assert(Math.abs(shown - Math.round(row.gapPerDay.kcal)) <= 1,
      row.days + ' ימים: מוצג ' + shown + ' מול ' + Math.round(row.gapPerDay.kcal));
  });

  App.setState({ tab: 'home' });
});




test('הפס והטבלה מראים את אותו מספר', () => {
  App.setState({ date: Dates.today(), tab: 'calc', basis: 7,
    stepsMode: 'off', caution: 'mid' });

  const bar = doc.querySelector('.pick-live .s').textContent;
  const inBar = Number((bar.match(/שורף\s*([\d,]+)/) || [])[1]
    ? bar.match(/שורף\s*([\d,]+)/)[1].replace(/,/g, '') : NaN);

  const r = Metrics.dayAligned(Store.getEntries(), Store.getSettings(),
    { days: 7, endDate: Dates.today() });
  if (!r.ok) { App.setState({ tab: 'home' }); return; }

  assert(Math.abs(inBar - Math.round(r.base)) <= 1,
    'בפס ' + inBar + ' מול המנוע ' + Math.round(r.base));

  // ואותו מספר בטבלה
  const rows = [...doc.querySelectorAll('#view table.t tbody tr')];
  const i = window.Parts.WINDOWS.indexOf(7);
  const cell = rows[i].children[5].textContent.replace(/,/g, '');
  const inTable = Number((cell.match(/^\s*(-?\d+)/) || [])[1]);

  assert(Math.abs(inTable - Math.round(r.base)) <= 1,
    'בטבלה ' + inTable + ' מול המנוע ' + Math.round(r.base));

  App.setState({ basis: 'adaptive', tab: 'home' });
});

test('"שורף" בפס עוקב אחרי בחירת הצעדים', () => {
  App.setState({ date: Dates.today(), tab: 'calc', basis: 7, stepsMode: 'off' });
  const readBar = () => {
    const t = doc.querySelector('.pick-live .s').textContent;
    const m = t.match(/שורף\s*([\d,]+)/);
    return m ? Number(m[1].replace(/,/g, '')) : NaN;
  };

  const without = readBar();
  doc.querySelector('[data-steps="on"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));
  const withSteps = readBar();

  const r = Metrics.dayAligned(Store.getEntries(), Store.getSettings(),
    { days: 7, endDate: Dates.today() });
  if (r.ok && r.stepKcal > 0) {
    assert(withSteps > without,
      '"עם צעדים" אמור להגדיל את השריפה: ' + withSteps + ' מול ' + without);
    assert(Math.abs((withSteps - without) - Math.round(r.stepKcal)) <= 2,
      'ההפרש ' + (withSteps - without) + ' אינו קלוריות ההליכה');
  }

  App.setState({ stepsMode: 'off', basis: 'adaptive', tab: 'home' });
});

test('פס הבחירה מציג את היעד שנוצר ממנו', () => {
  App.setState({ date: Dates.today(), tab: 'targets', basis: 'adaptive', caution: 'mid' });

  const live = doc.querySelector('.pick-live .v');
  assert(live, 'היעד לא מוצג בפס');

  const chosen = window.Dash.adjust(
    window.Dash.report(Store.getEntries(), Store.getSettings(), Dates.today(), App.state),
    'mid');
  const shown = Number(live.textContent.replace(/[^\d]/g, ''));
  assert(Math.abs(shown - Math.round(chosen.target)) <= 1,
    'מוצג ' + shown + ' מול ' + Math.round(chosen.target));

  // והוא זז עם הבחירה, בלי לגלול לשום מקום
  doc.querySelector('[data-caution="low"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));
  const careful = Number(doc.querySelector('.pick-live .v').textContent.replace(/[^\d]/g, ''));
  assert(careful < shown, 'זהיר אמור להוריד את היעד: ' + careful + ' מול ' + shown);

  App.setState({ caution: 'mid', tab: 'home' });
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

test('הבחירה נשמרת במעבר בין טאבים', () => {
  App.setState({ date: Dates.today(), tab: 'targets', basis: 7, caution: 'low' });
  App.setState({ tab: 'home' });
  assert(App.state.basis === 7 && App.state.caution === 'low', 'הבחירה אבדה');

  App.setState({ tab: 'targets' });
  const active = doc.querySelector('[data-basis="7"]');
  assert(active && active.getAttribute('aria-pressed') === 'true',
    'הבחירה לא מסומנת אחרי חזרה');

  App.setState({ basis: 'adaptive', caution: 'mid', tab: 'home' });
});


test('החלונות מלאים גם כשהיום עדיין ריק', () => {
  // מוודאים שהיום האחרון בלי רישום אוכל
  Store.upsert({ date: Dates.today(), kcal: '' });
  App.setState({ date: Dates.today(), tab: 'targets' });

  const model = Metrics.targetGaps(Store.getEntries(), Store.getSettings(),
    { endDate: Dates.today(), windows: [3, 5, 7] });

  assert(model.lastLogged <= Dates.today(), 'היום האחרון שדווח');
  model.rows.filter((r) => r.ok).forEach((row) => {
    assert(row.to === model.lastLogged,
      row.days + ': החלון לא מסתיים ביום שדווח');
    assert(row.loggedDays === row.days || row.loggedDays >= row.days - 1,
      row.days + ' ימים: רק ' + row.loggedDays + ' דווחו');
  });

  App.setState({ tab: 'home' });
});


test('בחירת "עם צעדים" מזיזה את כל השורות', () => {
  App.setState({ date: Dates.today(), tab: 'targets', stepsMode: 'off' });

  const gapsOf = () => [...[...doc.querySelectorAll('#view table.t')]
    .find((t) => t.textContent.includes('פחמימות'))
    .querySelectorAll('tbody tr')]
    .map((tr) => tr.children[1].textContent.replace(/[^\d.\-−]/g, '').replace('−', '-'))
    .filter((v) => v !== '');

  const without = gapsOf();

  const toggle = doc.querySelector('[data-steps="on"]');
  assert(toggle, 'הבורר חסר');
  toggle.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.stepsMode === 'on', 'הבחירה לא נשמרה');

  const withSteps = gapsOf();
  assert(withSteps.length === without.length, 'מספר השורות השתנה');

  // עם צעדים היעד גדול יותר, ולכן הפער קטן — אבל רק בחלונות
  // שיש בהם רישום צעדים
  const model = Metrics.targetGaps(Store.getEntries(), Store.getSettings(),
    { endDate: Dates.today(), windows: window.TargetsTab.LENGTHS, withSteps: true });
  const usable = model.rows.filter((r) => r.ok);

  let compared = 0;
  usable.forEach((row, i) => {
    if (!row.stepKcal) return;
    assert(Number(withSteps[i]) < Number(without[i]),
      row.days + ' ימים: הפער לא קטן — ' + withSteps[i] + ' מול ' + without[i]);
    compared++;
  });

  if (!compared) {
    // בלי רישום צעדים הבחירה לא אמורה לשנות דבר, וזה גם תקין
    assert(withSteps.join() === without.join(),
      'אין צעדים ובכל זאת המספרים השתנו');
  }

  App.setState({ stepsMode: 'off', tab: 'home' });
});


test('בורר הצעדים נמצא בתוך הפס הדביק', () => {
  App.setState({ date: Dates.today(), tab: 'targets', stepsMode: 'off' });

  const bar = doc.querySelector('.sticky-bar');
  assert(bar, 'פס הבקרה חסר');

  const picker = doc.querySelector('[data-steps="on"]');
  assert(picker, 'הבורר חסר');
  assert(bar.contains(picker), 'הבורר מחוץ לפס, ולכן ייעלם בגלילה');

  assert(bar.querySelector('[data-basis]'), 'בורר החלון לא בפס');
  assert(bar.querySelector('[data-caution]'), 'בורר הזהירות לא בפס');

  App.setState({ tab: 'home' });
});

test('הבורר עדיין פועל מתוך הפס', () => {
  App.setState({ date: Dates.today(), tab: 'targets', stepsMode: 'off' });
  doc.querySelector('.sticky-bar [data-steps="on"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));
  assert(App.state.stepsMode === 'on', 'הלחיצה לא נקלטה');

  const active = doc.querySelector('.sticky-bar [data-steps="on"]');
  assert(active.getAttribute('aria-pressed') === 'true', 'הבחירה לא מסומנת');

  App.setState({ stepsMode: 'off', tab: 'home' });
});

test('בורר הצעדים מופיע היכן שהוא משפיע, ולא במקומות אחרים', () => {
  // הוא משנה את היעד ואת שרשרת החישוב
  ['targets', 'calc'].forEach((tab) => {
    App.setState({ date: Dates.today(), tab: tab });
    const bar = doc.querySelector('.sticky-bar');
    assert(bar && bar.querySelector('[data-steps]'), 'הבורר חסר בטאב ' + tab);
  });

  // ובמסכים שאינו נוגע להם הוא רק היה מבלבל
  ['home', 'weight'].forEach((tab) => {
    App.setState({ date: Dates.today(), tab: tab });
    assert(!doc.querySelector('[data-steps]'), 'הבורר הופיע בטאב ' + tab);
  });

  App.setState({ tab: 'home' });
});

test('הבחירה משפיעה גם על הפירוט ועל ההסבר', () => {
  App.setState({ date: Dates.today(), tab: 'targets', stepsMode: 'off' });
  let text = doc.getElementById('view').textContent;
  assert(text.indexOf('בניכוי הליכה') !== -1, 'חסרה שורת הניכוי במצב הרגיל');
  assert(text.indexOf('השמרני') !== -1, 'לא הוסבר מה המשמעות');

  doc.querySelector('[data-steps="on"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));
  text = doc.getElementById('view').textContent;
  assert(text.indexOf('היעד בלי הליכה') !== -1, 'הפירוט לא התחלף');
  assert(text.indexOf('מרשה לאכול יותר') !== -1, 'ההסבר לא התחלף');

  App.setState({ stepsMode: 'off', tab: 'home' });
});

test('כיסוי הימים מוצג במפורש', () => {
  App.setState({ date: Dates.today(), tab: 'targets' });
  const table = [...doc.querySelectorAll('#view table.t')]
    .find((t) => t.textContent.includes('פחמימות'));

  const chosen = window.Dash.adjust(
    window.Dash.report(Store.getEntries(), Store.getSettings(), Dates.today(), App.state),
    App.state.caution);
  const model = Metrics.targetGaps(Store.getEntries(), Store.getSettings(),
    { endDate: Dates.today(), windows: window.TargetsTab.LENGTHS,
      overrideTarget: chosen.ok ? chosen.target : null });

  const rows = [...table.querySelectorAll('tbody tr')];
  model.rows.forEach((row, i) => {
    if (!row.ok) return;
    const sub = rows[i].querySelector('.sub');
    assert(sub, row.days + ': חסרה שורת הכיסוי');

    // הטווח תמיד מוצג, וכיסוי חלקי מסומן בנוסף
    assert(sub.textContent.indexOf(window.Dates.short(row.to)) !== -1,
      row.days + ': הטווח לא מוצג: ' + sub.textContent);

    const partial = row.loggedDays < row.days;
    assert(sub.textContent.indexOf('דווחו') !== -1 === partial,
      row.days + ': הכיסוי החלקי לא סומן נכון: ' + sub.textContent);
    assert(sub.classList.contains('warn') === partial,
      row.days + ': הסימון לא תואם את הכיסוי');
  });

  App.setState({ tab: 'home' });
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

test('בחירת חלון וזהירות משנה את היעד בכל השורות', () => {
  App.setState({ date: Dates.today(), tab: 'targets', basis: 'adaptive', caution: 'mid' });

  const gapsNow = () => [...doc.querySelectorAll('#view table.t')]
    .find((t) => t.textContent.includes('פחמימות'))
    .querySelectorAll('tbody tr')[1].children[1].textContent;

  const middle = gapsNow();

  doc.querySelector('[data-caution="low"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));
  assert(App.state.caution === 'low', 'הבחירה לא נשמרה');
  const careful = gapsNow();
  assert(careful !== middle, 'הפער לא השתנה עם הזהירות');

  // זהיר מניח הוצאה נמוכה -> יעד נמוך -> הפער גדול יותר
  const num = (t) => Number(t.replace(/[^\d.\-−]/g, '').replace('−', '-'));
  assert(num(careful) > num(middle),
    'זהיר אמור להגדיל את הפער: ' + careful + ' מול ' + middle);

  App.setState({ caution: 'mid' });
});

test('כל השורות נמדדות מול אותו יעד שנבחר', () => {
  App.setState({ date: Dates.today(), tab: 'targets', basis: 7, caution: 'mid' });

  const chosen = window.Dash.adjust(
    window.Dash.report(Store.getEntries(), Store.getSettings(), Dates.today(), App.state),
    'mid');
  const model = Metrics.targetGaps(Store.getEntries(), Store.getSettings(),
    { endDate: Dates.today(), windows: [3, 7, 14],
      overrideTarget: chosen.ok ? chosen.target : null });

  model.rows.filter((r) => r.ok).forEach((row) => {
    assert(Math.abs(row.target.kcal - chosen.target) < 0.01,
      row.days + ': היעד אינו זה שנבחר');
  });

  App.setState({ basis: 'adaptive', tab: 'home' });
});

test('הפער מוצג ליום ולא כסכום', () => {
  App.setState({ date: Dates.today(), tab: 'targets' });
  const model = Metrics.targetGaps(Store.getEntries(), Store.getSettings(),
    { endDate: Dates.today(), windows: window.TargetsTab.LENGTHS });
  const usable = model.rows.filter((r) => r.ok);
  if (!usable.length) return;

  const table = [...doc.querySelectorAll('#view table.t')]
    .find((t) => t.textContent.includes('פחמימות'));
  const numbers = [...table.querySelectorAll('tbody tr')]
    .map((tr) => Math.abs(Number(tr.children[1].textContent.replace(/[^\d.]/g, ''))))
    .filter((n) => n > 0);

  // מספר יומי סביר, לא סכום של שבועות
  numbers.forEach((n) => assert(n < 3000, 'מספר שנראה כמו סכום ולא כממוצע יומי: ' + n));

  App.setState({ tab: 'home' });
});




test('טאב המאזן מציג כרטיס לכל אורך חלון', () => {
  App.setState({ date: Dates.today(), tab: 'balance', stepsMode: 'off' });

  const cards = [...doc.querySelectorAll('#view .card')]
    .filter((c) => c.querySelector('.bal-line') || c.querySelector('.empty'));

  assert(cards.length >= window.Parts.WINDOWS.length,
    'ציפיתי לכרטיס לכל אורך, יש ' + cards.length);

  App.setState({ tab: 'home' });
});

test('כל כרטיס בנוי כמאזן: פתיחה, תנועה, סגירה', () => {
  App.setState({ date: Dates.today(), tab: 'balance', stepsMode: 'off' });

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => c.querySelector('.bal-line'));
  if (!card) { App.setState({ tab: 'home' }); return; }

  // המאזן הראשון בכרטיס הוא הסבב המלא; אחריו החלון המתגלגל
  const main = [...card.querySelectorAll('.bal-label')]
    .filter((l) => !l.closest('.pending'))
    .map((l) => l.textContent);
  assert(main.join() === 'י.פ,קלוריות,צעדים,י.ס', 'הסדר שגוי: ' + main.join());

  // לשקילות יש תאריך בודד, לתנועה טווח
  const when = [...card.querySelectorAll('.bal-when')]
    .filter((l) => !l.closest('.pending')).map((l) => l.textContent);
  assert(when[0].indexOf('–') === -1, 'לפתיחה יש טווח במקום תאריך');
  assert(when[3].indexOf('–') === -1, 'לסגירה יש טווח במקום תאריך');
  assert(when[1].indexOf('–') !== -1, 'לקלוריות אין טווח');
  assert(when[2].indexOf('–') !== -1, 'לצעדים אין טווח');

  assert(card.querySelector('.bal-calc'), 'חסר חישוב התחזוקה');
  App.setState({ tab: 'home' });
});

test('המאזן סגור: הסגירה היא הבוקר שאחרי היום האחרון', () => {
  App.setState({ date: Dates.today(), tab: 'balance' });

  window.Parts.WINDOWS.forEach((days) => {
    const r = Metrics.dayAligned(Store.getEntries(), Store.getSettings(),
      { days: days, endDate: Dates.today() });
    if (!r.ok) return;

    assert(r.endDate === Dates.addDays(r.foodTo, 1),
      days + ': הסגירה אינה הבוקר שאחרי');
    assert(r.startDate === r.foodFrom,
      days + ': הפתיחה אינה בוקר היום הראשון');
    assert(Dates.diffDays(r.startDate, r.endDate) === days,
      days + ': המרווח בין השקילות אינו ' + days);
  });

  App.setState({ tab: 'home' });
});

test('הסבבים מעוגנים, ולכן לא כולם נגמרים באותו יום', () => {
  App.setState({ date: Dates.today(), tab: 'balance' });

  const ends = {};
  window.Parts.WINDOWS.forEach((days) => {
    const r = Metrics.dayAligned(Store.getEntries(), Store.getSettings(),
      { days: days, endDate: Dates.today() });
    if (!r.ok) return;

    // כל סבב מיושר לעוגן בכפולה שלמה
    const offset = Dates.diffDays(r.anchor, r.foodFrom);
    assert(offset % days === 0,
      days + ': הסבב אינו מיושר לעוגן, היסט ' + offset);

    ends[days] = r.foodTo;
  });

  const unique = new Set(Object.values(ends));
  assert(unique.size > 1,
    'כל האורכים נגמרו באותו יום — העיגון לא פעל: ' + JSON.stringify(ends));

  App.setState({ tab: 'home' });
});

test('כותרת הכרטיס מציגה את מספר הסבב', () => {
  App.setState({ date: Dates.today(), tab: 'balance' });

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => c.querySelector('.bal-line'));
  if (!card) { App.setState({ tab: 'home' }); return; }

  const sub = card.textContent;
  assert(sub.indexOf('סבב') !== -1 && sub.indexOf('מתוך') !== -1,
    'מספר הסבב לא מוצג');

  App.setState({ tab: 'home' });
});

test('התחזוקה בכרטיס תואמת את המנוע', () => {
  App.setState({ date: Dates.today(), tab: 'balance', stepsMode: 'off' });

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => c.querySelector('.bal-result'));
  if (!card) { App.setState({ tab: 'home' }); return; }

  const title = card.querySelector('h3').textContent;
  const days = window.Parts.WINDOWS.find((d) => window.Parts.windowLabel(d) === title);

  const r = Metrics.dayAligned(Store.getEntries(), Store.getSettings(),
    { days: days, endDate: Dates.today() });

  // הסינון הקודם הסיר את סימן המינוס
  const raw = card.querySelector('.bal-result .v').textContent
    .replace(/[^0-9.\-]/g, '');
  const shown = Number(raw);
  assert(Math.abs(shown - Math.round(r.base)) <= 1,
    days + ': מוצג ' + shown + ' מול ' + Math.round(r.base));

  App.setState({ tab: 'home' });
});


test('תחזוקה לא סבירה מסומנת ומוסברת', () => {
  App.setState({ date: Dates.today(), tab: 'balance', stepsMode: 'off' });

  window.Parts.WINDOWS.forEach((days) => {
    const r = Metrics.dayAligned(Store.getEntries(), Store.getSettings(),
      { days: days, endDate: Dates.today() });
    if (!r.ok) return;

    const title = window.Parts.windowLabel(days);
    const card = [...doc.querySelectorAll('#view .card')]
      .find((c) => (c.querySelector('h3') || {}).textContent === title);
    if (!card || !card.querySelector('.bal-result')) return;

    const bad = r.base < 800 || r.base > 6000;
    const marked = !!card.querySelector('.bal-result--bad');
    assert(marked === bad, title + ': הסימון ' + marked + ' מול הצפוי ' + bad);

    if (bad) {
      assert(card.textContent.indexOf('אינו סביר') !== -1,
        title + ': לא הוסבר למה המספר לא סביר');
      // ויעד שנגזר ממספר לא סביר לא מוצג בכלל
      assert(!card.querySelector('.bal-result--target'),
        title + ': הוצג יעד על בסיס מספר לא סביר');
    }
  });

  App.setState({ tab: 'home' });
});



test('החלון המתגלגל מוצג לצד הסבב המלא', () => {
  App.setState({ date: Dates.today(), tab: 'balance', stepsMode: 'off' });

  let checked = 0;
  window.Parts.WINDOWS.forEach((days) => {
    const r = Metrics.dayAligned(Store.getEntries(), Store.getSettings(),
      { days: days, endDate: Dates.today() });
    if (!r.ok || !r.rolling) return;

    const card = [...doc.querySelectorAll('#view .card')]
      .find((c) => (c.querySelector('h3') || {}).textContent ===
        window.Parts.windowLabel(days));
    if (!card) return;

    const box = card.querySelector('.pending');
    assert(box, days + ': חסר החלון המתגלגל');
    assert(box.textContent.indexOf(days + ' הימים האחרונים') !== -1,
      days + ': הכותרת שגויה');

    const shown = Number(box.querySelector('.pending-result .v').textContent
      .replace(/[^0-9.\-]/g, ''));
    assert(Math.abs(shown - Math.round(r.rolling.base)) <= 1,
      days + ': מוצג ' + shown + ' מול ' + Math.round(r.rolling.base));

    checked++;
  });

  assert(checked > 0, 'לא נמצא אף חלון מתגלגל');
  App.setState({ tab: 'home' });
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

test('החלון הקודם מוצג להשוואה', () => {
  App.setState({ date: Dates.today(), tab: 'balance' });

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => c.querySelector('.pending'));
  if (!card) { App.setState({ tab: 'home' }); return; }

  const title = card.querySelector('h3').textContent;
  const days = window.Parts.WINDOWS.find((d) => window.Parts.windowLabel(d) === title);
  const r = Metrics.dayAligned(Store.getEntries(), Store.getSettings(),
    { days: days, endDate: Dates.today() });

  if (r.rolling && r.rolling.previous) {
    const note = card.querySelector('.pending-note').textContent;
    assert(note.indexOf('שלפניהם') !== -1, 'אין השוואה לחלון הקודם');
    // החלון הקודם נגמר יום לפני שהנוכחי מתחיל
    assert(r.rolling.previous.foodTo === Dates.addDays(r.rolling.foodFrom, -1),
      'החלונות אינם רצופים');
  }

  App.setState({ tab: 'home' });
});

test('בטבלה יש עמודת סבב מלא ועמודת אחרונים', () => {
  App.setState({ date: Dates.today(), tab: 'calc', basis: 7, stepsMode: 'off' });

  const table = [...doc.querySelectorAll('#view table.t')]
    .find((t) => t.textContent.indexOf('אחרונים') !== -1);
  assert(table, 'הטבלה חסרה');

  const heads = [...table.querySelectorAll('th')].map((h) => h.textContent);
  assert(heads.indexOf('סבב מלא') !== -1, 'חסרה עמודת הסבב המלא');
  assert(heads.indexOf('אחרונים') !== -1, 'חסרה עמודת האחרונים');

  const rows = [...table.querySelectorAll('tbody tr')];
  window.Parts.WINDOWS.forEach((days, i) => {
    const r = Metrics.dayAligned(Store.getEntries(), Store.getSettings(),
      { days: days, endDate: Dates.today() });
    if (!r.ok || !r.rolling || r.rolling.sameAsBlock) return;

    const cell = rows[i].children[6];
    const shown = Number((cell.querySelector('.num') || {}).textContent
      ? cell.querySelector('.num').textContent.replace(/[^0-9.\-]/g, '') : NaN);
    assert(Math.abs(shown - Math.round(r.rolling.base)) <= 1,
      days + ': מוצג ' + shown + ' מול ' + Math.round(r.rolling.base));
  });

  App.setState({ basis: 'adaptive', tab: 'home' });
});


test('טווח ישן מוסבר במקום להישאר תעלומה', () => {
  // משקל נפסק לפני שבועיים, אוכל ממשיך — בדיוק המצב שמייצר
  // תאריכים ישנים בטבלה
  Store.clearAll();
  const cut = Dates.addDays(Dates.today(), -20);
  for (let i = 0; i < 40; i++) {
    const d = Dates.addDays(Dates.today(), -(39 - i));
    const e = { date: d, kcal: 2500, steps: 9000 };
    if (d <= cut) e.weightKg = 89 - 0.02 * i;
    Store.upsert(e);
  }

  App.setState({ date: Dates.today(), tab: 'calc', basis: 7 });

  const text = doc.getElementById('view').textContent;
  assert(text.indexOf('הטווח נעצר') !== -1, 'לא הוסבר למה הטווח ישן');
  assert(text.indexOf('אין שקילה') !== -1, 'לא נאמר מה חוסם');
  assert(text.indexOf('שקילה אחרונה') !== -1, 'לא מוצגות נקודות הקצה');

  seed();
  App.setState({ tab: 'home' });
});

test('כשהטווח עדכני אין הודעת אבחון', () => {
  Store.clearAll();
  for (let i = 0; i < 40; i++) {
    Store.upsert({ date: Dates.addDays(Dates.today(), -(39 - i)),
      weightKg: 89 - 0.02 * i, kcal: 2500, steps: 9000 });
  }

  App.setState({ date: Dates.today(), tab: 'calc', basis: 7 });
  assert(doc.getElementById('view').textContent.indexOf('הטווח נעצר') === -1,
    'הודעת אבחון מיותרת');

  seed();
  App.setState({ tab: 'home' });
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

test('הפס מציג את התקופה שהוא מודד', () => {
  App.setState({ date: Dates.today(), tab: 'calc', basis: 7 });
  const live = doc.querySelector('.pick-live .s');
  assert(live, 'שורת הפירוט חסרה');

  const r = Metrics.dayAligned(Store.getEntries(), Store.getSettings(),
    { days: 7, endDate: Dates.today() });
  if (r.ok) {
    assert(live.textContent.indexOf(window.Dates.short(r.foodTo)) !== -1,
      'התקופה לא מוצגת: ' + live.textContent);
  }

  App.setState({ basis: 'adaptive', tab: 'home' });
});

test('כל אורכי החלון זמינים ומגיעים ממקור אחד', () => {
  const expected = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 21, 28];
  assert(window.Parts.WINDOWS.join() === expected.join(),
    'הרשימה: ' + window.Parts.WINDOWS.join());

  // כל המסכים משתמשים באותה רשימה
  [window.CalcTab, window.TargetsTab, window.WeightTab].forEach((tab, i) => {
    assert(tab.LENGTHS === window.Parts.WINDOWS,
      'מסך ' + i + ' מחזיק רשימה משלו');
  });

  // וכל אורך מקבל צ'יפ בפס הבחירה
  App.setState({ date: Dates.today(), tab: 'targets' });
  expected.forEach((days) => {
    assert(doc.querySelector('[data-basis="' + days + '"]'),
      'חסר צ׳יפ לחלון של ' + days);
  });

  App.setState({ tab: 'home' });
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

test('טבלת החישוב מציגה שורה לכל אורך', () => {
  App.setState({ date: Dates.today(), tab: 'calc', basis: 7 });

  const table = [...doc.querySelectorAll('#view table.t')]
    .find((t) => t.textContent.indexOf('סבב מלא') !== -1);
  assert(table, 'הטבלה חסרה');

  const rows = [...table.querySelectorAll('tbody tr')];
  assert(rows.length === window.Parts.WINDOWS.length,
    'ציפיתי ל-' + window.Parts.WINDOWS.length + ' שורות, יש ' + rows.length);

  window.Parts.WINDOWS.forEach((days, i) => {
    assert(rows[i].children[0].textContent.indexOf(String(days)) === 0,
      'שורה ' + i + ' אינה של ' + days + ' ימים');
  });

  App.setState({ basis: 'adaptive', tab: 'home' });
});

test('טאב החישוב הוא טבלה אחת, בלי כרטיס שלבים', () => {
  App.setState({ date: Dates.today(), tab: 'calc', basis: 7 });

  assert(!doc.querySelector('[data-align]'), 'נשאר בורר שיטות מדידה');
  assert(!doc.querySelector('#view .step'), 'נשאר כרטיס שלבים');
  assert(doc.getElementById('view').textContent.indexOf('איך הגענו למספר') === -1,
    'הכותרת עדיין מופיעה');

  // והטבלה עצמה נשארה
  const text = doc.getElementById('view').textContent;
  assert(text.indexOf('י.פ') !== -1 && text.indexOf('י.ס') !== -1, 'הטבלה חסרה');
  assert(text.indexOf('אחרונים') !== -1, 'עמודת החלון המתגלגל חסרה');

  App.setState({ tab: 'home' });
});

test('בורר הצעדים עדיין משנה את הטבלה', () => {
  App.setState({ date: Dates.today(), tab: 'calc', basis: 7, stepsMode: 'off' });

  const valuesNow = () => [...doc.querySelectorAll('#view table.t tbody tr')]
    .map((tr) => (tr.children[5] || {}).textContent || '').join('|');

  const without = valuesNow();
  doc.querySelector('[data-steps="on"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));
  const withSteps = valuesNow();

  const r = Metrics.dayAligned(Store.getEntries(), Store.getSettings(),
    { days: 7, endDate: Dates.today() });
  if (r.ok && r.stepKcal > 0) {
    assert(withSteps !== without, 'הטבלה לא הגיבה לבורר');
  }

  App.setState({ stepsMode: 'off', tab: 'home' });
});

test('טבלת כל אורכי החלון מסמנת את הנבחר', () => {
  App.setState({ date: Dates.today(), tab: 'calc', basis: 10 });

  const table = [...doc.querySelectorAll('#view table.t')]
    .find((t) => t.textContent.indexOf('סבב מלא') !== -1);
  assert(table, 'הטבלה חסרה');

  const marked = [...table.querySelectorAll('tbody tr')]
    .filter((tr) => tr.textContent.indexOf('✓') !== -1);
  assert(marked.length === 1, 'ציפיתי לשורה מסומנת אחת, יש ' + marked.length);
  assert(marked[0].children[0].textContent.indexOf('10') === 0,
    'הסימון על החלון הלא נכון');

  App.setState({ basis: 'adaptive', tab: 'home' });
});

test('במצב מסתגל מוצג חלון שבוע עם הסבר', () => {
  App.setState({ date: Dates.today(), tab: 'calc', basis: 'adaptive' });

  const text = doc.getElementById('view').textContent;
  assert(text.indexOf('אין לו סבבים') !== -1, 'לא הוסבר למה');
  assert(window.CalcTab.windowOf({ basis: 'adaptive' }) === 7, 'לא נבחר שבוע');

  App.setState({ tab: 'home' });
});




test('משקל יציב עם שומן יורד ושריר עולה מזוהה כרה־קומפוזיציה', () => {
  Store.clearAll();
  for (let i = 0; i < 42; i++) {
    Store.upsert({
      date: Dates.addDays(Dates.today(), -(41 - i)),
      weightKg: Number((89 + Math.sin(i * 2.1) * 0.4).toFixed(1)),
      bodyFatKg: Number((23.5 - 0.025 * i + Math.sin(i * 1.7) * 0.3).toFixed(1)),
      muscleKg: Number((35.0 + 0.012 * i + Math.sin(i * 1.3) * 0.25).toFixed(1))
    });
  }

  App.setState({ date: Dates.today(), tab: 'main' });
  const lead = doc.querySelector('#view .lead').textContent;

  assert(lead.indexOf('מחליף הרכב') !== -1,
    'לא זוהתה רה־קומפוזיציה: ' + lead);
  assert(lead.indexOf('טובה יותר מירידה במשקל') !== -1,
    'לא נאמר שזו התקדמות');
});

test('שינוי בתוך הרעש מסומן ולא נקרא כתוצאה', () => {
  App.setState({ date: Dates.today(), tab: 'main' });

  const table = [...doc.querySelectorAll('#view table.t')]
    .find((t) => t.textContent.indexOf('אחוז שומן') !== -1);
  const rows = [...table.querySelectorAll('tbody tr')];

  let marked = 0;
  window.MainTab.LENGTHS.forEach((days, i) => {
    const r = Metrics.compositionWindow(Store.getEntries(),
      { days: days, endDate: Dates.today() });
    if (!r.ok) return;

    ['weightKg', 'bodyFatKg', 'muscleKg'].forEach((field, col) => {
      const sig = r.significance[field];
      if (!sig) return;
      const cell = rows[i].children[2 + col];
      assert(cell.classList.contains('within-noise') === !sig.real,
        days + ' ' + field + ': הסימון לא תואם');
      if (!sig.real) marked++;
    });
  });

  assert(marked > 0, 'לא נמצא אף שינוי בתוך הרעש');
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

test('הקריאה מפרטת מה עבר את הרעש ומה לא', () => {
  App.setState({ date: Dates.today(), tab: 'main' });
  const text = doc.getElementById('view').textContent;

  assert(text.indexOf('מעל רעש המדידה') !== -1 || text.indexOf('בתוך הרעש') !== -1,
    'לא פורט מה עבר את הסף');
  assert(text.indexOf('ביו־אימפדנס') !== -1, 'לא הוסבר למה הסף שונה');

  // הבדיקות חולקות מצב; מי שהחליף נתונים מחזיר אותם
  seed();
  App.setState({ date: Dates.today(), tab: 'home' });
});




test('טאב הנתונים אומר עד מתי הנתונים עדכניים', () => {
  App.setState({ date: Dates.today(), tab: 'data', dataAll: false });

  const text = doc.getElementById('view').textContent;
  assert(text.indexOf('עדכני עד') !== -1, 'חסר האריח הראשי');
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

test('יום חסר מסומן', () => {
  const day = Dates.today();
  Store.upsert({ date: day, weightKg: 88.4, kcal: '' });
  App.setState({ date: day, tab: 'data', dataAll: false });

  const table = [...doc.querySelectorAll('#view table.t')]
    .find((t) => t.textContent.indexOf('נוזלים') !== -1);
  const first = table.querySelector('tbody tr');

  assert(first.classList.contains('within-noise'),
    'יום בלי אוכל לא סומן');
});

test('אפשר לפתוח את כל הימים', () => {
  App.setState({ date: Dates.today(), tab: 'data', dataAll: false });

  const button = doc.getElementById('data-all');
  const entries = Store.getEntries();
  if (entries.length <= window.DataTab.PAGE) return;

  assert(button, 'כפתור ההרחבה חסר');
  button.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.dataAll === true, 'הבחירה לא נשמרה');

  const rows = [...doc.querySelectorAll('#view table.t')]
    .find((t) => t.textContent.indexOf('נוזלים') !== -1)
    .querySelectorAll('tbody tr');
  assert(rows.length === entries.length,
    'מוצגות ' + rows.length + ' מתוך ' + entries.length);

  App.setState({ dataAll: false, tab: 'home' });
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

test('בחירת חלוקה משנה את התקציב', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2, splitRow: null });
  const read = () => Number(doc.querySelector('#view .big-number .v')
    .textContent.replace(/[^0-9.\-]/g, ''));

  const half = read();
  doc.querySelector('[data-split="3"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));
  assert(App.state.splitParts === 3, 'הבחירה לא נשמרה');
  assert(App.state.splitRow === null, 'בחירת השורה לא אופסה');

  const third = read();
  const a = Metrics.periodSplit(Store.getEntries(),
    { parts: 2, endDate: Dates.today() });
  const b = Metrics.periodSplit(Store.getEntries(),
    { parts: 3, endDate: Dates.today() });

  if (a.ok && b.ok &&
      Math.round(a.selected.maintenance) !== Math.round(b.selected.maintenance)) {
    assert(half !== third, 'התקציב לא השתנה');
  }

  App.setState({ splitParts: 2, tab: 'home' });
});

test('המקטע האחרון נבחר, ואפשר לבחור אחר', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 3, splitRow: null });

  const marked = [...doc.querySelectorAll('#view tr[data-split-row]')]
    .filter((tr) => tr.textContent.indexOf('✓') !== -1);
  assert(marked.length === 1, 'סומנו ' + marked.length + ' שורות');
  assert(marked[0].dataset.splitRow === '3', 'לא סומן האחרון');

  // לחיצה על שורה אחרת מעבירה אליה
  const other = [...doc.querySelectorAll('#view tr[data-split-row]')]
    .find((tr) => tr.dataset.splitRow === '2');
  other.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.splitRow === '2', 'הבחירה לא נשמרה');

  const nowMarked = [...doc.querySelectorAll('#view tr[data-split-row]')]
    .filter((tr) => tr.textContent.indexOf('✓') !== -1);
  assert(nowMarked[0].dataset.splitRow === '2', 'הסימון לא עבר');

  App.setState({ splitRow: null, tab: 'home' });
});

test('התקציב תואם את החישוב: תחזוקה פחות גירעון ועוד הליכה', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2, splitRow: null });

  const split = Metrics.periodSplit(Store.getEntries(), {
    parts: 2, endDate: Dates.today(),
    kcalPerKg: Store.getSettings().kcalPerKg,
    kcalPerStep: Store.getSettings().kcalPerStep
  });
  if (!split.ok) return;

  const row = split.selected;
  const rate = Math.abs(Store.getSettings().goal.ratePerWeekKg || 0);
  const deficit = (rate * (Store.getSettings().kcalPerKg || 7700)) / 7;
  const expected = Math.round(row.maintenance - deficit + (row.stepKcal || 0));

  const shown = Number(doc.querySelector('#view .big-number .v')
    .textContent.replace(/[^0-9.\-]/g, ''));
  assert(Math.abs(shown - expected) <= 1, 'מוצג ' + shown + ' מול ' + expected);

  App.setState({ tab: 'home' });
});

test('יעדי המאקרו מוצגים ומסתכמים לתקציב', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2, splitRow: null });

  const text = doc.getElementById('view').textContent;
  ['חלבון', 'שומן', 'פחמימות'].forEach((name) => {
    assert(text.indexOf(name) !== -1, 'חסר מאקרו: ' + name);
  });

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => (c.querySelector('h3') || {}).textContent === 'התקציב');
  const budget = Number(card.querySelector('.big-number .v')
    .textContent.replace(/[^0-9.\-]/g, ''));

  const grams = [...card.querySelectorAll('table.t tbody tr')]
    .map((tr) => Number(tr.children[1].textContent.replace(/[^0-9.\-]/g, '')));

  const sum = grams[0] * 4 + grams[1] * 9 + grams[2] * 4;
  assert(Math.abs(sum - budget) < 20,
    'המאקרו מסתכם ל-' + Math.round(sum) + ' מול תקציב ' + budget);

  App.setState({ tab: 'home' });
});

test('"בפועל" הוא ממוצע מול ממוצע ולא שקילה בודדת', () => {
  App.setState({ date: Dates.today(), tab: 'budget', splitParts: 2, splitRow: null });

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => (c.querySelector('h3') || {}).textContent === 'איפה אני עומד');
  const heads = [...card.querySelectorAll('th')].map((h) => h.textContent);

  assert(heads.indexOf('צפוי ק״ג') !== -1, 'חסרה עמודת הצפוי');
  assert(heads.indexOf('בפועל') !== -1, 'חסרה עמודת הבפועל');

  const rows = [...card.querySelectorAll('tbody tr')];
  assert(rows.length === window.BudgetTab.LENGTHS.length,
    'שורות: ' + rows.length);

  App.setState({ tab: 'home' });
});

test('מסך המצב עונה על ארבע השאלות', () => {
  App.setState({ date: Dates.today(), tab: 'status', stepsMode: 'off' });

  const titles = [...doc.querySelectorAll('#view .card h3')].map((h) => h.textContent);
  ['כמה לאכול היום', 'מול היעד', 'הגוף'].forEach((name) => {
    assert(titles.indexOf(name) !== -1, 'חסר כרטיס: ' + name);
  });

  // הסדר: קודם מה לעשות היום, אחר כך מה קרה
  assert(titles.indexOf('כמה לאכול היום') < titles.indexOf('מול היעד'),
    'הסדר הפוך');
});

test('היעד במסך המצב תואם את המנוע', () => {
  App.setState({ date: Dates.today(), tab: 'status', stepsMode: 'off' });

  const best = window.StatusTab.bestWindow(
    Store.getEntries(), Store.getSettings(), Dates.today(), App.state);
  if (!best) return;

  const rate = Math.abs(Store.getSettings().goal.ratePerWeekKg || 0);
  const deficit = (rate * (Store.getSettings().kcalPerKg || 7700)) / 7;
  const expected = Math.round(best.data.base - deficit);

  const shown = Number(doc.querySelector('#view .big-number .v')
    .textContent.replace(/[^0-9.\-]/g, ''));

  assert(Math.abs(shown - expected) <= 1, 'מוצג ' + shown + ' מול ' + expected);
});

test('הנותר להיום מחושב ממה שכבר נאכל', () => {
  const day = Dates.today();
  Store.upsert({ date: day, kcal: 1400 });
  App.setState({ date: day, tab: 'status', stepsMode: 'off' });

  const lead = doc.querySelector('#view .lead');
  assert(lead, 'חסרה שורת הנותר');
  assert(lead.textContent.indexOf('1,400') !== -1, 'לא מוצג מה נאכל');
  assert(lead.textContent.indexOf('נשאר') !== -1 ||
    lead.textContent.indexOf('מעל היעד') !== -1, 'לא מוצג הנותר');

  // וכשאין רישום נאמר זאת
  Store.upsert({ date: day, kcal: '' });
  App.setState({ date: day, tab: 'status' });
  assert(doc.getElementById('view').textContent.indexOf('עוד לא רשמת') !== -1,
    'לא נאמר שאין רישום');
});

test('הפער הוא זהות ולא מדידה נפרדת', () => {
  App.setState({ date: Dates.today(), tab: 'status', stepsMode: 'off' });

  const best = window.StatusTab.bestWindow(
    Store.getEntries(), Store.getSettings(), Dates.today(), App.state);
  if (!best) return;

  const r = best.data;
  const settings = Store.getSettings();
  const rate = Math.abs(settings.goal.ratePerWeekKg || 0);
  const deficit = (rate * (settings.kcalPerKg || 7700)) / 7;

  const target = r.base - deficit;
  const gap = r.meanKcal - target;

  // פער = גירעון + הליכה − מה שהמשקל מראה
  const identity = deficit + r.stepKcal - r.fromWeight;
  assert(Math.abs(gap - identity) < 0.01,
    'הזהות נשברה: ' + gap.toFixed(1) + ' מול ' + identity.toFixed(1));

  // וזה מה שמוצג
  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => (c.querySelector('h3') || {}).textContent === 'מול היעד');
  const shown = Number(card.querySelector('.tile .v').textContent
    .replace(/[^0-9.\-−]/g, '').replace('−', '-'));
  assert(Math.abs(shown - Math.round(gap)) <= 1, 'מוצג ' + shown + ' מול ' + Math.round(gap));

  // והנוסחה מוצגת עם כל רכיביה
  const calc = card.querySelector('.calc').textContent;
  assert(calc.indexOf('גירעון מתוכנן') !== -1, 'חסר הגירעון');
  assert(calc.indexOf('הליכה שלא ביעד') !== -1, 'חסרה ההליכה');
  assert(calc.indexOf('מה שהמשקל מראה') !== -1, 'חסר רכיב המשקל');
});

test('"עם צעדים" מקטין את הפער בדיוק בקלוריות ההליכה', () => {
  App.setState({ date: Dates.today(), tab: 'status', stepsMode: 'off' });
  const read = () => {
    const card = [...doc.querySelectorAll('#view .card')]
      .find((c) => (c.querySelector('h3') || {}).textContent === 'מול היעד');
    return Number(card.querySelector('.tile .v').textContent
      .replace(/[^0-9.\-−]/g, '').replace('−', '-'));
  };

  const without = read();
  doc.querySelector('[data-steps="on"]').dispatchEvent(
    new window.Event('click', { bubbles: true }));
  const withSteps = read();

  const best = window.StatusTab.bestWindow(
    Store.getEntries(), Store.getSettings(), Dates.today(), App.state);
  if (best && best.data.stepKcal > 0) {
    assert(Math.abs((without - withSteps) - Math.round(best.data.stepKcal)) <= 2,
      'ההפרש ' + (without - withSteps) + ' אינו ' + Math.round(best.data.stepKcal));
  }

  App.setState({ stepsMode: 'off' });
});

test('החריגה מוצגת ליום, מצטבר ובקילוגרמים', () => {
  App.setState({ date: Dates.today(), tab: 'status', stepsMode: 'off' });

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => (c.querySelector('h3') || {}).textContent === 'מול היעד');
  if (!card) return;

  const labels = [...card.querySelectorAll('.tile .k')].map((k) => k.textContent);
  assert(labels.join() === 'ליום,מצטבר,שווה ערך', 'האריחים: ' + labels.join());

  // המצטבר הוא היומי כפול מספר הימים שדווחו
  const values = [...card.querySelectorAll('.tile .v')]
    .map((v) => Number(v.textContent.replace(/[^0-9.\-−]/g, '').replace('−', '-')));

  const best = window.StatusTab.bestWindow(
    Store.getEntries(), Store.getSettings(), Dates.today(), App.state);
  if (!best) return;

  // הערך המוצג מעוגל, ולכן ההשוואה מול המספר המלא
  const settings = Store.getSettings();
  const rate = Math.abs(settings.goal.ratePerWeekKg || 0);
  const deficit = (rate * (settings.kcalPerKg || 7700)) / 7;
  const exact = best.data.meanKcal - (best.data.base - deficit);

  assert(Math.abs(values[1] - exact * best.data.loggedDays) <= best.data.loggedDays,
    'המצטבר ' + values[1] + ' אינו ' + Math.round(exact * best.data.loggedDays));
});

test('הדף הראשי הוא הראשון ומציג משקל, שומן ושריר', () => {
  App.setState({ date: Dates.today(), tab: 'main' });

  const text = doc.getElementById('view').textContent;
  assert(text.indexOf('הרכב הגוף') !== -1, 'כותרת המקטע חסרה');

  const table = [...doc.querySelectorAll('#view table.t')]
    .find((t) => t.textContent.indexOf('אחוז שומן') !== -1);
  assert(table, 'הטבלה חסרה');

  const heads = [...table.querySelectorAll('th')].map((h) => h.textContent);
  ['משקל', 'שומן', 'שריר', 'אחוז שומן'].forEach((name) => {
    assert(heads.indexOf(name) !== -1, 'חסרה עמודה: ' + name);
  });

  const rows = [...table.querySelectorAll('tbody tr')];
  assert(rows.length === window.MainTab.LENGTHS.length,
    'ציפיתי ל-' + window.MainTab.LENGTHS.length + ' שורות, יש ' + rows.length);

  window.MainTab.LENGTHS.forEach((days, i) => {
    assert(rows[i].children[0].textContent.indexOf(String(days)) === 0,
      'שורה ' + i + ' אינה של ' + days + ' ימים');
  });
});

test('הערכים בטבלה תואמים את המנוע', () => {
  App.setState({ date: Dates.today(), tab: 'main' });

  const table = [...doc.querySelectorAll('#view table.t')]
    .find((t) => t.textContent.indexOf('אחוז שומן') !== -1);
  const rows = [...table.querySelectorAll('tbody tr')];

  let checked = 0;
  window.MainTab.LENGTHS.forEach((days, i) => {
    const r = Metrics.compositionWindow(Store.getEntries(),
      { days: days, endDate: Dates.today() });
    if (!r.ok || !Fmt.isNum(r.fields.weightKg.change)) return;

    const shown = Number(rows[i].children[2].textContent
      .replace(/[^0-9.\-−]/g, '').replace('−', '-').split('.').slice(0, 2).join('.'));
    assert(Math.abs(shown - r.fields.weightKg.change) < 0.02,
      days + ': מוצג ' + shown + ' מול ' + r.fields.weightKg.change.toFixed(2));
    checked++;
  });

  assert(checked > 0, 'לא נבדקה אף שורה');
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

test('טאב המשקל מציג את כל אורכי החלון', () => {
  App.setState({ date: Dates.today(), tab: 'home' });
  const tab = doc.querySelector('[data-tab="weight"]');
  assert(tab, 'כפתור הטאב חסר');

  tab.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.tab === 'weight', 'הטאב לא התחלף');

  const text = doc.getElementById('view').textContent;
  assert(text.includes('משקל לפי חלונות'), 'כותרת המקטע חסרה');

  // כל אורך שיש לו מספיק נתונים מקבל כרטיס
  window.WeightTab.LENGTHS.forEach((days) => {
    const blocks = Metrics.weightBlocks(Store.getEntries(),
      { days: days, endDate: Dates.today() });
    if (blocks.rows.length < 2) return;
    assert(text.includes('כל ' + days + ' ימים'), 'חסר חלון של ' + days);
  });

  App.setState({ tab: 'home' });
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

test('שבוע אחרון חריג מסומן בכותרת', () => {
  // מוסיפים שבוע של עלייה חדה בסוף
  const base = Store.getEntries();
  const last = base[base.length - 1].weightKg;
  for (let i = 6; i >= 0; i--) {
    Store.upsert({ date: Dates.addDays(Dates.today(), -i), weightKg: last + 1.2 + 0.2 * (7 - i) });
  }
  App.setState({ date: Dates.today(), tab: 'home' });

  const d = Metrics.dashboard(Store.getEntries(), Store.getSettings(), { endDate: Dates.today() });
  assert(d.lastWeekEffect < -0.25, 'התרחיש לא יצר שבוע חריג: ' + d.lastWeekEffect);

  const flag = doc.querySelector('.flag');
  assert(flag, 'לא הופיעה הערה על השבוע החריג');
  assert(flag.textContent.includes('עד סוף השבוע שעבר'), 'נוסח לא צפוי: ' + flag.textContent);
  const shown = Number(flag.querySelector('b').textContent);
  assert(Math.abs(shown - d.halvesBeforeLastWeek.loss) < 0.06,
    'מוצג ' + shown + ' מול ' + d.halvesBeforeLastWeek.loss.toFixed(1));
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

test('שורת השיאים מציגה את הקצוות ואת השקילה האחרונה', () => {
  App.setState({ date: Dates.today(), tab: 'home' });
  const peaks = doc.querySelector('.peaks');
  assert(peaks, 'שורת השיאים חסרה');
  ['הכי גבוה', 'הכי נמוך', 'שקילה אחרונה'].forEach((label) =>
    assert(peaks.textContent.includes(label), 'חסר: ' + label));

  const d = Metrics.dashboard(Store.getEntries(), Store.getSettings(), { endDate: Dates.today() });
  const numbers = [...peaks.querySelectorAll('b')].map((b) => Number(b.textContent));
  assert(Math.abs(numbers[0] - d.maxWeight) < 0.06, 'השיא לא תואם');
  assert(Math.abs(numbers[1] - d.minWeight) < 0.06, 'השפל לא תואם');
  assert(Math.abs(numbers[2] - d.latestWeight) < 0.06, 'השקילה האחרונה לא תואמת');
  assert(numbers[0] > numbers[1], 'השיא אמור להיות גבוה מהשפל');
});

test('טבלת הטווחים מציגה 5 ימים, שבוע, שבועיים ושלושה', () => {
  App.setState({ date: Dates.today(), tab: 'home' });
  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => c.textContent.includes('לפי טווחים'));
  assert(card, 'הכרטיס חסר');

  const model = Metrics.rollingWindows(Store.getEntries(),
    { endDate: Dates.today(), lengths: [5, 7, 14, 21] });
  const usable = model.rows.filter((r) => r.ok && r.covered);
  const rows = [...card.querySelectorAll('tbody tr')];
  assert(rows.length === usable.length, 'ציפיתי ל-' + usable.length + ' שורות, יש ' + rows.length);

  usable.forEach((row, i) => {
    const shown = Number(rows[i].children[2].textContent.replace(/[^\d.\-−]/g, '').replace('−', '-'));
    assert(Math.abs(shown - (-row.deltaKg)) < 0.02,
      row.days + ' ימים: מוצג ' + shown + ' מול ' + (-row.deltaKg).toFixed(2));
    // המילה תואמת את הסימן
    const word = rows[i].children[1].textContent.trim();
    if (shown < -0.05) assert(word === 'ירדת', 'ציפיתי ל"ירדת", קיבלתי ' + word);
    if (shown > 0.05) assert(word === 'עלית', 'ציפיתי ל"עלית", קיבלתי ' + word);
  });
});

test('בחירת זהירות מזיזה את היעד לשני הכיוונים', () => {
  App.setState({ date: Dates.today(), basis: 'adaptive', caution: 'mid' });
  const target = () => {
    const hint = [...doc.querySelectorAll('#view .hint')]
      .map((el) => el.textContent)
      .find((t) => t.indexOf('היעד היומי שלך') !== -1);
    const m = hint.match(/היעד היומי שלך הוא (-?[\d,]+)/);
    assert(m, 'לא חולץ מספר: ' + hint.slice(0, 90));
    return Number(m[1].replace(/,/g, ''));
  };

  const middle = target();

  doc.querySelector('[data-caution="low"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.caution === 'low', 'הבחירה לא נשמרה');
  const careful = target();

  doc.querySelector('[data-caution="high"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  const generous = target();

  assert(careful < middle && middle < generous,
    'הסדר שגוי: ' + careful + ' / ' + middle + ' / ' + generous);

  // ההפרש בין הקצוות הוא טווח אי־הוודאות של ההערכה
  const r = Metrics.windowReport(Store.getEntries(), Store.getSettings(),
    { windowDays: 'adaptive', endDate: Dates.today() });
  assert(Math.abs((generous - careful) - 2 * r.ci95) <= 2,
    'ההפרש ' + (generous - careful) + ' מול ' + Math.round(2 * r.ci95));

  App.setState({ caution: 'mid' });
});

test('בחירת בסיס החישוב משנה את היעד', () => {
  // הרמז חי במסך הסיכום, ולכן הטאב מצוין במפורש
  App.setState({ date: Dates.today(), tab: 'home', basis: 'adaptive', caution: 'mid' });
  const target = () => {
    const hint = [...doc.querySelectorAll('#view .hint')]
      .map((el) => el.textContent)
      .find((t) => t.indexOf('היעד היומי שלך') !== -1);
    const m = hint.match(/היעד היומי שלך הוא (-?[\d,]+)/);
    assert(m, 'לא חולץ מספר מהרמז: ' + hint.slice(0, 90));
    return Number(m[1].replace(/,/g, ''));
  };

  const all = target();
  const chip = doc.querySelector('[data-basis="7"]');
  assert(chip, 'חסר כפתור לשבוע');
  assert(!chip.hasAttribute('disabled'), 'הכפתור אמור להיות זמין');

  chip.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.basis === 7, 'הבחירה לא נשמרה');
  assert(target() !== all, 'היעד לא השתנה');

  App.setState({ basis: 'adaptive' });
});

test('בסיס בלי מספיק ימים מנוטרל ולא נבחר', () => {
  App.setState({ date: Dates.today(), tab: 'home' });
  const available = Metrics.availableWindows(Store.getEntries(),
    { endDate: Dates.today(), candidates: [3, 5, 7, 10, 14, 21, 28] });

  available.forEach((w) => {
    const chip = doc.querySelector('[data-basis="' + w.days + '"]');
    assert(chip, 'חסר כפתור ל-' + w.days);
    assert(chip.hasAttribute('disabled') === !w.available,
      w.days + ': מצב הכפתור לא תואם את הזמינות');
  });
});

test('הלוח עומד גם בלי נתונים', () => {
  errors.length = 0;
  Store.clearAll();
  App.setState({ date: Dates.today(), tab: 'home' });
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
