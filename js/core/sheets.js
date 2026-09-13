/**
 * Sheets — משיכת נתונים מה-Apps Script הקיים של הגיליון.
 *
 * הכתובת לא נשמרת בקוד אלא בהגדרות, מסיבה אחת: מי שמחזיק בה יכול
 * לקרוא ולכתוב לגיליון בלי שום אימות. כתובת בתוך ריפו ציבורי היא
 * כתובת פומבית.
 *
 * הקריאה והכתיבה נעשות שתיהן דרך הפעולות שכבר מוגדרות בסקריפט:
 * get ו-getNutrition לקריאה, add ו-addNutrition לכתיבה. אין צורך
 * לשנות בו דבר.
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
   * שמירה לגיליון ב-JSONP.
   *
   * POST רגיל נכשל ב-"Failed to fetch": בקשה חוצת־מקורות ל-Apps
   * Script גוררת preflight שהוא אינו עונה עליו. JSONP עוקף את זה
   * לגמרי — תג script לכתובת GET אינו כפוף ל-CORS, והסקריפט מחזיר
   * קריאה לפונקציה שהגדרנו.
   *
   * זו בדיוק השיטה שבה הדפים הקיימים שומרים, ולכן אין צורך לגעת
   * בסקריפט: הפעולות add ו-addNutrition כבר מוגדרות בו.
   */
  function jsonp(url, params, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var doc = root.document;
      if (!doc) { reject(new Error('אין דפדפן')); return; }

      var name = 'sheetsCallback_' + Date.now() + '_' +
        Math.floor(Math.random() * 100000);
      var script = doc.createElement('script');
      var done = false;

      var cleanup = function () {
        if (done) return;
        done = true;
        try { delete root[name]; } catch (error) { root[name] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      };

      var settled = false;
      var finish = function (value) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      root[name] = function (data) {
        finish(data === undefined ? { ok: true } : data);
      };

      /**
       * onload אינו עדות להצלחה.
       *
       * תג script יורה onload גם כשהתוכן שהתקבל אינו JavaScript
       * תקין — דף שגיאה של Apps Script נטען "בהצלחה" ורק נכשל
       * בפענוח, וכישלון פענוח אינו מגיע ל-onerror. הסתמכות על
       * onload גרמה לכך שכישלון דווח כשמירה מוצלחת.
       *
       * ההצלחה היחידה שנחשבת היא קריאה בפועל ל-callback.
       */
      script.onload = function () {
        setTimeout(function () {
          if (settled) return;
          settled = true;
          var address = script.src;
          cleanup();
          var error = new Error('הגיליון החזיר תשובה שאינה בפורמט הצפוי. ' +
            'כנראה הסקריפט לא מכיר את הפעולה, או שהוא החזיר דף שגיאה.');
          error.url = address;
          error.loaded = true;
          reject(error);
        }, 1500);
      };

      /**
       * כל הפרמטרים נשלחים תמיד, גם ריקים.
       *
       * השמטת פרמטר ריק נראתה נקייה יותר, אבל הסקריפט מצפה לכולם:
       * חסר אחד והוא זורק שגיאה, מחזיר דף HTML במקום JavaScript,
       * והתג נכשל בטעינה. זה בדיוק מה שהחזיר "הגיליון לא נענה".
       * הדפים שעובדים שולחים את כולם.
       */
      var query = Object.keys(params).map(function (key) {
        var value = params[key];
        var text = (value === null || value === undefined) ? '' : String(value);
        return encodeURIComponent(key) + '=' + encodeURIComponent(text);
      }).join('&');

      script.src = url + (url.indexOf('?') === -1 ? '?' : '&') +
        query + '&callback=' + name;

      script.onerror = function () {
        if (settled) return;
        settled = true;
        var address = script.src;
        cleanup();
        var error = new Error('הגיליון לא נענה. כדאי לוודא שהכתובת נכונה ' +
          'ושהפריסה מוגדרת "Anyone" ולא "Anyone with Google account".');
        error.url = address;
        reject(error);
      };

      setTimeout(function () {
        if (settled) return;
        settled = true;
        var address = script.src;
        cleanup();
        var late = new Error('הגיליון לא ענה בזמן.');
        late.url = address;
        reject(late);
      }, timeoutMs || 20000);

      doc.head.appendChild(script);
    });
  }

  /**
   * שומר יום אחד: מדדי גוף ותזונה, כל אחד בפעולה שלו.
   * נשלח רק מה שיש — פעולה בלי ערכים תדרוס נתונים קיימים בריק.
   */
  /**
   * הסקריפט מצפה ל-DD/MM/YYYY.
   *
   * זה הפורמט שהדפים הקיימים שולחים, והם אלה שעובדים. שליחת
   * YYYY-MM-DD גרמה לסקריפט לזרוק שגיאה, להחזיר דף HTML במקום
   * JavaScript, ולכישלון שנראה כמו בעיית הרשאות.
   */
  function toSheetDate(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso || '');
  }

  function push(url, entry) {
    if (!url) return Promise.reject(new Error('לא הוגדרה כתובת גיליון'));
    if (!entry || !entry.date) return Promise.reject(new Error('אין תאריך לשמירה'));

    var sheetDate = toSheetDate(entry.date);

    var has = function (fields) {
      return fields.some(function (key) {
        return entry[key] !== null && entry[key] !== undefined && entry[key] !== '';
      });
    };

    var jobs = [];

    if (has(['weightKg', 'muscleKg', 'bodyFatKg', 'waterKg'])) {
      jobs.push(jsonp(url, {
        action: 'add',
        date: sheetDate,
        weight: entry.weightKg,
        muscle: entry.muscleKg,
        fat: entry.bodyFatKg,
        fluids: entry.waterKg
      }).then(function (data) { return { part: 'body', data: data }; }));
    }

    if (has(['kcal', 'proteinG', 'carbG', 'fatG', 'fiberG', 'steps'])) {
      jobs.push(jsonp(url, {
        action: 'addNutrition',
        date: sheetDate,
        calories: entry.kcal,
        fat: entry.fatG,
        carbs: entry.carbG,
        protein: entry.proteinG,
        fiber: entry.fiberG,
        steps: entry.steps
      }).then(function (data) { return { part: 'nutrition', data: data }; }));
    }

    if (!jobs.length) return Promise.reject(new Error('אין מה לשמור ליום הזה'));
    return Promise.all(jobs);
  }

  /**
   * בדיקת חיבור: שולחת פעולת שמירה ריקה ומדווחת מה חזר.
   * משתמשת באותו ערוץ שבו נעשית השמירה, כדי שהבדיקה תשקף את המציאות.
   */
  function probe(url) {
    if (!url) return Promise.reject(new Error('לא הוגדרה כתובת גיליון'));

    return jsonp(url, { action: 'get' }, 12000).then(function (data) {
      var rows = data && (data.rows || data.data);
      return {
        accepted: true,
        rows: rows ? rows.length : null,
        body: JSON.stringify(data).slice(0, 300)
      };
    });
  }

  root.Sheets = {
    push: push,
    probe: probe,
    jsonp: jsonp,
    toSheetDate: toSheetDate,
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
