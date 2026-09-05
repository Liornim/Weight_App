/**
 * בדיקות ללוגיקה הטהורה. הרצה:  node tests/run-tests.js
 * הקבצים נטענים כמו בדפדפן (script tags), ולכן אפשר לבדוק אותם
 * בלי DOM ובלי כלי build.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const context = vm.createContext(globalThis);

['js/lib/stats.js', 'js/lib/dates.js', 'js/lib/kalman.js', 'js/lib/bodycomp.js', 'js/core/metrics.js', 'js/core/store.js', 'js/core/sheets.js'].forEach((rel) => {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  vm.runInContext(code, context, { filename: rel });
});

const { Stats, Dates, Metrics, Store, Kalman, BodyComp, Sheets } = globalThis;

let passed = 0;
const failures = [];

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

function close(actual, expected, tolerance, message) {
  // NaN חייב להיכשל במפורש. השוואה איתו תמיד false, ובלי הבדיקה הזו
  // חישוב שבור עובר בשקט — קרה בפועל.
  var bad = typeof actual !== 'number' || !isFinite(actual) ||
    Math.abs(actual - expected) > tolerance;
  if (bad) {
    throw new Error(`${message || 'value'}: expected ${expected} ±${tolerance}, got ${actual}`);
  }
}

// ---------- Stats ----------

test('mean / median / stdDev מתעלמים מערכים לא מספריים', () => {
  close(Stats.mean([1, 2, 3, null, undefined, NaN, '4']), 2, 1e-9, 'mean');
  close(Stats.median([5, 1, 3]), 3, 1e-9, 'median');
  close(Stats.median([4, 1, 3, 2]), 2.5, 1e-9, 'median even');
  close(Stats.stdDev([2, 4, 4, 4, 5, 5, 7, 9]), 2.13809, 1e-4, 'sd');
  assert(Stats.stdDev([5]) === null, 'sd של ערך בודד צריך להיות null');
  assert(Stats.mean([]) === null, 'mean של רשימה ריקה צריך להיות null');
});

test('רגרסיה לינארית על קו מדויק', () => {
  const points = [0, 1, 2, 3, 4].map((x) => ({ x, y: 10 + 2 * x }));
  const reg = Stats.linearRegression(points);
  close(reg.slope, 2, 1e-9, 'slope');
  close(reg.intercept, 10, 1e-9, 'intercept');
  close(reg.r2, 1, 1e-9, 'r2');
  close(reg.seSlope, 0, 1e-9, 'se');
  close(reg.at(10), 30, 1e-9, 'at');
});

test('רגרסיה מחזירה null כשאין מספיק נקודות או שאין פיזור ב-x', () => {
  assert(Stats.linearRegression([{ x: 1, y: 1 }]) === null, 'נקודה אחת');
  assert(Stats.linearRegression([{ x: 1, y: 1 }, { x: 1, y: 2 }]) === null, 'אותו x');
});

test('שגיאת תקן גדלה כשהרעש גדל', () => {
  const clean = [0, 1, 2, 3, 4, 5].map((x) => ({ x, y: x }));
  const noisy = [0, 1, 2, 3, 4, 5].map((x, i) => ({ x, y: x + (i % 2 ? 1.5 : -1.5) }));
  assert(Stats.linearRegression(noisy).seSlope > Stats.linearRegression(clean).seSlope, 'רעש צריך להגדיל SE');
});

// ---------- Dates ----------

test('חשבון תאריכים חוצה חודשים ושנים', () => {
  assert(Dates.addDays('2026-02-28', 1) === '2026-03-01', 'שנה לא מעוברת');
  assert(Dates.addDays('2024-02-28', 1) === '2024-02-29', 'שנה מעוברת');
  assert(Dates.addDays('2025-12-31', 1) === '2026-01-01', 'מעבר שנה');
  assert(Dates.diffDays('2026-01-01', '2026-03-01') === 59, 'הפרש ימים');
  assert(Dates.lastDays('2026-03-10', 7).length === 7, 'אורך חלון');
  assert(Dates.lastDays('2026-03-10', 7)[0] === '2026-03-04', 'תחילת חלון');
});

test('תחילת שבוע היא יום ראשון', () => {
  assert(Dates.weekStart('2026-03-11') === '2026-03-08', 'רביעי -> ראשון');
  assert(Dates.weekStart('2026-03-08') === '2026-03-08', 'ראשון נשאר');
});

test('פורמט תאריך ואימות', () => {
  assert(Dates.isIso('2026-03-08'), 'ISO תקין');
  assert(!Dates.isIso('08/03/2026'), 'פורמט אחר נדחה');
  assert(Dates.short('2026-03-08') === '08/03', 'קיצור');
});

// ---------- עזר לבניית נתוני בדיקה ----------

function buildSeries(startDate, days, fn) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = Dates.addDays(startDate, i);
    const values = fn(i, date);
    if (values) out.push(Object.assign({ date }, values));
  }
  return out;
}

// רעש דטרמיניסטי כדי שהבדיקות לא יהיו הפכפכות
function noise(i, amplitude) {
  return Math.sin(i * 2.399963) * amplitude;
}

// ---------- Metrics ----------

test('ממוצע נע דורש מינימום מדידות', () => {
  const entries = [
    { date: '2026-03-01', weightKg: 80 },
    { date: '2026-03-02', weightKg: 82 }
  ];
  const ma = Metrics.movingAverage(entries, 'weightKg', { windowDays: 7, minPoints: 3 });
  assert(ma.every((d) => d.y === null), 'עם 2 מדידות בלבד אין ממוצע');

  const three = entries.concat([{ date: '2026-03-03', weightKg: 84 }]);
  const ma3 = Metrics.movingAverage(three, 'weightKg', { windowDays: 7, minPoints: 3 });
  close(ma3[ma3.length - 1].y, 82, 1e-9, 'ממוצע 3 מדידות');
});

test('הממוצע הנע מתעלם ממדידות מחוץ לחלון', () => {
  const entries = buildSeries('2026-03-01', 14, (i) => ({ weightKg: i < 7 ? 90 : 80 }));
  const ma = Metrics.movingAverage(entries, 'weightKg', { windowDays: 7, minPoints: 3 });
  const last = ma[ma.length - 1];
  close(last.y, 80, 1e-9, 'החלון האחרון מכיל רק 80');
  assert(last.n === 7, 'שבע מדידות בחלון');
});

test('מגמה משחזרת שיפוע ידוע גם עם רעש', () => {
  // ירידה של 0.5 ק״ג בשבוע = 0.0714 ליום, פלוס רעש נוזלים של ±0.4 ק״ג
  const entries = buildSeries('2026-02-01', 28, (i) => ({ weightKg: 85 - 0.0714 * i + noise(i, 0.4) }));
  const t = Metrics.trend(entries, 'weightKg', { windowDays: 28, endDate: '2026-02-28' });
  assert(t.ok, 'צריך להצליח');
  close(t.perWeek, -0.5, 0.12, 'שיפוע שבועי');
  assert(t.ci95PerWeek > 0 && t.ci95PerWeek < 0.4, 'רווח סמך סביר: ' + t.ci95PerWeek);
  assert(t.n === 28, 'מספר נקודות');
});

test('מגמה מסרבת לחשב כשאין מספיק נקודות', () => {
  const entries = buildSeries('2026-03-01', 3, () => ({ weightKg: 80 }));
  const t = Metrics.trend(entries, 'weightKg', { windowDays: 14, endDate: '2026-03-03' });
  assert(!t.ok && t.reason === 'insufficient', 'צריך להחזיר חוסר נתונים');
});

test('הערכת TDEE משחזרת ערך ידוע', () => {
  // אמת: TDEE=2600, אכילה 2100 -> גירעון 500 ליום -> 500/7700 ק״ג ליום
  const lossPerDay = 500 / 7700;
  const entries = buildSeries('2026-02-01', 28, (i) => ({
    weightKg: 88 - lossPerDay * i + noise(i, 0.35),
    kcal: 2100 + noise(i * 1.7, 150)
  }));
  const r = Metrics.estimateTDEE(entries, { windowDays: 28, endDate: '2026-02-28' });
  assert(r.ok, 'צריך להצליח: ' + r.reason);
  close(r.tdee, 2600, 150, 'TDEE');
  close(r.meanKcal, 2100, 60, 'ממוצע צריכה');
  assert(r.ci95 > 0, 'צריך רווח סמך');
  close(r.deficit, 500, 150, 'גירעון');
});

test('הערכת TDEE נכשלת בשקט כשאין מספיק ימי תזונה', () => {
  const entries = buildSeries('2026-02-01', 28, (i) => ({
    weightKg: 88 - 0.06 * i,
    kcal: i < 5 ? 2100 : null
  })).map((e) => {
    if (e.kcal === null) delete e.kcal;
    return e;
  });
  const r = Metrics.estimateTDEE(entries, { windowDays: 28, endDate: '2026-02-28' });
  assert(!r.ok && r.reason === 'kcal', 'צריך לדווח על חוסר בקלוריות, קיבלתי ' + r.reason);
});

test('משקל יציב נותן TDEE ששווה לצריכה', () => {
  const entries = buildSeries('2026-02-01', 28, (i) => ({
    weightKg: 80 + noise(i, 0.3),
    kcal: 2400 + noise(i * 1.3, 100)
  }));
  const r = Metrics.estimateTDEE(entries, { windowDays: 28, endDate: '2026-02-28' });
  assert(r.ok, 'צריך להצליח');
  close(r.tdee, 2400, 200, 'TDEE של אחזקה');
});

test('estimateTDEEMulti בוחר את החלון עם רווח הסמך הצר ביותר', () => {
  const entries = buildSeries('2026-01-15', 45, (i) => ({
    weightKg: 90 - 0.07 * i + noise(i, 0.3),
    kcal: 2000 + noise(i * 1.9, 120)
  }));
  const r = Metrics.estimateTDEEMulti(entries, { endDate: '2026-02-28' });
  assert(r.best && r.best.ok, 'צריך למצוא הערכה');
  assert(r.all.every((x) => !x.ok || x.ci95 >= r.best.ci95), 'הנבחר צריך להיות הצר ביותר');
});

test('פירוק שינוי המשקל לשומן ולמסה רזה', () => {
  // 80% מהירידה משומן
  const entries = buildSeries('2026-02-01', 28, (i) => ({
    weightKg: 90 - 0.05 * i + noise(i, 0.2),
    bodyFatKg: 25 - 0.04 * i + noise(i * 1.1, 0.15)
  }));
  const c = Metrics.composition(entries, { windowDays: 28, endDate: '2026-02-28' });
  assert(c.ok, 'צריך להצליח');
  close(c.fatShare, 0.8, 0.15, 'חלק השומן בירידה');
  close(c.leanShare, 0.2, 0.15, 'חלק המסה הרזה');
});

test('פירוק מסרב לחשב כשהמשקל יציב', () => {
  const entries = buildSeries('2026-02-01', 28, (i) => ({
    weightKg: 90 + noise(i, 0.2),
    bodyFatKg: 25 + noise(i * 1.1, 0.15)
  }));
  const c = Metrics.composition(entries, { windowDays: 28, endDate: '2026-02-28' });
  assert(c.fatShare === null && c.reason === 'stable', 'שינוי זניח לא ניתן לפירוק');
});

test('כיסוי נתונים סופר את הימים הנכונים', () => {
  const entries = [
    { date: '2026-03-08', weightKg: 80 },
    { date: '2026-03-10', weightKg: 80 },
    { date: '2026-03-10', kcal: 2000 }
  ];
  const cov = Metrics.coverage(entries.slice(0, 2), { windowDays: 7, endDate: '2026-03-10', field: 'weightKg' });
  assert(cov.count === 2, 'שני ימים עם משקל');
  assert(cov.days.length === 7, 'שבעה ימים בחלון');
  close(cov.pct, 2 / 7, 1e-9, 'אחוז כיסוי');
});

test('עמידה ביעדים מודדת גם ממוצע וגם פיזור', () => {
  const entries = [
    { date: '2026-03-04', kcal: 1000 },
    { date: '2026-03-05', kcal: 3000 },
    { date: '2026-03-06', kcal: 2000 },
    { date: '2026-03-07', kcal: 2000 }
  ];
  const a = Metrics.adherence(entries, { kcal: 2000 }, { windowDays: 7, endDate: '2026-03-10', tolerance: 0.1 });
  close(a.fields.kcal.mean, 2000, 1e-9, 'ממוצע מושלם');
  close(a.fields.kcal.gap, 0, 1e-9, 'אין פער בממוצע');
  close(a.fields.kcal.pctInRange, 0.5, 1e-9, 'רק חצי מהימים בטווח');
});

test('תקציב שבועי מחשב כמה נשאר להיום', () => {
  // ראשון עד שלישי דווחו, היום שלישי
  const entries = [
    { date: '2026-03-08', kcal: 2500 },
    { date: '2026-03-09', kcal: 2500 }
  ];
  const b = Metrics.weekBudget(entries, { kcal: 2000 }, { date: '2026-03-10' });
  assert(b.ok, 'צריך להצליח');
  close(b.weekTarget, 14000, 1e-9, 'יעד שבועי');
  close(b.consumed, 5000, 1e-9, 'נצרך');
  close(b.remaining, 9000, 1e-9, 'נשאר');
  assert(b.remainingDays === 5, 'חמישה ימים נותרו כולל היום, קיבלתי ' + b.remainingDays);
  close(b.perRemainingDay, 1800, 1e-9, 'ליום נותר');
});

test('השוואת תקופות מחשבת דלתא', () => {
  const entries = buildSeries('2026-02-01', 28, (i) => ({
    weightKg: i < 14 ? 90 : 88,
    kcal: i < 14 ? 2400 : 2000
  }));
  const c = Metrics.comparePeriods(entries, { windowDays: 14, endDate: '2026-02-28' });
  close(c.deltas.weightKg, -2, 1e-9, 'ירידה של 2 ק״ג בין התקופות');
  close(c.deltas.kcal, -400, 1e-9, 'ירידה של 400 קלוריות');
});

test('BMR לפי Mifflin-St Jeor', () => {
  const bmr = Metrics.bmrMifflin({ sex: 'male', heightCm: 180, ageYears: 30 }, 80);
  close(bmr, 1780, 1, 'גבר 80/180/30');
  const female = Metrics.bmrMifflin({ sex: 'female', heightCm: 165, ageYears: 30 }, 60);
  close(female, 1320.25, 1, 'אישה 60/165/30');
  assert(Metrics.bmrMifflin({ sex: 'male' }, 80) === null, 'חסרים נתונים -> null');
});

test('שדות נגזרים: מסה רזה ואחוז שומן', () => {
  const d = Metrics.derive({ date: '2026-03-01', weightKg: 80, bodyFatKg: 20 });
  close(d.leanKg, 60, 1e-9, 'מסה רזה');
  close(d.bodyFatPct, 25, 1e-9, 'אחוז שומן');
  assert(Metrics.derive({ date: '2026-03-01', weightKg: 80 }).leanKg === null, 'בלי שומן אין מסה רזה');
});

// ---------- Store ----------

test('Store עובד גם בלי localStorage', () => {
  Store.init();
  Store.clearAll();
  Store.upsert({ date: '2026-03-01', weightKg: 80 });
  assert(Store.getEntries().length === 1, 'נשמרה רשומה');
});

test('עדכון חלקי לא דורס שדות קיימים', () => {
  Store.clearAll();
  Store.upsert({ date: '2026-03-01', weightKg: 80.4, bodyFatKg: 20 });
  Store.upsert({ date: '2026-03-01', kcal: 2100 });
  const e = Store.getEntry('2026-03-01');
  close(e.weightKg, 80.4, 1e-9, 'המשקל נשמר');
  close(e.kcal, 2100, 1e-9, 'הקלוריות נוספו');
});

test('שליחת ערך ריק מוחקת את השדה', () => {
  Store.clearAll();
  Store.upsert({ date: '2026-03-01', weightKg: 80, kcal: 2100 });
  Store.upsert({ date: '2026-03-01', kcal: '' });
  const e = Store.getEntry('2026-03-01');
  assert(!('kcal' in e), 'הקלוריות נמחקו');
  close(e.weightKg, 80, 1e-9, 'המשקל נשאר');
});

test('רשומה שהתרוקנה נמחקת', () => {
  Store.clearAll();
  Store.upsert({ date: '2026-03-01', weightKg: 80 });
  Store.upsert({ date: '2026-03-01', weightKg: '' });
  assert(Store.getEntry('2026-03-01') === null, 'הרשומה הוסרה');
});

test('פסיק עשרוני ורווחים מתפרשים נכון', () => {
  assert(Store.toNumber('80,4') === 80.4, 'פסיק');
  assert(Store.toNumber(' 2100 ') === 2100, 'רווחים');
  assert(Store.toNumber('') === null, 'ריק');
  assert(Store.toNumber('abc') === null, 'טקסט');
  assert(Store.toNumber('-0.5') === -0.5, 'שלילי');
});

test('אימות מסמן ערכים לא הגיוניים', () => {
  const w = Store.validate({ date: '2026-03-01', weightKg: 80, bodyFatKg: 95 });
  assert(w.length === 1, 'שומן גדול מהמשקל צריך אזהרה אחת, קיבלתי ' + w.length);
  assert(Store.validate({ date: '2026-03-01', weightKg: 80, bodyFatKg: 20 }).length === 0, 'נתון תקין');
});

test('ייצוא וייבוא CSV שומרים על הנתונים', () => {
  Store.clearAll();
  Store.upsert({ date: '2026-03-01', weightKg: 80.4, bodyFatKg: 20.1, kcal: 2100, note: 'בוקר' });
  Store.upsert({ date: '2026-03-02', weightKg: 80.1, kcal: 1950 });
  const csv = Store.exportCSV();
  Store.clearAll();
  const result = Store.importCSV(csv, 'replace');
  assert(result.imported === 2, 'שתי רשומות יובאו');
  const e = Store.getEntry('2026-03-01');
  close(e.weightKg, 80.4, 1e-9, 'משקל שרד');
  assert(e.note === 'בוקר', 'הערה שרדה');
});

test('ייבוא CSV עם כותרות בעברית ותאריך DD/MM/YYYY', () => {
  Store.clearAll();
  const csv = 'תאריך,משקל,קלוריות\n08/03/2026,79.8,2200\n09/03/2026,79.6,2150';
  const result = Store.importCSV(csv, 'replace');
  assert(result.imported === 2, 'יובאו שתי שורות, קיבלתי ' + result.imported);
  const e = Store.getEntry('2026-03-08');
  assert(e !== null, 'התאריך הומר ל-ISO');
  close(e.kcal, 2200, 1e-9, 'קלוריות');
});

test('ייבוא במיזוג: הרשומה החדשה יותר מנצחת', () => {
  Store.clearAll();
  Store.upsert({ date: '2026-03-01', weightKg: 80 });
  const payload = JSON.stringify({
    entries: [{ date: '2026-03-01', weightKg: 77, updatedAt: '2030-01-01T00:00:00.000Z' }]
  });
  Store.importJSON(payload, 'merge');
  close(Store.getEntry('2026-03-01').weightKg, 77, 1e-9, 'הגרסה החדשה גברה');

  const old = JSON.stringify({
    entries: [{ date: '2026-03-01', weightKg: 99, updatedAt: '2000-01-01T00:00:00.000Z' }]
  });
  Store.importJSON(old, 'merge');
  close(Store.getEntry('2026-03-01').weightKg, 77, 1e-9, 'גרסה ישנה לא דורסת');
});

test('ייצוא JSON כולל הגדרות ורשומות', () => {
  Store.clearAll();
  Store.updateSettings({ targets: { kcal: 2000 } });
  Store.upsert({ date: '2026-03-01', weightKg: 80 });
  const parsed = JSON.parse(Store.exportJSON());
  assert(parsed.entries.length === 1, 'רשומה אחת');
  assert(parsed.settings.targets.kcal === 2000, 'יעד נשמר');
  assert(parsed.version === 1, 'גרסת סכמה');
});

test('הרשומות נשמרות ממוינות לפי תאריך', () => {
  Store.clearAll();
  ['2026-03-05', '2026-03-01', '2026-03-03'].forEach((d) => Store.upsert({ date: d, weightKg: 80 }));
  const dates = Store.getEntries().map((e) => e.date);
  assert(dates.join(',') === '2026-03-01,2026-03-03,2026-03-05', 'מיון: ' + dates.join(','));
});

test('תאריך לא תקין נדחה', () => {
  let threw = false;
  try { Store.upsert({ date: '01/03/2026', weightKg: 80 }); } catch (e) { threw = true; }
  assert(threw, 'צריך לזרוק שגיאה');
});


test('יעד קלוריות מוצע נגזר מה-TDEE ומקצב היעד', () => {
  // TDEE 2600, יעד ירידה של 0.5 ק"ג בשבוע -> גירעון 550 ליום
  const target = Metrics.suggestedKcal(2600, -0.5, 7700);
  close(target, 2050, 1, 'יעד מוצע');
  assert(Metrics.suggestedKcal(null, -0.5, 7700) === null, 'בלי TDEE אין יעד');
  close(Metrics.suggestedKcal(2600, 0, 7700), 2600, 1e-9, 'אחזקה');
});

test('תחזית הגעה ליעד', () => {
  const p = Metrics.projection(85, 80, -0.5, '2026-03-01');
  close(p.weeks, 10, 1e-9, 'עשרה שבועות');
  assert(p.date === '2026-05-10', 'תאריך יעד: ' + p.date);
  const wrongWay = Metrics.projection(85, 80, +0.3, '2026-03-01');
  assert(wrongWay.date === null, 'מגמה מנוגדת ליעד לא מייצרת תאריך');
  const arrived = Metrics.projection(80.01, 80, -0.5, '2026-03-01');
  assert(arrived.weeks === 0, 'כבר ביעד');
});


test('כותרות עמודות נפוצות מזוהות בייבוא', () => {
  Store.clearAll();
  const csv = 'תאריך,משקל,שומן,שריר,נוזלים,קלוריות,חלבון,פחמימות,צעדים\n' +
              '10/03/2026,81.2,22.4,58.1,44.3,2150,168,190,9400';
  Store.importCSV(csv, 'replace');
  const e = Store.getEntry('2026-03-10');
  close(e.weightKg, 81.2, 1e-9, 'משקל');
  close(e.bodyFatKg, 22.4, 1e-9, 'שומן גוף');
  close(e.muscleKg, 58.1, 1e-9, 'שריר');
  close(e.waterKg, 44.3, 1e-9, 'נוזלים');
  close(e.carbG, 190, 1e-9, 'פחמימות');
  close(e.steps, 9400, 1e-9, 'צעדים');
});

test('עמודות באנגלית ובאותיות גדולות מזוהות גם הן', () => {
  Store.clearAll();
  Store.importCSV('Date,Weight,Calories,Protein\n2026-03-10,80,2000,150', 'replace');
  const e = Store.getEntry('2026-03-10');
  close(e.weightKg, 80, 1e-9, 'weight');
  close(e.kcal, 2000, 1e-9, 'calories');
  close(e.proteinG, 150, 1e-9, 'protein');
});

test('עמודה לא מוכרת מדולגת בלי להפיל את הייבוא', () => {
  Store.clearAll();
  const r = Store.importCSV('תאריך,משקל,מצב רוח\n2026-03-10,80,מעולה', 'replace');
  assert(r.imported === 1, 'השורה יובאה');
  close(Store.getEntry('2026-03-10').weightKg, 80, 1e-9, 'משקל');
});

test('החלקים בפירוק מסתכמים לשינוי המשקל', () => {
  // שומן נמדד רק בחלק מהימים — הפירוק חייב להישאר עקבי
  const entries = buildSeries('2026-02-01', 28, (i) => {
    const row = { weightKg: 90 - 0.05 * i + noise(i, 0.2) };
    if (i % 2 === 0) row.bodyFatKg = 25 - 0.04 * i + noise(i * 1.1, 0.15);
    return row;
  });
  const c = Metrics.composition(entries, { windowDays: 28, endDate: '2026-02-28' });
  assert(c.ok, 'צריך להצליח');
  close(c.fat.changeOverWindow + c.lean.changeOverWindow, c.weight.changeOverWindow, 1e-9,
    'שומן + רזה צריך להיות שווה למשקל');
  close(c.fatShare + c.leanShare, 1, 1e-9, 'החלקים מסתכמים ל-100%');
  assert(c.pairedDays === 14, 'ארבעה עשר ימים משותפים, קיבלתי ' + c.pairedDays);
});

test('נתוני פתיחה נטענים רק כשאין נתונים שמורים', () => {
  Store.clearAll();
  Store.seed({ seedId: 'a', entries: [{ date: '2026-03-01', weightKg: 80 }, { date: '2026-03-02', weightKg: 79.8 }] });
  assert(Store.getEntries().length === 2, 'הזרע נטען');
  Store.upsert({ date: '2026-03-01', weightKg: 75 });
  Store.init(); // טעינה מחדש כמו רענון דף
  close(Store.getEntry('2026-03-01').weightKg, 75, 1e-9, 'העריכה המקומית שרדה את הטעינה');
});

test('הזרע כולל הגדרות פרופיל', () => {
  Store.clearAll();
  Store.seed({
    seedId: 'p', entries: [{ date: '2026-03-01', weightKg: 80 }],
    settings: { profile: { heightCm: 180, birthDate: '1990-05-20', sex: 'male' } }
  });
  const p = Store.getSettings().profile;
  assert(p.heightCm === 180 && p.birthDate === '1990-05-20' && p.sex === 'male', 'הפרופיל נשתל');
});

test('זרע חדש מחליף נתונים שלא נערכו, ולא כאלה שנערכו', () => {
  // מקרה א: אין עריכות ידניות -> החלפה שקטה
  Store.clearAll();
  Store.seed({ seedId: 'v1', entries: [{ date: '2025-01-01', weightKg: 90 }] });
  globalThis.METRICS_SEED = { seedId: 'v2', entries: [{ date: '2026-07-26', weightKg: 88 }] };
  Store.init();
  assert(Store.getEntries().length === 1 && Store.getEntry('2026-07-26'), 'הזרע החדש נטען');
  assert(Store.pendingSeedId() === null, 'אין המתנה לאישור');

  // מקרה ב: יש עריכה ידנית -> לא נוגעים, מסמנים שיש עדכון
  Store.upsert({ date: '2026-08-01', weightKg: 87 });
  globalThis.METRICS_SEED = { seedId: 'v3', entries: [{ date: '2026-07-26', weightKg: 80 }] };
  Store.init();
  assert(Store.getEntries().length === 2, 'הנתונים הידניים שרדו');
  assert(Store.pendingSeedId() === 'v3', 'סומן שיש זרע חדש');

  // ואישור מפורש כן מחליף
  Store.applyPendingSeed();
  assert(Store.getEntries().length === 1, 'אחרי אישור הזרע נטען');
  close(Store.getEntry('2026-07-26').weightKg, 80, 1e-9, 'הערך מהזרע החדש');
  delete globalThis.METRICS_SEED;
});

// ---------- ממוצע נע מעריכי ----------

test('EWMA מגיב חלקית לסטייה, לא במלואה', () => {
  const entries = buildSeries('2026-03-01', 10, () => ({ weightKg: 80 }))
    .concat([{ date: '2026-03-11', weightKg: 90 }]);
  const line = Metrics.ewma(entries, 'weightKg', { alpha: 0.1 });
  const last = line[line.length - 1];
  close(last.y, 81, 1e-9, 'קפיצה של 10 ק"ג מזיזה את המגמה ב-1 בלבד');
  close(last.deviation, 9, 1e-9, 'הסטייה מהמגמה');
});

test('EWMA מתכנס לרמה חדשה', () => {
  const entries = buildSeries('2026-03-01', 80, (i) => ({ weightKg: i < 40 ? 90 : 85 }));
  const line = Metrics.ewma(entries, 'weightKg', { alpha: 0.1 });
  close(line[line.length - 1].y, 85, 0.1, 'אחרי 40 יום ברמה החדשה');
});

// ---------- מסנן קלמן ----------

function kalmanDays(count, opts) {
  // בונה רצף אמיתי: משקל שנגזר ממאזן אנרגיה, פלוס רעש שקילה
  const days = [];
  let trueWeight = opts.startWeight;
  for (let i = 0; i < count; i++) {
    const tdee = typeof opts.tdee === 'function' ? opts.tdee(i) : opts.tdee;
    const intake = opts.intake + noise(i * 1.7, opts.intakeNoise || 0);
    days.push({
      date: Dates.addDays('2026-01-01', i),
      weight: trueWeight + noise(i, opts.weightNoise === undefined ? 0.5 : opts.weightNoise),
      intake: intake
    });
    trueWeight += (intake - tdee) / 7700;
  }
  return days;
}

test('קלמן משחזר TDEE קבוע', () => {
  const days = kalmanDays(60, { startWeight: 88, tdee: 2600, intake: 2100, intakeNoise: 150 });
  const r = Kalman.run(days, {});
  assert(r.ok, 'צריך להצליח');
  close(r.final.tdee, 2600, 150, 'TDEE');
  assert(r.final.ci95 > 0 && r.final.ci95 < 500, 'רווח סמך סביר: ' + r.final.ci95);
});

test('אי־הוודאות של קלמן מצטמצמת עם הזמן', () => {
  const days = kalmanDays(60, { startWeight: 88, tdee: 2600, intake: 2100, intakeNoise: 150 });
  const r = Kalman.run(days, {});
  const early = r.states[9].tdeeSd;
  const late = r.states[r.states.length - 1].tdeeSd;
  assert(late < early, 'אחרי 60 יום צריך להיות בטוח יותר מאשר אחרי 10 (' + late + ' מול ' + early + ')');
});

test('קלמן עוקב אחרי שינוי מטבולי שרגרסיה מפספסת', () => {
  // ההוצאה צונחת מ-2700 ל-2300 באמצע התקופה
  const days = kalmanDays(80, {
    startWeight: 92, intake: 2200, intakeNoise: 120,
    tdee: (i) => (i < 40 ? 2700 : 2300)
  });
  const r = Kalman.run(days, {});
  assert(Math.abs(r.final.tdee - 2300) < 200, 'קלמן צריך להתכנס לערך החדש, קיבלתי ' + Math.round(r.final.tdee));

  // אותם נתונים דרך רגרסיה על חלון של 56 יום — עדיין נגררת מהתקופה הישנה
  const entries = days.map((d) => ({ date: d.date, weightKg: d.weight, kcal: d.intake }));
  const ols = Metrics.estimateTDEE(entries, { windowDays: 56, endDate: days[days.length - 1].date });
  assert(ols.ok, 'הרגרסיה צריכה לרוץ');
  assert(Math.abs(ols.tdee - 2300) > Math.abs(r.final.tdee - 2300),
    'הרגרסיה אמורה להיות רחוקה יותר מהערך הנוכחי (קלמן ' + Math.round(r.final.tdee) + ', רגרסיה ' + Math.round(ols.tdee) + ')');
});

test('קלמן מתמודד עם ימים חסרים', () => {
  const full = kalmanDays(70, { startWeight: 88, tdee: 2600, intake: 2100, intakeNoise: 150 });
  // מוחקים כל שקילה שלישית וכל דיווח קלוריות רביעי
  const sparse = full.map((d, i) => ({
    date: d.date,
    weight: i % 3 === 0 ? null : d.weight,
    intake: i % 4 === 0 ? null : d.intake
  }));
  const r = Kalman.run(sparse, {});
  assert(r.ok, 'צריך להצליח');
  close(r.final.tdee, 2600, 250, 'TDEE עם נתונים חלקיים');
  assert(r.final.observedDays < r.final.totalDays, 'דווח שחלק מהימים חסרים');
});

test('קלמן מסרב לרוץ כשאין כמעט נתוני תזונה', () => {
  const days = kalmanDays(30, { startWeight: 88, tdee: 2600, intake: 2100 })
    .map((d, i) => ({ date: d.date, weight: d.weight, intake: i < 2 ? d.intake : null }));
  const r = Kalman.run(days, {});
  assert(!r.ok && r.reason === 'intake', 'צריך לדווח על חוסר בקלוריות');
});

test('adaptiveTDEE מזיז את הצריכה יום אחורה מול השקילה', () => {
  const days = kalmanDays(50, { startWeight: 88, tdee: 2600, intake: 2100, intakeNoise: 150 });
  const entries = days.map((d) => ({ date: d.date, weightKg: d.weight, kcal: d.intake }));
  const r = Metrics.adaptiveTDEE(entries, { endDate: days[days.length - 1].date });
  assert(r.ok, 'צריך להצליח');
  assert(r.final.intakeLag === 1, 'ברירת המחדל היא היסט של יום');
  close(r.final.tdee, 2600, 250, 'TDEE');
});

// ---------- נוסחאות הרכב גוף ----------

test('BMI', () => {
  close(BodyComp.bmi(80, 180), 24.69, 0.01, 'BMI');
  assert(BodyComp.bmi(80, null) === null, 'בלי גובה אין BMI');
});

test('Deurenberg מחזיר אחוז שומן סביר', () => {
  const male = BodyComp.bodyFatDeurenberg(88, 178, 36, 'male');
  close(male, 1.20 * BodyComp.bmi(88, 178) + 0.23 * 36 - 10.8 - 5.4, 1e-9, 'הנוסחה');
  assert(male > 15 && male < 35, 'טווח הגיוני: ' + male);
  const female = BodyComp.bodyFatDeurenberg(60, 165, 36, 'female');
  assert(female > male - 20 && female > 20, 'לאישה צפוי אחוז גבוה יותר באותו BMI');
});

test('Boer ו-Hume נותנים מסה רזה קרובה', () => {
  const boer = BodyComp.leanBoer(88, 178, 'male');
  const hume = BodyComp.leanHume(88, 178, 'male');
  assert(Math.abs(boer - hume) < 5, 'שני האומדנים צריכים להיות באותו אזור: ' + boer + ' מול ' + hume);
  assert(boer > 40 && boer < 80, 'טווח הגיוני');
});

test('BMR בשתי שיטות', () => {
  close(BodyComp.bmrMifflin(80, 180, 30, 'male'), 1780, 1, 'Mifflin');
  close(BodyComp.bmrKatchMcArdle(65), 370 + 21.6 * 65, 1e-9, 'Katch-McArdle');
  assert(BodyComp.bmrMifflin(80, null, 30, 'male') === null, 'חסרים נתונים');
});

test('בדיקת שפיות למדידת שומן', () => {
  const check = BodyComp.fatCrossCheck(22.3, 88.4, 178, 36, 'male');
  assert(check.ok, 'צריך להצליח');
  assert(check.estimates.length === 3, 'שלושה אומדנים');
  assert(Fmt => true);
  assert(check.gap !== null, 'צריך פער');
  const noProfile = BodyComp.fatCrossCheck(22.3, 88.4, null, null, 'male');
  assert(!noProfile.ok && noProfile.reason === 'profile', 'בלי פרופיל אי אפשר');
});

// ---------- יעד נגזר ופיצוי ----------

test('יעד נגזר עוקב אחרי ה-TDEE כשההתאמה האוטומטית פעילה', () => {
  const settings = { autoTargetFromTdee: true, targets: { kcal: 2000 }, goal: { ratePerWeekKg: -0.5 }, kcalPerKg: 7700 };
  const t = Metrics.derivedTarget(settings, 2850);
  close(t.kcal, 2850 - 550, 1, 'יעד לירידה של חצי קילו');
  assert(t.source === 'tdee', 'המקור הוא ה-TDEE');

  // אותו יעד קצב, TDEE אחר -> יעד אחר
  close(Metrics.derivedTarget(settings, 2600).kcal, 2050, 1, 'היעד זז עם ה-TDEE');

  settings.autoTargetFromTdee = false;
  const manual = Metrics.derivedTarget(settings, 2850);
  close(manual.kcal, 2000, 1e-9, 'כשהאוטומט כבוי היעד הידני קובע');
  assert(manual.source === 'manual', 'מקור ידני');
});

test('פיצוי בחלון נע: יום גבוה מוריד את היעד להיום', () => {
  const entries = [
    { date: '2026-03-04', kcal: 2300 },
    { date: '2026-03-05', kcal: 2300 },
    { date: '2026-03-06', kcal: 2300 },
    { date: '2026-03-07', kcal: 2300 },
    { date: '2026-03-08', kcal: 2300 },
    { date: '2026-03-09', kcal: 4000 }   // חריגה של 1700
  ];
  const r = Metrics.catchUp(entries, { targetDaily: 2300, days: 7, endDate: '2026-03-10' });
  assert(r.ok, 'צריך לרוץ');
  assert(r.loggedDays === 6, 'שישה ימים ידועים');
  close(r.perRemainingDay, 2300 * 7 - (2300 * 5 + 4000), 1e-9, 'היום צריך לקזז את כל החריגה');
  close(r.perRemainingDay, 600, 1e-9, 'כלומר 600 קלוריות');
});

test('פיצוי בלתי אפשרי מסומן ככזה ומוצע פריסה', () => {
  const entries = [{ date: '2026-03-09', kcal: 5000 }];
  const r = Metrics.catchUp(entries, { targetDaily: 2300, days: 7, endDate: '2026-03-10', floor: 1800 });
  assert(r.belowFloor, 'צריך לזהות שהמספר מתחת לרצפה');
  assert(!r.feasible, 'לא ניתן לביצוע ביום אחד');
  const overWeek = r.spread.find((s) => s.days === 7);
  assert(overWeek.feasible, 'פריסה על שבוע כן אפשרית');
  assert(overWeek.perDay > r.perRemainingDay, 'פריסה ארוכה מקלה על כל יום');
});

test('ימים בלי דיווח לא נספרים כאפס', () => {
  const withGap = [{ date: '2026-03-08', kcal: 2300 }, { date: '2026-03-09', kcal: 2300 }];
  const r = Metrics.catchUp(withGap, { targetDaily: 2300, days: 7, endDate: '2026-03-10' });
  close(r.perRemainingDay, 2300, 1e-9, 'שני ימים ביעד -> היום ביעד, בלי אשראי מדומה');
  assert(r.missingDays === 4, 'ארבעה ימים חסרים דווחו');
});

test('פיצוי במצב שבוע קלנדרי מתחלק על הימים שנותרו', () => {
  const entries = [
    { date: '2026-03-08', kcal: 3000 },
    { date: '2026-03-09', kcal: 3000 }
  ];
  // 10/03/2026 הוא יום שלישי -> נותרו שלישי עד שבת, חמישה ימים
  const r = Metrics.catchUp(entries, { targetDaily: 2000, mode: 'week', endDate: '2026-03-10' });
  assert(r.remainingDays === 5, 'חמישה ימים נותרו, קיבלתי ' + r.remainingDays);
  close(r.perRemainingDay, (2000 * 7 - 6000) / 5, 1e-9, 'החוב מתחלק על חמישה ימים');
  close(r.perRemainingDay, 1600, 1e-9, '1600 ליום');
});

test('בלי יעד אין חישוב פיצוי', () => {
  const r = Metrics.catchUp([], { targetDaily: null });
  assert(!r.ok && r.reason === 'no-target', 'צריך לדווח שאין יעד');
});

// ---------- שיטת הבלוקים ובסיס בלי צעדים ----------

test('שיטת הבלוקים משחזרת TDEE ידוע', () => {
  const lossPerDay = 500 / 7700;
  const entries = buildSeries('2026-01-01', 60, (i) => ({
    weightKg: 88 - lossPerDay * i + noise(i, 0.3),
    kcal: 2100 + noise(i * 1.7, 150)
  }));
  const r = Metrics.blockWindows(entries, { days: 14, endDate: '2026-03-01', count: 2 });
  assert(r.rows.length === 2, 'שני חלונות');
  close(r.rows[0].tdee, 2600, 250, 'TDEE מחלון של 14 יום');
  assert(r.rows[0].ci95 > 0, 'צריך רווח סמך');
});

test('רווח הסמך של שיטת הבלוקים גדל ככל שהחלון קצר', () => {
  const entries = buildSeries('2026-01-01', 60, (i) => ({
    weightKg: 88 - 0.065 * i + noise(i, 0.5),
    kcal: 2100 + noise(i * 1.7, 400)
  }));
  const short = Metrics.blockWindows(entries, { days: 5, endDate: '2026-03-01', count: 1 });
  const long = Metrics.blockWindows(entries, { days: 14, endDate: '2026-03-01', count: 1 });
  assert(short.rows[0].ci95 > long.rows[0].ci95 * 1.5,
    'חלון של 5 ימים חייב להיות רועש בהרבה (' + Math.round(short.rows[0].ci95) + ' מול ' + Math.round(long.rows[0].ci95) + ')');
});

test('אומדן רעש השקילה מהנתונים', () => {
  const quiet = buildSeries('2026-01-01', 40, (i) => ({ weightKg: 88 + noise(i, 0.15) }));
  const noisy = buildSeries('2026-01-01', 40, (i) => ({ weightKg: 88 + noise(i, 1.2) }));
  assert(Metrics.weightNoiseSd(noisy) > Metrics.weightNoiseSd(quiet), 'סדרה רועשת -> אומדן גבוה יותר');
});

test('בסיס בלי צעדים מחסיר את תרומת ההליכה', () => {
  const entries = buildSeries('2026-01-01', 40, (i) => ({
    weightKg: 88 - 0.065 * i + noise(i, 0.3),
    kcal: 2100 + noise(i * 1.7, 150),
    steps: 10000
  }));
  const r = Metrics.baselineWithoutSteps(entries, { kcalPerStep: 0.03 }, { tdee: 2800, tdeeCi: 300, endDate: '2026-02-09' });
  close(r.meanSteps, 10000, 1, 'צעדים ממוצעים');
  close(r.stepKcal, 300, 1, 'תרומת הצעדים');
  close(r.base, 2500, 1, 'בסיס');
  assert(r.ci95 > 300, 'אי-הוודאות גדלה בגלל הקבוע לצעד: ' + Math.round(r.ci95));
  close(r.maintenanceAt(10000), 2800, 1, 'חזרה ל-TDEE המקורי');
  close(r.maintenanceAt(0), 2500, 1, 'אפס צעדים');
  close(r.maintenanceAt(20000), 3100, 1, 'צעדים כפולים');
});

test('קבוע גבוה לצעד מוריד את הבסיס', () => {
  const entries = buildSeries('2026-01-01', 40, () => ({ weightKg: 88, kcal: 2100, steps: 10000 }));
  const low = Metrics.baselineWithoutSteps(entries, {}, { tdee: 2800, tdeeCi: 300, kcalPerStep: 0.025, endDate: '2026-02-09' });
  const high = Metrics.baselineWithoutSteps(entries, {}, { tdee: 2800, tdeeCi: 300, kcalPerStep: 0.040, endDate: '2026-02-09' });
  close(low.base, 2550, 1, 'קבוע נמוך');
  close(high.base, 2400, 1, 'קבוע גבוה');
});

test('בלי נתוני צעדים הבסיס שווה ל-TDEE', () => {
  const entries = buildSeries('2026-01-01', 40, () => ({ weightKg: 88, kcal: 2100 }));
  const r = Metrics.baselineWithoutSteps(entries, {}, { tdee: 2800, tdeeCi: 300, endDate: '2026-02-09' });
  assert(r.meanSteps === null, 'אין צעדים');
  close(r.base, 2800, 1e-9, 'הבסיס לא משתנה');
});

test('ההמלצה לעולם לא יורדת מתחת למינימום הבטוח', () => {
  const entries = [{ date: '2026-03-09', kcal: 5000 }];
  const r = Metrics.catchUp(entries, { targetDaily: 2300, days: 7, endDate: '2026-03-10', floor: 1800 });
  assert(!r.feasible, 'ביום אחד זה לא סביר');
  assert(r.recommended.spread, 'ההמלצה צריכה להיות פריסה');
  assert(r.recommended.perDay >= 1800, 'ההמלצה מעל הרצפה: ' + Math.round(r.recommended.perDay));
  assert(r.recommended.days > 1, 'על פני יותר מיום');

  const easy = Metrics.catchUp([{ date: '2026-03-09', kcal: 2300 }],
    { targetDaily: 2300, days: 7, endDate: '2026-03-10', floor: 1800 });
  assert(!easy.recommended.spread, 'כשהכול תקין אין פריסה');
  close(easy.recommended.perDay, 2300, 1e-9, 'ההמלצה היא היעד');
});

// ---------- מאזן אנרגיה ----------

function balanceFixture() {
  // בסיס אמיתי 2500, צעדים 10000 -> TDEE 2800
  return buildSeries('2026-01-01', 40, (i) => ({
    weightKg: 88 - (300 / 7700) * i + noise(i, 0.25),
    kcal: 2500,
    steps: 10000
  }));
}

test('מאזן אנרגיה מפריד בין תזונה בלבד לבין הכל', () => {
  const entries = balanceFixture();
  const settings = { kcalPerKg: 7700, kcalPerStep: 0.03, goal: { ratePerWeekKg: -0.5 } };
  const r = Metrics.energyBalance(entries, settings, { date: '2026-02-09', windowDays: 7 });
  assert(r.ok, 'צריך לרוץ');

  const p = r.period;
  close(p.stepKcal, 300, 1, 'קלוריות מצעדים');
  close(p.nutritionDeficit, r.base - 2500, 1e-9, 'גירעון מתזונה בלבד');
  close(p.totalDeficit, p.nutritionDeficit + 300, 1e-9, 'גירעון כולל');
  close(p.totalRate * 7700 / 7, -p.totalDeficit, 1e-9, 'הקצב עקבי עם הגירעון');
  assert(p.totalDeficit > p.nutritionDeficit, 'הצעדים מגדילים את הגירעון');
});

test('ההפרש לסגור מחושב בנפרד לתזונה ולכולל', () => {
  const entries = balanceFixture();
  const settings = { kcalPerKg: 7700, kcalPerStep: 0.03, goal: { ratePerWeekKg: -0.5 } };
  const r = Metrics.energyBalance(entries, settings, { date: '2026-02-09', windowDays: 7 });
  close(r.goalDeficit, 550, 1, 'גירעון נדרש לחצי קילו');

  const p = r.period;
  close(p.gapNutrition, 550 - p.nutritionDeficit, 1e-9, 'הפרש לתזונה בלבד');
  close(p.gapTotal, 550 - p.totalDeficit, 1e-9, 'הפרש כולל');
  assert(p.gapNutrition - p.gapTotal > 299, 'ההפרש בין השניים הוא בדיוק תרומת הצעדים');

  // אכילה לפי intakeForGoal סוגרת את הפער בדיוק.
  // נבדק אלגברית ולא בהזנה חוזרת, כי שינוי הצריכה היה משנה גם את אומדן ה-TDEE.
  close(r.base - p.intakeForGoalTotal + p.stepKcal, r.goalDeficit, 1e-9, 'הצריכה המתוקנת נותנת בדיוק את הגירעון הדרוש');
  close(r.base - p.intakeForGoalNutrition, r.goalDeficit, 1e-9, 'ובלי צעדים, אותו דבר');
});

test('צעדים נוספים כתחליף לקיצוץ בקלוריות', () => {
  const entries = balanceFixture();
  const settings = { kcalPerKg: 7700, kcalPerStep: 0.03, goal: { ratePerWeekKg: -0.5 } };
  const p = Metrics.energyBalance(entries, settings, { date: '2026-02-09', windowDays: 7 }).period;
  if (p.gapTotal > 0) {
    close(p.extraSteps * settings.kcalPerStep, p.gapTotal, 1e-6, 'הצעדים הנוספים שווים בדיוק לפער');
  } else {
    close(p.extraSteps, 0, 1e-9, 'אין פער -> אין צורך בצעדים נוספים');
  }
});

test('יום בלי דיווח מסומן ולא מחושב כאפס', () => {
  const entries = balanceFixture();
  const settings = { kcalPerKg: 7700, kcalPerStep: 0.03, goal: { ratePerWeekKg: -0.5 } };
  const r = Metrics.energyBalance(entries, settings, { date: '2026-02-15', windowDays: 7 });
  assert(!r.today.ok, 'ליום ללא רשומה אין מאזן');
  assert(r.period.ok, 'אבל לתקופה כן');
});

// ---------- שיטות ובחירה ביניהן ----------

test('כל השיטות מוחזרות עם חשבון גלוי', () => {
  const entries = buildSeries('2026-01-01', 45, (i) => ({
    weightKg: 88 - (500 / 7700) * i + noise(i, 0.3),
    kcal: 2100 + noise(i * 1.7, 150),
    steps: 9000
  }));
  const r = Metrics.tdeeMethods(entries, { kcalPerKg: 7700, kcalPerStep: 0.03 }, { endDate: '2026-02-14' });
  const ids = r.methods.map((m) => m.id);
  ['kalman', 'regression', 'block14', 'block7'].forEach((id) => {
    assert(ids.indexOf(id) !== -1, 'חסרה שיטה: ' + id);
  });
  r.methods.forEach((m) => {
    assert(m.derivation.length >= 5, m.id + ': החשבון צריך להיות מפורט');
    assert(m.formula && m.summary, m.id + ': חסרה נוסחה או הסבר');
    close(m.base, m.tdee - 9000 * 0.03, 1, m.id + ': בסיס בלי צעדים');
  });
});

test('הבחירה בשיטה קובעת מי נבחר', () => {
  const entries = buildSeries('2026-01-01', 45, (i) => ({
    weightKg: 88 - 0.065 * i + noise(i, 0.3),
    kcal: 2100, steps: 9000
  }));
  const dflt = Metrics.tdeeMethods(entries, {}, { endDate: '2026-02-14' });
  assert(dflt.chosen.id === 'kalman', 'ברירת המחדל היא קלמן');

  const picked = Metrics.tdeeMethods(entries, { tdeeMethod: 'block14' }, { endDate: '2026-02-14' });
  assert(picked.chosen.id === 'block14', 'הבחירה נשמרה');

  const bogus = Metrics.tdeeMethods(entries, { tdeeMethod: 'nope' }, { endDate: '2026-02-14' });
  assert(bogus.chosen.id === 'kalman', 'שיטה לא מוכרת נופלת לברירת מחדל');
});

test('מאזן האנרגיה מקבל TDEE חיצוני', () => {
  const entries = buildSeries('2026-01-01', 40, () => ({ weightKg: 88, kcal: 2400, steps: 10000 }));
  const settings = { kcalPerKg: 7700, kcalPerStep: 0.03, goal: { ratePerWeekKg: -0.5 } };
  const a = Metrics.energyBalance(entries, settings, { date: '2026-02-09', tdee: 2800, tdeeCi: 300 });
  const b = Metrics.energyBalance(entries, settings, { date: '2026-02-09', tdee: 2500, tdeeCi: 300 });
  close(a.base, 2500, 1, 'בסיס לפי TDEE של 2800');
  close(b.base, 2200, 1, 'בסיס לפי TDEE של 2500');
  assert(a.period.nutritionDeficit > b.period.nutritionDeficit, 'שיטה אחרת -> מאזן אחר');
});

// ---------- משיכה מהגיליון ----------

test('המרת תאריכים מכל הפורמטים שהגיליון מחזיר', () => {
  assert(Sheets.toIso('21/08/2026') === '2026-08-21', 'DD/MM/YYYY');
  assert(Sheets.toIso('2026-08-21') === '2026-08-21', 'ISO');
  assert(Sheets.toIso('2026-08-21T00:00:00.000Z') === '2026-08-21', 'חותמת זמן מלאה');
  assert(Sheets.toIso('1/8/26') === '2026-08-01', 'ספרה בודדת ושנה מקוצרת');
  assert(Sheets.toIso('') === null, 'ריק');
  assert(Sheets.toIso('שלום') === null, 'טקסט');
});

test('שורות תזונה הופכות לרשומות', () => {
  const rows = [
    ['20/08/2026', 2880, 111.6, 216.3, 171.5, 26.3, 10712],
    ['19/08/2026', 2552, 113.9, 196.8, 175.0, 28.0, 9755]
  ];
  const entries = Sheets.rowsToEntries(rows, Sheets.NUTRITION_COLUMNS);
  assert(entries.length === 2, 'שתי רשומות');
  close(entries[0].kcal, 2880, 1e-9, 'קלוריות');
  close(entries[0].fatG, 111.6, 1e-9, 'שומן תזונתי');
  close(entries[0].carbG, 216.3, 1e-9, 'פחמימות');
  close(entries[0].proteinG, 171.5, 1e-9, 'חלבון');
  close(entries[0].fiberG, 26.3, 1e-9, 'סיבים');
  close(entries[0].steps, 10712, 1e-9, 'צעדים');
});

test('שורות מדדי גוף הופכות לרשומות', () => {
  const rows = [['21/08/2026', 88.4, 35.4, 22.3, 48.5]];
  const entries = Sheets.rowsToEntries(rows, Sheets.BODY_COLUMNS);
  close(entries[0].weightKg, 88.4, 1e-9, 'משקל');
  close(entries[0].muscleKg, 35.4, 1e-9, 'שריר');
  close(entries[0].bodyFatKg, 22.3, 1e-9, 'שומן גוף');
  close(entries[0].waterKg, 48.5, 1e-9, 'נוזלים');
});

test('שורות פגומות מדולגות בלי להפיל', () => {
  const rows = [[], ['לא תאריך', 1, 2], ['21/08/2026'], ['22/08/2026', 88.4]];
  const entries = Sheets.rowsToEntries(rows, Sheets.BODY_COLUMNS);
  assert(entries.length === 1, 'רק שורה אחת תקינה, קיבלתי ' + entries.length);
  assert(entries[0].date === '2026-08-22', 'התאריך הנכון');
});

test('מיזוג שני המקורות לפי תאריך', () => {
  const merged = Sheets.merge([
    [{ date: '2026-08-20', kcal: 2880 }],
    [{ date: '2026-08-20', weightKg: 88.4 }, { date: '2026-08-21', weightKg: 88.4 }]
  ]);
  assert(merged.length === 2, 'שני תאריכים');
  close(merged[0].kcal, 2880, 1e-9, 'התזונה נשמרה');
  close(merged[0].weightKg, 88.4, 1e-9, 'והמשקל התווסף לאותו יום');
});

test('משיכה מלאה עם רשת מדומה', () => {
  const calls = [];
  const transport = (url) => {
    calls.push(url);
    if (url.indexOf('getNutrition') !== -1) {
      return Promise.resolve({ success: true, data: [['20/08/2026', 2880, 111.6, 216.3, 171.5, 26.3, 10712]] });
    }
    if (url.indexOf('getMetrics') !== -1) {
      return Promise.resolve({ success: true, data: [['21/08/2026', 88.4, 35.4, 22.3, 48.5]] });
    }
    return Promise.resolve({ success: false });
  };

  let result = null;
  Sheets.pull('https://example.test/exec', { transport }).then((r) => { result = r; });
  return new Promise((resolve) => setImmediate(resolve)).then(() => {
    assert(result, 'המשיכה לא הסתיימה');
    assert(result.entries.length === 2, 'שתי רשומות, קיבלתי ' + result.entries.length);
    assert(result.nutrition.action === 'getNutrition', 'זוהתה פעולת התזונה');
    assert(result.body.action === 'getMetrics', 'זוהתה פעולת מדדי הגוף');
  });
});

test('כתובת לא תקינה נדחית מיד', () => {
  let rejected = false;
  Sheets.pull('ftp://nope', { transport: () => Promise.resolve({}) }).catch(() => { rejected = true; });
  return new Promise((resolve) => setImmediate(resolve)).then(() => {
    assert(rejected, 'צריך לדחות כתובת שאינה https');
  });
});

test('כשלון רשת בפעולה אחת לא מפיל את השנייה', () => {
  const transport = (url) => url.indexOf('getNutrition') !== -1
    ? Promise.resolve({ success: true, data: [['20/08/2026', 2000, 60, 200, 150, 20, 8000]] })
    : Promise.reject(new Error('network'));

  let result = null;
  Sheets.pull('https://example.test/exec', { transport }).then((r) => { result = r; });
  return new Promise((resolve) => setImmediate(resolve)).then(() => {
    assert(result, 'צריך להצליח חלקית');
    assert(result.body.action === null, 'מדדי הגוף לא נמצאו');
    assert(result.entries.length === 1, 'התזונה כן נמשכה');
  });
});

test('מיזוג לא מוחק שדות שהמקור החדש לא מכיל', () => {
  Store.clearAll();
  Store.upsert({ date: '2026-08-21', weightKg: 88.4, bodyFatKg: 22.3, muscleKg: 35.4 });
  // מקור שמביא רק תזונה לאותו יום
  Store.importJSON(JSON.stringify({
    entries: [{ date: '2026-08-21', kcal: 2840, proteinG: 223, updatedAt: '2030-01-01T00:00:00.000Z' }]
  }), 'merge');
  const e = Store.getEntry('2026-08-21');
  close(e.weightKg, 88.4, 1e-9, 'המשקל שרד');
  close(e.bodyFatKg, 22.3, 1e-9, 'השומן שרד');
  close(e.muscleKg, 35.4, 1e-9, 'השריר שרד');
  close(e.kcal, 2840, 1e-9, 'הקלוריות נוספו');
});

test('בהתנגשות על אותו שדה, החדש מנצח והישן משלים', () => {
  Store.clearAll();
  Store.upsert({ date: '2026-08-21', weightKg: 88.4, muscleKg: 35.4 });
  Store.importJSON(JSON.stringify({
    entries: [{ date: '2026-08-21', weightKg: 87.9, updatedAt: '2030-01-01T00:00:00.000Z' }]
  }), 'merge');
  close(Store.getEntry('2026-08-21').weightKg, 87.9, 1e-9, 'הערך החדש גבר');
  close(Store.getEntry('2026-08-21').muscleKg, 35.4, 1e-9, 'והשדה השני נשמר');

  Store.importJSON(JSON.stringify({
    entries: [{ date: '2026-08-21', weightKg: 99, waterKg: 48.5, updatedAt: '2000-01-01T00:00:00.000Z' }]
  }), 'merge');
  const e = Store.getEntry('2026-08-21');
  close(e.weightKg, 87.9, 1e-9, 'רשומה ישנה לא דורסת ערך קיים');
  close(e.waterKg, 48.5, 1e-9, 'אבל כן מוסיפה שדה שחסר');
});

test('חותמת זמן מגיליון מומרת לפי אזור הזמן המקומי', () => {
  // 22/08 בישראל מגיע כ-21/08T21:00Z. חיתוך לפני ה-T היה נותן 21/08.
  const local = new Date('2026-08-21T21:00:00.000Z');
  const expected = local.getFullYear() + '-' +
    String(local.getMonth() + 1).padStart(2, '0') + '-' +
    String(local.getDate()).padStart(2, '0');
  assert(Sheets.toIso('2026-08-21T21:00:00.000Z') === expected,
    'ציפיתי ל-' + expected + ', קיבלתי ' + Sheets.toIso('2026-08-21T21:00:00.000Z'));
  assert(Sheets.toIso(new Date('2026-08-21T21:00:00.000Z')) === expected, 'גם אובייקט Date');
  // מחרוזת בלי שעה נשארת כמו שהיא, בלי שום המרה
  assert(Sheets.toIso('2026-08-22') === '2026-08-22', 'תאריך טקסטואלי לא זז');
  assert(Sheets.toIso('22/08/2026') === '2026-08-22', 'וגם DD/MM/YYYY');
});

test('פעולת מדדי הגוף הנכונה היא get', () => {
  assert(Sheets.BODY_ACTIONS[0] === 'get', 'get צריכה להיות ראשונה');
  const transport = (url) => url.indexOf('action=get&') !== -1 || url.endsWith('action=get')
    ? Promise.resolve({ success: true, data: [['21/08/2026', 88.4, 35.4, 22.3, 48.5]] })
    : Promise.resolve({ success: false });
  let result = null;
  Sheets.pull('https://example.test/exec', { transport }).then((r) => { result = r; });
  return new Promise((resolve) => setImmediate(resolve)).then(() => {
    assert(result && result.body.action === 'get', 'לא נבחרה הפעולה get');
    close(result.entries[0].weightKg, 88.4, 1e-9, 'משקל');
    close(result.entries[0].muscleKg, 35.4, 1e-9, 'שריר');
  });
});

// ---------- דוח התקדמות ----------

test('דוח התקדמות מודד שינוי בין בלוקים', () => {
  // ירידה של 100 גרם ליום
  const entries = buildSeries('2026-01-01', 40, (i) => ({
    weightKg: 90 - 0.1 * i,
    bodyFatKg: (90 - 0.1 * i) * 0.25
  }));
  const r = Metrics.progressReport(entries, { goal: { ratePerWeekKg: -0.7 }, kcalPerKg: 7700 },
    { endDate: '2026-02-09' });

  const three = r.rows.find((x) => x.days === 3);
  close(three.weightChange, -0.3, 1e-9, 'שלושה ימים = 300 גרם');
  assert(three.noisy, 'שלושה ימים מסומן כרועש');

  const seven = r.rows.find((x) => x.days === 7);
  close(seven.weightChange, -0.7, 1e-9, 'שבוע = 700 גרם');
  assert(!seven.noisy, 'שבוע לא מסומן כרועש');

  // כל שורה חייבת להחזיר מספר אמיתי או null מפורש, לא NaN
  r.rows.forEach((row) => {
    [row.weightChange, row.fatPctChange, row.weightNow, row.fatPctNow].forEach((v) => {
      assert(v === null || (typeof v === 'number' && isFinite(v)),
        row.days + ' ימים: ערך לא תקין ' + v);
    });
  });
  close(r.rows.find((x) => x.days === 14).weightChange, -1.4, 1e-9, 'שבועיים = 1.4 ק"ג');
});

test('השוואה לתוכנית מסווגת נכון', () => {
  function rate(perDay) {
    return buildSeries('2026-01-01', 30, (i) => ({ weightKg: 90 - perDay * i }));
  }
  const settings = { goal: { ratePerWeekKg: -0.5 }, kcalPerKg: 7700 };
  const end = '2026-01-30';

  const onTrack = Metrics.progressReport(rate(0.5 / 7), settings, { endDate: end }).plan;
  assert(onTrack.status === 'onTrack', 'בקצב: ' + onTrack.status);
  close(onTrack.kcalAdjustment, 0, 1, 'אין צורך בתיקון');

  assert(Metrics.progressReport(rate(0.1 / 7), settings, { endDate: end }).plan.status === 'behind', 'איטי');
  assert(Metrics.progressReport(rate(1.2 / 7), settings, { endDate: end }).plan.status === 'fast', 'מהיר');
  assert(Metrics.progressReport(rate(-0.3 / 7), settings, { endDate: end }).plan.status === 'wrongWay', 'כיוון הפוך');
});

test('תיקון הקלוריות המוצע מחזיר לקצב המתוכנן', () => {
  // יורד 0.2 בשבוע במקום 0.5 -> חסר גירעון של 0.3 ק"ג בשבוע
  const entries = buildSeries('2026-01-01', 30, (i) => ({ weightKg: 90 - (0.2 / 7) * i }));
  const plan = Metrics.progressReport(entries, { goal: { ratePerWeekKg: -0.5 }, kcalPerKg: 7700 },
    { endDate: '2026-01-30' }).plan;
  close(plan.kcalAdjustment, 0.3 * 7700 / 7, 5, 'כ-330 קלוריות ליום');
  assert(plan.kcalAdjustment > 0, 'חיובי = צריך לקצץ');
});

test('בלי יעד אין השוואה לתוכנית', () => {
  const entries = buildSeries('2026-01-01', 30, (i) => ({ weightKg: 90 - 0.05 * i }));
  assert(!Metrics.progressReport(entries, { goal: {} }, { endDate: '2026-01-30' }).plan.ok, 'אין תוכנית');
});

// ---------- דוח החלון ----------

function windowFixture() {
  // אמת: בסיס 2500, צעדים 10000 (=300), TDEE 2800, אכילה 2200 -> גירעון 600
  return buildSeries('2026-01-01', 60, (i) => ({
    weightKg: 90 - (600 / 7700) * i + noise(i, 0.2),
    bodyFatKg: 25 - (480 / 7700) * i + noise(i * 1.1, 0.15),
    muscleKg: 36 + noise(i * 0.7, 0.1),
    kcal: 2200,
    steps: 10000
  }));
}

const WIN_SETTINGS = { kcalPerKg: 7700, kcalPerStep: 0.03, goal: { ratePerWeekKg: -0.5 } };

test('דוח החלון עובד לכל אורך חלון שיש לו כיסוי מלא', () => {
  const entries = windowFixture();   // 60 ימים -> עד חלון 28 בדיוק
  [3, 5, 7, 10, 14, 21, 28, 'adaptive'].forEach((w) => {
    const r = Metrics.windowReport(entries, WIN_SETTINGS, { windowDays: w, endDate: '2026-03-01' });
    assert(r.ok, 'חלון ' + w + ' נכשל');
    assert(isFinite(r.tdee), 'חלון ' + w + ': TDEE לא תקין');
    close(r.base, r.tdee - 300, 1, 'חלון ' + w + ': בסיס בלי צעדים');
  });
});

test('היעד היומי נגזר מהבסיס ומהקצב שנבחר', () => {
  const entries = windowFixture();
  const r = Metrics.windowReport(entries, WIN_SETTINGS, { windowDays: 14, endDate: '2026-03-01' });
  close(r.deficitPerDay, 550, 1, 'גירעון לחצי קילו בשבוע');
  close(r.target, r.base - 550, 1, 'יעד = בסיס פחות גירעון');

  const gentle = Metrics.windowReport(entries,
    Object.assign({}, WIN_SETTINGS, { goal: { ratePerWeekKg: -0.25 } }),
    { windowDays: 14, endDate: '2026-03-01' });
  assert(gentle.target > r.target, 'קצב איטי יותר -> יעד גבוה יותר');

  const maintain = Metrics.windowReport(entries,
    Object.assign({}, WIN_SETTINGS, { goal: { ratePerWeekKg: 0 } }),
    { windowDays: 14, endDate: '2026-03-01' });
  close(maintain.target, maintain.base, 1e-9, 'שמירה = הבסיס עצמו');
});

test('הירידה התאורטית עם ובלי צעדים נבדלת בדיוק בתרומת ההליכה', () => {
  const entries = windowFixture();
  const r = Metrics.windowReport(entries, WIN_SETTINGS, { windowDays: 14, endDate: '2026-03-01' });
  const diff = r.theoretical.withSteps - r.theoretical.withoutSteps;
  close(diff, -(300 * 14) / 7700, 0.01, 'ההפרש הוא בדיוק הקלוריות מהצעדים');
  assert(r.theoretical.withSteps < r.theoretical.withoutSteps, 'עם צעדים יורדים יותר');
});

test('שינוי שומן ושריר מדווחים בנפרד', () => {
  const entries = windowFixture();
  const r = Metrics.windowReport(entries, WIN_SETTINGS, { windowDays: 14, endDate: '2026-03-01' });
  assert(r.actual.fatChange < -0.5, 'השומן ירד: ' + r.actual.fatChange);
  assert(Math.abs(r.actual.muscleChange) < 0.3, 'השריר כמעט לא זז: ' + r.actual.muscleChange);
  assert(r.actual.weightChange < 0, 'המשקל ירד');
});

test('עמידה ביעד נמדדת מול היעד המחושב', () => {
  const entries = windowFixture();
  const r = Metrics.windowReport(entries, WIN_SETTINGS, { windowDays: 14, endDate: '2026-03-01' });
  close(r.intake.mean, 2200, 1, 'צריכה ממוצעת');
  close(r.gapPerDay, 2200 - r.target, 1, 'פער יומי מול היעד');
  close(r.gapTotal, r.gapPerDay * r.intake.days, 1e-6, 'פער מצטבר');
});

test('הפיצוי סוגר את הפער של השבוע האחרון בלבד', () => {
  const entries = windowFixture();
  const r = Metrics.windowReport(entries, WIN_SETTINGS, { windowDays: 14, endDate: '2026-03-01' });
  assert(r.recent.days === 7, 'הפיצוי צריך להתבסס על שבעה ימים, לא על ' + r.recent.days);

  r.compensation.forEach((c) => {
    close(c.perDay * c.days, r.target * c.days - r.recent.gap, 0.01,
      c.days + ' ימים: הפיצוי לא סוגר את הפער');
  });

  const single = r.compensation.find((c) => c.days === 1);
  const week = r.compensation.find((c) => c.days === 7);
  if (r.recent.gap > 0) assert(week.perDay > single.perDay, 'פריסה ארוכה מקלה');
});

test('חריגה גדולה: סגירה ביום אחד נפסלת, פריסה על שבוע מתאפשרת', () => {
  const entries = buildSeries('2026-01-01', 40, (i) => ({
    weightKg: 90 + 0.02 * i, kcal: 3500, steps: 10000
  }));
  const r = Metrics.windowReport(entries, WIN_SETTINGS, { windowDays: 14, endDate: '2026-02-09' });

  assert(r.recent.days === 7 && r.recent.loggedDays <= 7, 'הפער חושב על יותר משבוע');
  assert(!r.compensation.find((c) => c.days === 1).feasible, 'יום אחד לא אמור להיות אפשרי');
  assert(r.compensation.find((c) => c.days === 7).feasible, 'שבוע כן אמור להיות אפשרי');
  assert(r.compensationFeasible, 'צריך להיות סימון שקיימת דרך סבירה');
});

test('כשאף פריסה לא עוברת את הרצפה, זה מסומן', () => {
  // רצפה גבוהה מדמה את המקרה שבו כל האפשרויות יורדות נמוך מדי
  const entries = buildSeries('2026-01-01', 40, (i) => ({
    weightKg: 90 + 0.02 * i, kcal: 3500, steps: 10000
  }));
  const r = Metrics.windowReport(entries, WIN_SETTINGS,
    { windowDays: 14, endDate: '2026-02-09', floor: 3000 });
  assert(r.compensationFeasible === false, 'היה צריך לסמן שאין דרך סבירה');
  assert(r.compensation.every((c) => !c.feasible), 'אף אפשרות לא אמורה להיות סבירה');
});

test('כשהצריכה עצמה גבוהה, ההערכה עולה איתה והיעד נשאר בר־השגה', () => {
  // אכילה של 6000 עם עלייה איטית -> ההוצאה הנמדדת גבוהה, ולכן
  // גם היעד גבוה, והפער ניתן לסגירה. זו התנהגות נכונה ולא באג.
  const entries = buildSeries('2026-01-01', 40, (i) => ({
    weightKg: 90 + 0.05 * i, kcal: 6000, steps: 10000
  }));
  const r = Metrics.windowReport(entries, WIN_SETTINGS, { windowDays: 14, endDate: '2026-02-09' });
  assert(r.target > 3000, 'היעד צריך לעלות עם ההוצאה, קיבלתי ' + Math.round(r.target));
  assert(r.compensationFeasible, 'הפער אמור להיות ניתן לסגירה');
});

test('חלון דורש כיסוי מלא של שתי התקופות', () => {
  // 27 ימי נתונים: חלון 13 אפשרי (26 ימים), חלון 14 לא (28 ימים)
  const entries = buildSeries('2026-01-01', 27, (i) => ({
    weightKg: 90 - 0.05 * i, kcal: 2200, steps: 9000
  }));
  const end = '2026-01-27';

  const ok = Metrics.windowReport(entries, WIN_SETTINGS, { windowDays: 13, endDate: end });
  assert(ok.ok, 'חלון 13 היה צריך לעבוד');
  assert(ok.block && ok.block.complete, 'החלון צריך להיות מסומן כמלא');

  const tooLong = Metrics.windowReport(entries, WIN_SETTINGS, { windowDays: 14, endDate: end });
  assert(!tooLong.ok && tooLong.reason === 'window', 'חלון 14 היה צריך להיפסל');
  assert(tooLong.needDays === 28, 'צריך 28 ימים');
  assert(tooLong.haveDays === 27, 'יש 27 ימים');
  assert(tooLong.missingDays === 1, 'חסר יום אחד');
});

test('חלון לא זמין לא נופל בשקט לשיטה אחרת', () => {
  const entries = buildSeries('2026-01-01', 27, (i) => ({
    weightKg: 90 - 0.05 * i, kcal: 2200, steps: 9000
  }));
  const r = Metrics.windowReport(entries, WIN_SETTINGS, { windowDays: 28, endDate: '2026-01-27' });
  assert(!r.ok, 'חלון 28 עם 27 ימי נתונים חייב להיכשל');
  assert(r.tdee === undefined, 'אסור להחזיר הערכה מחלון אחר');
});

test('רשימת החלונות הזמינים מדויקת', () => {
  const entries = buildSeries('2026-01-01', 27, (i) => ({
    weightKg: 90 - 0.05 * i, kcal: 2200, steps: 9000
  }));
  const list = Metrics.availableWindows(entries, { endDate: '2026-01-27' });
  const byDays = {};
  list.forEach((w) => { byDays[w.days] = w; });

  [3, 5, 7, 10].forEach((n) => assert(byDays[n].available, 'חלון ' + n + ' היה צריך להיות זמין'));
  [14, 21, 28].forEach((n) => assert(!byDays[n].available, 'חלון ' + n + ' לא היה צריך להיות זמין'));
  assert(byDays[28].missingDays === 29, 'לחלון 28 חסרים 29 ימים, קיבלתי ' + byDays[28].missingDays);
});

test('חלון בלי מספיק שקילות אינו נחשב מלא', () => {
  // מספיק ימים בטווח, אבל שקילות רק בחלק מהם
  const entries = buildSeries('2026-01-01', 20, (i) => {
    const row = { kcal: 2200, steps: 9000 };
    if (i % 5 === 0) row.weightKg = 90 - 0.05 * i;
    return row;
  });
  const r = Metrics.windowReport(entries, WIN_SETTINGS, { windowDays: 7, endDate: '2026-01-20' });
  assert(!r.ok, 'חלון עם 1-2 שקילות בלבד לא אמור להיחשב מלא');
});

test('שינוי בפועל נופל לחלון קצר יותר כשאין תקופה קודמת', () => {
  // 27 ימי נתונים בלבד: חלון 28 לא ימצא תקופה קודמת
  const entries = buildSeries('2026-01-01', 27, (i) => ({
    weightKg: 90 - 0.05 * i, bodyFatKg: 25 - 0.04 * i, muscleKg: 36, kcal: 2200, steps: 9000
  }));
  const r = Metrics.windowReport(entries, WIN_SETTINGS, { windowDays: 'adaptive', endDate: '2026-01-27' });
  assert(r.ok, 'הדוח נכשל למרות שיש נתונים');
  assert(r.actual.weightChange !== null, 'לא נמצא שינוי בפועל למרות שיש נתונים');
  assert(r.changeDays < 28, 'היה צריך לרדת לחלון קצר יותר, נשאר ' + r.changeDays);
  assert(r.actual.weightChange < 0, 'המשקל ירד');
});

test('חלון קצר מסומן כפחות אמין מחלון ארוך', () => {
  const noisy = buildSeries('2026-01-01', 60, (i) => ({
    weightKg: 90 - 0.07 * i + noise(i, 0.7),
    kcal: 2200 + noise(i * 1.9, 500),
    steps: 10000
  }));
  const short = Metrics.windowReport(noisy, WIN_SETTINGS, { windowDays: 3, endDate: '2026-03-01' });
  const long = Metrics.windowReport(noisy, WIN_SETTINGS, { windowDays: 28, endDate: '2026-03-01' });
  assert(short.ci95 > long.ci95, 'חלון קצר חייב להיות רועש יותר');
  assert(short.reliability === 'low', 'שלושה ימים צריכים להיות בעלי אמינות נמוכה');
});

test('בלי נתונים הדוח נכשל בשקט', () => {
  const r = Metrics.windowReport([], WIN_SETTINGS, { windowDays: 14, endDate: '2026-03-01' });
  assert(!r.ok && r.reason === 'insufficient', 'צריך לדווח חוסר נתונים');
});

test('רישום צעדים היום לא מזיז את היעד', () => {
  const entries = windowFixture();
  const before = Metrics.windowReport(entries, WIN_SETTINGS, { windowDays: 14, endDate: '2026-03-01' });

  // מוסיפים הליכה חריגה ביום האחרון
  const withWalk = entries.map((e) => e.date === '2026-03-01'
    ? Object.assign({}, e, { steps: 30000 }) : e);
  const after = Metrics.windowReport(withWalk, WIN_SETTINGS, { windowDays: 14, endDate: '2026-03-01' });

  close(after.target, before.target, 1e-9, 'היעד זז בגלל צעדים של היום');
  close(after.base, before.base, 1e-9, 'הבסיס זז בגלל צעדים של היום');
});

test('כל שלב במסנן שומר את החשבון שהוביל אליו', () => {
  const days = kalmanDays(30, { startWeight: 88, tdee: 2600, intake: 2100, intakeNoise: 100 });
  const r = Kalman.run(days, {});
  const s = r.states[10];

  assert(isFinite(s.predictedWeight), 'חסר המשקל שנוּבא');
  assert(isFinite(s.measuredWeight), 'חסר המשקל שנמדד');
  close(s.residual, s.measuredWeight - s.predictedWeight, 1e-9, 'ההפרש לא תואם');
  assert(isFinite(s.tdeeBefore), 'חסרה ההערכה שלפני התיקון');

  // התיקון תמיד בכיוון ההפרש: משקל גבוה מהצפוי -> שורף פחות ממה שחשבנו
  const moved = s.tdee - s.tdeeBefore;
  if (Math.abs(s.residual) > 0.01) {
    assert((s.residual > 0) === (moved < 0),
      'כיוון התיקון שגוי: הפרש ' + s.residual.toFixed(2) + ' הזיז את ההערכה ב-' + moved.toFixed(0));
  }

  // הניבוי נגזר מהיום הקודם לפי מאזן האנרגיה
  const prev = r.states[9];
  close(s.predictedWeight, prev.weight + (prev.intake - prev.tdee) / 7700, 1e-9,
    'הניבוי לא תואם את מאזן האנרגיה');
});

test('המעבר לאחור מדייק את ההיסטוריה בלי לגעת בהווה', () => {
  const days = kalmanDays(60, { startWeight: 88, tdee: 2600, intake: 2100, intakeNoise: 150 });
  const r = Kalman.run(days, {});

  const filteredTail = r.states.slice(10).map((s) => s.tdee);
  const smoothTail = r.states.slice(10).map((s) => s.smoothTdee);
  const rmse = (a) => Math.sqrt(a.reduce((sum, v) => sum + (v - 2600) * (v - 2600), 0) / a.length);

  assert(rmse(smoothTail) < rmse(filteredTail),
    'המוחלק צריך להיות קרוב יותר לאמת: ' + rmse(smoothTail).toFixed(0) +
    ' מול ' + rmse(filteredTail).toFixed(0));

  // ההערכה של היום האחרון זהה — אין עתיד שישפר אותה
  const last = r.states[r.states.length - 1];
  close(last.smoothTdee, last.tdee, 1e-6, 'היום האחרון השתנה');
  close(last.smoothWeight, last.weight, 1e-6, 'המשקל של היום האחרון השתנה');

  // אי־הוודאות של העבר קטנה יותר אחרי המעבר לאחור
  const mid = r.states[30];
  assert(mid.smoothTdeeSd <= mid.tdeeSd + 1e-9,
    'אי־הוודאות של העבר לא קטנה: ' + mid.smoothTdeeSd + ' מול ' + mid.tdeeSd);
});

test('ההחלקה לא מזייפת יציבות כשההוצאה באמת משתנה', () => {
  const days = kalmanDays(80, {
    startWeight: 92, intake: 2200, intakeNoise: 120,
    tdee: (i) => (i < 40 ? 2700 : 2300)
  });
  const r = Kalman.run(days, {});
  const early = r.states[20].smoothTdee;
  const late = r.states[70].smoothTdee;
  assert(early - late > 200,
    'המוחלק היה צריך לשקף את הקפיצה: ' + Math.round(early) + ' -> ' + Math.round(late));
});

test('כל מצב מקבל ערך מוחלק', () => {
  const days = kalmanDays(30, { startWeight: 88, tdee: 2600, intake: 2100 });
  const r = Kalman.run(days, {});
  r.states.forEach(function (s, i) {
    assert(typeof s.smoothTdee === 'number' && isFinite(s.smoothTdee), 'חסר ערך מוחלק ביום ' + i);
    assert(typeof s.smoothWeight === 'number' && isFinite(s.smoothWeight), 'חסר משקל מוחלק ביום ' + i);
  });
});

// ---------- לוח המחוונים ----------

test('סיכום הגירעון לכמה חלונות', () => {
  const entries = windowFixture();   // בסיס 2500, צעדים 10000, אכילה 2200
  const r = Metrics.deficitSummary(entries, WIN_SETTINGS, { endDate: '2026-03-01' });
  assert(r.ok, 'צריך לרוץ');
  assert(r.rows.length === 3, 'שלושה חלונות');

  r.rows.forEach((row) => {
    assert(row.loggedDays === row.days, row.days + ': ציפיתי לכל הימים, יש ' + row.loggedDays);
    assert(row.sum.low < row.sum.mid && row.sum.mid < row.sum.high, row.days + ': התרחישים לא מסודרים');
    close(row.kg.mid, -row.sum.mid / 7700, 1e-9, row.days + ': המרה לקילוגרמים');
    assert(row.actualKg !== null, row.days + ': חסר השינוי שנמדד');
  });

  // חלון ארוך יותר צובר גירעון גדול יותר
  assert(Math.abs(r.rows[2].sum.mid) > Math.abs(r.rows[0].sum.mid), '14 יום צריך לצבור יותר מ-7');
});

test('השינוי בפועל הוא הפרש ממוצעים בין שני חלונות מלאים', () => {
  // ירידה קבועה של 100 גרם ליום: הפרש בין חלונות צמודים = 0.1 × ימים
  const entries = buildSeries('2026-01-01', 40, (i) => ({
    weightKg: 90 - 0.1 * i, kcal: 2200, steps: 9000
  }));
  const r = Metrics.deficitSummary(entries, WIN_SETTINGS,
    { endDate: '2026-02-09', windows: [7, 10, 14] });

  r.rows.forEach((row) => {
    assert(row.ok, row.days + ': היה צריך לעבוד');
    close(row.actualKg, -0.1 * row.days, 1e-9, row.days + ' ימים: ההפרש בין הממוצעים');
    close(row.currentMean - row.previousMean, row.actualKg, 1e-9, 'עקביות פנימית');
    // החלונות צמודים ומעוגנים ליום הראשון
    assert(Dates.addDays(row.previous.to, 1) === row.current.from, row.days + ': חלונות לא צמודים');
    assert(row.current.from >= '2026-01-01', 'החלון מתחיל אחרי תחילת הנתונים');
    assert(row.loggedDays === row.days, 'כל ימי החלון דווחו');
  });
});

test('בלי שני חלונות מלאים הדוח אומר כמה חסר', () => {
  // 20 ימי נתונים: חלון 14 דורש 28
  const entries = buildSeries('2026-01-01', 20, (i) => ({
    weightKg: 90 - 0.05 * i, kcal: 2200, steps: 9000
  }));
  const r = Metrics.deficitSummary(entries, WIN_SETTINGS,
    { endDate: '2026-01-20', windows: [7, 14] });

  assert(r.rows[0].ok, 'חלון 7 אמור לעבוד');
  assert(!r.rows[1].ok && r.rows[1].reason === 'blocks', 'חלון 14 היה צריך להיפסל');
  assert(r.rows[1].completeBlocks === 1, 'חלון מלא אחד');
  assert(r.rows[1].needDays === 28, 'צריך 28 ימים');
});

test('הגירעון הצפוי עקבי עם הירידה שנמדדה', () => {
  const entries = windowFixture();
  const r = Metrics.deficitSummary(entries, WIN_SETTINGS, { endDate: '2026-03-01' });
  r.rows.forEach((row) => {
    // הנתונים נבנו כך שהמשקל באמת יורד לפי מאזן האנרגיה
    assert(Math.abs(row.kg.mid - row.actualKg) < 0.5,
      row.days + ' ימים: צפוי ' + row.kg.mid.toFixed(2) + ' מול נמדד ' + row.actualKg.toFixed(2));
  });
});

test('מספרי לוח המחוונים', () => {
  const entries = windowFixture();
  const d = Metrics.dashboard(entries, WIN_SETTINGS, { endDate: '2026-03-01' });
  assert(d.ok, 'צריך לרוץ');
  assert(d.spanDays === 60, 'שישים ימים במעקב, קיבלתי ' + d.spanDays);
  assert(d.weighIns === 60, 'שישים שקילות');
  assert(d.maxWeight > d.minWeight, 'שיא גבוה משפל');
  close(d.peakDrop, d.maxWeight - d.minWeight, 1e-9, 'הירידה מהשיא לשפל');
  // הירידה נמדדת בין חצי התקופה הראשון לשני
  close(d.totalLoss, d.halves.loss, 1e-9, 'הירידה בין החצאים');
  close(d.halves.loss, d.halves.first.mean - d.halves.second.mean, 1e-9, 'עקביות פנימית');
  assert(d.totalLoss < d.peakDrop, 'ממוצעים אמורים לתת מספר צנוע יותר');
  assert(d.totalLoss > 2, 'ירידה משמעותית לאורך התקופה');
  close(d.stepsWeek, 10000, 1, 'ממוצע צעדים בשבוע');
  assert(d.currentWeight < d.maxWeight, 'המשקל הנוכחי נמוך מהשיא');
});

test('לוח המחוונים בלי נתונים', () => {
  assert(!Metrics.dashboard([], WIN_SETTINGS).ok, 'צריך להחזיר כישלון');
});

test('שינוי בהרכב הגוף לכמה חלונות, עם טווחי תאריכים', () => {
  // ירידה קבועה: משקל 100 גרם ליום, שומן 80, שריר יציב
  const entries = buildSeries('2026-01-01', 40, (i) => ({
    weightKg: 90 - 0.1 * i,
    bodyFatKg: 25 - 0.08 * i,
    muscleKg: 36
  }));
  const r = Metrics.bodyChangeSummary(entries, { endDate: '2026-02-09', windows: [7, 10, 14] });

  r.rows.forEach((row) => {
    assert(row.ok, row.days + ': היה צריך לעבוד');
    close(row.fields.weightKg.change, -0.1 * row.days, 1e-9, row.days + ': משקל');
    close(row.fields.bodyFatKg.change, -0.08 * row.days, 1e-9, row.days + ': שומן');
    close(row.fields.muscleKg.change, 0, 1e-9, row.days + ': שריר');

    assert(Dates.diffDays(row.current.from, row.current.to) === row.days - 1, 'אורך החלון הנוכחי');
    assert(Dates.addDays(row.previous.to, 1) === row.current.from, 'החלונות לא צמודים');
    assert(row.blockIndex >= 2, 'מספר החלון');
  });
});

test('הרכב הגוף נמדד על חלונות מלאים בלבד', () => {
  const entries = buildSeries('2026-01-01', 20, (i) => ({ weightKg: 90 - 0.05 * i }));
  const r = Metrics.bodyChangeSummary(entries, { endDate: '2026-01-20', windows: [7, 14] });
  assert(r.rows[0].ok, 'חלון 7 אמור לעבוד');
  assert(!r.rows[1].ok, 'חלון 14 בלי שני חלונות מלאים');
  assert(r.rows[1].fields.weightKg.change === null, 'אין מספר בלי חלון מלא');
});

// ---------- חלונות מעוגנים ----------

test('חלונות רצופים מעוגנים ליום הראשון', () => {
  // 26/07 עד 25/08 = 31 ימים, חלונות של 7 -> ארבעה מלאים ושארית של 3
  const entries = buildSeries('2026-07-26', 31, () => ({ weightKg: 88 }));
  const b = Metrics.anchoredBlocks(entries, 7, { endDate: '2026-08-25' });

  assert(b.ok, 'צריך להצליח');
  assert(b.completeBlocks === 4, 'ארבעה חלונות מלאים, קיבלתי ' + b.completeBlocks);
  assert(b.current.from === '2026-08-16' && b.current.to === '2026-08-22',
    'חלון 4: ' + b.current.from + '–' + b.current.to);
  assert(b.current.index === 4, 'מספר החלון');
  assert(b.previous.from === '2026-08-09' && b.previous.to === '2026-08-15',
    'חלון 3: ' + b.previous.from + '–' + b.previous.to);
  assert(b.partial && b.partial.days === 3, 'שארית של שלושה ימים');
  assert(b.partial.from === '2026-08-23', 'השארית מתחילה למחרת');
});

test('החלונות צמודים ולא חופפים', () => {
  const entries = buildSeries('2026-07-26', 31, () => ({ weightKg: 88 }));
  [3, 5, 7, 10, 14].forEach((n) => {
    const b = Metrics.anchoredBlocks(entries, n, { endDate: '2026-08-25' });
    if (!b.ok) return;
    assert(Dates.addDays(b.previous.to, 1) === b.current.from,
      n + ': החלונות לא צמודים');
    assert(Dates.diffDays(b.current.from, b.current.to) === n - 1, n + ': אורך שגוי');
  });
});

test('פחות משני חלונות מלאים מדווח ככישלון', () => {
  const entries = buildSeries('2026-07-26', 20, () => ({ weightKg: 88 }));
  const b = Metrics.anchoredBlocks(entries, 14, { endDate: '2026-08-14' });
  assert(!b.ok && b.reason === 'blocks', 'צריך לדווח שאין מספיק חלונות');
  assert(b.completeBlocks === 1, 'חלון מלא אחד');
  assert(b.needDays === 28, 'צריך 28 ימים');
});

test('לוח המחוונים מדווח אילו ימים חסרים', () => {
  // 20 ימים, בלי שקילה בשניים מהם
  const entries = buildSeries('2026-01-01', 20, (i) => {
    const row = { kcal: 2200, steps: 9000 };
    if (i !== 5 && i !== 12) row.weightKg = 90 - 0.05 * i;
    return row;
  });
  const d = Metrics.dashboard(entries, WIN_SETTINGS, { endDate: '2026-01-20' });

  assert(d.spanDays === 20, 'עשרים ימים בטווח');
  assert(d.weighIns === 18, 'שמונה עשרה שקילות, קיבלתי ' + d.weighIns);
  assert(d.missingWeighIns.length === 2, 'שני ימים חסרים');
  assert(d.missingWeighIns[0] === '2026-01-06', 'היום החסר הראשון: ' + d.missingWeighIns[0]);
  assert(d.missingWeighIns[1] === '2026-01-13', 'היום החסר השני: ' + d.missingWeighIns[1]);
});

test('שקילה בכל יום -> אין ימים חסרים והספירה מלאה', () => {
  const entries = buildSeries('2026-01-01', 31, (i) => ({ weightKg: 90 - 0.05 * i }));
  const d = Metrics.dashboard(entries, WIN_SETTINGS, { endDate: '2026-01-31' });
  assert(d.spanDays === 31 && d.weighIns === 31, d.weighIns + ' מתוך ' + d.spanDays);
  assert(d.missingWeighIns.length === 0, 'לא אמורים להיות ימים חסרים');
});

test('השקילה האחרונה והממוצע הם שני מספרים שונים', () => {
  const entries = buildSeries('2026-01-01', 20, (i) => ({ weightKg: 90 + noise(i, 0.8) }));
  const d = Metrics.dashboard(entries, WIN_SETTINGS, { endDate: '2026-01-20' });
  assert(d.latestWeightDate === '2026-01-20', 'תאריך השקילה האחרונה');
  close(d.latestWeight, 90 + noise(19, 0.8), 1e-9, 'השקילה האחרונה היא הערך הגולמי');
  assert(Math.abs(d.currentWeight - d.latestWeight) > 0.01, 'הממוצע אמור להיות שונה מהשקילה');
});

test('הלוח מתעלם מרשומות שאחרי תאריך הסיום', () => {
  const entries = buildSeries('2026-01-01', 40, (i) => ({ weightKg: 90 - 0.05 * i }));
  const d = Metrics.dashboard(entries, WIN_SETTINGS, { endDate: '2026-01-20' });

  assert(d.spanDays === 20, 'עשרים ימים, קיבלתי ' + d.spanDays);
  assert(d.weighIns === 20, 'עשרים שקילות, קיבלתי ' + d.weighIns);
  assert(d.weighIns + d.missingWeighIns.length === d.spanDays, 'הספירה לא מסתדרת');
  assert(d.latestWeightDate === '2026-01-20', 'השקילה האחרונה בטווח: ' + d.latestWeightDate);
  // המשקל הנמוך ביותר שייך לטווח ולא לעתיד
  close(d.minWeight, 90 - 0.05 * 19, 1e-9, 'השפל בתוך הטווח');
});

// ---------- השוואת חלונות ----------

test('השוואת חלונות מחזירה שורה לכל חלון', () => {
  const entries = windowFixture();   // 60 ימים, בסיס 2500, צעדים 10000, אכילה 2200
  const r = Metrics.windowComparison(entries, WIN_SETTINGS,
    { endDate: '2026-03-01', windows: ['adaptive', 7, 14, 28] });

  assert(r.rows.length === 4, 'ארבע שורות');
  close(r.meanIntake, 2200, 1, 'צריכה ממוצעת');

  r.rows.filter((row) => row.ok).forEach((row) => {
    // שלושת התרחישים מסודרים: זהיר < הערכה < נדיב
    assert(row.dailyDeficit.low < row.dailyDeficit.mid, row.label + ': סדר תרחישים');
    assert(row.dailyDeficit.mid < row.dailyDeficit.high, row.label + ': סדר תרחישים');

    // גירעון גדול יותר = ירידה שבועית גדולה יותר
    assert(row.weeklyKg.high < row.weeklyKg.mid, row.label + ': ירידה לפי תרחיש');
    close(row.weeklyKg.mid, -(row.dailyDeficit.mid * 7) / 7700, 1e-9, row.label + ': המרה לק"ג');

    // הגירעון מתיישב עם ההוצאה פחות הצריכה
    close(row.dailyDeficit.mid, row.tdee - row.meanIntake, 1e-9, row.label + ': גירעון יומי');
  });
});

test('חלון בלי כיסוי מסומן ולא מחושב', () => {
  const entries = buildSeries('2026-01-01', 20, (i) => ({
    weightKg: 90 - 0.05 * i, kcal: 2200, steps: 9000
  }));
  const r = Metrics.windowComparison(entries, WIN_SETTINGS,
    { endDate: '2026-01-20', windows: [7, 28] });

  assert(r.rows[0].ok, 'חלון 7 אמור לעבוד');
  assert(!r.rows[1].ok && r.rows[1].reason === 'window', 'חלון 28 היה צריך להיפסל');
  assert(r.rows[1].needDays === 56, 'צריך 56 ימים');
});

test('הקצבה לימים הקרובים סוגרת את החוב שנצבר', () => {
  const entries = windowFixture();
  const r = Metrics.windowComparison(entries, WIN_SETTINGS,
    { endDate: '2026-03-01', windows: [7], horizons: [1, 3, 7] });
  const row = r.rows[0];

  row.allowance.mid.forEach((option) => {
    // אכילה של perDay במשך days ימים משאירה את המצטבר באפס
    const projected = row.carried.mid + option.days * (row.tdee - option.perDay);
    close(projected, 0, 1e-6, option.days + ' ימים: הקצבה לא מאפסת את החוב');
  });

  // פריסה ארוכה יותר מקרבת את הקצבה להוצאה עצמה
  const single = row.allowance.mid.find((o) => o.days === 1);
  const week = row.allowance.mid.find((o) => o.days === 7);
  assert(Math.abs(week.perDay - row.tdee) < Math.abs(single.perDay - row.tdee),
    'פריסה ארוכה אמורה להתקרב להוצאה');
});

test('הקצבה בתרחיש זהיר נמוכה מזו שבנדיב', () => {
  const entries = windowFixture();
  const row = Metrics.windowComparison(entries, WIN_SETTINGS,
    { endDate: '2026-03-01', windows: ['adaptive'], horizons: [3] }).rows[0];
  assert(row.allowance.low[0].perDay < row.allowance.mid[0].perDay, 'זהיר < הערכה');
  assert(row.allowance.mid[0].perDay < row.allowance.high[0].perDay, 'הערכה < נדיב');
});

// ---------- סגירת התקופה בירוק ----------

test('התקופה היא N הימים האחרונים ומסתיימת היום', () => {
  const entries = windowFixture();
  [7, 14, 28].forEach((n) => {
    const r = Metrics.periodTarget(entries, WIN_SETTINGS,
      { endDate: '2026-03-01', days: n, windowDays: 'adaptive' });
    assert(r.ok, n + ': צריך לרוץ');
    assert(r.period.to === '2026-03-01', n + ': התקופה אמורה להסתיים היום');
    assert(Dates.diffDays(r.period.from, r.period.to) === n - 1, n + ': אורך שגוי');
  });
});

test('החלפת אורך התקופה משנה את מה שנצבר', () => {
  const entries = windowFixture();
  const week = Metrics.periodTarget(entries, WIN_SETTINGS, { endDate: '2026-03-01', days: 7 });
  const month = Metrics.periodTarget(entries, WIN_SETTINGS, { endDate: '2026-03-01', days: 28 });

  assert(week.loggedDays < month.loggedDays, 'חודש אמור לכלול יותר ימים');
  assert(Math.abs(month.carried.mid) > Math.abs(week.carried.mid),
    'המצטבר בחודש אמור להיות גדול יותר: ' + Math.round(month.carried.mid) +
    ' מול ' + Math.round(week.carried.mid));
});

test('הפריסה סוגרת את הפער לאורך מספר הימים שנבחר', () => {
  const entries = windowFixture();
  const r = Metrics.periodTarget(entries, WIN_SETTINGS,
    { endDate: '2026-03-01', days: 14, horizons: [1, 3, 7] });

  ['low', 'mid', 'high'].forEach((key) => {
    const burn = key === 'low' ? r.tdee - r.ci95 : key === 'high' ? r.tdee + r.ci95 : r.tdee;
    r.plan[key].forEach((option) => {
      const projected = r.carried[key] + option.days * (burn - option.perDay);
      close(projected, 0, 1e-6, key + '/' + option.days + ': הפריסה לא מאפסת את הפער');
    });
  });

  // פריסה ארוכה מתקרבת להוצאה עצמה
  const single = r.plan.mid.find((o) => o.days === 1);
  const week = r.plan.mid.find((o) => o.days === 7);
  assert(Math.abs(week.perDay - r.tdee) < Math.abs(single.perDay - r.tdee),
    'פריסה ארוכה אמורה להתקרב להוצאה');
});

test('סטטוס הירוק תואם את הסימן של המצטבר', () => {
  const entries = windowFixture();
  const r = Metrics.periodTarget(entries, WIN_SETTINGS, { endDate: '2026-03-01', days: 14 });
  ['low', 'mid', 'high'].forEach((key) => {
    assert(r.green[key] === (r.carried[key] > 0), key + ': סטטוס לא תואם');
  });
});

test('התקופה מסתיימת היום ומכסה את N הימים האחרונים', () => {
  const entries = buildSeries('2026-07-26', 27, (i) => ({
    weightKg: 88 - 0.05 * i, kcal: 2200, steps: 9000
  }));
  const r = Metrics.periodTarget(entries, WIN_SETTINGS,
    { endDate: '2026-08-21', days: 14, windowDays: 'adaptive' });

  assert(r.ok, 'צריך לרוץ');
  assert(r.period.to === '2026-08-21', 'סוף התקופה: ' + r.period.to);
  assert(r.period.from === '2026-08-08', 'תחילת התקופה: ' + r.period.from);
  assert(r.loggedDays > 0, 'אמורים להיות ימים מדווחים');
});

test('סבבי הבלוקים מעוגנים ליום הראשון, כמו בגיליון', () => {
  // 26/07 עד 24/08 = 30 ימים, סבבים של 5 -> שישה סבבים מלאים
  const entries = buildSeries('2026-07-26', 30, (i) => ({
    weightKg: 89 - 0.03 * i, kcal: 2400, steps: 9000
  }));
  const r = Metrics.blockWindows(entries, { days: 5, count: 6, endDate: '2026-08-24' });

  assert(r.totalBlocks === 6, 'שישה סבבים מלאים, קיבלתי ' + r.totalBlocks);
  assert(r.first === '2026-07-26', 'העיגון ליום הראשון');

  var latest = r.rows[0];
  assert(latest.index === 6, 'הסבב האחרון הוא 6, קיבלתי ' + latest.index);
  assert(latest.from === '2026-08-20' && latest.to === '2026-08-24',
    'סבב 6: ' + latest.from + '–' + latest.to);
  assert(latest.prevFrom === '2026-08-15' && latest.prevTo === '2026-08-19',
    'סבב 5: ' + latest.prevFrom + '–' + latest.prevTo);

  // סבב 2 הוא 31/07 עד 04/08, בדיוק כמו בגיליון
  var second = r.rows.find(function (row) { return row.index === 2; });
  assert(second.from === '2026-07-31' && second.to === '2026-08-04',
    'סבב 2: ' + second.from + '–' + second.to);
});

test('סבב חלקי בסוף לא נספר', () => {
  // 32 ימים: שישה סבבים של 5 ועוד שארית של 2
  const entries = buildSeries('2026-07-26', 32, () => ({ weightKg: 88, kcal: 2400 }));
  const r = Metrics.blockWindows(entries, { days: 5, count: 3, endDate: '2026-08-26' });
  assert(r.totalBlocks === 6, 'שישה סבבים מלאים');
  assert(r.rows[0].to === '2026-08-24', 'הסבב האחרון מסתיים ב-24/08, לא ב-26/08');
});

test('העיגון לא זז כשעובר עוד יום', () => {
  const entries = buildSeries('2026-07-26', 31, (i) => ({
    weightKg: 89 - 0.03 * i, kcal: 2400, steps: 9000
  }));
  const at24 = Metrics.blockWindows(entries, { days: 5, count: 1, endDate: '2026-08-24' });
  const at25 = Metrics.blockWindows(entries, { days: 5, count: 1, endDate: '2026-08-25' });
  assert(at24.rows[0].from === at25.rows[0].from,
    'הסבב זז ביום: ' + at24.rows[0].from + ' מול ' + at25.rows[0].from);
});

test('התחזוקה בסבב מחושבת כמו בגיליון', () => {
  const entries = buildSeries('2026-07-26', 30, (i) => ({
    weightKg: 89 - 0.03 * i, kcal: 2400, steps: 10000
  }));
  const row = Metrics.blockWindows(entries,
    { days: 5, count: 1, endDate: '2026-08-24', kcalPerStep: 0.04 }).rows[0];

  // צריכה + קלוריות מירידת המשקל − קלוריות מצעדים
  close(row.base, row.meanKcal + row.fromWeight - row.fromSteps, 1e-9, 'תחזוקה בלי צעדים');
  close(row.fromSteps, 10000 * 0.04, 1e-9, 'קלוריות מצעדים');
  close(row.fromWeight, (row.prevMeanWeight - row.meanWeight) * 7700 / 5, 1e-9,
    'קלוריות מירידת המשקל');
});

// ---------- שחזור הטבלה של המשתמש ----------
//
// כל שורה כאן היא שורה מהגיליון. הבדיקה בונה נתונים שהממוצעים שלהם
// זהים לאלה שבטבלה, ודורשת שהמנוע יחזיר בדיוק את אותה תחזוקה.
// זה מה שמוודא שהנוסחה, העיגון וקבוע הצעדים זהים.

const SHEET_START = '2026-07-26';
const SHEET_SETTINGS = { kcalPerKg: 7700, kcalPerStep: 0.04 };

/** בונה ימים שבהם לכל סבב יש בדיוק הממוצעים שנתונים */
function blocksFixture(days, blocks) {
  const entries = [];
  blocks.forEach((block, index) => {
    for (let d = 0; d < days; d++) {
      entries.push({
        date: Dates.addDays(SHEET_START, index * days + d),
        weightKg: block.weight,
        kcal: block.kcal,
        steps: block.steps
      });
    }
  });
  return entries;
}

