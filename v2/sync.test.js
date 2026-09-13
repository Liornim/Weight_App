/**
 * בדיקות לכתיבה חזרה לגיליון, עם שרת מדומה.
 * הנקודה הרגישה כאן היא כישלון שקט: סקריפט בלי doPost מחזיר דף
 * HTML עם קוד 200, ובלי בדיקה זה נראה כמו הצלחה.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const dom = new JSDOM('<div></div>', { url: 'https://x.local/' });
const w = dom.window;

['js/lib/dates.js', 'js/core/sheets.js'].forEach((file) => {
  new Function('window', 'globalThis', fs.readFileSync(path.join(ROOT, file), 'utf8'))(w, w);
});

let passed = 0;
const failures = [];
const queue = [];

function test(name, fn) { queue.push({ name, fn }); }
function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

const URL = 'https://script.google.com/macros/s/TEST/exec';
const ENTRY = { date: '2026-09-13', weightKg: 88.4, kcal: 2100 };

test('היום נשלח כ-JSON בגוף הבקשה', () => {
  let sent = null;
  w.fetch = (url, opts) => {
    sent = { url, opts };
    return Promise.resolve({ ok: true, status: 200,
      text: () => Promise.resolve('{"ok":true}') });
  };

  return w.Sheets.push(URL, ENTRY).then(() => {
    assert(sent.url === URL, 'כתובת שגויה');
    assert(sent.opts.method === 'POST', 'לא POST');
    const body = JSON.parse(sent.opts.body);
    assert(body.action === 'save', 'פעולה: ' + body.action);
    assert(body.entry.date === '2026-09-13', 'התאריך לא נשלח');
    assert(body.entry.weightKg === 88.4, 'המשקל לא נשלח');
  });
});

test('נשלח כ-text/plain כדי להימנע מ-preflight', () => {
  let headers = null;
  w.fetch = (url, opts) => {
    headers = opts.headers;
    return Promise.resolve({ ok: true, status: 200,
      text: () => Promise.resolve('{"ok":true}') });
  };

  return w.Sheets.push(URL, ENTRY).then(() => {
    assert(headers['Content-Type'].indexOf('text/plain') === 0,
      'סוג התוכן: ' + headers['Content-Type'] + ' — application/json גורר preflight ' +
      'ש-Apps Script לא עונה עליו');
  });
});

test('סקריפט בלי doPost מזוהה ולא נחשב להצלחה', () => {
  // Apps Script מחזיר דף HTML עם קוד 200 כשהפעולה לא קיימת
  w.fetch = () => Promise.resolve({ ok: true, status: 200,
    text: () => Promise.resolve('<!DOCTYPE html><html>Script function not found</html>') });

  return w.Sheets.push(URL, ENTRY).then(
    () => { throw new Error('היה צריך להיכשל'); },
    (error) => assert(error.message.indexOf('doPost') !== -1,
      'ההודעה לא מסבירה מה חסר: ' + error.message));
});

test('שגיאה שהסקריפט מחזיר מועברת כמו שהיא', () => {
  w.fetch = () => Promise.resolve({ ok: true, status: 200,
    text: () => Promise.resolve('{"ok":false,"error":"לשונית לא נמצאה"}') });

  return w.Sheets.push(URL, ENTRY).then(
    () => { throw new Error('היה צריך להיכשל'); },
    (error) => assert(error.message.indexOf('לשונית') !== -1, error.message));
});

test('בלי כתובת או בלי תאריך אין שליחה', () => {
  let called = false;
  w.fetch = () => { called = true; return Promise.resolve({}); };

  return w.Sheets.push('', ENTRY).then(
    () => { throw new Error('היה צריך להיכשל'); },
    (error) => {
      assert(error.message.indexOf('כתובת') !== -1, error.message);
      return w.Sheets.push(URL, { weightKg: 88 }).then(
        () => { throw new Error('היה צריך להיכשל'); },
        (second) => {
          assert(second.message.indexOf('תאריך') !== -1, second.message);
          assert(!called, 'נשלחה בקשה למרות הקלט החסר');
        });
    });
});

test('בדיקת החיבור מבחינה בין קבלה לדחייה', () => {
  w.fetch = () => Promise.resolve({ ok: true, status: 200,
    text: () => Promise.resolve('{"ok":true}') });

  return w.Sheets.probe(URL).then((result) => {
    assert(result.accepted, 'תשובה תקינה לא זוהתה כקבלה');
    assert(result.isJson, 'לא זוהה כ-JSON');

    // דף HTML מסקריפט בלי doPost
    w.fetch = () => Promise.resolve({ ok: true, status: 200,
      text: () => Promise.resolve('<!DOCTYPE html>Script function not found: doPost') });

    return w.Sheets.probe(URL).then((html) => {
      assert(!html.accepted, 'דף HTML נחשב לקבלה');
      assert(!html.isJson, 'זוהה בטעות כ-JSON');
      assert(html.body.indexOf('doPost') !== -1, 'הגוף לא הוחזר לאבחון');
    });
  });
});

test('בדיקת החיבור מקבלת גם success כמו בסקריפט הישן', () => {
  w.fetch = () => Promise.resolve({ ok: true, status: 200,
    text: () => Promise.resolve('{"success":true}') });

  return w.Sheets.probe(URL).then((result) => {
    assert(result.accepted, 'הסקריפט הישן מחזיר success ולא ok');
  });
});

test('קוד ה-doPost מכיל את מה שצריך', () => {
  const code = w.Sheets.DO_POST_SNIPPET;
  ['function doPost', 'JSON.parse', 'getSheetByName', 'ContentService']
    .forEach((part) => assert(code.indexOf(part) !== -1, 'חסר: ' + part));

  // ערך ריק לא מוחק נתון קיים
  assert(code.indexOf('=== ""') !== -1 || code.indexOf('continue') !== -1,
    'אין הגנה מפני מחיקת ערכים');
  // אזור הזמן מפורש, אחרת התאריך יזוז
  assert(code.indexOf('Asia/Jerusalem') !== -1, 'אזור הזמן לא מפורש');
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
