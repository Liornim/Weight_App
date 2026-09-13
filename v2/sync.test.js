/**
 * בדיקות לשמירה בגיליון.
 *
 * השמירה נעשית ב-JSONP ולא ב-POST: בקשה חוצת־מקורות ל-Apps Script
 * גוררת preflight שהוא אינו עונה עליו, וזה מה שהחזיר "Failed to
 * fetch". כאן נבדק שהכתובת נבנית בדיוק כמו בדפים שעובדים.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const dom = new JSDOM('<html><head></head><body></body></html>', { url: 'https://x.local/' });
const w = dom.window;

new Function('window', 'globalThis',
  fs.readFileSync(path.join(ROOT, 'js/core/sheets.js'), 'utf8'))(w, w);

let passed = 0;
const failures = [];
const queue = [];

function test(name, fn) { queue.push({ name, fn }); }
function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

const URL = 'https://script.google.com/macros/s/TEST/exec';

/** מדמה את גוגל: קולט את תג הסקריפט וקורא ל-callback */
function serve(handler) {
  const seen = [];
  const head = w.document.head;
  const original = head.appendChild.bind(head);

  head.appendChild = function (node) {
    if (node.tagName !== 'SCRIPT') return original(node);
    seen.push(node.src);

    setTimeout(function () {
      const params = new w.URLSearchParams(node.src.split('?')[1]);
      const name = params.get('callback');
      const reply = handler ? handler(params) : { ok: true };
      if (reply === null) {
        if (node.onerror) node.onerror();
      } else if (reply === 'silent') {
        // הסקריפט החזיר JSON נקי בלי לעטוף בקריאה ל-callback
        if (node.onload) node.onload();
      } else {
        w[name](reply);
      }
    }, 0);

    return node;
  };

  return seen;
}

test('מדדי גוף נשלחים בפעולת add עם אותם שמות פרמטרים', () => {
  const seen = serve();

  return w.Sheets.push(URL, {
    date: '2026-09-13', weightKg: 88.4, muscleKg: 35.4,
    bodyFatKg: 22.3, waterKg: 48.4
  }).then(() => {
    assert(seen.length === 1, 'ציפיתי לקריאה אחת, היו ' + seen.length);
    const params = new w.URLSearchParams(seen[0].split('?')[1]);

    assert(params.get('action') === 'add', 'פעולה: ' + params.get('action'));
    assert(params.get('date') === '2026-09-13', 'תאריך');
    assert(params.get('weight') === '88.4', 'משקל: ' + params.get('weight'));
    assert(params.get('muscle') === '35.4', 'שריר');
    assert(params.get('fat') === '22.3', 'שומן');
    assert(params.get('fluids') === '48.4', 'נוזלים');
    assert(params.get('callback'), 'חסר callback');
  });
});

test('תזונה נשלחת בפעולת addNutrition', () => {
  const seen = serve();

  return w.Sheets.push(URL, {
    date: '2026-09-13', kcal: 2100, proteinG: 150,
    carbG: 200, fatG: 80, fiberG: 25, steps: 9500
  }).then(() => {
    const params = new w.URLSearchParams(seen[0].split('?')[1]);

    assert(params.get('action') === 'addNutrition', 'פעולה: ' + params.get('action'));
    assert(params.get('calories') === '2100', 'קלוריות');
    assert(params.get('protein') === '150', 'חלבון');
    assert(params.get('carbs') === '200', 'פחמימות');
    assert(params.get('fat') === '80', 'שומן');
    assert(params.get('fiber') === '25', 'סיבים');
    assert(params.get('steps') === '9500', 'צעדים');
  });
});

test('יום עם שתי הקבוצות נשלח בשתי קריאות', () => {
  const seen = serve();

  return w.Sheets.push(URL, {
    date: '2026-09-13', weightKg: 88.4, kcal: 2100
  }).then(() => {
    assert(seen.length === 2, 'ציפיתי לשתי קריאות, היו ' + seen.length);
    const actions = seen.map((src) =>
      new w.URLSearchParams(src.split('?')[1]).get('action')).sort();
    assert(actions[0] === 'add' && actions[1] === 'addNutrition',
      'פעולות: ' + actions.join(','));
  });
});

