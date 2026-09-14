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
  App.setState({ date: Dates.today() });
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
  // "זהיר" ו"נדיב" הם שמות בחירה שהמשתמש ביקש, ולכן מותרים
  // "מעריכים" הם שני ה-AI שמתווכחים, ולכן מותר. הבדיקה מחפשת
  // "ממוצע מעריכי", שהוא מונח סטטיסטי.
  ['חלון', 'תרחיש', 'מסתגל', 'קלמן', 'רגרסיה', 'סטיית תקן',
   'רווח סמך', 'ממוצע מעריכי', 'TDEE', '±'].forEach((term) => {
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
    const hints = [...doc.querySelectorAll('#view .hint')].map((el) => el.textContent);
    const hint = hints.find((t) => t.indexOf('היעד היומי שלך') !== -1);
    assert(hint, 'לא נמצא היעד');
    return Number(hint.match(/היעד היומי שלך הוא ([\d,]+)/)[1].replace(/,/g, ''));
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



test('הירידה בכותרת היא ההפרש בין חצאי התקופה', () => {
  App.setState({ date: Dates.today() });
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

  App.setState({ date: Dates.today() });
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
  App.setState({ date: Dates.today() });

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
  App.setState({ date: Dates.today() });

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
  App.setState({ date: Dates.today() });
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
  App.setState({ date: Dates.today() });
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
    return Number(hint.match(/היעד היומי שלך הוא ([\d,]+)/)[1].replace(/,/g, ''));
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
  App.setState({ date: Dates.today(), basis: 'adaptive', caution: 'mid' });
  const target = () => {
    const hint = [...doc.querySelectorAll('#view .hint')]
      .map((el) => el.textContent)
      .find((t) => t.indexOf('היעד היומי שלך') !== -1);
    return Number(hint.match(/היעד היומי שלך הוא ([\d,]+)/)[1].replace(/,/g, ''));
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
  App.setState({ date: Dates.today() });
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
