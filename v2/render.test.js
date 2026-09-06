/**
 * בדיקה שהתצוגה עומדת גם בתשובות חלקיות.
 * "המודל הוחלף ואז כלום" נבע משגיאה בתוך הרינדור שנבלעה בשקט,
 * ולכן כאן נבדקות דווקא הצורות החריגות.
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
w.document.dispatchEvent(new w.Event('DOMContentLoaded'));

const { Store, App, Dates, Estimate } = w;
let passed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); passed++; } catch (error) { failures.push({ name, message: error.message }); }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

// נתונים מינימליים כדי שהמסך ייבנה
for (let i = 0; i < 20; i++) {
  Store.upsert({
    date: Dates.addDays(Dates.today(), -(19 - i)),
    weightKg: 88 - 0.05 * i, kcal: 2200, proteinG: 150, carbG: 200, fatG: 80
  });
}
Store.updateSettings({ aiKeyA: 'AQ.TEST', goal: { ratePerWeekKg: -0.5 } });
App.setState({ date: Dates.today() });

test('ההערכה מתמזגת גם כשהפריטים חסרים', () => {
  const merged = Estimate.reconcile(
    { kcal: 700, protein: 40 },
    { kcal: 900, protein: 50 }
  );
  assert(merged.fields.kcal === 800, 'קלוריות: ' + merged.fields.kcal);
  assert(merged.confidence === 'medium', 'רמת ביטחון');
});

test('הבדלי פריטים עומדים גם כשאין items בכלל', () => {
  const diff = Estimate.itemDifferences({ kcal: 700 }, { kcal: 900 });
  assert(Array.isArray(diff.onlyLean) && diff.onlyLean.length === 0, 'צד ראשון');
  assert(Array.isArray(diff.onlyRich) && diff.onlyRich.length === 0, 'צד שני');
});

test('הבדלי פריטים עומדים גם כששם הפריט חסר', () => {
  const diff = Estimate.itemDifferences(
    { items: [{ grams: 100 }, { name: 'עוף' }] },
    { items: [{ name: '' }, { name: 'שמן' }] }
  );
  assert(diff.onlyLean.indexOf('עוף') !== -1, 'עוף לא זוהה');
  assert(diff.onlyRich.indexOf('שמן') !== -1, 'שמן לא זוהה');
});

test('מיזוג שני צדדים ריקים לא קורס', () => {
  const merged = Estimate.reconcile({}, {});
  assert(merged.confidence === 'low', 'ביטחון נמוך');
  assert(merged.notes.length > 0, 'אמורה להיות הערה');
  assert(merged.fields.kcal === undefined, 'לא אמור להמציא מספר');
});

test('חילוץ מטקסט מחזיר מבנה שהתצוגה יודעת לקרוא', () => {
  const parsed = Estimate.parseAnswer('קלוריות 1500\nחלבון 90\nשומן 40');
  assert(parsed, 'לא חולץ');
  assert(Array.isArray(parsed.items), 'items חייב להיות מערך');
  assert(typeof parsed.reasoning === 'string', 'reasoning חייב להיות מחרוזת');

  // וגם שהמיזוג עובד עליו
  const merged = Estimate.reconcile(parsed, parsed);
  assert(merged.fields.kcal === 1500, 'המיזוג נכשל');
});

test('שמירת הגדרה באמצע התהליך לא מבטלת את התצוגה', () => {
  // זה בדיוק התרחיש שנשבר: שמירת המודל שהוחלף מרנדרת מחדש,
  // וכתיבה לאלמנט שנשמר קודם נעלמת
  App.setState({ date: Dates.today() });
  const before = w.document.getElementById('debate');
  assert(before, 'אלמנט התוצאה חסר');

  Store.updateSettings({ aiModelB: 'some/model:free' });

  const after = w.document.getElementById('debate');
  assert(after, 'האלמנט נעלם אחרי הרינדור');
  assert(before !== after, 'התרחיש לא שוחזר: האלמנט לא הוחלף');

  // כתיבה לאלמנט הישן באמת נעלמת — ולכן הקוד חייב לשלוף מחדש
  before.innerHTML = 'ישן';
  assert(w.document.getElementById('debate').textContent !== 'ישן',
    'הכתיבה לאלמנט הישן דווקא נראית — הבדיקה לא רלוונטית');
});

test('הקוד שולף את אלמנט התוצאה מחדש ולא שומר אותו', () => {
  const src = fs.readFileSync(path.join(__dirname, 'js/app.js'), 'utf8');
  const showFn = src.match(/var show = function[\s\S]*?\};/);
  assert(showFn, 'לא נמצאה פונקציית ההצגה');
  assert(showFn[0].indexOf("getElementById('debate')") !== -1,
    'ההצגה חייבת לשלוף את האלמנט בכל קריאה');
});

console.log('');
failures.forEach((f) => { console.log('\u2717 ' + f.name); console.log('   ' + f.message); });
console.log('\n' + passed + ' עברו, ' + failures.length + ' נכשלו\n');
process.exit(failures.length ? 1 : 0);
