/**
 * Sheets — משיכת נתונים מה-Apps Script הקיים של הגיליון.
 *
 * הכתובת לא נשמרת בקוד אלא בהגדרות, מסיבה אחת: מי שמחזיק בה יכול
 * לקרוא ולכתוב לגיליון בלי שום אימות. כתובת בתוך ריפו ציבורי היא
 * כתובת פומבית.
 *
 * הסנכרון הוא חד־כיווני — משיכה בלבד. כתיבה חזרה תדרוש טיפול
 * בהתנגשויות, ואין סיבה לקחת את הסיכון הזה כשהאפליקציה שומרת מקומית.
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

  root.Sheets = {
    pull: pull,
    rowsToEntries: rowsToEntries,
    merge: merge,
    toIso: toIso,
    NUTRITION_COLUMNS: NUTRITION_COLUMNS,
    BODY_COLUMNS: BODY_COLUMNS,
    NUTRITION_ACTIONS: NUTRITION_ACTIONS,
    BODY_ACTIONS: BODY_ACTIONS
  };
})(typeof window !== 'undefined' ? window : globalThis);