function checkSheet(days, blocks, expected) {
  const endDate = Dates.addDays(SHEET_START, blocks.length * days - 1);
  const r = Metrics.blockWindows(blocksFixture(days, blocks), {
    days: days, count: blocks.length, endDate: endDate,
    kcalPerKg: SHEET_SETTINGS.kcalPerKg, kcalPerStep: SHEET_SETTINGS.kcalPerStep
  });

  // המשקלים בגיליון מוצגים בשתי ספרות אחרי הנקודה. עיגול של עד
  // 0.005 בכל ממוצע מזיז את ההפרש בעד 0.01 ק"ג, וזה מתורגם ל-
  // 0.01 × 7700 ÷ ימים קלוריות. הסבילות נגזרת מכך ולא נבחרת ביד.
  const roundingTolerance = (0.01 * 7700) / days + 1;

  expected.forEach((want) => {
    const row = r.rows.find((x) => x.index === want.index);
    assert(row, days + ' ימים: חסר סבב ' + want.index);
    assert(row.from === want.from && row.to === want.to,
      days + ' ימים, סבב ' + want.index + ': תקופה ' + row.from + '–' + row.to +
      ' במקום ' + want.from + '–' + want.to);
    close(row.meanWeight, want.weight, 0.005, days + '/' + want.index + ': משקל ממוצע');
    close(row.prevMeanWeight, want.prevWeight, 0.005, days + '/' + want.index + ': משקל קודם');
    close(row.deltaKg, want.delta, 0.011, days + '/' + want.index + ': שינוי משקל');
    close(row.fromWeight, want.fromWeight, roundingTolerance,
      days + '/' + want.index + ': קלוריות מירידת משקל');
    close(row.fromSteps, want.fromSteps, 1.5, days + '/' + want.index + ': קלוריות מצעדים');
    close(row.base, want.maintenance, roundingTolerance + 1,
      days + '/' + want.index + ': תחזוקה אמיתית');
  });
}

