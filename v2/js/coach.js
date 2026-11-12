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


  /** סדרת שקילות עם ממוצע נע של 3 ושל 7 שקילות (או פחות בהתחלה) */
  function weightSeries(rows) {
    var list = rows.filter(function (row) { return typeof row.weightKg === 'number'; });
    var mean = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
    return list.map(function (row, i) {
      var upto = list.slice(0, i + 1).map(function (r) { return r.weightKg; });
      return { date: row.date, w: row.weightKg, avg3: mean(upto.slice(-3)), avg7: mean(upto.slice(-7)) };
    });
  }

  function weightChart(series) {
    if (series.length < 2) return '';
    var W = 340, H = 230, L = 38, R = 44, T = 14, B = 26;
    var vals = [];
    series.forEach(function (p) { vals.push(p.w, p.avg3, p.avg7); });
    var top = Math.ceil((Math.max.apply(null, vals) + 0.1) * 2) / 2;
    var bottom = Math.floor((Math.min.apply(null, vals) - 0.1) * 2) / 2;
    var x = function (i) { return L + (W - L - R) * i / (series.length - 1); };
    var y = function (v) { return T + (top - v) / (top - bottom) * (H - T - B); };
    var path = function (key) {
      return series.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[key]).toFixed(1); }).join(' ');
    };
    var grid = '';
    for (var v = bottom; v <= top + 0.001; v += 0.5) {
      var whole = Math.abs(v - Math.round(v)) < 0.01;
      grid += '<line class="wchart__grid' + (whole ? ' wchart__grid--whole' : '') + '" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>' +
        '<text class="wchart__axis" x="' + (L - 5) + '" y="' + (y(v) + 4).toFixed(1) + '">' + root.Fmt.n(v, 1) + '</text>';
    }
    var step = Math.ceil(series.length / 7);
    var ticks = series.map(function (p, i) {
      var lastI = series.length - 1;
      if (i !== lastI && (i % step || lastI - i < step)) return '';
      return '<text class="wchart__tick" x="' + x(i).toFixed(1) + '" y="' + (H - 7) + '">' + P.esc(p.date.slice(8, 10) + '/' + p.date.slice(5, 7)) + '</text>';
    }).join('');
    var dots = series.map(function (p, i) {
      return '<circle class="wchart__dot" cx="' + x(i).toFixed(1) + '" cy="' + y(p.w).toFixed(1) + '" r="3"/>';
    }).join('');
    var last = series[series.length - 1], lx = x(series.length - 1) + 6;
    var y7 = y(last.avg7), y3 = y(last.avg3);
    if (Math.abs(y7 - y3) < 12) { if (y7 < y3) { y7 -= 6; y3 += 6; } else { y7 += 6; y3 -= 6; } }
    var ends = '<text class="wchart__end wchart__end--a7" x="' + lx + '" y="' + (y7 + 4).toFixed(1) + '">' + root.Fmt.n(last.avg7, 1) + '</text>' +
      '<text class="wchart__end wchart__end--a3" x="' + lx + '" y="' + (y3 + 4).toFixed(1) + '">' + root.Fmt.n(last.avg3, 1) + '</text>';
    return '<svg class="wchart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="משקל וממוצע נע">' + grid +
      '<path class="wchart__a3" d="' + path('avg3') + '"/><path class="wchart__a7" d="' + path('avg7') + '"/>' + dots + ticks + ends + '</svg>' +
      '<div class="wchart__legend"><span><i class="wchart__k wchart__k--a7"></i>ממוצע 7</span>' +
      '<span><i class="wchart__k wchart__k--a3"></i>ממוצע 3</span><span><i class="wchart__k wchart__k--dot"></i>שקילה</span>' +
      '<span>קו לכל חצי ק״ג</span></div>';
  }

  function weightBlock(rows) {
    var w = weightAverage(rows);
    if (!w) return '';
    var change = w.change === null
      ? 'השוואה של 7 השקילות האחרונות מול 7 הקודמות תופיע אחרי 14 שקילות (עכשיו ' + rows.filter(function (r) { return typeof r.weightKg === 'number'; }).length + ')'
      : (w.change <= 0 ? 'ירידה של ' : 'עלייה של ') + root.Fmt.n(Math.abs(w.change), 1) +
        ' ק״ג מול 7 השקילות הקודמות';
    var series = weightSeries(rows);
    var last = series[series.length - 1];
    return '<div class="today__balance">' +
      '<div class="today__label">ממוצע משקל נע</div>' +
      '<div class="wavg">' +
        '<span><b>' + root.Fmt.n(last.avg7, 1) + '</b> ק״ג<small>ממוצע ' + Math.min(7, series.length) + ' שקילות</small></span>' +
        '<span><b>' + root.Fmt.n(last.avg3, 1) + '</b> ק״ג<small>ממוצע ' + Math.min(3, series.length) + ' שקילות</small></span>' +
        '<span><b>' + root.Fmt.n(last.w, 1) + '</b> ק״ג<small>שקילה אחרונה</small></span>' +
      '</div>' +
      weightChart(series) +
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


  /** קלוריות לקילוגרם שומן, בערך */
  var KCAL_PER_KG = 7700;
  function kgText(kcal) {
    return '≈' + root.Fmt.n(Math.abs(kcal) / KCAL_PER_KG, 2) + ' ק״ג';
  }


  /** טווח סביר לכל ארוחה: הנמוך והגבוה שקבעתי לה, ובלי טווח = המספר עצמו */
  function mealRange(m) {
    var k = typeof m.kcal === 'number' ? m.kcal : 0;
    return [typeof m.kcalLow === 'number' ? m.kcalLow : k, typeof m.kcalHigh === 'number' ? m.kcalHigh : k];
  }

  function dayRange(row) {
    var list = Array.isArray(row.meals) ? row.meals : [];
    if (!list.length) return typeof row.kcal === 'number' ? [row.kcal, row.kcal] : null;
    return list.reduce(function (acc, m) {
      var r = mealRange(m);
      return [acc[0] + r[0], acc[1] + r[1]];
    }, [0, 0]);
  }

  /** טווח הגירעון המצטבר לפי דיוק הרישום; השריפה נשארת כפי שהיא. חיובי = גירעון */
  function deficitRange(rows, cfg) {
    var low = 0, high = 0, days = 0;
    rows.forEach(function (row) {
      if (typeof row.kcal !== 'number' || typeof row.steps !== 'number') return;
      var r = dayRange(row) || [row.kcal, row.kcal];
      var burn = cfg.baseBurn + row.steps * cfg.kcalPerStep;
      low += burn - r[1];
      high += burn - r[0];
      days++;
    });
    return days ? { low: Math.round(low), high: Math.round(high) } : null;
  }

  function rangeText(r) {
    var side = function (v) { return root.Fmt.n(Math.abs(v), 0) + ' ' + (v >= 0 ? 'גירעון' : 'עודף'); };
    var kg = function (v) { return (v >= 0 ? 'ירידה ' : 'עלייה ') + root.Fmt.n(Math.abs(v) / KCAL_PER_KG, 2); };
    return 'בין ' + side(r.low) + ' ל-' + side(r.high) + ', כלומר בין ' + kg(r.low) + ' ל' + kg(r.high) + ' ק״ג';
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
        '<span class="cumul__kg cumul__kg--' + (b.total <= 0 ? 'good' : 'bad') + '">' + kgText(b.total) + ' ' +
          (b.total <= 0 ? 'ירידה' : 'עלייה') + ' בשומן, לפי החשבון</span>' +
        (function () {
          var r = deficitRange(rows, cfg);
          return r && r.low !== r.high ? '<span class="cumul__range">טווח לפי דיוק הרישום: ' + rangeText(r) + '</span>' : '';
        })() +
        '<span class="cumul__unit">קק״ל ' + (b.total <= 0 ? 'גירעון' : 'עודף') +
          ' · ממוצע ' + fmt(avg) + ' ' + (avg <= 0 ? 'גירעון' : 'עודף') + ' ליום, תוכנית ' +
          fmt(cfg.plannedDeficit) + ' גירעון</span>' +
      '</div>' +
      '<div class="cumul__pill cumul__pill--' + (onPlan ? 'good' : 'bad') + '">' +
        (onPlan ? 'לפני התוכנית ב-' : 'מאחורי התוכנית ב-') + fmt(b.gap) + ' קק״ל (' + kgText(b.gap) + ')</div>' +
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

  /** קבוצות המזון; הסדר קבוע כדי שהצבעים יישארו באותו מקום בכל פס */
  var CATS = [
    { key: 'meat', label: 'בשר, עוף ודגים' },
    { key: 'dairy', label: 'חלב וביצים' },
    { key: 'protein', label: 'אבקת חלבון' },
    { key: 'veg', label: 'ירקות וקטניות' },
    { key: 'grains', label: 'לחם ודגנים' },
    { key: 'fat', label: 'שמן, רטבים וזיתים' },
    { key: 'snacks', label: 'נשנושים ומתוקים' },
    { key: 'fried', label: 'מטוגן במסעדה' },
    { key: 'alcohol', label: 'אלכוהול' },
    { key: 'other', label: 'לא מפורק' }
  ];

  /** סכום לכל קבוצה; ארוחה בלי פירוק נספרת כ"לא מפורק" */
  function catTotals(rows) {
    var out = {};
    CATS.forEach(function (c) { out[c.key] = { kcal: 0, proteinG: 0 }; });
    rows.forEach(function (row) {
      (Array.isArray(row.meals) ? row.meals : []).forEach(function (meal) {
        var items = Array.isArray(meal.items) && meal.items.length ? meal.items
          : [{ cat: 'other', kcal: meal.kcal, proteinG: meal.proteinG }];
        items.forEach(function (item) {
          var bucket = out[item.cat] || out.other;
          bucket.kcal += typeof item.kcal === 'number' ? item.kcal : 0;
          bucket.proteinG += typeof item.proteinG === 'number' ? item.proteinG : 0;
        });
      });
    });
    return out;
  }

  function stack(totals, all) {
    if (!all) return '';
    return '<div class="groups__stack">' + CATS.filter(function (c) {
      return totals[c.key].kcal > 0;
    }).map(function (c) {
      return '<i class="groups__seg groups__c--' + c.key + '" style="width:' +
        (totals[c.key].kcal / all * 100).toFixed(2) + '%" title="' + P.esc(c.label) + '"></i>';
    }).join('') + '</div>';
  }

  function groupCard(title, sub, rows) {
    var totals = catTotals(rows);
    var all = CATS.reduce(function (sum, c) { return sum + totals[c.key].kcal; }, 0);
    var days = rows.filter(function (r) { return Array.isArray(r.meals) && r.meals.length; }).length || 1;
    var list = CATS.filter(function (c) { return totals[c.key].kcal > 0; }).sort(function (a, b) {
      return totals[b.key].kcal - totals[a.key].kcal;
    }).map(function (c) {
      var t = totals[c.key];
      var pct = all ? Math.round(t.kcal / all * 100) : 0;
      return '<li class="groups__row">' +
        '<span class="groups__name"><i class="groups__dot groups__c--' + c.key + '"></i>' + P.esc(c.label) + '</span>' +
        '<span class="groups__pct">' + pct + '%</span>' +
        '<span class="groups__kcal">' + root.Fmt.n(t.kcal, 0) + '</span>' +
        '<span class="groups__day">' + root.Fmt.n(Math.round(t.kcal / days), 0) + ' ליום</span>' +
      '</li>';
    }).join('');
    return P.card(title, sub + ' · ' + root.Fmt.n(all, 0) + ' קק״ל',
      stack(totals, all) + '<ul class="groups__list">' + list + '</ul>');
  }

  /** טאב הקבוצות: לאן הלכו הקלוריות */
  function groups() {
    var state = read();
    var rows = state.rows || [];
    if (!rows.length) return P.section('קבוצות', P.card(null, null, P.empty('עוד לא נרשמו ארוחות.')));
    var last = rows.slice(-7);
    var perDay = rows.slice().reverse().map(function (row) {
      var totals = catTotals([row]);
      var all = CATS.reduce(function (sum, c) { return sum + totals[c.key].kcal; }, 0);
      return '<div class="groups__daybar"><span class="groups__date">' +
        P.esc(root.Dates.short(row.date) + ' · ' + weekday(row.date)) + '</span>' +
        '<span class="groups__daykcal">' + root.Fmt.n(all, 0) + '</span>' + stack(totals, all) + '</div>';
    }).join('');
    return P.section('קבוצות',
      groupCard('כל התקופה', rows.length + ' ימים', rows) +
      (rows.length > 7 ? groupCard('7 הימים האחרונים', '7 ימים', last) : '') +
      P.card('לפי יום', 'קק״ל לכל יום', perDay) +
      P.hint('החלוקה נשענת על ההערכות של כל פריט, ולכן היא טובה לזיהוי דפוסים ולא לחשבון מדויק.'));
  }


  /**
   * פירוק הגירעון לשני מקורות: תזונה (תחזוקה בלי צעדים פחות מה שנאכל)
   * וצעדים (צעדים × מקדם). כאן חיובי = גירעון, כמו שמדברים עליו.
   * יום פתוח מציג רק את חלק התזונה עד עכשיו, ולא נכנס לסכום.
   */
  function splitOf(rows, cfg, targets) {
    var out = { days: 0, diet: 0, steps: 0, list: [] };
    rows.forEach(function (row) {
      var kcal = typeof row.kcal === 'number' ? row.kcal : eatenOf(row, 'kcal');
      var closed = typeof row.kcal === 'number' && typeof row.steps === 'number';
      var diet = typeof kcal === 'number' ? Math.round(cfg.baseBurn - kcal) : null;
      var steps = typeof row.steps === 'number' ? Math.round(row.steps * cfg.kcalPerStep) : null;
      out.list.push({ date: row.date, kcal: kcal, stepsCount: row.steps, diet: diet, steps: steps, closed: closed });
      if (!closed) return;
      out.days++;
      out.diet += diet;
      out.steps += steps;
    });
    var kcalTarget = targets && typeof targets.kcal === 'number' ? targets.kcal : null;
    out.dietPlan = kcalTarget === null ? null : (cfg.baseBurn - kcalTarget) * out.days;
    out.stepsPlan = kcalTarget === null ? null : (cfg.plannedDeficit - (cfg.baseBurn - kcalTarget)) * out.days;
    return out;
  }

  /** טאב הפירוק: כמה מהגירעון בא מהתזונה וכמה מהצעדים */
  function split() {
    var state = read();
    var cfg = state.balance;
    var rows = state.rows || [];
    if (!cfg || !rows.length) return P.section('פירוק', P.card(null, null, P.empty('עוד אין ימים לפירוק.')));
    var s = splitOf(rows, cfg, state.targets);
    var fmt = function (v) { return root.Fmt.n(Math.abs(Math.round(v)), 0); };
    var word = function (v) { return v >= 0 ? 'גירעון' : 'עודף'; };
    var vsPlan = function (v, plan) {
      if (plan === null) return word(v);
      var d = v - plan;
      return word(v) + ' ' + kgText(v) + ' · ' + (d >= 0 ? 'לפני התוכנית ב-' : 'מאחורי התוכנית ב-') + fmt(d);
    };
    var total = s.diet + s.steps;
    var tiles = s.days ? '<div class="cumul__tiles">' +
      tile('מהתזונה', fmt(s.diet), vsPlan(s.diet, s.dietPlan), s.dietPlan === null ? 'calm' : (s.diet >= s.dietPlan ? 'good' : 'bad')) +
      tile('מהצעדים', fmt(s.steps), vsPlan(s.steps, s.stepsPlan), s.stepsPlan === null ? 'calm' : (s.steps >= s.stepsPlan ? 'good' : 'bad')) +
      tile('סה״כ', fmt(total), word(total) + ' ' + kgText(total) + ' ' + (total >= 0 ? 'ירידה' : 'עלייה'), total >= 0 ? 'good' : 'bad') +
    '</div>' : '';
    var head = '<section class="cumul">' +
      '<div class="cumul__row"><h2 class="cumul__title">פירוק הגירעון</h2>' +
        '<span class="cumul__stamp">' + s.days + ' ימים סגורים</span></div>' +
      '<div class="cumul__gap">תזונה = ' + root.Fmt.n(cfg.baseBurn, 0) + ' פחות מה שנאכל. ' +
        'צעדים = צעדים × ' + cfg.kcalPerStep + '. חיובי = גירעון. ' +
        'ק״ג = קק״ל ÷ ' + root.Fmt.n(KCAL_PER_KG, 0) + ', שינוי בשומן לפי החשבון.</div>' +
      tiles + (function () {
        var r = deficitRange(rows, cfg);
        return r && r.low !== r.high ? '<div class="cumul__gap">טווח הסה״כ לפי דיוק הרישום: ' + rangeText(r) + '</div>' : '';
      })() + '</section>';
    var cell = function (v, signed) {
      if (typeof v !== 'number') return '<td class="n flat">—</td>';
      if (!signed) return '<td class="n">' + root.Fmt.n(v, 0) + '</td>';
      return '<td class="n split__' + (v >= 0 ? 'good' : 'bad') + '">' + (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(v) + '</td>';
    };
    var kgCell = function (v) {
      if (typeof v !== 'number') return '<td class="n flat">—</td>';
      return '<td class="n split__' + (v >= 0 ? 'good' : 'bad') + '">' + (v >= 0 ? '−' : '+') +
        root.Fmt.n(Math.abs(v) / KCAL_PER_KG, 2) + '</td>';
    };
    var table = P.table(['תאריך', 'קלוריות', 'מהתזונה', 'צעדים', 'מהצעדים', 'סה״כ', 'ק״ג'],
      s.list.slice().reverse().map(function (d) {
        var both = typeof d.diet === 'number' && typeof d.steps === 'number' ? d.diet + d.steps : null;
        return '<tr><td class="n">' + P.esc(root.Dates.short(d.date)) + (d.closed ? '' : ' (פתוח)') + '</td>' +
          cell(d.kcal, false) + cell(d.diet, true) + cell(d.stepsCount, false) + cell(d.steps, true) + cell(both, true) + kgCell(both) + '</tr>';
      }));
    var scen = (function () {
      var closed = rows.filter(function (row) { return typeof row.kcal === 'number' && typeof row.steps === 'number'; });
      if (!closed.length) return '';
      var eaten = { low: 0, mid: 0, high: 0 };
      closed.forEach(function (row) {
        var r = dayRange(row) || [row.kcal, row.kcal];
        eaten.low += r[0]; eaten.mid += row.kcal; eaten.high += r[1];
      });
      var base = cfg.baseBurn * closed.length;
      var signed = function (v) {
        return '<td class="n split__' + (v >= 0 ? 'good' : 'bad') + '">' + (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(v) + '</td>';
      };
      var kgCell2 = function (v) {
        return '<td class="n split__' + (v >= 0 ? 'good' : 'bad') + '">' + (v >= 0 ? '−' : '+') + root.Fmt.n(Math.abs(v) / KCAL_PER_KG, 2) + '</td>';
      };
      var line = function (label, e) {
        var diet = Math.round(base - e);
        var tot = diet + Math.round(s.steps);
        return '<tr><td>' + label + '</td><td class="n">' + root.Fmt.n(Math.round(e), 0) + '</td>' +
          signed(diet) + signed(Math.round(s.steps)) + signed(tot) + kgCell2(tot) + '</tr>';
      };
      return P.card('מה אם', 'לפי טווח הדיוק של כל ארוחה',
        P.table(['תרחיש', 'אכלת', 'מהתזונה', 'מהצעדים', 'סה״כ', 'ק״ג'], [
          line('הכי פחות אוכל', eaten.low), line('רשום', eaten.mid), line('הכי הרבה אוכל', eaten.high)]) +
        P.hint('הצעדים לא משתנים בין התרחישים; הטווח הוא רק של רישום האוכל. ק״ג שלילי = ירידה.'));
    })();
    return P.section('פירוק', head + scen + P.card('לפי יום', 'קק״ל', table) +
      P.hint('יום פתוח מציג את התזונה עד עכשיו, ונכנס לסכום רק כשנסגר עם הצעדים.'));
  }


  /**
   * תמונת מצב בסוף כל יום סגור: מה היה המצטבר נכון לאותו יום.
   * כאן חיובי = טוב (גירעון, לפני התוכנית), כדי שהחצים יהיו פשוטים.
   */
  function trendOf(rows, cfg, targets) {
    var kcalTarget = targets && typeof targets.kcal === 'number' ? targets.kcal : null;
    var protTarget = targets && typeof targets.proteinG === 'number' ? targets.proteinG : null;
    var stepsTarget = targets && typeof targets.steps === 'number' ? targets.steps : null;
    var acc = { days: 0, eaten: 0, burnSteps: 0, steps: 0, prot: 0 };
    var weights = [];
    var out = [];
    rows.forEach(function (row) {
      if (typeof row.weightKg === 'number') weights.push(row.weightKg);
      if (typeof row.kcal !== 'number' || typeof row.steps !== 'number') return;
      acc.days++;
      acc.eaten += row.kcal;
      acc.steps += row.steps;
      acc.burnSteps += row.steps * cfg.kcalPerStep;
      acc.prot += typeof row.proteinG === 'number' ? row.proteinG : 0;
      var deficit = acc.days * cfg.baseBurn + acc.burnSteps - acc.eaten;
      var ahead = deficit - acc.days * cfg.plannedDeficit;
      var last3 = weights.slice(-3);
      out.push({
        date: row.date,
        days: acc.days,
        deficit: Math.round(deficit),
        ahead: Math.round(ahead),
        food: kcalTarget === null ? null : Math.round(acc.days * kcalTarget - acc.eaten),
        walk: stepsTarget === null ? null : Math.round(acc.burnSteps - acc.days * stepsTarget * cfg.kcalPerStep),
        stepsPerDay: ahead < 0 ? Math.round(-ahead / cfg.kcalPerStep / 10) : 0,
        protein: protTarget === null ? null : Math.round(acc.prot - acc.days * protTarget),
        weight3: last3.length ? last3.reduce(function (a, b) { return a + b; }, 0) / last3.length : null,
        weight7: weights.length ? weights.slice(-7).reduce(function (a, b) { return a + b; }, 0) / weights.slice(-7).length : null
      });
    });
    return out;
  }

  function trendChart(list, plan) {
    if (list.length < 2) return '';
    var W = 320, H = 150, L = 40, R = 6, T = 10, B = 22;
    var planAt = function (i) { return list[i].days * plan; };
    var values = list.map(function (d) { return d.deficit; }).concat(list.map(function (d, i) { return planAt(i); }), [0]);
    var top = Math.max.apply(null, values), bottom = Math.min.apply(null, values);
    var pad = (top - bottom) * 0.08 || 50;
    top += pad; bottom -= pad;
    var y = function (v) { return T + (top - v) / (top - bottom) * (H - T - B); };
    var step = (W - L - R) / list.length;
    var x = function (i) { return L + step * i + step / 2; };
    var path = function (fn) {
      return list.map(function (d, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(fn(d, i)).toFixed(1); }).join(' ');
    };
    var dots = list.map(function (d, i) {
      return '<circle class="trend__dot trend__dot--' + (d.ahead >= 0 ? 'good' : 'bad') + '" cx="' + x(i).toFixed(1) +
        '" cy="' + y(d.deficit).toFixed(1) + '" r="' + (i === list.length - 1 ? 4.5 : 3) + '"/>' +
        '<text class="cumul__tick" x="' + x(i).toFixed(1) + '" y="' + (H - 6) + '">' + P.esc(root.Dates.short(d.date)) + '</text>';
    }).join('');
    var label = function (v) {
      return '<text class="cumul__axis" x="' + (L - 4) + '" y="' + (y(v) + 4).toFixed(1) + '">' + root.Fmt.n(Math.round(v), 0) + '</text>';
    };
    return '<svg class="cumul__chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="גירעון מצטבר מול התוכנית">' +
      '<line class="cumul__zero" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '"/>' +
      label(0) + label(planAt(list.length - 1)) +
      '<path class="trend__plan" d="' + path(function (d, i) { return planAt(i); }) + '"/>' +
      '<path class="trend__line" d="' + path(function (d) { return d.deficit; }) + '"/>' + dots +
    '</svg>' +
    '<div class="cumul__legend">' +
      '<span><i class="cumul__key cumul__key--avg"></i>גירעון מצטבר בפועל</span>' +
      '<span><i class="cumul__key cumul__key--plan"></i>התוכנית</span>' +
      '<span>מעל אפס = גירעון</span>' +
    '</div>';
  }

  /** טאב המגמה: איך השתנה המצטבר מיום ליום */
  function trend() {
    var state = read();
    var cfg = state.balance;
    var list = cfg ? trendOf(state.rows || [], cfg, state.targets) : [];
    if (!list.length) return P.section('מגמה', P.card(null, null, P.empty('עוד אין ימים סגורים להשוואה.')));
    var fmt = function (v, d) { return root.Fmt.n(Math.abs(v), d || 0); };
    var kg = function (v) { return fmt(v / KCAL_PER_KG, 2); };
    var METRICS = [
      { key: 'deficit', label: 'מאזן מצטבר', show: function (v) { return fmt(v) + ' ' + (v >= 0 ? 'גירעון' : 'עודף'); } },
      { key: 'deficit', label: 'בק״ג שומן', show: function (v) { return (v >= 0 ? '−' : '+') + kg(v); }, delta: function (v) { return kg(v); } },
      { key: 'ahead', label: 'מול התוכנית', show: function (v) { return fmt(v) + ' ' + (v >= 0 ? 'לפני' : 'מאחורי'); } },
      { key: 'food', label: 'אוכל מול היעד', show: function (v) { return fmt(v) + ' ' + (v >= 0 ? 'מתחת' : 'מעל'); } },
      { key: 'walk', label: 'הליכה מול התוכנית', show: function (v) { return fmt(v) + ' ' + (v >= 0 ? 'יותר' : 'פחות'); } },
      { key: 'stepsPerDay', label: 'צעדים נוספים ליום (10 ימים)', show: function (v) { return v ? fmt(v) : 'אין פער'; }, lowerIsBetter: true },
      { key: 'protein', label: 'חלבון מול היעד (ג׳)', show: function (v) { return fmt(v) + ' ' + (v >= 0 ? 'עודף' : 'חוסר'); } },
      { key: 'weight3', label: 'ממוצע 3 שקילות', show: function (v) { return fmt(v, 1); }, delta: function (v) { return fmt(v, 1); }, lowerIsBetter: true },
      { key: 'weight7', label: 'ממוצע 7 שקילות', show: function (v) { return fmt(v, 1); }, delta: function (v) { return fmt(v, 1); }, lowerIsBetter: true }
    ];
    var arrow = function (m, a, b) {
      if (typeof a !== 'number' || typeof b !== 'number') return '<span class="trend__d">—</span>';
      var d = b - a;
      if (Math.abs(d) < (m.key === 'weight3' ? 0.05 : 1)) return '<span class="trend__d">ללא שינוי</span>';
      var good = m.lowerIsBetter ? d < 0 : d > 0;
      return '<span class="trend__d trend__d--' + (good ? 'good' : 'bad') + '">' + (good ? '✓ ' : '✗ ') +
        (m.delta ? m.delta(d) : fmt(d)) + '</span>';
    };
    var cell = function (m, v) { return typeof v === 'number' ? m.show(v) : '—'; };
    var now = list[list.length - 1];
    var prev = list.length > 1 ? list[list.length - 2] : null;
    var compare = '<section class="cumul trend">' +
      '<div class="cumul__row"><h2 class="cumul__title">' +
        (prev ? P.esc(root.Dates.short(prev.date)) + ' מול ' : '') + P.esc(root.Dates.short(now.date)) + '</h2>' +
        '<span class="cumul__stamp">מצטבר נכון לסוף כל יום</span></div>' +
      '<div class="trend__grid">' +
        '<span class="trend__h"></span><span class="trend__h">' + (prev ? P.esc(root.Dates.short(prev.date)) : '') +
        '</span><span class="trend__h">' + P.esc(root.Dates.short(now.date)) + '</span><span class="trend__h">שינוי</span>' +
        METRICS.map(function (m) {
          return '<span class="trend__k">' + P.esc(m.label) + '</span>' +
            '<span class="trend__v">' + (prev ? cell(m, prev[m.key]) : '—') + '</span>' +
            '<span class="trend__v trend__v--now">' + cell(m, now[m.key]) + '</span>' +
            (prev ? arrow(m, prev[m.key], now[m.key]) : '<span class="trend__d">—</span>');
        }).join('') +
      '</div>' + trendChart(list, cfg.plannedDeficit) + '</section>';
    var table = P.table(['עד יום', 'מאזן', 'ק״ג', 'מול התוכנית', 'צעדים נוספים ליום', 'ממוצע 3', 'ממוצע 7'],
      list.slice().reverse().map(function (d, i, arr) {
        var before = arr[i + 1];
        var withArrow = function (m, v) {
          return '<td class="n">' + cell(m, v) + (before ? '<br>' + arrow(m, before[m.key], v) : '') + '</td>';
        };
        return '<tr><td class="n">' + P.esc(root.Dates.short(d.date)) + '</td>' +
          withArrow(METRICS[0], d.deficit) + withArrow(METRICS[1], d.deficit) + withArrow(METRICS[2], d.ahead) +
          withArrow(METRICS[5], d.stepsPerDay) + withArrow(METRICS[7], d.weight3) + withArrow(METRICS[8], d.weight7) + '</tr>';
      }));
    return P.section('מגמה', compare + P.card('המצב בסוף כל יום', 'מהחדש לישן', table) +
      P.hint('✓ ירוק = השתפר מהיום הקודם, ✗ אדום = הורע. ק״ג = קק״ל ÷ 7,700. צעדים נוספים = כמה צעדים מעל 6,700 ביום, לאורך 10 ימים, כדי לסגור את הפער.'));
  }


  /**
   * טאב המאקרו: לכל יום גרמים ואחוז מהקלוריות של חלבון, פחמימה, שומן ואלכוהול.
   * האחוז מחושב מקלוריות המאקרו (4/4/9 ואלכוהול לפי הרישום), כך שהארבעה מסתכמים ל-100.
   */
  function macroOf(row) {
    var meals = Array.isArray(row.meals) ? row.meals : [];
    var sum = function (key) {
      return meals.reduce(function (a, m) { return a + (typeof m[key] === 'number' ? m[key] : 0); }, 0);
    };
    var alcohol = meals.reduce(function (a, m) {
      return a + (m.items || []).reduce(function (b, i) { return b + (i.cat === 'alcohol' && typeof i.kcal === 'number' ? i.kcal : 0); }, 0);
    }, 0);
    var p = typeof row.proteinG === 'number' ? row.proteinG : sum('proteinG');
    var c = typeof row.carbG === 'number' ? row.carbG : sum('carbG');
    var f = typeof row.fatG === 'number' ? row.fatG : sum('fatG');
    var kcal = typeof row.kcal === 'number' ? row.kcal : sum('kcal');
    var parts = { p: p * 4, c: c * 4, f: f * 9, a: alcohol };
    var total = parts.p + parts.c + parts.f + parts.a;
    var pct = function (v) { return total ? Math.round(v / total * 100) : 0; };
    return { date: row.date, kcal: kcal, p: p, c: c, f: f, alcohol: alcohol,
      pp: pct(parts.p), pc: pct(parts.c), pf: pct(parts.f), pa: pct(parts.a), closed: typeof row.steps === 'number' };
  }

  function macroBar(m) {
    var seg = function (cls, v) { return v ? '<i class="mbar__seg mbar--' + cls + '" style="width:' + v + '%"></i>' : ''; };
    return '<div class="mbar">' + seg('p', m.pp) + seg('c', m.pc) + seg('f', m.pf) + seg('a', m.pa) + '</div>';
  }

  function macros() {
    var state = read();
    var rows = (state.rows || []).filter(function (r) { return Array.isArray(r.meals) && r.meals.length; });
    if (!rows.length) return P.section('מאקרו', P.card(null, null, P.empty('עוד אין ארוחות.')));
    var t = state.targets || {};
    var list = rows.map(macroOf);
    var n = root.Fmt.n;
    var avg = function (key) { return list.reduce(function (a, m) { return a + m[key]; }, 0) / list.length; };
    var all = macroOf({ meals: [], kcal: avg('kcal'), proteinG: avg('p'), carbG: avg('c'), fatG: avg('f') });
    all.alcohol = avg('alcohol');
    var tot = all.p * 4 + all.c * 4 + all.f * 9 + all.alcohol;
    all.pp = Math.round(all.p * 4 / tot * 100); all.pc = Math.round(all.c * 4 / tot * 100);
    all.pf = Math.round(all.f * 9 / tot * 100); all.pa = Math.round(all.alcohol / tot * 100);
    var tgt = function (key) { return typeof t[key] === 'number' ? t[key] : null; };
    var tp = tgt('proteinG'), tc = tgt('carbG'), tf = tgt('fatG');
    var tk = (tp || 0) * 4 + (tc || 0) * 4 + (tf || 0) * 9;
    var targetPct = tk ? ' · יעד: חלבון ' + Math.round(tp * 4 / tk * 100) + '%, פחמימה ' + Math.round(tc * 4 / tk * 100) +
      '%, שומן ' + Math.round(tf * 9 / tk * 100) + '%' : '';
    var legend = '<div class="mlegend"><span><i class="mbar--p"></i>חלבון</span><span><i class="mbar--c"></i>פחמימה</span>' +
      '<span><i class="mbar--f"></i>שומן</span><span><i class="mbar--a"></i>אלכוהול</span></div>';
    var summary = P.card('ממוצע יומי', list.length + ' ימים' + targetPct,
      macroBar(all) + legend +
      '<div class="mavg">' +
        '<span><b>' + n(all.p, 0) + '</b> ג׳ חלבון<small>' + all.pp + '% · יעד ' + (tp || '—') + '</small></span>' +
        '<span><b>' + n(all.c, 0) + '</b> ג׳ פחמימה<small>' + all.pc + '% · יעד ' + (tc || '—') + '</small></span>' +
        '<span><b>' + n(all.f, 0) + '</b> ג׳ שומן<small>' + all.pf + '% · יעד ' + (tf || '—') + '</small></span>' +
        '<span><b>' + n(all.alcohol, 0) + '</b> קק״ל אלכוהול<small>' + all.pa + '%</small></span>' +
      '</div>');
    var flag = function (v, target, higherIsGood, closed) {
      if (target === null || !closed) return '';
      var good = higherIsGood ? v >= target * 0.95 : v <= target * 1.05;
      return ' mcell--' + (good ? 'good' : 'bad');
    };
    var cell = function (g, pc, cls) { return '<td class="n' + cls + '">' + n(g, 0) + '<small>' + pc + '%</small></td>'; };
    var table = P.table(['תאריך', 'קק״ל', 'חלבון', 'פחמימה', 'שומן', 'אלכוהול', 'חלוקה'],
      list.slice().reverse().map(function (m) {
        return '<tr><td class="n">' + P.esc(root.Dates.short(m.date)) + '<small>' + P.esc(weekday(m.date).replace('יום ', '')) + '</small></td>' +
          '<td class="n">' + n(m.kcal, 0) + '</td>' +
          cell(m.p, m.pp, flag(m.p, tp, true, m.closed)) + cell(m.c, m.pc, flag(m.c, tc, false, m.closed)) + cell(m.f, m.pf, flag(m.f, tf, false, m.closed)) +
          '<td class="n">' + (m.alcohol ? n(m.alcohol, 0) + '<small>' + m.pa + '%</small>' : '—') + '</td>' +
          '<td class="mtable__bar">' + macroBar(m) + '</td></tr>';
      }));
    var totals = catTotals(state.rows || []);
    var fatRows = CATS.map(function (c) {
      var fat = (state.rows || []).reduce(function (a, r) {
        return a + (r.meals || []).reduce(function (b, m) {
          return b + (m.items || []).reduce(function (x, i) { return x + (i.cat === c.key && typeof i.fatG === 'number' ? i.fatG : 0); }, 0);
        }, 0);
      }, 0);
      return { label: c.label, fat: fat };
    }).filter(function (r) { return r.fat >= 1; }).sort(function (a, b) { return b.fat - a.fat; });
    var fatAll = fatRows.reduce(function (a, r) { return a + r.fat; }, 0) || 1;
    var fatCard = P.card('מאיפה בא השומן', 'כל התקופה',
      P.table(['קבוצה', 'שומן (ג׳)', 'מהשומן'], fatRows.map(function (r) {
        return '<tr><td>' + P.esc(r.label) + '</td><td class="n">' + n(r.fat, 0) + '</td><td class="n">' + Math.round(r.fat / fatAll * 100) + '%</td></tr>';
      })));
    void totals;
    return P.section('מאקרו', summary + P.card('לפי יום', 'גרמים ואחוז מהקלוריות', table) + fatCard +
      P.hint('האחוזים מחושבים מקלוריות: חלבון ופחמימה 4 לגרם, שומן 9 לגרם, אלכוהול לפי הרישום. ירוק = בתוך היעד (חלבון: מעליו).'));
  }


  /**
   * דף ציונים: לכל יום סגור, האם עמד בכל מטרה; ספירה, אחוז ורצף נוכחי.
   */
  function goalsOf(state) {
    var t = state.targets || {};
    var cfg = state.balance || { baseBurn: 2150, kcalPerStep: 0.045, plannedDeficit: 550 };
    var G = [];
    if (typeof t.kcal === 'number') G.push({ key: 'kcal', label: 'קלוריות עד ' + root.Fmt.n(t.kcal, 0), test: function (r) { return r.kcal <= t.kcal; } });
    G.push({ key: 'deficit', label: 'גירעון של ' + cfg.plannedDeficit + ' לפחות', test: function (r) { return cfg.baseBurn + r.steps * cfg.kcalPerStep - r.kcal >= cfg.plannedDeficit; } });
    G.push({ key: 'balance', label: 'בלי עודף (גירעון כלשהו)', test: function (r) { return cfg.baseBurn + r.steps * cfg.kcalPerStep - r.kcal >= 0; } });
    if (typeof t.proteinG === 'number') G.push({ key: 'protein', label: 'חלבון ' + t.proteinG + ' לפחות', test: function (r) { return (r.proteinG || 0) >= t.proteinG; } });
    if (typeof t.fatG === 'number') G.push({ key: 'fat', label: 'שומן עד ' + t.fatG, test: function (r) { return (r.fatG || 0) <= t.fatG; } });
    if (typeof t.steps === 'number') G.push({ key: 'steps', label: 'צעדים ' + root.Fmt.n(t.steps, 0) + ' לפחות', test: function (r) { return r.steps >= t.steps; } });
    if (typeof t.stepsGoal === 'number') G.push({ key: 'steps10', label: 'צעדים ' + root.Fmt.n(t.stepsGoal, 0) + ' לפחות', test: function (r) { return r.steps >= t.stepsGoal; } });
    G.push({ key: 'dry', label: 'בלי אלכוהול', test: function (r) {
      return !(r.meals || []).some(function (m) { return (m.items || []).some(function (i) { return i.cat === 'alcohol' && i.kcal > 0; }); });
    } });
    return G;
  }

  function scoresOf(state) {
    var rows = (state.rows || []).filter(function (r) { return typeof r.kcal === 'number' && typeof r.steps === 'number'; });
    var goals = goalsOf(state);
    var days = rows.map(function (r) {
      var res = {};
      goals.forEach(function (g) { res[g.key] = !!g.test(r); });
      var hit = goals.filter(function (g) { return res[g.key]; }).length;
      return { date: r.date, res: res, hit: hit, of: goals.length };
    });
    var stats = goals.map(function (g) {
      var hit = days.filter(function (d) { return d.res[g.key]; }).length;
      var streak = 0;
      for (var i = days.length - 1; i >= 0 && days[i].res[g.key]; i--) streak++;
      var best = 0, run = 0;
      days.forEach(function (d) { run = d.res[g.key] ? run + 1 : 0; best = Math.max(best, run); });
      return { key: g.key, label: g.label, hit: hit, of: days.length, pct: days.length ? Math.round(hit / days.length * 100) : 0, streak: streak, best: best };
    });
    var total = days.reduce(function (a, d) { return a + d.hit; }, 0);
    var possible = days.length * goals.length;
    return { goals: goals, days: days, stats: stats, score: possible ? Math.round(total / possible * 100) : 0 };
  }

  function scorecard() {
    var state = read();
    var sc = scoresOf(state);
    if (!sc.days.length) return P.section('ציונים', P.card(null, null, P.empty('עוד אין ימים סגורים.')));
    var grade = sc.score >= 80 ? 'good' : sc.score >= 60 ? 'warn' : 'bad';
    var head = '<section class="cumul">' +
      '<div class="cumul__row"><h2 class="cumul__title">דף ציונים</h2><span class="cumul__stamp">' + sc.days.length + ' ימים סגורים</span></div>' +
      '<div class="score__big score--' + grade + '">' + sc.score + '<small>/100</small></div>' +
      '<div class="cumul__gap">אחוז המטרות שהושגו מכל המטרות בכל הימים</div>' +
    '</section>';
    var statRows = sc.stats.map(function (s) {
      var cls = s.pct >= 80 ? 'good' : s.pct >= 50 ? 'warn' : 'bad';
      return '<tr><td>' + P.esc(s.label) + '</td>' +
        '<td class="n score__cell--' + cls + '"><b>' + s.hit + '/' + s.of + '</b><small>' + s.pct + '%</small></td>' +
        '<td class="n">' + s.streak + '</td><td class="n">' + s.best + '</td>' +
        '<td><div class="score__bar"><i class="score--' + cls + '" style="width:' + s.pct + '%"></i></div></td></tr>';
    });
    var statCard = P.card('לפי מטרה', 'כמה ימים עמדת בכל מטרה',
      P.table(['מטרה', 'ימים', 'רצף נוכחי', 'רצף שיא', ''], statRows));
    var dayRows = sc.days.slice().reverse().map(function (d) {
      return '<tr><td class="n">' + P.esc(root.Dates.short(d.date)) + '<small>' + P.esc(weekday(d.date).replace('יום ', '')) + '</small></td>' +
        sc.goals.map(function (g) { return '<td class="score__mark score__mark--' + (d.res[g.key] ? 'ok' : 'no') + '">' + (d.res[g.key] ? '✓' : '✗') + '</td>'; }).join('') +
        '<td class="n"><b>' + d.hit + '/' + d.of + '</b></td></tr>';
    });
    var short = { kcal: 'קל׳', deficit: 'גירעון', balance: 'בלי עודף', protein: 'חלבון', fat: 'שומן', steps: '6.7K', steps10: '10K', dry: 'בלי אלכ׳' };
    var dayCard = P.card('לפי יום', '✓ עמד · ✗ לא עמד',
      P.table(['תאריך'].concat(sc.goals.map(function (g) { return short[g.key] || g.label; })).concat(['סה״כ']), dayRows));
    return P.section('ציונים', head + statCard + dayCard +
      P.hint('רק ימים סגורים (עם צעדים). גירעון לפי החשבון הנוכחי: ' + root.Fmt.n((state.balance || {}).baseBurn || 2150, 0) + ' + צעדים × ' + ((state.balance || {}).kcalPerStep || 0.045) + '.'));
  }

  /** שם היום בשבוע, לפי תאריך ISO ובלי תלות באזור הזמן של הדפדפן */
  function weekday(iso) {
    var names = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    var p = iso.split('-').map(Number);
    return 'יום ' + names[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
  }


  /** כמה מדויק כל רישום: נמדד, חלקי, או הערכה */
  var BASIS = {
    exact: { label: 'מדויק', hint: 'שקילה או תווית' },
    partial: { label: 'חלקי', hint: 'חלק נמדד, חלק הערכה' },
    estimate: { label: 'הערכה', hint: 'הערכה שלי, בלי מדידה' }
  };

  function basisOf(rows) {
    var out = { exact: 0, partial: 0, estimate: 0, none: 0 };
    rows.forEach(function (row) {
      (Array.isArray(row.meals) ? row.meals : []).forEach(function (m) {
        var k = typeof m.kcal === 'number' ? m.kcal : 0;
        out[BASIS[m.basis] ? m.basis : 'none'] += k;
      });
    });
    out.total = out.exact + out.partial + out.estimate + out.none;
    return out;
  }

  function basisBar(b) {
    if (!b.total) return '';
    var keys = ['exact', 'partial', 'estimate'];
    var pct = function (k) { return Math.round(b[k] / b.total * 100); };
    return '<div class="basis">' +
      '<div class="basis__bar">' + keys.filter(function (k) { return b[k]; }).map(function (k) {
        return '<i class="basis__seg basis--' + k + '" style="width:' + (b[k] / b.total * 100).toFixed(2) + '%"></i>';
      }).join('') + '</div>' +
      '<div class="basis__legend">' + keys.map(function (k) {
        return '<span><i class="basis__dot basis--' + k + '"></i>' + BASIS[k].label + ' ' + pct(k) + '% · ' +
          root.Fmt.n(b[k], 0) + '</span>';
      }).join('') + '</div></div>';
  }

  /** טאב הארוחות: כל יום, מהחדש לישן, עם כל מה שנרשם בו */
  function meals() {
    var state = read();
    var rows = (state.rows || []).slice().reverse();
    if (!rows.length) return P.section('ארוחות', P.card(null, null, P.empty('עוד לא נרשמו ארוחות.')));
    var n = function (v) { return typeof v === 'number' ? root.Fmt.n(v, 0) : '—'; };
    var all = basisOf(rows);
    var overall = all.total ? P.card('כמה מזה נמדד', 'כל התקופה, לפי קק״ל', basisBar(all) +
      P.hint('מדויק = שקילה או תווית. חלקי = חלק נמדד וחלק הערכה. הערכה = בלי מדידה, מעוגל למעלה.')) : '';
    return P.section('ארוחות', overall + rows.map(function (row) {
      var list = Array.isArray(row.meals) ? row.meals : [];
      var sum = function (key) {
        if (typeof row[key] === 'number') return row[key];
        var total = list.reduce(function (acc, m) { return acc + (typeof m[key] === 'number' ? m[key] : 0); }, 0);
        return list.length ? total : null;
      };
      var closed = typeof row.kcal === 'number' && typeof row.steps === 'number';
      var head = '<div class="meals__sum">' +
        '<span><b>' + n(sum('kcal')) + '</b> קק״ל' +
          (function () { var r = dayRange(row); return r && r[0] !== r[1] ? ' <small class="meals__range">(טווח <bdi dir="ltr">' + n(r[0]) + '–' + n(r[1]) + '</bdi>)</small>' : ''; })() + '</span>' +
        '<span><b>' + n(sum('proteinG')) + '</b> ג׳ חלבון</span>' +
        '<span><b>' + n(sum('carbG')) + '</b> ג׳ פחמימות</span>' +
        '<span><b>' + n(sum('fatG')) + '</b> ג׳ שומן</span>' +
      '</div>';
      var body = list.length ? '<ul class="meals__list">' + list.map(function (m) {
        return '<li class="meals__item">' +
          '<div class="meals__top"><span class="meals__time">' + P.esc(m.time || '') + '</span>' +
            '<span class="meals__kcal">' + n(m.kcal) + ' קק״ל' +
              (function () { var r = mealRange(m); return r[0] !== r[1] ? '<small class="meals__range" dir="ltr">' + n(r[0]) + '–' + n(r[1]) + '</small>' : ''; })() +
            '</span></div>' +
          '<div class="meals__name">' + P.esc(m.name || '') + '</div>' +
          '<div class="meals__macro">חלבון ' + n(m.proteinG) + ' · פחמימות ' + n(m.carbG) +
            ' · שומן ' + n(m.fatG) + '</div>' +
          (BASIS[m.basis] ? '<div class="meals__basis"><span class="basis__tag basis--' + m.basis + '">' +
            BASIS[m.basis].label + '</span>' + P.esc(m.basisNote || BASIS[m.basis].hint) + '</div>' : '') +
        '</li>';
      }).join('') + '</ul>' : P.hint('לא נרשמו ארוחות ביום הזה.');
      return P.card(root.Dates.short(row.date) + ' · ' + weekday(row.date), closed ? 'יום סגור' : 'יום פתוח',
        head + basisBar(basisOf([row])) + body);
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
    cumulBlock(rows, state.balance, targets) +
    forecastBlock(rows, state.balance);
  }


  /**
   * תחזית: מתי מגיעים ליעדי משקל, לפי הגירעון הממוצע עד היום ולפי התוכנית.
   * נקודת המוצא היא ממוצע 3 השקילות האחרונות, כדי לא להיגרר אחרי שקילה בודדת.
   */
  var MILESTONES = [86, 84];
  function forecastOf(rows, cfg, now) {
    var b = balanceOf(rows, cfg);
    var weights = rows.filter(function (row) { return typeof row.weightKg === 'number'; });
    if (!b.days || !weights.length) return null;
    var last = weights.slice(-3).map(function (row) { return row.weightKg; });
    var from = last.reduce(function (a, w) { return a + w; }, 0) / last.length;
    var avg = -b.total / b.days;
    var first = rows.length ? rows[0].date : null;
    var today = now || new Date();
    var tracked = first ? Math.round((Date.parse(today.toISOString().slice(0, 10)) - Date.parse(first)) / 864e5) + 1 : b.days;
    var when = function (kg, perDay) {
      if (from <= kg) return { done: true };
      if (!(perDay > 0)) return { never: true };
      var days = Math.ceil((from - kg) * KCAL_PER_KG / perDay);
      var d = new Date(today.getTime() + days * 864e5);
      return { days: days, date: d.toISOString().slice(0, 10) };
    };
    return {
      tracked: tracked, closed: b.days, avg: Math.round(avg), from: from,
      goals: MILESTONES.map(function (kg) {
        return { kg: kg, actual: when(kg, avg), plan: when(kg, cfg.plannedDeficit) };
      })
    };
  }

  function forecastBlock(rows, cfg) {
    if (!cfg) return '';
    var f = forecastOf(rows, cfg);
    if (!f) return '';
    var cell = function (w) {
      if (w.done) return 'הושג';
      if (w.never) return 'לא בקצב הזה';
      return P.esc(root.Dates.short(w.date)) + '<br><small>בעוד ' + root.Fmt.n(w.days, 0) + ' ימים</small>';
    };
    var rowsHtml = f.goals.map(function (g) {
      return '<tr><td>' + g.kg + ' ק״ג</td><td>' + cell(g.actual) + '</td><td>' + cell(g.plan) + '</td></tr>';
    });
    return P.card('תחזית', f.tracked + ' ימים במעקב · ' + f.closed + ' ימים סגורים',
      '<div class="forecast__facts">' +
        '<span>גירעון ממוצע: <b>' + root.Fmt.n(Math.abs(f.avg), 0) + '</b> ' + (f.avg >= 0 ? 'ליום' : 'עודף ליום') + '</span>' +
        '<span>נקודת מוצא: <b>' + root.Fmt.n(f.from, 1) + '</b> ק״ג (ממוצע 3 שקילות)</span>' +
      '</div>' +
      P.table(['יעד', 'בקצב עד עכשיו', 'בקצב התוכנית'], rowsHtml) +
      P.hint('חשבון לפי ' + root.Fmt.n(KCAL_PER_KG, 0) + ' קק״ל לק״ג שומן. לא כולל מים, ולא את ההאטה כשהמשקל יורד. יכויל בסוף 19.11.'));
  }


  /**
   * ייצוא לאקסל: גיליון לכל טאב. הספרייה (SheetJS) נטענת רק בלחיצה,
   * כדי לא להכביד על כל פתיחה של האתר.
   */
  function workbookData() {
    var state = read();
    var rows = state.rows || [];
    var cfg = state.balance || { baseBurn: 2150, kcalPerStep: 0.045, plannedDeficit: 550 };
    var targets = state.targets || {};
    var r1 = function (v) { return typeof v === 'number' ? Math.round(v * 10) / 10 : ''; };
    var r0 = function (v) { return typeof v === 'number' ? Math.round(v) : ''; };
    var catLabel = {};
    CATS.forEach(function (c) { catLabel[c.key] = c.label; });
    var basisLabel = function (b) { return BASIS[b] ? BASIS[b].label : ''; };
    var sum = function (row, key) {
      return (Array.isArray(row.meals) ? row.meals : []).reduce(function (a, m) {
        return a + (typeof m[key] === 'number' ? m[key] : 0);
      }, 0);
    };

    var cum = 0, cumDays = 0;
    var days = [['תאריך', 'יום', 'משקל', 'קלוריות', 'טווח נמוך', 'טווח גבוה', 'חלבון', 'פחמימות', 'שומן',
      'צעדים', 'שריפה משוערת', 'גירעון (+) / עודף (−)', 'מהתזונה', 'מהצעדים', 'ק״ג שומן (− ירידה)',
      'גירעון מצטבר', 'מול התוכנית מצטבר', 'יום סגור', 'ממוצע 3 שקילות', 'ממוצע 7 שקילות']];
    var ws = {};
    weightSeries(rows).forEach(function (p) { ws[p.date] = p; });
    rows.forEach(function (row) {
      var kcal = typeof row.kcal === 'number' ? row.kcal : (row.meals && row.meals.length ? sum(row, 'kcal') : null);
      var closed = typeof row.kcal === 'number' && typeof row.steps === 'number';
      var range = dayRange(row);
      var burn = typeof row.steps === 'number' ? cfg.baseBurn + row.steps * cfg.kcalPerStep : null;
      var bal = closed ? burn - row.kcal : null;
      if (closed) { cum += bal; cumDays++; }
      days.push([row.date, weekday(row.date), r1(row.weightKg), r0(kcal), range ? r0(range[0]) : '', range ? r0(range[1]) : '',
        r0(typeof row.proteinG === 'number' ? row.proteinG : sum(row, 'proteinG')),
        r0(typeof row.carbG === 'number' ? row.carbG : sum(row, 'carbG')),
        r0(typeof row.fatG === 'number' ? row.fatG : sum(row, 'fatG')),
        r0(row.steps), r0(burn), r0(bal),
        typeof kcal === 'number' ? r0(cfg.baseBurn - kcal) : '',
        typeof row.steps === 'number' ? r0(row.steps * cfg.kcalPerStep) : '',
        closed ? Math.round(-bal / KCAL_PER_KG * 100) / 100 : '',
        closed ? r0(cum) : '', closed ? r0(cum - cumDays * cfg.plannedDeficit) : '',
        closed ? 'כן' : 'לא', ws[row.date] ? r1(ws[row.date].avg3) : '', ws[row.date] ? r1(ws[row.date].avg7) : '']);
    });

    var meals = [['תאריך', 'שעה', 'ארוחה', 'קלוריות', 'טווח נמוך', 'טווח גבוה', 'חלבון', 'פחמימות', 'שומן', 'דיוק', 'הערת דיוק']];
    var items = [['תאריך', 'ארוחה', 'פריט', 'קבוצה', 'קלוריות', 'חלבון', 'פחמימות', 'שומן']];
    var walks = [['תאריך', 'סוג', 'שעה', 'דקות', 'ק״מ', 'צעדים', 'דופק ממוצע', 'דופק מרבי', 'קלוריות לפי השעון']];
    rows.forEach(function (row) {
      (row.meals || []).forEach(function (m) {
        var r = mealRange(m);
        meals.push([row.date, m.time || '', m.name || '', r0(m.kcal), r0(r[0]), r0(r[1]), r1(m.proteinG), r1(m.carbG), r1(m.fatG),
          basisLabel(m.basis), m.basisNote || '']);
        (m.items || []).forEach(function (i) {
          items.push([row.date, m.name || '', i.name || '', catLabel[i.cat] || i.cat || '', r0(i.kcal), r1(i.proteinG), r1(i.carbG), r1(i.fatG)]);
        });
      });
      (row.walks || []).forEach(function (w) {
        walks.push([row.date, w.type || 'הליכה', w.time || '',
          typeof w.minutes === 'number' ? Math.round((w.minutes + (w.seconds || 0) / 60) * 10) / 10 : '',
          r1(w.km), r0(w.steps), r0(w.avgHr), r0(w.maxHr), r0(w.deviceKcal)]);
      });
    });

    var totals = catTotals(rows);
    var all = CATS.reduce(function (a, c) { return a + totals[c.key].kcal; }, 0) || 1;
    var groups = [['קבוצה', 'קלוריות', 'אחוז מהקלוריות', 'חלבון']];
    CATS.forEach(function (c) {
      if (!totals[c.key].kcal) return;
      groups.push([c.label, r0(totals[c.key].kcal), Math.round(totals[c.key].kcal / all * 1000) / 10, r0(totals[c.key].proteinG)]);
    });

    var trendRows = [['עד יום', 'ימים סגורים', 'גירעון מצטבר', 'ק״ג שומן (− ירידה)', 'מול התוכנית (+ לפני)', 'אוכל מול היעד (+ מתחת)',
      'הליכה מול התוכנית (+ יותר)', 'צעדים נוספים ליום (10 ימים)', 'חלבון מול היעד', 'ממוצע 3 שקילות', 'ממוצע 7 שקילות']];
    trendOf(rows, cfg, targets).forEach(function (t) {
      trendRows.push([t.date, t.days, t.deficit, Math.round(-t.deficit / KCAL_PER_KG * 100) / 100, t.ahead,
        t.food === null ? '' : t.food, t.walk === null ? '' : t.walk, t.stepsPerDay, t.protein === null ? '' : t.protein, r1(t.weight3), r1(t.weight7)]);
    });

    var f = forecastOf(rows, cfg);
    var forecast = [['נתון', 'ערך']];
    if (f) {
      forecast.push(['ימים במעקב', f.tracked], ['ימים סגורים', f.closed], ['גירעון ממוצע ליום', f.avg], ['נקודת מוצא (ממוצע 3 שקילות)', r1(f.from)]);
      forecast.push(['', ''], ['יעד', 'בקצב עד עכשיו', 'ימים', 'בקצב התוכנית', 'ימים']);
      f.goals.forEach(function (g) {
        var a = g.actual, p = g.plan;
        forecast.push([g.kg + ' ק״ג', a.date || (a.done ? 'הושג' : 'לא בקצב הזה'), a.days || '', p.date || (p.done ? 'הושג' : ''), p.days || '']);
      });
    }

    var macroRows = [['תאריך', 'קלוריות', 'חלבון (ג׳)', 'חלבון %', 'פחמימה (ג׳)', 'פחמימה %', 'שומן (ג׳)', 'שומן %', 'אלכוהול (קק״ל)', 'אלכוהול %']];
    rows.filter(function (r) { return Array.isArray(r.meals) && r.meals.length; }).forEach(function (r) {
      var m = macroOf(r);
      macroRows.push([m.date, r0(m.kcal), r0(m.p), m.pp, r0(m.c), m.pc, r0(m.f), m.pf, r0(m.alcohol), m.pa]);
    });

    var sc = scoresOf(state);
    var scoreRows = [['מטרה', 'ימים שעמד', 'מתוך', 'אחוז', 'רצף נוכחי', 'רצף שיא']];
    sc.stats.forEach(function (st) { scoreRows.push([st.label, st.hit, st.of, st.pct, st.streak, st.best]); });
    scoreRows.push(['', ''], ['ציון כולל', sc.score], ['', '']);
    scoreRows.push(['תאריך'].concat(sc.goals.map(function (g) { return g.label; })).concat(['סה״כ']));
    sc.days.forEach(function (dd) {
      scoreRows.push([dd.date].concat(sc.goals.map(function (g) { return dd.res[g.key] ? '✓' : '✗'; })).concat([dd.hit + '/' + dd.of]));
    });

    var settings = [['הגדרה', 'ערך'],
      ['יעד קלוריות', targets.kcal || ''], ['יעד חלבון', targets.proteinG || ''], ['יעד פחמימות', targets.carbG || ''],
      ['יעד שומן', targets.fatG || ''], ['צעדים (מינימום לתוכנית)', targets.steps || ''], ['יעד צעדים', targets.stepsGoal || ''],
      ['שריפת בסיס', cfg.baseBurn], ['קלוריות לצעד', cfg.kcalPerStep], ['גירעון מתוכנן ליום', cfg.plannedDeficit],
      ['קק״ל לק״ג שומן', KCAL_PER_KG], ['עודכן', state.updatedAt || '']];

    return [
      { name: 'ימים', rows: days }, { name: 'ארוחות', rows: meals }, { name: 'פריטים', rows: items },
      { name: 'קבוצות', rows: groups }, { name: 'מאקרו', rows: macroRows }, { name: 'אימונים', rows: walks }, { name: 'מגמה', rows: trendRows }, { name: 'ציונים', rows: scoreRows },
      { name: 'תחזית', rows: forecast }, { name: 'הגדרות', rows: settings }
    ];
  }

  function loadXlsx(done) {
    if (root.XLSX) return done();
    var tag = root.document.createElement('script');
    tag.src = 'vendor/xlsx.full.min.js';
    tag.onload = function () { done(); };
    tag.onerror = function () { done(new Error('load')); };
    root.document.head.appendChild(tag);
  }

  function exportXlsx() {
    loadXlsx(function (err) {
      if (err || !root.XLSX) { root.alert && root.alert('לא הצלחתי לטעון את כלי הייצוא.'); return; }
      var X = root.XLSX;
      var wb = X.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      workbookData().forEach(function (sheet) {
        var ws = X.utils.aoa_to_sheet(sheet.rows);
        ws['!cols'] = sheet.rows[0].map(function (_, c) {
          var w = sheet.rows.reduce(function (m, r) { return Math.max(m, String(r[c] === undefined ? '' : r[c]).length); }, 6);
          return { wch: Math.min(w + 2, 60) };
        });
        ws['!views'] = [{ RTL: true }];
        X.utils.book_append_sheet(wb, ws, sheet.name);
      });
      var today = new Date().toISOString().slice(0, 10);
      X.writeFile(wb, 'weight-tracking-' + today + '.xlsx');
    });
  }

  function exportButton() {
    return '<div class="export"><button type="button" class="export__btn" data-coach-export>⬇ הורדה לאקסל (כל הטאבים)</button></div>';
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

  root.Coach = { start: start, load: load, card: card, today: today, balanceOf: balanceOf, macroTotals: macroTotals, weightAverage: weightAverage, stepsDiff: stepsDiff, stepsForGap: stepsForGap, meals: meals, groups: groups, split: split, splitOf: splitOf, trend: trend, trendOf: trendOf, forecastOf: forecastOf, weightSeries: weightSeries, macros: macros, macroOf: macroOf, scorecard: scorecard, scoresOf: scoresOf, workbookData: workbookData, exportXlsx: exportXlsx, exportButton: exportButton, basisOf: basisOf, deficitRange: deficitRange, dayRange: dayRange, catTotals: catTotals, KEY: KEY };
})(typeof window !== 'undefined' ? window : globalThis);
