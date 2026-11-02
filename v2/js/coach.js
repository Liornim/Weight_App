/**
 * Coach — נתונים וסיכום שמגיעים מקובץ בריפו.
 *
 * הגיליון חסום מהסביבה שבה Claude רץ, אבל הריפו לא. לכן Claude כותב
 * ל-data/coach.json, והדף הוא שמעביר את הנתונים למאגר ולגיליון: בכתובת
 * הגיליון מחזיק רק הדפדפן.
 *
 * שתי הגנות, ושתיהן נחוצות:
 *
 * חתימה לכל יום וקבוצה. ערך מהקובץ נכנס למאגר פעם אחת בלבד, אחרת
 * תיקון ידני באתר היה נדרס בכל פתיחה.
 *
 * בדיקה לפני כתיבה. הפעולה add מוסיפה שורה ולא מעדכנת, ולכן שני
 * מכשירים שדוחפים אותו יום היו יוצרים כפילות. כתיבה מתבצעת רק
 * כשהגיליון מאשר שאין שורה לתאריך הזה; ערכים שונים רק מדווחים.
 */
(function (root) {
  'use strict';

  var P = root.Parts, Store = root.Store;

  var KEY = 'metricsLab.coach';
  var URL_PATH = 'data/coach.json';
  var POLL_MS = 120000;
  var RECHECK_MS = 2000;

  var GROUPS = {
    body: ['weightKg', 'bodyFatKg', 'muscleKg', 'waterKg'],
    food: ['kcal', 'proteinG', 'carbG', 'fatG', 'fiberG', 'steps']
  };

  var busy = false;

  function blank() { return { applied: {}, sheet: {}, summary: null, updatedAt: null }; }

  function read() {
    try {
      return Object.assign(blank(), JSON.parse(root.localStorage.getItem(KEY)) || {});
    } catch (e) {
      return blank();
    }
  }

  function write(state) {
    try { root.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* תצוגה בלבד */ }
  }

  /** רק השדות של הקבוצה, ורק מספרים */
  function part(entry, group) {
    var out = {};
    GROUPS[group].forEach(function (key) {
      if (typeof entry[key] === 'number' && isFinite(entry[key])) out[key] = entry[key];
    });
    return Object.keys(out).length ? out : null;
  }

  /** החישובים של שאר המסכים מסתמכים על תאריכי ISO */
  function validEntries(data) {
    return (data && Array.isArray(data.entries) ? data.entries : [])
      .filter(function (e) { return e && /^\d{4}-\d{2}-\d{2}$/.test(e.date); });
  }

  function apply(data, state) {
    var changed = false;
    var app = root.App || {};
    app.quiet = true;
    try {
      validEntries(data).forEach(function (entry) {
        Object.keys(GROUPS).forEach(function (group) {
          var values = part(entry, group);
          if (!values) return;
          var key = entry.date + ':' + group;
          var sign = JSON.stringify(values);
          if (state.applied[key] === sign) return;
          Store.upsert(Object.assign({ date: entry.date }, values));
          state.applied[key] = sign;
          changed = true;
        });
      });
    } finally {
      app.quiet = false;
    }

    if (data && data.updatedAt !== state.updatedAt) {
      state.updatedAt = data.updatedAt || null;
      state.summary = (data && data.summary) || null;
      changed = true;
    }
    return changed;
  }

  function wait(ms) {
    return new Promise(function (done) { setTimeout(done, ms); });
  }

  /**
   * מצב אחד של יום וקבוצה מול הגיליון.
   * 'unknown' אינו נשמר, כדי שתקלה זמנית תנוסה שוב. 'sent' נשמר, כי
   * כתיבה שעדיין לא נראית לא צריכה לחזור ולהוסיף שורה שנייה.
   */
  function syncOne(url, job) {
    var Sheets = root.Sheets;
    var row = Object.assign({ date: job.date }, job.values);

    return Sheets.verify(url, row, job.group).then(function (found) {
      if (found.state !== 'missing') return found.state;

      return Sheets.save(url, row, job.group).then(function (saved) {
        if (saved.state !== 'missing') return saved.state;
        return wait(RECHECK_MS).then(function () {
          return Sheets.verify(url, row, job.group);
        }).then(function (again) {
          if (again.state !== 'missing') return again.state;
          return saved.sent ? 'sent' : 'unknown';
        });
      });
    }).catch(function () { return 'unknown'; });
  }

  function syncSheet(data, state) {
    var url = (Store.getSettings().sync || {}).url;
    if (!url || !root.Sheets) return Promise.resolve(false);

    var jobs = [];
    validEntries(data).forEach(function (entry) {
      Object.keys(GROUPS).forEach(function (group) {
        var values = part(entry, group);
        if (!values) return;
        var sign = JSON.stringify(values);
        var known = state.sheet[entry.date + ':' + group];
        if (known && known.sign === sign) return;
        jobs.push({ date: entry.date, group: group, values: values, sign: sign });
      });
    });

    var changed = false;
    var log = {};
    // בזה אחר זה: בקשות JSONP במקביל מתנגשות
    return jobs.reduce(function (chain, job) {
      return chain.then(function () {
        return syncOne(url, job);
      }).then(function (result) {
        if (result === 'unknown') return;
        var key = job.date + ':' + job.group;
        state.sheet[key] = { sign: job.sign, state: result };
        log[key] = result === 'sent' ? 'unknown' : result;
        changed = true;
      });
    }, Promise.resolve()).then(function () {
      if (changed) {
        var app = root.App || {};
        app.quiet = true;
        try {
          Store.updateSettings({
            syncLog: Object.assign({}, Store.getSettings().syncLog || {}, log)
          });
        } finally {
          app.quiet = false;
        }
      }
      return changed;
    });
  }

  /** לא לבנות מסך מחדש מתחת למי שמקליד */
  function refresh() {
    var active = root.document && root.document.activeElement;
    var typing = active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
    if (!typing && root.App && root.App.setState) root.App.setState({});
  }

  function load() {
    if (busy || !root.fetch) return Promise.resolve(false);
    busy = true;

    return root.fetch(URL_PATH + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('coach ' + response.status);
        return response.json();
      })
      .then(function (data) {
        var state = read();
        var applied = apply(data, state);
        write(state);
        if (applied) refresh();

        return syncSheet(data, state).then(function (synced) {
          write(state);
          if (synced) refresh();
          return applied || synced;
        });
      })
      // קובץ חסר או רשת נופלת: מה שכבר במכשיר ממשיך לעבוד
      .catch(function () { return false; })
      .then(function (result) { busy = false; return result; });
  }

  function start() {
    if (!root.fetch) return;
    load();
    if (root.document) {
      root.document.addEventListener('visibilitychange', function () {
        if (root.document.visibilityState === 'visible') load();
      });
    }
    setInterval(function () {
      if (!root.document || root.document.visibilityState === 'visible') load();
    }, POLL_MS);
  }

  function problems(state) {
    var names = { body: 'משקל', food: 'אוכל' };
    return Object.keys(state.sheet).filter(function (key) {
      var s = state.sheet[key].state;
      return s === 'mismatch' || s === 'duplicate';
    }).map(function (key) {
      var bits = key.split(':');
      var what = names[bits[1]] + ' של ' + root.Dates.short(bits[0]);
      return state.sheet[key].state === 'mismatch'
        ? what + ': בגיליון יש ערכים אחרים, ולכן הוא לא עודכן.'
        : what + ': בגיליון יש כמה שורות לתאריך הזה.';
    });
  }

  function card() {
    var state = read();
    var s = state.summary;
    if (!s) return '';

    var tiles = Array.isArray(s.tiles) ? s.tiles.map(function (t) {
      var tone = /^(good|warn|bad)$/.test(t.tone || '') ? ' tile--' + t.tone : '';
      return '<div class="tile' + tone + '">' +
        '<span class="k">' + P.esc(t.label) + '</span>' +
        '<span class="v">' + P.esc(t.value) + '</span>' +
        (t.sub ? '<span class="s">' + P.esc(t.sub) + '</span>' : '') +
      '</div>';
    }) : [];

    var lines = Array.isArray(s.lines) ? s.lines : [];

    return P.section('הסיכום של Claude', P.card(s.headline || null,
      s.date ? root.Dates.short(s.date) : null,
      (tiles.length ? P.tiles(tiles) : '') +
      lines.map(function (line) { return P.hint(String(line)); }).join('') +
      problems(state).map(function (line) { return P.hint('⚠ ' + line); }).join('')));
  }

  root.Coach = { start: start, load: load, card: card, KEY: KEY };
})(typeof window !== 'undefined' ? window : globalThis);