test('שחזור טבלת 5 הימים מהגיליון', () => {
  const blocks = [
    { weight: 89.94, kcal: 2400, steps: 9000 },
    { weight: 88.80, kcal: 2265, steps: 9313 },
    { weight: 88.68, kcal: 2675, steps: 7851 },
    { weight: 88.78, kcal: 2491, steps: 7245 },
    { weight: 88.88, kcal: 2538, steps: 9284 },
    { weight: 88.00, kcal: 2332, steps: 10191 }
  ];
  checkSheet(5, blocks, [
    { index: 2, from: '2026-07-31', to: '2026-08-04', weight: 88.80, prevWeight: 89.94,
      delta: 1.14, fromWeight: 1756, fromSteps: 373, maintenance: 3648 },
    { index: 3, from: '2026-08-05', to: '2026-08-09', weight: 88.68, prevWeight: 88.80,
      delta: 0.12, fromWeight: 185, fromSteps: 314, maintenance: 2546 },
    { index: 4, from: '2026-08-10', to: '2026-08-14', weight: 88.78, prevWeight: 88.68,
      delta: -0.10, fromWeight: -154, fromSteps: 290, maintenance: 2047 },
    { index: 5, from: '2026-08-15', to: '2026-08-19', weight: 88.88, prevWeight: 88.78,
      delta: -0.10, fromWeight: -154, fromSteps: 371, maintenance: 2012 },
    { index: 6, from: '2026-08-20', to: '2026-08-24', weight: 88.00, prevWeight: 88.88,
      delta: 0.88, fromWeight: 1355, fromSteps: 408, maintenance: 3280 }
  ]);
});

