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
  App.setState({ date: Dates.today() });
  ['weightKg', 'bodyFatKg', 'muscleKg', 'kcal', 'proteinG', 'carbG', 'fatG', 'fiberG', 'steps']
    .forEach((field) => {
      assert(doc.querySelector('[data-field="' + field + '"]'), 'חסר שדה: ' + field);
    });

  doc.querySelector('[data-field="fiberG"]').value = '31';
  doc.querySelector('[data-field="steps"]').value = '11500';
  doc.querySelector('#save-entry').dispatchEvent(new window.Event('click', { bubbles: true }));

  const saved = Store.getEntry(Dates.today());
  assert(saved.fiberG === 31, 'הסיבים לא נשמרו: ' + saved.fiberG);
  assert(saved.steps === 11500, 'הצעדים לא נשמרו: ' + saved.steps);
});

test('ניווט בין ימים מזיז את הטופס', () => {
  App.setState({ date: Dates.today() });
  doc.querySelector('#day-back').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.date === Dates.addDays(Dates.today(), -1), 'לא חזר יום אחורה');

  doc.querySelector('#day-fwd').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.date === Dates.today(), 'לא חזר קדימה');

  // אי אפשר לעבור אל מעבר להיום
  doc.querySelector('#day-fwd').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(App.state.date === Dates.today(), 'עבר לתאריך עתידי');
});


test('הדבקת שורה ממלאת את הטופס', () => {
  App.setState({ date: Dates.today() });
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
  App.setState({ date: Dates.today() });
  const input = doc.querySelector('#paste-line');
  input.value = 'קלוריות 2000, חלבון 150';
  doc.querySelector('#paste-apply').dispatchEvent(new window.Event('click', { bubbles: true }));

  assert(Number(doc.querySelector('[data-field="kcal"]').value) === 2000, 'קלוריות');
  assert(Number(doc.querySelector('[data-field="proteinG"]').value) === 150, 'חלבון');
});

test('הדבקה ריקה מדווחת ולא מוחקת', () => {
  App.setState({ date: Dates.today() });
  doc.querySelector('[data-field="kcal"]').value = '1900';
  doc.querySelector('#paste-line').value = '';
  doc.querySelector('#paste-apply').dispatchEvent(new window.Event('click', { bubbles: true }));

  assert(doc.querySelector('#paste-result').textContent.includes('ריק'), 'לא דווח');
  assert(doc.querySelector('[data-field="kcal"]').value === '1900', 'הערך נמחק');
});

test('העלאת תמונה מופיעה רק עם מפתח, הדבקה תמיד', () => {
  Store.updateSettings({ aiKeyA: '', aiKeyB: '' });
  App.setState({ date: Dates.today() });

  assert(doc.querySelector('#paste-line'), 'שדה ההדבקה אמור להיות זמין תמיד');
  assert(doc.querySelector('#copy-prompt'), 'כפתור העתקת ההוראה חסר');
  assert(!doc.querySelector('#photo'), 'שדה התמונה לא אמור להופיע בלי מפתח');

  Store.updateSettings({ aiKeyA: 'AIzaTEST' });
  App.setState({ date: Dates.today() });
  assert(doc.querySelector('#photo'), 'שדה התמונה חסר למרות שיש מפתח');

  const card = [...doc.querySelectorAll('#view .card')]
    .find((c) => c.textContent.includes('העלאת תמונה'));
  assert(card.textContent.includes('Gemini'), 'הספק לא מזוהה: ' + card.textContent.slice(0, 60));
  assert(card.textContent.includes('מעריך פעמיים'), 'לא צוין שזה מפתח יחיד');

  Store.updateSettings({ aiKeyB: 'sk-or-TEST' });
  App.setState({ date: Dates.today() });
  const both = [...doc.querySelectorAll('#view .card')]
    .find((c) => c.textContent.includes('העלאת תמונה'));
  assert(both.textContent.includes('ויכוח בין Gemini ל-OpenRouter') ||
    (both.textContent.includes('Gemini') && both.textContent.includes('OpenRouter')),
    'לא צוין הוויכוח בין השניים: ' + both.textContent.slice(0, 80));

  Store.updateSettings({ aiKeyA: '', aiKeyB: '' });
});

test('שדה המודל מופיע רק כשהמפתח השני הוא OpenRouter', () => {
  Store.updateSettings({ aiKeyA: 'AIzaTEST', aiKeyB: '' });
  App.setState({ date: Dates.today() });
  assert(!doc.querySelector('[data-model="aiModelB"]'), 'שדה המודל לא אמור להופיע');

  Store.updateSettings({ aiKeyB: 'sk-or-TEST' });
  App.setState({ date: Dates.today() });
  assert(doc.querySelector('[data-model="aiModelB"]'), 'שדה המודל חסר');

  Store.updateSettings({ aiKeyA: '', aiKeyB: '' });
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
