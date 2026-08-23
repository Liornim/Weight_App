/**
 * Dates — עבודה עם תאריכים בפורמט ISO (YYYY-MM-DD) בלבד.
 * כל התאריכים במערכת הם מחרוזות ISO. אין Date objects באחסון,
 * כדי להימנע מהפתעות אזור זמן.
 */
(function (root) {
  'use strict';

  var MS_PER_DAY = 86400000;
  var DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  function isIso(str) {
    return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str);
  }

  /** ISO -> Date ב-UTC, כדי שהחשבון לא יזוז בשעון קיץ */
  function toDate(iso) {
    if (!isIso(iso)) return null;
    var parts = iso.split('-');
    return new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
  }

  function fromDate(date) {
    var y = date.getUTCFullYear();
    var m = String(date.getUTCMonth() + 1).padStart(2, '0');
    var d = String(date.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  /** מספר הימים מאז 1970 — האינדקס שמשמש כציר X בכל הרגרסיות */
  function dayIndex(iso) {
    var d = toDate(iso);
    return d === null ? null : Math.round(d.getTime() / MS_PER_DAY);
  }

  /** ההפך מ-dayIndex */
  function fromDayIndex(index) {
    return isFinite(index) ? fromDate(new Date(index * MS_PER_DAY)) : null;
  }

  function addDays(iso, days) {
    var d = toDate(iso);
    if (!d) return null;
    d.setUTCDate(d.getUTCDate() + days);
    return fromDate(d);
  }

  function diffDays(fromIso, toIso) {
    var a = dayIndex(fromIso), b = dayIndex(toIso);
    return a === null || b === null ? null : b - a;
  }

  function today() {
    var now = new Date();
    // התאריך המקומי של המשתמש, לא UTC — "היום" נקבע לפי השעון שלו
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, '0');
    var d = String(now.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  /** רשימת תאריכים רציפה, כולל שני הקצוות */
  function range(fromIso, toIso) {
    var out = [];
    var cursor = fromIso;
    var guard = 0;
    while (cursor <= toIso && guard++ < 5000) {
      out.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return out;
  }

  /** N הימים האחרונים כולל endIso */
  function lastDays(endIso, n) {
    return range(addDays(endIso, -(n - 1)), endIso);
  }

  function dayName(iso) {
    var d = toDate(iso);
    return d ? DAY_NAMES[d.getUTCDay()] : '';
  }

  /** תצוגה קצרה: 08/03 */
  function short(iso) {
    return isIso(iso) ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';
  }

  /** תצוגה מלאה: 08/03/2026 */
  function long(iso) {
    return isIso(iso) ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '';
  }

  /** יום ראשון של השבוע שאליו שייך התאריך (שבוע ישראלי: ראשון–שבת) */
  function weekStart(iso) {
    var d = toDate(iso);
    if (!d) return null;
    return addDays(iso, -d.getUTCDay());
  }

  root.Dates = {
    isIso: isIso,
    toDate: toDate,
    fromDate: fromDate,
    dayIndex: dayIndex,
    fromDayIndex: fromDayIndex,
    addDays: addDays,
    diffDays: diffDays,
    today: today,
    range: range,
    lastDays: lastDays,
    dayName: dayName,
    short: short,
    long: long,
    weekStart: weekStart
  };
})(typeof window !== 'undefined' ? window : globalThis);