test('שחזור טבלת 7 הימים מהגיליון', () => {
  const blocks = [
    { weight: 89.74, kcal: 2400, steps: 9000 },
    { weight: 88.54, kcal: 2521, steps: 8406 },
    { weight: 88.96, kcal: 2617, steps: 7635 },
    { weight: 88.56, kcal: 2517, steps: 9621 }
  ];
  checkSheet(7, blocks, [
    { index: 2, from: '2026-08-02', to: '2026-08-08', weight: 88.54, prevWeight: 89.74,
      delta: 1.20, fromWeight: 1320, fromSteps: 336, maintenance: 3505 },
    { index: 3, from: '2026-08-09', to: '2026-08-15', weight: 88.96, prevWeight: 88.54,
      delta: -0.42, fromWeight: -456, fromSteps: 305, maintenance: 1856 },
    { index: 4, from: '2026-08-16', to: '2026-08-22', weight: 88.56, prevWeight: 88.96,
      delta: 0.40, fromWeight: 440, fromSteps: 385, maintenance: 2572 }
  ]);
});

test('שחזור טבלת 10 הימים מהגיליון', () => {
  const blocks = [
    { weight: 89.37, kcal: 2400, steps: 9000 },
    { weight: 88.73, kcal: 2583, steps: 7548 },
    { weight: 88.44, kcal: 2435, steps: 9737 }
  ];
  checkSheet(10, blocks, [
    { index: 2, from: '2026-08-05', to: '2026-08-14', weight: 88.73, prevWeight: 89.37,
      delta: 0.64, fromWeight: 493, fromSteps: 302, maintenance: 2774 },
    { index: 3, from: '2026-08-15', to: '2026-08-24', weight: 88.44, prevWeight: 88.73,
      delta: 0.29, fromWeight: 223, fromSteps: 389, maintenance: 2269 }
  ]);
});

