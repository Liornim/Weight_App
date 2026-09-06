/**
 * בדיקות לפענוח שורת ההדבקה.
 * הפורמט הזה הוא הגשר בין הניתוח בשיחה לבין הטופס, ולכן הוא צריך
 * להיות סלחני לניסוחים אבל לא לנחש כשאין מספיק מידע.
 */
const fs = require('fs');
const path = require('path');

const scope = {};
new Function('globalThis', fs.readFileSync(path.join(__dirname, 'js/paste.js'), 'utf8'))(scope);
const Paste = scope.Paste;

let passed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); passed++; } catch (error) { failures.push({ name, message: error.message }); }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

test('שורה מקוצרת נקראת לפי הסדר', () => {
  const r = Paste.parse('1671 118 126 24 12');
  assert(r.ok, 'צריך להצליח');
  assert(r.format === 'short', 'פורמט: ' + r.format);
  assert(r.fields.kcal === 1671, 'קלוריות: ' + r.fields.kcal);
  assert(r.fields.proteinG === 118, 'חלבון');
  assert(r.fields.carbG === 126, 'פחמימות');
  assert(r.fields.fatG === 24, 'שומן');
  assert(r.fields.fiberG === 12, 'סיבים');
});

test('פסיקים ומפרידים לא שוברים', () => {
  const r = Paste.parse('1,671  118,  126 | 24 / 12');
  assert(r.fields.kcal === 1671, 'קלוריות: ' + r.fields.kcal);
  assert(r.fields.fiberG === 12, 'סיבים: ' + r.fields.fiberG);
});

test('שורה חלקית ממלאת רק את מה שיש ומדווחת מה חסר', () => {
  const r = Paste.parse('1671 118');
  assert(r.fields.kcal === 1671 && r.fields.proteinG === 118, 'שני הראשונים');
  assert(r.fields.carbG === undefined, 'לא ממציא פחמימות');
  assert(r.missing.indexOf('carbG') !== -1, 'הפחמימות אמורות להופיע כחסרות');
  assert(r.missing.indexOf('kcal') === -1, 'קלוריות לא חסרות');
});

test('כתיבה במילים נקראת בכל סדר', () => {
  const r = Paste.parse('חלבון 118, קלוריות 1671, סיבים 12');
  assert(r.format === 'labelled', 'פורמט: ' + r.format);
  assert(r.fields.kcal === 1671, 'קלוריות: ' + r.fields.kcal);
  assert(r.fields.proteinG === 118, 'חלבון');
  assert(r.fields.fiberG === 12, 'סיבים');
  assert(r.fields.carbG === undefined, 'לא הוזכרו פחמימות');
});

test('נקודתיים וסימנים אחרי המילה', () => {
  const r = Paste.parse('קלוריות: 1671\nחלבון = 118\nשומן - 24');
  assert(r.fields.kcal === 1671, 'קלוריות');
  assert(r.fields.proteinG === 118, 'חלבון');
  assert(r.fields.fatG === 24, 'שומן');
});

test('"שומן באוכל" לא מתבלבל עם שומן בגוף', () => {
  const r = Paste.parse('משקל 88.4, שומן בגוף 22.1, שריר 36.2');
  assert(r.fields.weightKg === 88.4, 'משקל: ' + r.fields.weightKg);
  assert(r.fields.bodyFatKg === 22.1, 'שומן בגוף: ' + r.fields.bodyFatKg);
  assert(r.fields.muscleKg === 36.2, 'שריר');
  assert(r.fields.fatG === undefined, 'לא אמור למלא שומן באוכל');
});

test('שורה עם תוויות לא נקראת כרצף מספרים', () => {
  const r = Paste.parse('קלוריות 1671 חלבון 118');
  assert(r.format === 'labelled', 'היה צריך להיקרא כמסומן');
  assert(r.fields.proteinG === 118, 'חלבון: ' + r.fields.proteinG);
  assert(r.fields.carbG === undefined, 'לא אמור לפרש 118 כפחמימות');
});

test('מספרים עשרוניים', () => {
  const r = Paste.parse('קלוריות 1671.5, חלבון 118.3, שומן 23.7');
  assert(r.fields.kcal === 1671.5, 'קלוריות');
  assert(r.fields.proteinG === 118.3, 'חלבון');
  assert(r.fields.fatG === 23.7, 'שומן');
});

test('שדה ריק או בלי מספרים מדווח ולא מנחש', () => {
  assert(!Paste.parse('').ok, 'ריק');
  assert(Paste.parse('').reason === 'empty', 'סיבה');
  assert(!Paste.parse('אכלתי סלט').ok, 'בלי מספרים');
  assert(Paste.parse('אכלתי סלט').reason === 'no-numbers', 'סיבה');
});

test('טקסט ארוך שמסתיים בשורת מספרים', () => {
  const r = Paste.parse('ההערכה השמרנית 1500 והמחמירה 1850.\nההכרעה:\n1671 118 126 24 12');
  // בטקסט חופשי בלי תוויות, המספר הראשון הוא הקובע — ולכן חשוב
  // שהשורה תודבק לבדה
  assert(r.ok, 'צריך להצליח');
  assert(r.format === 'short', 'אין תוויות מוכרות');
});

test('ההוראה שמועתקת מבקשת את הפורמט הנכון', () => {
  const text = Paste.promptText();
  assert(text.indexOf('קלוריות חלבון פחמימות שומן סיבים') !== -1, 'חסר סדר השדות');
  assert(text.indexOf('שמרנית') !== -1 && text.indexOf('מחמירה') !== -1, 'חסר הוויכוח');
  assert(text.indexOf('1671') !== -1, 'חסרה דוגמה');
});

console.log('');
failures.forEach((f) => { console.log('\u2717 ' + f.name); console.log('   ' + f.message); });
console.log('\n' + passed + ' עברו, ' + failures.length + ' נכשלו\n');
process.exit(failures.length ? 1 : 0);