test('קבוצה ריקה אינה נשלחת כלל', () => {
  const seen = serve();

  // רק מדדי גוף — אין סיבה לשלוח פעולת תזונה ריקה שתדרוס נתונים
  return w.Sheets.push(URL, { date: '2026-09-13', weightKg: 88.4 }).then(() => {
    assert(seen.length === 1, 'נשלחו ' + seen.length + ' קריאות');
    assert(seen[0].indexOf('action=add&') !== -1 || seen[0].indexOf('action=add') !== -1,
      'הפעולה שנשלחה: ' + seen[0]);
    assert(seen[0].indexOf('addNutrition') === -1, 'נשלחה פעולת תזונה ריקה');
  });
});

test('ערכים ריקים אינם נכנסים לכתובת', () => {
  const seen = serve();

  return w.Sheets.push(URL, {
    date: '2026-09-13', kcal: 2100, proteinG: null, fiberG: ''
  }).then(() => {
    const params = new w.URLSearchParams(seen[0].split('?')[1]);
    assert(!params.has('protein'), 'חלבון ריק נשלח');
    assert(!params.has('fiber'), 'סיבים ריקים נשלחו');
    assert(params.get('calories') === '2100', 'הקלוריות לא נשלחו');
  });
});

test('תשובה בלי callback עדיין נחשבת הצלחה', () => {
  // חלק מהפעולות מחזירות JSON נקי; התג נטען, הפונקציה לא נקראת,
  // והבקשה בכל זאת בוצעה
  serve(() => 'silent');

  return w.Sheets.push(URL, { date: '2026-09-13', weightKg: 88 }).then((parts) => {
    assert(parts.length === 1, 'לא הוחזרה תוצאה');
    assert(parts[0].data.viaLoad, 'לא סומן שההצלחה נקבעה מהטעינה');
  });
});

test('כישלון טעינה מדווח בהודעה מובנת', () => {
  serve(() => null);

  return w.Sheets.push(URL, { date: '2026-09-13', weightKg: 88 }).then(
    () => { throw new Error('היה צריך להיכשל'); },
    (error) => {
      assert(error.message.indexOf('לא נענה') !== -1, error.message);
      assert(error.message.indexOf('Anyone') !== -1,
        'ההודעה לא מכוונת להגדרת הפריסה: ' + error.message);
    });
});

test('בלי כתובת או בלי תאריך אין שליחה', () => {
  const seen = serve();

  return w.Sheets.push('', { date: '2026-09-13' }).then(
    () => { throw new Error('היה צריך להיכשל'); },
    (error) => {
      assert(error.message.indexOf('כתובת') !== -1, error.message);
      return w.Sheets.push(URL, { weightKg: 88 }).then(
        () => { throw new Error('היה צריך להיכשל'); },
        (second) => {
          assert(second.message.indexOf('תאריך') !== -1, second.message);
          assert(seen.length === 0, 'נשלחה בקשה למרות קלט חסר');
        });
    });
});

test('יום בלי שום ערך אינו נשלח', () => {
  const seen = serve();
  return w.Sheets.push(URL, { date: '2026-09-13' }).then(
    () => { throw new Error('היה צריך להיכשל'); },
    (error) => {
      assert(error.message.indexOf('אין מה לשמור') !== -1, error.message);
      assert(seen.length === 0, 'נשלחה בקשה ריקה');
    });
});

queue.reduce(function (chain, item) {
  return chain.then(function () {
    return Promise.resolve().then(item.fn).then(
      () => { passed++; },
      (error) => failures.push({ name: item.name, message: error.message }));
  });
}, Promise.resolve()).then(function () {
  console.log('');
  failures.forEach((f) => { console.log('\u2717 ' + f.name); console.log('   ' + f.message); });
  console.log('\n' + passed + ' עברו, ' + failures.length + ' נכשלו\n');
  process.exit(failures.length ? 1 : 0);
});