test('שחזור טבלת 14 הימים מהגיליון', () => {
  const blocks = [
    { weight: 89.14, kcal: 2400, steps: 9000 },
    { weight: 88.76, kcal: 2567, steps: 8628 }
  ];
  checkSheet(14, blocks, [
    { index: 2, from: '2026-08-09', to: '2026-08-22', weight: 88.76, prevWeight: 89.14,
      delta: 0.38, fromWeight: 212, fromSteps: 345, maintenance: 2434 }
  ]);
});

test('ברירת המחדל של קבוע הצעדים היא 25 צעדים לקלוריה', () => {
  // בדיקה על אחסון נקי, כדי לא לפגוע בנתוני שאר הבדיקות
  const fresh = Store.getSettings().kcalPerStep;
  assert(Math.abs(fresh - 0.04) < 1e-9, 'ציפיתי ל-0.04, קיבלתי ' + fresh);
});

test('קבוע הצעדים: 25 צעדים לקלוריה', () => {
  close(0.04, 1 / 25, 1e-9, 'חלוקה ב-25 שקולה להכפלה ב-0.04');
  const entries = blocksFixture(5, [
    { weight: 89, kcal: 2400, steps: 10000 },
    { weight: 88, kcal: 2400, steps: 10000 }
  ]);
  const row = Metrics.blockWindows(entries,
    { days: 5, count: 1, endDate: Dates.addDays(SHEET_START, 9), kcalPerStep: 1 / 25 }).rows[0];
  close(row.fromSteps, 400, 1e-9, '10,000 צעדים = 400 קלוריות');
});

