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

  /**
   * תחילת המעקב: ב-v2 כל המסכים רואים רק מהתאריך הזה והלאה.
   *
   * זה סינון תצוגה בלבד. המאגר והגיליון שומרים את כל ההיסטוריה,
   * והאפליקציה הישנה ב-/ עדיין מציגה אותה, כך שאפשר לחזור אחורה
   * על ידי הסרת startDate מהקובץ.
   */
  var startDate = null;
  var allEntries = Store.getEntries;
  Store.getEntries = function () {
    var entries = allEntries();
    return startDate
      ? entries.filter(function (e) { return e.date >= startDate; })
      : entries;
  };

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

    var from = (data && /^\d{4}-\d{2}-\d{2}$/.test(data.startDate)) ? data.startDate : null;
    if (from !== (state.startDate || null)) {
      state.startDate = from;
      startDate = from;
      changed = true;
    }

    /**
     * התצוגה נבדקת לפי התוכן ולא לפי updatedAt. גרסה ישנה של הקוד
     * שכבר קראה את הקובץ הזה שמרה אותו בלי השדות החדשים, ובדיקה לפי
     * התאריך השאירה את הטלפון בלי המאזן.
     */
    if (data) {
      var view = {
        updatedAt: data.updatedAt || null,
        summary: data.summary || null,
        rows: validEntries(data),
        targets: data.targets || null,
        balance: data.balance || null
      };
      Object.keys(view).forEach(function (key) {
        if (JSON.stringify(state[key] === undefined ? null : state[key]) !== JSON.stringify(view[key])) {
          state[key] = view[key];
          changed = true;
        }
      });
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

  /** שעת הרענון מתעדכנת בכל טעינה, גם כשהנתונים לא השתנו */
  function stampNow(state) {
    if (!root.document) return;
    var text = stampText(state);
    Array.prototype.forEach.call(root.document.querySelectorAll('[data-coach-stamp]'), function (el) {
      el.textContent = text;
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
        state.loadedAt = Date.now();
        write(state);
        if (applied) refresh();
        stampNow(state);

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

  // מהמטמון, כדי שההיסטוריה לא תהבהב במסך לפני שהקובץ נטען
  startDate = read().startDate || null;

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

  /** הסכום של היום: מה שנסגר, ואם לא נסגר אז סכום הארוחות */
  function eatenOf(row, key) {
    if (typeof row[key] === 'number') return row[key];
    var meals = Array.isArray(row.meals) ? row.meals : [];
    var total = meals.reduce(function (sum, meal) {
      return sum + (typeof meal[key] === 'number' ? meal[key] : 0);
    }, 0);
    return total ? total : null;
  }

  /** שורה גדולה: כמה נאכל, כמה היעד וכמה נשאר */
  function gauge(label, unit, eaten, target, doneWhenFull) {
    var value = eaten || 0;
    var left = target - value;
    var pct = Math.max(0, Math.min(100, Math.round(value / target * 100)));
    var note = left >= 0
      ? 'נשארו ' + root.Fmt.n(left, 0) + ' ' + unit
      : (doneWhenFull ? 'עברת את היעד ב-' : 'מעל היעד ב-') + root.Fmt.n(-left, 0) + ' ' + unit;
    var over = left < 0 && !doneWhenFull;
    return '<div class="today__gauge' + (over ? ' today__gauge--over' : '') + '">' +
      '<div class="today__label">' + P.esc(label) + '</div>' +
      '<div class="today__num"><strong>' + root.Fmt.n(value, 0) + '</strong>' +
        '<span> / ' + root.Fmt.n(target, 0) + ' ' + unit + '</span></div>' +
      '<div class="today__bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="today__left">' + P.esc(note) + '</div>' +
    '</div>';
  }

  /**
   * המאזן של ימים סגורים בלבד: יום פתוח עוד יתמלא, והיה נראה כגירעון.
   * הוצאה = תחזוקה בלי הליכה + צעדים × מקדם. שלילי = גירעון.
   */
  function dayBalance(row, cfg) {
    if (typeof row.kcal !== 'number' || typeof row.steps !== 'number') return null;
    return Math.round(row.kcal - (cfg.baseBurn + row.steps * cfg.kcalPerStep));
  }

  function balanceOf(rows, cfg) {
    var days = 0, total = 0;
    rows.forEach(function (row) {
      var one = dayBalance(row, cfg);
      if (one === null) return;
      days++;
      total += one;
    });
    return { days: days, total: total, gap: total + days * cfg.plannedDeficit };
  }

  /** ממוצע 7 השקילות האחרונות, ומול 7 שלפניהן כשיש מספיק */
  function weightAverage(rows) {
    var weights = rows.filter(function (row) {
      return typeof row.weightKg === 'number';
    }).map(function (row) { return row.weightKg; });
    if (!weights.length) return null;
    var mean = function (list) {
      return list.reduce(function (sum, w) { return sum + w; }, 0) / list.length;
    };
    var last = weights.slice(-7);
    var previous = weights.slice(-14, -7);
    return {
      count: last.length,
      average: mean(last),
      change: previous.length === 7 ? mean(last) - mean(previous) : null
    };
  }

  function weightBlock(rows) {
    var w = weightAverage(rows);
    if (!w) return '';
    var change = w.change === null
      ? 'השוואה שבועית תופיע אחרי 14 שקילות'
      : (w.change <= 0 ? 'ירידה של ' : 'עלייה של ') + root.Fmt.n(Math.abs(w.change), 1) +
        ' ק״ג מול 7 השקילות הקודמות';
    return '<div class="today__balance">' +
      '<div class="today__label">ממוצע משקל, ' + w.count + ' שקילות אחרונות</div>' +
      '<div class="today__sum"><strong>' + root.Fmt.n(w.average, 1) + '</strong> ק״ג</div>' +
      '<div class="today__left">' + P.esc(change) + '</div>' +
    '</div>';
  }

  /** עודף או חוסר מול היעד, בימים סגורים בלבד */
  function macroTotals(rows, targets) {
    var closed = rows.filter(function (row) {
      return typeof row.kcal === 'number' && typeof row.steps === 'number';
    });
    return [['proteinG', 'חלבון'], ['carbG', 'פחמימות'], ['fatG', 'שומן']].filter(function (m) {
      return typeof targets[m[0]] === 'number';
    }).map(function (m) {
      var eaten = closed.reduce(function (sum, row) {
        return sum + (typeof row[m[0]] === 'number' ? row[m[0]] : 0);
      }, 0);
      return { label: m[1], diff: eaten - targets[m[0]] * closed.length };
    });
  }

  /** צעדים מול המינימום, בימים סגורים בלבד */
  function stepsDiff(rows, minimum) {
    var closed = rows.filter(function (row) {
      return typeof row.kcal === 'number' && typeof row.steps === 'number';
    });
    return closed.reduce(function (sum, row) { return sum + row.steps - minimum; }, 0);
  }

  function stepsForGap(gap, cfg) {
    return gap > 0 ? Math.round(gap / cfg.kcalPerStep) : 0;
  }

  /** אריח אחד במצטבר; הצבע אומר אם הכיוון טוב, לא רק אם המספר גדול */
  function tile(label, value, word, tone) {
    return '<div class="cumul__tile cumul__tile--' + tone + '">' +
      '<span class="cumul__k">' + P.esc(label) + '</span>' +
      '<span class="cumul__v">' + value + '</span>' +
      '<span class="cumul__w">' + P.esc(word) + '</span>' +
    '</div>';
  }

  /**
   * גרף המאזן: עמודה לכל יום סגור, קו של הממוצע המצטבר, וקו מקווקו של
   * התוכנית. מתחת לאפס זה גירעון, ולכן מה שמתחת לקו התוכנית הוא בקצב.
   */
  function balanceChart(daily, plan) {
    if (!daily.length) return '';
    var W = 320, H = 150, L = 34, R = 6, T = 10, B = 22;
    var avg = [], sum = 0;
    daily.forEach(function (d, i) { sum += d.value; avg.push(sum / (i + 1)); });
    var values = daily.map(function (d) { return d.value; }).concat(avg, [0, -plan]);
    var top = Math.max.apply(null, values), bottom = Math.min.apply(null, values);
    var pad = (top - bottom) * 0.08 || 50;
    top += pad; bottom -= pad;
    var y = function (v) { return T + (top - v) / (top - bottom) * (H - T - B); };
    var step = (W - L - R) / daily.length;
    var x = function (i) { return L + step * i + step / 2; };
    var barW = Math.min(step * 0.56, 26);
    var bars = daily.map(function (d, i) {
      var y0 = y(0), y1 = y(d.value);
      return '<rect class="cumul__bar cumul__bar--' + (d.value <= 0 ? 'good' : 'bad') + '" x="' +
        (x(i) - barW / 2).toFixed(1) + '" y="' + Math.min(y0, y1).toFixed(1) + '" width="' +
        barW.toFixed(1) + '" height="' + Math.max(Math.abs(y1 - y0), 1).toFixed(1) + '" rx="3"/>' +
        '<text class="cumul__tick" x="' + x(i).toFixed(1) + '" y="' + (H - 6) + '">' +
        P.esc(root.Dates.short(d.date)) + '</text>';
    }).join('');
    var line = avg.map(function (v, i) {
      return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
    }).join(' ');
    var dots = avg.map(function (v, i) {
      return '<circle class="cumul__dot" cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="' +
        (i === avg.length - 1 ? 4 : 2.5) + '"/>';
    }).join('');
    var label = function (v, text) {
      return '<text class="cumul__axis" x="' + (L - 4) + '" y="' + (y(v) + 4).toFixed(1) + '">' + text + '</text>';
    };
    return '<svg class="cumul__chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="מאזן יומי וממוצע מצטבר">' +
      '<line class="cumul__zero" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '"/>' +
      '<line class="cumul__plan" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(-plan).toFixed(1) + '" y2="' + y(-plan).toFixed(1) + '"/>' +
      label(0, '0') + label(-plan, '−' + root.Fmt.n(plan, 0)) +
      bars + '<path class="cumul__avg" d="' + line + '"/>' + dots +
    '</svg>' +
    '<div class="cumul__legend">' +
      '<span><i class="cumul__key cumul__key--good"></i>יום בגירעון</span>' +
      '<span><i class="cumul__key cumul__key--bad"></i>יום בעודף</span>' +
      '<span><i class="cumul__key cumul__key--avg"></i>ממוצע מצטבר</span>' +
      '<span><i class="cumul__key cumul__key--plan"></i>תוכנית</span>' +
    '</div>';
  }

  /** המצטבר: מקטע משלו, בסגנון הכותרת העליונה */
  function cumulBlock(rows, cfg, targets) {
    if (!cfg) return '';
    var b = balanceOf(rows, cfg);
    if (!b.days) return '';
    var fmt = function (v) { return root.Fmt.n(Math.abs(Math.round(v)), 0); };
    var daily = rows.map(function (row) {
      return { date: row.date, value: dayBalance(row, cfg) };
    }).filter(function (d) { return d.value !== null; });
    var avg = b.total / b.days;
    var onPlan = b.gap <= 0;

    var tiles = targets ? macroTotals(rows, targets).map(function (m) {
      var tone = m.label === 'חלבון' ? (m.diff >= 0 ? 'good' : 'warn')
        : m.label === 'שומן' ? (m.diff > 0 ? 'bad' : 'good')
        : (m.diff > 0 ? 'warn' : 'calm');
      return tile(m.label, fmt(m.diff), 'ג׳ ' + (m.diff > 0 ? 'עודף' : 'חוסר'), tone);
    }) : [];
    if (targets) {
      [targets.steps, targets.stepsGoal].forEach(function (goal) {
        if (typeof goal !== 'number') return;
        var diff = stepsDiff(rows, goal);
        tiles.push(tile('צעדים, מול ' + root.Fmt.n(goal, 0) + ' ביום', fmt(diff),
          diff >= 0 ? 'עודף' : 'חוסר', diff >= 0 ? 'good' : 'bad'));
      });
    }

    var steps = stepsForGap(b.gap, cfg);
    return '<section class="cumul">' +
      '<div class="cumul__row"><h2 class="cumul__title">המצטבר שלי</h2>' +
        '<span class="cumul__stamp">מצטבר, ' + b.days + ' ימים סגורים</span></div>' +
      '<div class="cumul__head">' +
        '<span class="cumul__label">מאזן קלוריות</span>' +
        '<span class="cumul__big cumul__big--' + (b.total <= 0 ? 'good' : 'bad') + '">' + fmt(b.total) + '</span>' +
        '<span class="cumul__unit">קק״ל ' + (b.total <= 0 ? 'גירעון' : 'עודף') +
          ' · ממוצע ' + fmt(avg) + ' ' + (avg <= 0 ? 'גירעון' : 'עודף') + ' ליום, תוכנית ' +
          fmt(cfg.plannedDeficit) + ' גירעון</span>' +
      '</div>' +
      '<div class="cumul__pill cumul__pill--' + (onPlan ? 'good' : 'bad') + '">' +
        (onPlan ? 'לפני התוכנית ב-' : 'מאחורי התוכנית ב-') + fmt(b.gap) + ' קק״ל</div>' +
      balanceChart(daily, cfg.plannedDeficit) +
      (steps
        ? '<div class="cumul__gap"><b>חסרים ' + root.Fmt.n(steps, 0) + ' צעדים</b> ' +
            'מעל המינימום, כדי לסגור את הפער. בפריסה ל-10 ימים: ' +
            root.Fmt.n(Math.round(steps / 10), 0) + ' ביום</div>'
        : '') +
      (tiles.length ? '<div class="cumul__tiles">' + tiles.join('') + '</div>' : '') +
    '</section>';
  }

  function clock(date) {
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  /** שעת הרענון האחרון, ושעת עדכון הנתונים בקובץ */
  function stampText(state) {
    var parts = [];
    if (state.loadedAt) parts.push('רענון אחרון ' + clock(new Date(state.loadedAt)));
    var m = /T(\d{2}:\d{2})/.exec(state.updatedAt || '');
    if (m) parts.push('נתונים מ-' + m[1]);
    return parts.join(' · ');
  }

  /** טאב הארוחות: כל יום, מהחדש לישן, עם כל מה שנרשם בו */
  function meals() {
    var state = read();
    var rows = (state.rows || []).slice().reverse();
    if (!rows.length) return P.section('ארוחות', P.card(null, null, P.empty('עוד לא נרשמו ארוחות.')));
    var n = function (v) { return typeof v === 'number' ? root.Fmt.n(v, 0) : '—'; };
    return P.section('ארוחות', rows.map(function (row) {
      var list = Array.isArray(row.meals) ? row.meals : [];
      var sum = function (key) {
        if (typeof row[key] === 'number') return row[key];
        var total = list.reduce(function (acc, m) { return acc + (typeof m[key] === 'number' ? m[key] : 0); }, 0);
        return list.length ? total : null;
      };
      var closed = typeof row.kcal === 'number' && typeof row.steps === 'number';
      var head = '<div class="meals__sum">' +
        '<span><b>' + n(sum('kcal')) + '</b> קק״ל</span>' +
        '<span><b>' + n(sum('proteinG')) + '</b> ג׳ חלבון</span>' +
        '<span><b>' + n(sum('carbG')) + '</b> ג׳ פחמימות</span>' +
        '<span><b>' + n(sum('fatG')) + '</b> ג׳ שומן</span>' +
      '</div>';
      var body = list.length ? '<ul class="meals__list">' + list.map(function (m) {
        return '<li class="meals__item">' +
          '<div class="meals__top"><span class="meals__time">' + P.esc(m.time || '') + '</span>' +
            '<span class="meals__kcal">' + n(m.kcal) + ' קק״ל</span></div>' +
          '<div class="meals__name">' + P.esc(m.name || '') + '</div>' +
          '<div class="meals__macro">חלבון ' + n(m.proteinG) + ' · פחמימות ' + n(m.carbG) +
            ' · שומן ' + n(m.fatG) + '</div>' +
        '</li>';
      }).join('') + '</ul>' : P.hint('לא נרשמו ארוחות ביום הזה.');
      return P.card(root.Dates.short(row.date), closed ? 'יום סגור' : 'יום פתוח', head + body);
    }).join(''));
  }

  /** מה נאכל היום, ארוחה בשורה */
  function mealList(row) {
    var meals = Array.isArray(row.meals) ? row.meals : [];
    if (!meals.length) return '';
    return '<div class="today__meals">' + meals.map(function (meal) {
      return '<div class="today__meal"><span>' + P.esc(meal.name) + '</span>' +
        '<b>' + root.Fmt.n(meal.kcal, 0) + ' קק״ל · ' + root.Fmt.n(meal.proteinG, 0) + ' ג׳</b></div>';
    }).join('') + '</div>';
  }

  /** הכרטיס הגדול בראש המסך */
  function today() {
    var state = read();
    var rows = state.rows || [];
    var targets = state.targets;
    if (!rows.length || !targets) return '';
    var row = rows[rows.length - 1];
    return '<section class="today">' +
      '<div class="today__row"><h2 class="today__title">היום · ' + P.esc(root.Dates.short(row.date)) + '</h2>' +
        '<span class="today__stamp" data-coach-stamp>' + P.esc(stampText(state)) + '</span></div>' +
      gauge('קלוריות', 'קק״ל', eatenOf(row, 'kcal'), targets.kcal, false) +
      gauge('חלבון', 'גרם', eatenOf(row, 'proteinG'), targets.proteinG, true) +
      (targets.carbG && targets.fatG
        ? '<div class="today__small">' +
            gauge('פחמימות', 'גרם', eatenOf(row, 'carbG'), targets.carbG, false) +
            gauge('שומן', 'גרם', eatenOf(row, 'fatG'), targets.fatG, false) +
          '</div>'
        : '') +
      mealList(row) +
      weightBlock(rows) +
    '</section>' +
    cumulBlock(rows, state.balance, targets);
  }

  /** הגיליון הפשוט: יום בשורה, החדש למעלה */
  function sheet(rows, cfg) {
    if (!rows || !rows.length) return '';
    var cell = function (value, digits) {
      return typeof value === 'number'
        ? '<td class="n">' + root.Fmt.n(value, digits) + '</td>'
        : '<td class="n flat">—</td>';
    };
    // תצוגה בלבד: שני סוגי האימון כבר נספרים בסך הצעדים היומי
    var minutesOf = function (row, isElliptical) {
      var walks = Array.isArray(row.walks) ? row.walks : [];
      var minutes = walks.filter(function (walk) {
        return (walk.type === 'אליפטיקל') === isElliptical;
      }).reduce(function (sum, walk) {
        return sum + (typeof walk.minutes === 'number' ? walk.minutes : 0);
      }, 0);
      return minutes ? minutes : null;
    };
    return P.table(['תאריך', 'משקל', 'קלוריות', 'חלבון', 'פחמימות', 'שומן', 'צעדים', 'הליכה (דק׳)', 'אורביטרק (דק׳)', 'מאזן'],
      rows.slice().reverse().map(function (row) {
        return '<tr><td class="n">' + P.esc(root.Dates.short(row.date)) + '</td>' +
          cell(row.weightKg, 1) + cell(eatenOf(row, 'kcal'), 0) +
          cell(eatenOf(row, 'proteinG'), 0) +
          cell(eatenOf(row, 'carbG'), 0) + cell(eatenOf(row, 'fatG'), 0) +
          cell(row.steps, 0) + cell(minutesOf(row, false), 0) + cell(minutesOf(row, true), 0) +
          cell(cfg ? dayBalance(row, cfg) : null, 0) + '</tr>';
      }));
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
      sheet(state.rows, state.balance) +
      lines.map(function (line) { return P.hint(String(line)); }).join('') +
      problems(state).map(function (line) { return P.hint('⚠ ' + line); }).join('')));
  }

  root.Coach = { start: start, load: load, card: card, today: today, balanceOf: balanceOf, macroTotals: macroTotals, weightAverage: weightAverage, stepsDiff: stepsDiff, stepsForGap: stepsForGap, meals: meals, KEY: KEY };
})(typeof window !== 'undefined' ? window : globalThis);
