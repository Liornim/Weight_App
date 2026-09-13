/**
 * Sheets — משיכת נתונים מה-Apps Script הקיים של הגיליון.
 *
 * הכתובת לא נשמרת בקוד אלא בהגדרות, מסיבה אחת: מי שמחזיק בה יכול
 * לקרוא ולכתוב לגיליון בלי שום אימות. כתובת בתוך ריפו ציבורי היא
 * כתובת פומבית.
 *
 * המשיכה עובדת מול כל Apps Script קיים. הכתיבה חזרה דורשת פעולה
 * אחת נוספת בסקריפט (doPost), ולכן היא כבויה עד שמפעילים אותה
 * במפורש — כדי ששמירה לא תיכשל בשקט מול סקריפט שלא מכיר אותה.
 */
(function (root) {
  'use strict';

  // שמות הפעולות שנוסה. ה-Apps Script של הגיליון חושף getNutrition,
  // ולשם מדדי הגוף ננסה כמה שמות מקובלים עד שאחד יענה.
  var NUTRITION_ACTIONS = ['getNutrition'];
  // 'get' הוא מה שהדף הישן משתמש בו בפועל. השאר נשארים כגיבוי.
  var BODY_ACTIONS = ['get', 'getMetrics', 'getBodyMetrics', 'getData'];

  /** [תאריך, קלוריות, שומן, פחמימות, חלבון, סיבים, צעדים] */
  var NUTRITION_COLUMNS = [null, 'kcal', 'fatG', 'carbG', 'proteinG', 'fiberG', 'steps'];

  /** [תאריך, משקל, שריר, שומן, נוזלים] */
  var BODY_COLUMNS = [null, 'weightKg', 'muscleKg', 'bodyFatKg', 'waterKg'];

  /**
   * שמות עמודות מוכרים.
   *
   * מיפוי לפי מיקום נשבר ברגע שמישהו מוסיף עמודה או מחליף סדר —
   * והתוצאה שקטה: שדה שלם חוזר ריק בלי שום שגיאה. לכן, אם השורה
   * הראשונה נראית ככותרות, המיפוי נבנה ממנה.
   *
   * הסדר חשוב: "שומן בגוף" נבדק לפני "שומן", אחרת שומן האוכל היה
   * בולע את מדידת הגוף.
   */
  var HEADER_NAMES = [
    { key: 'kcal', words: ['קלוריות', 'קלוריה', 'קק"ל', 'קק״ל', 'kcal', 'calories'] },
    { key: 'proteinG', words: ['חלבון', 'protein'] },
    { key: 'carbG', words: ['פחמימות', 'פחמימה', 'carbs', 'carbohydrate'] },
    { key: 'fiberG', words: ['סיבים', 'סיב', 'fiber', 'fibre'] },
    { key: 'steps', words: ['צעדים', 'steps'] },
    { key: 'weightKg', words: ['משקל', 'weight'] },
    { key: 'muscleKg', words: ['שריר', 'muscle'] },
    { key: 'waterKg', words: ['נוזלים', 'מים', 'water'] },
    { key: 'bodyFatKg', words: ['שומן בגוף', 'אחוז שומן', 'שומן גוף', 'body fat', 'bodyfat'] },
    { key: 'fatG', words: ['שומן', 'fat'] }
  ];

  function headerKey(cell) {
    var text = String(cell === null || cell === undefined ? '' : cell).toLowerCase().trim();
    if (!text) return null;

    for (var i = 0; i < HEADER_NAMES.length; i++) {
      var found = HEADER_NAMES[i].words.some(function (word) {
        return text.indexOf(String(word).toLowerCase()) !== -1;
      });
      if (found) return HEADER_NAMES[i].key;
    }
    return null;
  }

  /**
   * בונה מיפוי עמודות מהשורה הראשונה, אם היא כותרות.
   * מזוהה ככותרות כשהתא הראשון אינו תאריך ולפחות שתי עמודות
   * מזוהות בשם — שורת נתונים לא תעמוד בשני התנאים.
   */
  function columnsFromHeader(row) {
    if (!row || !row.length) return null;
    if (toIso(row[0]) !== null) return null;

    var mapped = row.map(function (cell, index) {
      return index === 0 ? null : headerKey(cell);
    });

    var named = mapped.filter(Boolean).length;
    return named >= 2 ? mapped : null;
  }

  function isIsoLike(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value);
  }

  function localIso(date) {
    if (!date || isNaN(date.getTime())) return null;
    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0');
  }

  /**
   * מקבל DD/MM/YYYY, YYYY-MM-DD, חותמת זמן מלאה או אובייקט Date.
   *
   * חותמת זמן מומרת לפי אזור הזמן המקומי ולא לפי UTC. גיליון גוגל
   * מחזיר תא תאריך כאובייקט Date, וב-JSON הוא הופך ל-UTC — כך
   * ש-22/08 בישראל מגיע כ-21/08T21:00Z. חיתוך המחרוזת לפני ה-T
   * היה מזיז כל תאריך כזה יום אחורה.
   */
  function toIso(value) {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return localIso(value);
    var s = String(value).trim();
    if (!s) return null;
    if (s.indexOf('T') !== -1) return localIso(new Date(s));
    if (isIsoLike(s)) return s.slice(0, 10);
    var m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
    if (!m) return null;
    var year = m[3].length === 2 ? '20' + m[3] : m[3];
    return year + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = parseFloat(String(value).replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }

  /** ממיר מערך שורות מהגיליון לרשומות של האפליקציה */
  function rowsToEntries(rows, columns) {
    // כותרות גוברות על המיקום הקבוע
    var header = columnsFromHeader((rows || [])[0]);
    if (header) {
      columns = header;
      rows = rows.slice(1);
    }

    var out = [];
    (rows || []).forEach(function (row) {
      if (!Array.isArray(row) || !row.length) return;
      var date = toIso(row[0]);
      if (!date) return;
      var entry = { date: date };
      var hasValue = false;
      columns.forEach(function (key, i) {
        if (!key) return;
        var v = toNumber(row[i]);
        if (v !== null) { entry[key] = v; hasValue = true; }
      });
      if (hasValue) out.push(entry);
    });
    return out;
  }

  /** ממזג רשומות משני מקורות לפי תאריך */
  function merge(groups) {
    var byDate = {};
    groups.forEach(function (list) {
      (list || []).forEach(function (entry) {
        byDate[entry.date] = Object.assign({}, byDate[entry.date], entry);
      });
    });
    return Object.keys(byDate).sort().map(function (d) { return byDate[d]; });
  }

  /** קריאה אחת. transport מוזרק כדי שאפשר יהיה לבדוק בלי רשת. */
  function call(url, action, transport) {
    var target = url + (url.indexOf('?') === -1 ? '?' : '&') + 'action=' + encodeURIComponent(action);
    return transport(target).then(function (payload) {
      if (payload && payload.success && Array.isArray(payload.data)) return payload.data;
      return null;
    }).catch(function () { return null; });
  }

  function defaultTransport(target) {
    return fetch(target).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    });
  }

  /** מנסה כמה שמות פעולה ומחזיר את הראשון שהחזיר נתונים */
  function tryActions(url, actions, transport) {
    var index = 0;
    function next() {
      if (index >= actions.length) return Promise.resolve({ action: null, rows: null });
      var action = actions[index++];
      return call(url, action, transport).then(function (rows) {
        return rows ? { action: action, rows: rows } : next();
      });
    }
    return next();
  }

  /**
   * משיכה מלאה. מחזיר את הרשומות ואת שמות הפעולות שעבדו,
   * כדי שה-UI יוכל לומר מה נמצא ומה לא.
   */
  function pull(url, options) {
    var opts = options || {};
    var transport = opts.transport || defaultTransport;
    if (!url || !/^https:\/\//.test(url)) {
      return Promise.reject(new Error('צריך כתובת https תקינה'));
    }

    return Promise.all([
      tryActions(url, opts.nutritionActions || NUTRITION_ACTIONS, transport),
      tryActions(url, opts.bodyActions || BODY_ACTIONS, transport)
    ]).then(function (results) {
      var nutrition = rowsToEntries(results[0].rows, NUTRITION_COLUMNS);
      var body = rowsToEntries(results[1].rows, BODY_COLUMNS);

      if (!results[0].action && !results[1].action) {
        throw new Error('הכתובת ענתה, אבל לא הוחזרו נתונים בפורמט המוכר');
      }

      function span(list) {
        if (!list.length) return null;
        var dates = list.map(function (e) { return e.date; }).sort();
        return { from: dates[0], to: dates[dates.length - 1] };
      }

      return {
        entries: merge([nutrition, body]),
        nutrition: { action: results[0].action, count: nutrition.length, span: span(nutrition) },
        body: { action: results[1].action, count: body.length, span: span(body) }
      };
    });
  }

  /**
   * כתיבת יום אחד חזרה לגיליון.
   *
   * נשלח כ-text/plain ולא כ-JSON בכוונה: בקשת JSON חוצת־מקורות
   * גוררת preflight, ו-Apps Script אינו עונה עליו. עם text/plain
   * הדפדפן שולח ישירות, והסקריפט קורא את הגוף ומפענח בעצמו.
   */
  function push(url, entry) {
    if (!url) return Promise.reject(new Error('לא הוגדרה כתובת גיליון'));
    if (!entry || !entry.date) return Promise.reject(new Error('אין תאריך לשמירה'));

    return root.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'save', entry: entry })
    }).then(function (response) {
      return response.text().then(function (body) {
        if (!response.ok) {
          throw new Error('הגיליון החזיר ' + response.status + ': ' + body.slice(0, 120));
        }

        var data;
        try {
          data = JSON.parse(body);
        } catch (error) {
          // סקריפט בלי doPost מחזיר דף HTML של שגיאה
          throw new Error('הסקריפט של הגיליון אינו תומך בשמירה. ' +
            'צריך להוסיף לו פעולת doPost.');
        }

        if (data && data.ok === false) {
          throw new Error(data.error || 'השמירה נדחתה');
        }
        return data;
      });
    });
  }

  /** הקוד שצריך להדביק ב-Apps Script של הגיליון כדי לאפשר שמירה */
  var DO_POST_SNIPPET = [
    '// מקבל יום אחד מהאפליקציה ומעדכן את שתי הלשוניות.',
    '// מעדכן שורה קיימת לפי התאריך, ומוסיף חדשה אם אין.',
    'function doPost(e) {',
    '  try {',
    '    var body = JSON.parse(e.postData.contents);',
    '    if (body.action !== "save") throw new Error("פעולה לא מוכרת");',
    '',
    '    var entry = body.entry;',
    '    var date = new Date(entry.date + "T12:00:00");',
    '',
    '    writeRow("גיליון1", date, [',
    '      entry.weightKg, entry.muscleKg, entry.bodyFatKg, entry.waterKg]);',
    '    writeRow("Nutrition", date, [',
    '      entry.kcal, entry.fatG, entry.carbG, entry.proteinG,',
    '      entry.fiberG, entry.steps]);',
    '',
    '    return json({ ok: true });',
    '  } catch (error) {',
    '    return json({ ok: false, error: String(error) });',
    '  }',
    '}',
    '',
    'function writeRow(sheetName, date, values) {',
    '  var sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);',
    '  if (!sheet) return;',
    '',
    '  var key = Utilities.formatDate(date, "Asia/Jerusalem", "yyyy-MM-dd");',
    '  var dates = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();',
    '  var target = 0;',
    '',
    '  for (var i = 0; i < dates.length; i++) {',
    '    var cell = dates[i][0];',
    '    if (!cell) continue;',
    '    var asDate = cell instanceof Date ? cell : new Date(cell);',
    '    if (isNaN(asDate.getTime())) continue;',
    '    if (Utilities.formatDate(asDate, "Asia/Jerusalem", "yyyy-MM-dd") === key) {',
    '      target = i + 1;',
    '      break;',
    '    }',
    '  }',
    '',
    '  if (!target) {',
    '    target = sheet.getLastRow() + 1;',
    '    sheet.getRange(target, 1).setValue(date);',
    '  }',
    '',
    '  // ערך ריק לא מוחק את מה שכבר בגיליון',
    '  for (var c = 0; c < values.length; c++) {',
    '    if (values[c] === null || values[c] === undefined || values[c] === "") continue;',
    '    sheet.getRange(target, c + 2).setValue(values[c]);',
    '  }',
    '}',
    '',
    'function json(payload) {',
    '  return ContentService.createTextOutput(JSON.stringify(payload))',
    '    .setMimeType(ContentService.MimeType.JSON);',
    '}'
  ].join('\n');

  root.Sheets = {
    push: push,
    DO_POST_SNIPPET: DO_POST_SNIPPET,
    pull: pull,
    rowsToEntries: rowsToEntries,
    merge: merge,
    toIso: toIso,
    NUTRITION_COLUMNS: NUTRITION_COLUMNS,
    BODY_COLUMNS: BODY_COLUMNS,
    columnsFromHeader: columnsFromHeader,
    headerKey: headerKey,
    rowsToEntries: rowsToEntries,
    NUTRITION_ACTIONS: NUTRITION_ACTIONS,
    BODY_ACTIONS: BODY_ACTIONS
  };
})(typeof window !== 'undefined' ? window : globalThis);