test('העיגון הוא השקילה הראשונה, לא רשומת התזונה הראשונה', () => {
  // רשומת תזונה בודדת יום לפני השקילה הראשונה
  const entries = [{ date: '2026-07-25', kcal: 2000 }];
  for (let i = 0; i < 20; i++) {
    entries.push({
      date: Dates.addDays('2026-07-26', i),
      weightKg: 89 - 0.03 * i, kcal: 2400, steps: 9000
    });
  }
  const r = Metrics.blockWindows(entries, { days: 5, count: 4, endDate: '2026-08-14' });
  const second = r.rows.find((row) => row.index === 2);
  assert(second.from === '2026-07-31',
    'הסבב היה צריך להתחיל ב-31/07 ולא ב-' + second.from);
});

test('תא תאריך עם חותמת זמן מומר לפי אזור הזמן המקומי', () => {
  // 05/08 בישראל מגיע כ-04/08T21:00Z. חיתוך המחרוזת מזיז יום אחורה
  // וכל התזונה נופלת על היום הלא נכון — קרה בפועל.
  const local = new Date('2026-08-04T21:00:00.000Z');
  const expected = local.getFullYear() + '-' +
    String(local.getMonth() + 1).padStart(2, '0') + '-' +
    String(local.getDate()).padStart(2, '0');
  assert(Sheets.toIso('2026-08-04T21:00:00.000Z') === expected,
    'ציפיתי ל-' + expected + ', קיבלתי ' + Sheets.toIso('2026-08-04T21:00:00.000Z'));
  assert(Sheets.toIso('2026-08-04T21:00:00.000Z') !== '2026-08-04' ||
    local.getUTCDate() === local.getDate(),
    'ההמרה עדיין חותכת את המחרוזת');
});

