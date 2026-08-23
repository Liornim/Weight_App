/**
 * Store — מקור האמת של האפליקציה.
 *
 * הנתונים נשמרים מקומית בדפדפן, ומיוצאים לקובץ בלחיצה אחת.
 * שכבת האחסון מופרדת בכוונה מהתצוגה: אם תרצה בעתיד לשמור בשרת
 * או בגיליון, צריך להחליף רק את persist/load כאן.
 */
(function (root) {
  'use strict';

  var Dates = root.Dates;
  var Metrics = root.Metrics;

  var STORAGE_KEY = 'metricsLab.v1';
  var SCHEMA_VERSION = 1;

  /** טווחים לבדיקת שפיות. לא חוסמים — רק מסמנים ערך חשוד. */
  var SANE_RANGE = {
    weightKg: [25, 400],
    bodyFatKg: [1, 200],
    muscleKg: [5, 200],
    waterKg: [5, 200],
    kcal: [0, 12000],
    proteinG: [0, 800],
    carbG: [0, 1500],
    fatG: [0, 600],
    fiberG: [0, 200],
    steps: [0, 120000]
  };

  var DEFAULT_SETTINGS = {
    profile: { heightCm: null, birthDate: null, sex: 'male' },
    targets: { kcal: null, proteinG: null, carbG: null, fatG: null, fiberG: null, steps: null },
    goal: { ratePerWeekKg: null, targetWeightKg: null },   // ratePerWeekKg שלילי = ירידה
    kcalPerKg: Metrics.DEFAULT_KCAL_PER_KG,
    kcalPerStep: 0.030,   // עלות נטו לצעד; 0.025-0.040 הוא הטווח המקובל
    tdeeMethod: 'kalman', // איזו שיטה מזינה את שאר המסכים
    sync: { url: '', lastSyncAt: null },  // כתובת ה-Apps Script של הגיליון
    autoTargetFromTdee: false,
    defaultWindow: 14
  };

  var state = {
    version: SCHEMA_VERSION,
    entries: [],      // ממוין לפי תאריך, תאריך אחד = רשומה אחת
    settings: clone(DEFAULT_SETTINGS),
    // meta עוקב אחרי מקור הנתונים: איזה זרע נטען, וכמה שינויים ידניים
    // בוצעו מאז. זה מה שמאפשר לרענן נתוני פתיחה בלי לדרוס עבודה של המשתמש.
    meta: { seedId: null, manualEdits: 0 }
  };

  var listeners = [];
  var memoryFallback = null; // כשאין גישה ל-localStorage

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function readRaw() {
    try {
      return root.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return memoryFallback;
    }
  }

  function writeRaw(text) {
    try {
      root.localStorage.setItem(STORAGE_KEY, text);
    } catch (err) {
      // מצב פרטי / אחסון חסום — האפליקציה ממשיכה לעבוד בזיכרון בלבד,
      // וה-UI מציג אזהרה שמפנה לייצוא ידני.
      memoryFallback = text;
      state.storageBlocked = true;
    }
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return isFinite(value) ? value : null;
    var normalized = String(value).trim().replace(/,/g, '.').replace(/[^\d.\-]/g, '');
    if (normalized === '' || normalized === '-' || normalized === '.') return null;
    var n = parseFloat(normalized);
    return isFinite(n) ? n : null;
  }

  /** מנקה רשומה גולמית לצורת האחסון. מחזיר null אם אין בה תאריך תקין. */
  function normalizeEntry(raw) {
    if (!raw || !Dates.isIso(raw.date)) return null;
    var out = { date: raw.date };
    Object.keys(Metrics.FIELDS).forEach(function (key) {
      var v = toNumber(raw[key]);
      if (v !== null) out[key] = v;
    });
    if (typeof raw.note === 'string' && raw.note.trim()) out.note = raw.note.trim().slice(0, 500);
    out.updatedAt = raw.updatedAt || new Date().toISOString();
    return out;
  }

  /** מחזיר רשימת אזהרות על ערכים שנראים לא סבירים */
  function validate(entry) {
    var warnings = [];
    Object.keys(SANE_RANGE).forEach(function (key) {
      var v = entry[key];
      if (typeof v !== 'number') return;
      var range = SANE_RANGE[key];
      if (v < range[0] || v > range[1]) {
        warnings.push(Metrics.FIELDS[key].label + ': ' + v + ' נראה מחוץ לטווח הסביר');
      }
    });
    if (typeof entry.weightKg === 'number') {
      var parts = ['bodyFatKg', 'muscleKg'];
      parts.forEach(function (key) {
        if (typeof entry[key] === 'number' && entry[key] > entry.weightKg) {
          warnings.push(Metrics.FIELDS[key].label + ' גדול מהמשקל הכולל');
        }
      });
    }
    return warnings;
  }

  function sortEntries() {
    state.entries.sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
  }

  function persist() {
    writeRaw(JSON.stringify({
      version: SCHEMA_VERSION,
      entries: state.entries,
      settings: state.settings,
      meta: state.meta
    }));
  }

  function emit() {
    listeners.forEach(function (fn) {
      try { fn(state); } catch (err) { console.error('listener failed', err); }
    });
  }

  function commit() {
    sortEntries();
    persist();
    emit();
  }

  // ---- API ציבורי ----

  function init() {
    var raw = readRaw();
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        state.entries = (parsed.entries || []).map(normalizeEntry).filter(Boolean);
        state.settings = Object.assign(clone(DEFAULT_SETTINGS), parsed.settings || {});
        state.settings.profile = Object.assign(clone(DEFAULT_SETTINGS.profile), parsed.settings && parsed.settings.profile);
        state.settings.targets = Object.assign(clone(DEFAULT_SETTINGS.targets), parsed.settings && parsed.settings.targets);
        state.settings.goal = Object.assign(clone(DEFAULT_SETTINGS.goal), parsed.settings && parsed.settings.goal);
        state.settings.sync = Object.assign(clone(DEFAULT_SETTINGS.sync), parsed.settings && parsed.settings.sync);
        state.meta = Object.assign({ seedId: null, manualEdits: 0 }, parsed.meta || {});
      } catch (err) {
        console.error('לא הצלחתי לקרוא את הנתונים השמורים', err);
      }
    }

    var incoming = root.METRICS_SEED;
    if (incoming && incoming.seedId !== state.meta.seedId) {
      if (!raw || !state.meta.manualEdits) {
        // אין נתונים שמורים, או שיש אבל הם הגיעו מזרע ישן ואיש לא נגע בהם.
        // בטוח להחליף.
        seed(incoming);
      } else {
        // המשתמש ערך משהו. לא נוגעים — מציעים לו את הרענון במסך הנתונים.
        state.seedAvailable = incoming.seedId;
      }
    }

    sortEntries();
    return state;
  }

  /** טוען נתוני פתיחה. דורס את הקיים, ולכן נקרא רק כשזה בטוח או באישור מפורש. */
  function seed(payload) {
    state.entries = (payload.entries || []).map(normalizeEntry).filter(Boolean);
    if (payload.settings) {
      state.settings = Object.assign(clone(DEFAULT_SETTINGS), payload.settings);
      ['profile', 'targets', 'goal', 'sync'].forEach(function (section) {
        state.settings[section] = Object.assign(clone(DEFAULT_SETTINGS[section]), payload.settings[section]);
      });
    }
    state.meta = { seedId: payload.seedId || 'unversioned', manualEdits: 0 };
    delete state.seedAvailable;
    sortEntries();
    persist();
  }

  /** רענון יזום מהמשתמש כשהוא כבר ערך נתונים */
  function applyPendingSeed() {
    if (!root.METRICS_SEED) return false;
    seed(root.METRICS_SEED);
    emit();
    return true;
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (l) { return l !== fn; });
    };
  }

  function getEntries() { return state.entries.slice(); }

  function getEntry(date) {
    return state.entries.find(function (e) { return e.date === date; }) || null;
  }

  function getSettings() { return clone(state.settings); }

  /**
   * שמירה לתאריך. שדות שלא נשלחו נשארים כמו שהם;
   * שדה שנשלח כמחרוזת ריקה נמחק. כך אפשר לעדכן רק את הקלוריות בערב
   * בלי לדרוס את שקילת הבוקר.
   */
  function upsert(raw) {
    if (!raw || !Dates.isIso(raw.date)) throw new Error('חסר תאריך תקין');
    var existing = getEntry(raw.date);
    var merged = existing ? Object.assign({}, existing) : { date: raw.date };

    Object.keys(Metrics.FIELDS).forEach(function (key) {
      if (!(key in raw)) return;
      var v = toNumber(raw[key]);
      if (v === null) delete merged[key];
      else merged[key] = v;
    });
    if ('note' in raw) {
      if (raw.note && String(raw.note).trim()) merged.note = String(raw.note).trim().slice(0, 500);
      else delete merged.note;
    }
    merged.updatedAt = new Date().toISOString();

    var warnings = validate(merged);
    var hasData = Metrics.hasAnyValue(merged) || !!merged.note;

    state.entries = state.entries.filter(function (e) { return e.date !== raw.date; });
    if (hasData) state.entries.push(merged);
    state.meta.manualEdits++;
    commit();
    return { entry: hasData ? merged : null, warnings: warnings };
  }

  function remove(date) {
    var before = state.entries.length;
    state.entries = state.entries.filter(function (e) { return e.date !== date; });
    if (state.entries.length !== before) { state.meta.manualEdits++; commit(); }
  }

  function updateSettings(patch) {
    ['profile', 'targets', 'goal', 'sync'].forEach(function (section) {
      if (patch[section]) {
        state.settings[section] = Object.assign({}, state.settings[section], patch[section]);
        delete patch[section];
      }
    });
    state.settings = Object.assign({}, state.settings, patch);
    state.meta.manualEdits++;
    commit();
    return getSettings();
  }

  function clearAll() {
    state.entries = [];
    state.meta.manualEdits++;
    commit();
  }

  // ---- ייצוא וייבוא ----

  function exportJSON() {
    return JSON.stringify({
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      entries: state.entries
    }, null, 2);
  }

  /** mode: 'merge' (ברירת מחדל, החדש גובר) או 'replace' */
  function importJSON(text, mode) {
    var parsed = JSON.parse(text);
    var incoming = (parsed.entries || []).map(normalizeEntry).filter(Boolean);
    if (mode === 'replace') {
      state.entries = incoming;
    } else {
      var byDate = {};
      state.entries.forEach(function (e) { byDate[e.date] = e; });
      incoming.forEach(function (e) {
        var current = byDate[e.date];
        if (!current) { byDate[e.date] = e; return; }
        // מיזוג ברמת השדה ולא ברמת הרשומה. מקור שמביא רק תזונה
        // לא אמור למחוק שקילה שכבר קיימת לאותו יום — זה בדיוק
        // מה שקרה כשהחלפנו רשומה שלמה.
        var newer = (e.updatedAt || '') >= (current.updatedAt || '');
        byDate[e.date] = newer
          ? Object.assign({}, current, e)
          : Object.assign({}, e, current);
      });
      state.entries = Object.keys(byDate).map(function (d) { return byDate[d]; });
    }
    if (parsed.settings && mode === 'replace') {
      state.settings = Object.assign(clone(DEFAULT_SETTINGS), parsed.settings);
    }
    commit();
    return { imported: incoming.length, total: state.entries.length };
  }

  var CSV_COLUMNS = ['date'].concat(Object.keys(Metrics.FIELDS)).concat(['note']);

  function csvCell(value) {
    if (value === null || value === undefined) return '';
    var s = String(value);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCSV() {
    var header = CSV_COLUMNS.join(',');
    var rows = Metrics.sorted(state.entries).map(function (e) {
      return CSV_COLUMNS.map(function (c) { return csvCell(e[c]); }).join(',');
    });
    // BOM כדי שאקסל יפתח עברית נכון
    return '\uFEFF' + [header].concat(rows).join('\n');
  }

  function parseCsvLine(line) {
    var out = [], cur = '', inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  /**
   * כינויים לכותרות עמודות בייבוא. קיימים כדי שייבוא מגיליון קיים
   * יעבוד בלי לערוך אותו קודם. שים לב ש"שומן" לבד מתפרש כשומן גוף —
   * לשומן תזונתי צריך כותרת מפורשת.
   */
  var COLUMN_ALIASES = {
    'משקל': 'weightKg', 'משקל (קג)': 'weightKg', 'משקל (ק״ג)': 'weightKg', 'weight': 'weightKg',
    'שומן': 'bodyFatKg', 'שומן גוף': 'bodyFatKg', 'אחוז שומן': 'bodyFatKg', 'fat': 'bodyFatKg',
    'שריר': 'muscleKg', 'מסת שריר': 'muscleKg', 'muscle': 'muscleKg',
    'נוזלים': 'waterKg', 'מים': 'waterKg', 'water': 'waterKg', 'fluids': 'waterKg',
    'קלוריות': 'kcal', 'קלוריה': 'kcal', 'calories': 'kcal', 'cal': 'kcal',
    'חלבון': 'proteinG', 'protein': 'proteinG',
    'פחמימה': 'carbG', 'פחמימות': 'carbG', 'carbs': 'carbG', 'carb': 'carbG',
    'שומן תזונתי': 'fatG', 'שומן (גר׳)': 'fatG', 'שומן גרם': 'fatG', 'fat_g': 'fatG',
    'סיבים': 'fiberG', 'סיבים תזונתיים': 'fiberG', 'fiber': 'fiberG',
    'צעדים': 'steps', 'step': 'steps'
  };

  /** ממיר כותרת עמודה — באנגלית או בעברית — למפתח שדה */
  function resolveColumn(name) {
    var raw = String(name).replace(/^\uFEFF/, '').trim();
    var lower = raw.toLowerCase();
    if (lower === 'date' || raw === 'תאריך') return 'date';
    if (lower === 'note' || raw === 'הערה' || raw === 'הערות') return 'note';
    if (COLUMN_ALIASES[raw]) return COLUMN_ALIASES[raw];
    if (COLUMN_ALIASES[lower]) return COLUMN_ALIASES[lower];
    var direct = Object.keys(Metrics.FIELDS).find(function (k) { return k.toLowerCase() === lower; });
    if (direct) return direct;
    var byLabel = Object.keys(Metrics.FIELDS).find(function (k) {
      var f = Metrics.FIELDS[k];
      return raw === f.label || raw === f.label + ' (' + f.unit + ')';
    });
    return byLabel || null;
  }

  /** מקבל DD/MM/YYYY או YYYY-MM-DD ומחזיר ISO */
  function parseDateCell(value) {
    var s = String(value || '').trim();
    if (Dates.isIso(s)) return s;
    var m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
    if (!m) return null;
    var year = m[3].length === 2 ? '20' + m[3] : m[3];
    return year + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
  }

  function importCSV(text, mode) {
    var lines = String(text).split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    if (!lines.length) return { imported: 0, skipped: 0, total: state.entries.length };

    var header = parseCsvLine(lines[0]).map(resolveColumn);
    if (header.indexOf('date') === -1) throw new Error('לא נמצאה עמודת תאריך');

    var entries = [], skipped = 0;
    lines.slice(1).forEach(function (line) {
      var cells = parseCsvLine(line);
      var raw = {};
      header.forEach(function (col, i) {
        if (!col) return;
        if (col === 'date') raw.date = parseDateCell(cells[i]);
        else raw[col] = cells[i];
      });
      var normalized = normalizeEntry(raw);
      if (normalized && Metrics.hasAnyValue(normalized)) entries.push(normalized);
      else skipped++;
    });

    var result = importJSON(JSON.stringify({ entries: entries }), mode);
    return { imported: result.imported, skipped: skipped, total: result.total };
  }

  root.Store = {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    init: init,
    seed: seed,
    applyPendingSeed: applyPendingSeed,
    pendingSeedId: function () { return state.seedAvailable || null; },
    meta: function () { return clone(state.meta); },
    subscribe: subscribe,
    getEntries: getEntries,
    getEntry: getEntry,
    getSettings: getSettings,
    upsert: upsert,
    remove: remove,
    updateSettings: updateSettings,
    clearAll: clearAll,
    exportJSON: exportJSON,
    importJSON: importJSON,
    exportCSV: exportCSV,
    importCSV: importCSV,
    validate: validate,
    normalizeEntry: normalizeEntry,
    toNumber: toNumber,
    isStorageBlocked: function () { return !!state.storageBlocked; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