// ---------- ממוצע מתגלגל ----------

test('החלון המתגלגל מסתיים היום ומושווה לימים שקדמו לו', () => {
  const entries = buildSeries('2026-08-01', 26, (i) => ({
    weightKg: 89 - 0.02 * i, kcal: 2400, steps: 9000
  }));
  const r = Metrics.rollingWindows(entries, { endDate: '2026-08-26', lengths: [3] });
  const row = r.rows[0];

  // בדיוק הדוגמה שנשאלה: 24 עד 26 מול 21 עד 23
  assert(row.current.from === '2026-08-24' && row.current.to === '2026-08-26',
    'החלון הנוכחי: ' + row.current.from + '–' + row.current.to);
  assert(row.previous.from === '2026-08-21' && row.previous.to === '2026-08-23',
    'החלון הקודם: ' + row.previous.from + '–' + row.previous.to);
  assert(Dates.addDays(row.previous.to, 1) === row.current.from, 'החלונות לא צמודים');
});

test('החלון המתגלגל זז עם התאריך, בניגוד לסבב', () => {
  const entries = buildSeries('2026-08-01', 26, (i) => ({
    weightKg: 89 - 0.02 * i, kcal: 2400, steps: 9000
  }));
  const at26 = Metrics.rollingWindows(entries, { endDate: '2026-08-26', lengths: [5] }).rows[0];
  const at25 = Metrics.rollingWindows(entries, { endDate: '2026-08-25', lengths: [5] }).rows[0];
  assert(at26.current.from !== at25.current.from, 'החלון המתגלגל אמור לזוז');
  assert(Dates.diffDays(at25.current.from, at26.current.from) === 1, 'הוא אמור לזוז יום אחד');
});

test('התחזוקה בחלון מתגלגל מחושבת באותה נוסחה', () => {
  const entries = buildSeries('2026-08-01', 26, (i) => ({
    weightKg: 89 - 0.05 * i, kcal: 2500, steps: 10000
  }));
  const row = Metrics.rollingWindows(entries,
    { endDate: '2026-08-26', lengths: [7], kcalPerStep: 0.04 }).rows[0];

  close(row.fromWeight, (row.prevMeanWeight - row.meanWeight) * 7700 / 7, 1e-9, 'קלוריות מירידת משקל');
  close(row.fromSteps, 10000 * 0.04, 1e-9, 'קלוריות מצעדים');
  close(row.base, row.meanKcal + row.fromWeight - row.fromSteps, 1e-9, 'תחזוקה');
  // ירידה קבועה של 50 גרם ליום -> ההפרש בין החלונות הוא 7 × 0.05
  close(row.deltaKg, 0.35, 1e-9, 'הפרש הממוצעים');
});

test('חלון מתגלגל בלי כיסוי מלא לתקופה הקודמת מסומן', () => {
  const entries = buildSeries('2026-08-01', 10, (i) => ({ weightKg: 89, kcal: 2400 }));
  const rows = Metrics.rollingWindows(entries, { endDate: '2026-08-10', lengths: [3, 7] }).rows;
  assert(rows[0].covered, 'חלון 3 מכוסה');
  assert(!rows[1].covered, 'חלון 7 דורש 14 ימים ואין');
});

// ---------- פיצול המאקרו ----------

test('הפיצול מחשב אחוזים מהקלוריות', () => {
  // 200 חלבון (800), 200 פחמימות (800), 44.4 שומן (400) = 2000
  const entries = buildSeries('2026-01-01', 10, () => ({
    kcal: 2000, proteinG: 200, carbG: 200, fatG: 400 / 9
  }));
  const r = Metrics.macroSplit(entries, { endDate: '2026-01-10', windowDays: 7 });

  assert(r.ok, 'צריך לרוץ');
  const byField = {};
  r.parts.forEach((p) => { byField[p.field] = p; });

  close(byField.proteinG.share, 0.4, 1e-6, 'חלבון 40%');
  close(byField.carbG.share, 0.4, 1e-6, 'פחמימות 40%');
  close(byField.fatG.share, 0.2, 1e-6, 'שומן 20%');
  close(r.unexplained, 0, 1e-6, 'אין הפרש');
  close(byField.proteinG.gramsPerDay, 200, 1e-9, 'גרמים ליום');
});

test('הפרש בין הסכום לדיווח מוחזר במפורש', () => {
  // המאקרו מסביר 1200 בלבד מתוך 2000
  const entries = buildSeries('2026-01-01', 10, () => ({
    kcal: 2000, proteinG: 100, carbG: 100, fatG: 44.44
  }));
  const r = Metrics.macroSplit(entries, { endDate: '2026-01-10', windowDays: 7 });
  close(r.unexplained, 2000 * 7 - (100 * 4 + 100 * 4 + 44.44 * 9) * 7, 1, 'ההפרש');
  assert(r.unexplainedShare > 0.3, 'ההפרש אמור להיות משמעותי');
});

test('צפיפות החלבון אינה תלויה בגודל היום', () => {
  const small = buildSeries('2026-01-01', 10, () => ({ kcal: 1000, proteinG: 100 }));
  const big = buildSeries('2026-01-01', 10, () => ({ kcal: 2000, proteinG: 200 }));

  const a = Metrics.macroSplit(small, { endDate: '2026-01-10', windowDays: 7 });
  const b = Metrics.macroSplit(big, { endDate: '2026-01-10', windowDays: 7 });

  close(a.proteinDensity, 10, 1e-9, 'עשרה גרם ל-100 קלוריות');
  close(a.proteinDensity, b.proteinDensity, 1e-9, 'הצפיפות זהה בשני הגדלים');

  // אבל הגרמים המוחלטים שונים — ולכן שניהם נחוצים
  const gramsA = a.parts.find((p) => p.field === 'proteinG').gramsPerDay;
  const gramsB = b.parts.find((p) => p.field === 'proteinG').gramsPerDay;
  assert(gramsB > gramsA, 'הגרמים המוחלטים אמורים להיות שונים');
});

test('בלי דיווח קלוריות אין פיצול', () => {
  const entries = buildSeries('2026-01-01', 5, () => ({ weightKg: 88 }));
  assert(!Metrics.macroSplit(entries, { endDate: '2026-01-05' }).ok, 'צריך להיכשל');
});

// ---------- טבלאות משקל ----------

test('השוואת יום לממוצעים שלפניו ושכוללים אותו', () => {
  // שלושה ימים לפני: 90, 89, 88 -> ממוצע 89. היום: 86
  const entries = [
    { date: '2026-09-02', weightKg: 90, muscleKg: 36, bodyFatKg: 24, waterKg: 49 },
    { date: '2026-09-03', weightKg: 89, muscleKg: 36, bodyFatKg: 23, waterKg: 49 },
    { date: '2026-09-04', weightKg: 88, muscleKg: 36, bodyFatKg: 22, waterKg: 49 },
    { date: '2026-09-05', weightKg: 86, muscleKg: 37, bodyFatKg: 21, waterKg: 50 }
  ];
  const r = Metrics.dayComparison(entries, { date: '2026-09-05', days: 3 });

  assert(r.before.from === '2026-09-02' && r.before.to === '2026-09-04',
    'טווח "לפני": ' + r.before.from + '–' + r.before.to);
  assert(r.including.from === '2026-09-03' && r.including.to === '2026-09-05',
    'טווח "כולל": ' + r.including.from + '–' + r.including.to);

  const w = r.fields.weightKg;
  close(w.value, 86, 1e-9, 'המדידה של היום');
  close(w.beforeMean, 89, 1e-9, 'ממוצע שלושת הימים שלפני');
  close(w.includingMean, (89 + 88 + 86) / 3, 1e-9, 'ממוצע כולל היום');
  close(w.vsBefore, -3, 1e-9, 'ההפרש מהתקופה שלפני');
  close(w.shift, (89 + 88 + 86) / 3 - 89, 1e-9, 'כמה היום הזיז את הממוצע');

  // כל ארבעת שדות הגוף מטופלים
  ['weightKg', 'muscleKg', 'bodyFatKg', 'waterKg'].forEach((f) => {
    assert(r.fields[f], 'חסר שדה ' + f);
  });
});

test('יום בלי מדידה מוחזר כריק ולא כאפס', () => {
  const entries = [
    { date: '2026-09-03', weightKg: 89 },
    { date: '2026-09-04', weightKg: 88 }
  ];
  const r = Metrics.dayComparison(entries, { date: '2026-09-05', days: 3 });
  assert(r.fields.weightKg.value === null, 'אין מדידה ליום הנבחר');
  assert(r.fields.weightKg.vsBefore === null, 'אין הפרש בלי מדידה');
  close(r.fields.weightKg.beforeMean, 88.5, 1e-9, 'הממוצע שלפני עדיין מחושב');
});

test('סבבי משקל כוללים גם את הסבב החלקי בסוף', () => {
  // 26/07 עד 05/09 = 42 ימים, סבבים של 5 -> שמונה מלאים ועוד שניים
  const entries = [];
  for (let i = 0; i < 42; i++) {
    entries.push({ date: Dates.addDays('2026-07-26', i), weightKg: 89 + noise(i, 0.3) });
  }
  const r = Metrics.weightBlocks(entries, { days: 5, endDate: '2026-09-05' });

  assert(r.rows.length === 9, 'תשעה סבבים, קיבלתי ' + r.rows.length);
  const last = r.rows[r.rows.length - 1];
  assert(last.partial, 'הסבב האחרון אמור להיות חלקי');
  assert(last.days === 2, 'שני ימים בסבב האחרון, קיבלתי ' + last.days);
  assert(last.from === '2026-09-04' && last.to === '2026-09-05',
    'הסבב האחרון: ' + last.from + '–' + last.to);

  // כל סבב מלא הוא בדיוק חמישה ימים והשינוי מחושב מול הקודם
  r.rows.slice(0, -1).forEach((row) => {
    assert(!row.partial && row.days === 5, 'סבב ' + row.index + ' אינו מלא');
  });
  assert(r.rows[0].change === null, 'לסבב הראשון אין קודם');
  close(r.rows[1].change, r.rows[1].mean - r.rows[0].mean, 1e-9, 'השינוי מול הסבב הקודם');
});

test('סבבי משקל לא דורשים דיווח תזונה', () => {
  const entries = [];
  for (let i = 0; i < 12; i++) {
    entries.push({ date: Dates.addDays('2026-08-01', i), weightKg: 88 - 0.1 * i });
  }
  const r = Metrics.weightBlocks(entries, { days: 5, endDate: '2026-08-12' });
  assert(r.rows.length === 3, 'שלושה סבבים');
  close(r.rows[1].change, -0.5, 1e-9, 'ירידה של חצי קילו בין סבבים');
});

test('הירידה הכוללת נמדדת בין ממוצעים ולא בין קצוות', () => {
  // שקילה ראשונה גבוהה במיוחד: קצה בודד שמנפח את התוצאה
  const entries = [{ date: '2026-01-01', weightKg: 95 }];
  for (let i = 1; i < 20; i++) {
    entries.push({ date: Dates.addDays('2026-01-01', i), weightKg: 90 - 0.05 * i });
  }
  const d = Metrics.dashboard(entries, WIN_SETTINGS, { endDate: '2026-01-20' });

  assert(d.peakDrop > 5.9, 'המרחק בין הקצוות גדול: ' + d.peakDrop.toFixed(2));
  assert(d.totalLoss < 2.5,
    'הירידה בין הממוצעים אמורה להיות צנועה: ' + d.totalLoss.toFixed(2));
  assert(d.startDays === 7, 'ממוצע הפתיחה על שבעה ימים');
  assert(d.startFrom === '2026-01-01', 'תחילת חלון הפתיחה');
});

test('פחות משבעה ימים -> ממוצע הפתיחה על מה שיש', () => {
  const entries = [
    { date: '2026-01-01', weightKg: 90 },
    { date: '2026-01-02', weightKg: 89 },
    { date: '2026-01-03', weightKg: 88 }
  ];
  const d = Metrics.dashboard(entries, WIN_SETTINGS, { endDate: '2026-01-03' });
  assert(d.startDays === 3, 'שלושה ימים, קיבלתי ' + d.startDays);
  close(d.startMean, 89, 1e-9, 'ממוצע הפתיחה');
});

test('הירידה נמדדת בין חצי התקופה הראשון לשני', () => {
  // 42 ימים -> 21 מול 21, בלי חפיפה
  const entries = buildSeries('2026-01-01', 42, (i) => ({ weightKg: 90 - 0.05 * i }));
  const d = Metrics.dashboard(entries, WIN_SETTINGS, { endDate: '2026-02-11' });

  assert(d.halves.days === 21, 'כל חצי 21 ימים, קיבלתי ' + d.halves.days);
  assert(d.halves.first.from === '2026-01-01' && d.halves.first.to === '2026-01-21',
    'החצי הראשון: ' + d.halves.first.from + '–' + d.halves.first.to);
  assert(d.halves.second.from === '2026-01-22' && d.halves.second.to === '2026-02-11',
    'החצי השני: ' + d.halves.second.from + '–' + d.halves.second.to);
  assert(!d.halves.skippedMiddleDay, 'מספר זוגי של ימים, אין יום שנשמט');

  // ירידה קבועה של 50 גרם ליום: המרחק בין מרכזי החצאים הוא 21 ימים
  close(d.totalLoss, 21 * 0.05, 1e-9, 'ההפרש בין החצאים');
  assert(d.halves.first.weighIns === 21 && d.halves.second.weighIns === 21,
    'כל שקילה נספרת בדיוק פעם אחת');
});

test('במספר ימים אי־זוגי היום האמצעי נשמט משני החצאים', () => {
  const entries = buildSeries('2026-01-01', 41, (i) => ({ weightKg: 90 - 0.05 * i }));
  const d = Metrics.dashboard(entries, WIN_SETTINGS, { endDate: '2026-02-10' });

  assert(d.halves.days === 20, 'כל חצי 20 ימים');
  assert(d.halves.skippedMiddleDay, 'היה צריך לסמן שיום נשמט');
  assert(d.halves.first.to < d.halves.second.from, 'החצאים לא חופפים');
  assert(Dates.diffDays(d.halves.first.to, d.halves.second.from) === 2,
    'בדיוק יום אחד בין החצאים');
});

test('החצאים משתמשים בכל הנתונים, לא רק בשבעה ימים', () => {
  // שבוע ראשון רועש במיוחד, שאר התקופה יציבה
  const entries = buildSeries('2026-01-01', 40, (i) => ({
    weightKg: (i < 7 ? 95 : 90) - 0.05 * i
  }));
  const d = Metrics.dashboard(entries, WIN_SETTINGS, { endDate: '2026-02-09' });

  // ממוצע פתיחה על שבעה ימים היה נותן מספר מנופח בהרבה
  const naive = d.startMean - d.currentWeight;
  assert(d.totalLoss < naive, 'החצאים אמורים למתן את השפעת השבוע הראשון: ' +
    d.totalLoss.toFixed(2) + ' מול ' + naive.toFixed(2));
  assert(d.halves.first.weighIns === 20, 'החצי הראשון כולל 20 ימים');
});

test('שבוע אחרון חריג מזוהה ומדווח בנפרד', () => {
  // ירידה יפה של חודש, ואז שבוע של עלייה חדה
  const entries = [];
  for (let i = 0; i < 35; i++) {
    entries.push({ date: Dates.addDays('2026-01-01', i), weightKg: 90 - 0.06 * i });
  }
  for (let i = 35; i < 42; i++) {
    entries.push({ date: Dates.addDays('2026-01-01', i), weightKg: 88 + 0.35 * (i - 35) });
  }
  const d = Metrics.dashboard(entries, WIN_SETTINGS, { endDate: '2026-02-11' });

  assert(d.halvesBeforeLastWeek, 'חסרה המדידה נכון לשבוע שעבר');
  assert(d.halvesBeforeLastWeek.loss > d.halves.loss,
    'עד שבוע שעבר הירידה הייתה גדולה יותר: ' +
    d.halvesBeforeLastWeek.loss.toFixed(2) + ' מול ' + d.halves.loss.toFixed(2));
  assert(d.lastWeekEffect < 0, 'השבוע האחרון אמור להקטין את הירידה');
  close(d.lastWeekEffect, d.halves.loss - d.halvesBeforeLastWeek.loss, 1e-9, 'עקביות');
});

test('בלי שבוע חריג שתי המדידות קרובות', () => {
  const entries = buildSeries('2026-01-01', 42, (i) => ({ weightKg: 90 - 0.05 * i }));
  const d = Metrics.dashboard(entries, WIN_SETTINGS, { endDate: '2026-02-11' });
  assert(Math.abs(d.lastWeekEffect) < 0.4,
    'בירידה קבועה אין סיבה לפער גדול: ' + d.lastWeekEffect.toFixed(2));
});

test('תקופה קצרה מדי -> אין מדידה נכון לשבוע שעבר', () => {
  const entries = buildSeries('2026-01-01', 12, (i) => ({ weightKg: 90 - 0.05 * i }));
  const d = Metrics.dashboard(entries, WIN_SETTINGS, { endDate: '2026-01-12' });
  assert(d.halvesBeforeLastWeek === null, 'לא אמורה להיות מדידה כזו');
  assert(d.lastWeekEffect === null, 'ולכן גם אין השפעה מחושבת');
});

test('המדידה עד שבוע שעבר נקייה מחפיפה', () => {
  const entries = buildSeries('2026-01-01', 42, (i) => ({ weightKg: 90 - 0.05 * i }));
  const d = Metrics.dashboard(entries, WIN_SETTINGS, { endDate: '2026-02-11' });
  const before = d.halvesBeforeLastWeek;

  assert(before, 'חסרה המדידה');
  assert(before.second.to === '2026-02-04', 'היא אמורה להסתיים שבוע קודם: ' + before.second.to);
  assert(before.first.to < before.second.from, 'החצאים חופפים');
  assert(before.days < d.halves.days, 'תקופה קצרה יותר -> חצאים קצרים יותר');

  // כל שקילה נספרת לכל היותר פעם אחת
  assert(before.first.weighIns + before.second.weighIns <= 35, 'ספירה כפולה');
});

// ---------- דוח ----------
// הריצה מופעלת בסוף הקובץ בלבד. אם היא תופעל באמצע, בדיקות שנרשמו
// אחריה לא ייכנסו לתור וייעלמו בשקט — קרה בפועל.
runAll().then(function () {
  console.log('');
  failures.forEach(function (f) {
    console.log('\u2717 ' + f.name);
    console.log('   ' + f.message);
  });
  console.log('\n' + passed + ' \u05e2\u05d1\u05e8\u05d5, ' + failures.length + ' \u05e0\u05db\u05e9\u05dc\u05d5\n');
  process.exit(failures.length ? 1 : 0);
});
