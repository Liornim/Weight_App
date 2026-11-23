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
        balance: data.balance || null,
        trips: data.trips || null,
        catchup: data.catchup || null
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
    // רגרסיה וממוצע חצאים, בלי השבוע הראשון (מים)
    var d0 = Date.parse(series[0].date) / 864e5;
    var s0 = 0;
    while (s0 < series.length && Date.parse(series[s0].date) / 864e5 < d0 + 7) s0++;
    var extra = '', regEnd = null;
    if (series.length - s0 >= 3) {
      var pts = series.slice(s0).map(function (p, k) { return { x: Date.parse(p.date) / 864e5, y: p.w, i: s0 + k }; });
      var fit = regress(pts);
      if (fit) {
        var a = pts[0], b = pts[pts.length - 1];
        regEnd = fit.at(b.x);
        extra += '<line class="wchart__reg" x1="' + x(a.i).toFixed(1) + '" y1="' + y(fit.at(a.x)).toFixed(1) + '" x2="' + x(b.i).toFixed(1) + '" y2="' + y(regEnd).toFixed(1) + '"/>';
      }
    }
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
      extra + '<path class="wchart__a3" d="' + path('avg3') + '"/><path class="wchart__a7" d="' + path('avg7') + '"/>' + dots + ticks + ends + '</svg>' +
      '<div class="wchart__legend"><span><i class="wchart__k wchart__k--a7"></i>ממוצע 7</span>' +
      '<span><i class="wchart__k wchart__k--a3"></i>ממוצע 3</span><span><i class="wchart__k wchart__k--dot"></i>שקילה</span>' +
      (extra ? '<span><i class="wchart__k wchart__k--reg"></i>מגמה (רגרסיה)' + (regEnd !== null ? ' · ' + root.Fmt.n(regEnd, 1) : '') + '</span>' : '') +
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
    var W = 340, H = 240, L = 46, R = 10, T = 14, B = 34;
    var avg = [], sum = 0;
    daily.forEach(function (d, i) { sum += d.value; avg.push(sum / (i + 1)); });
    var values = daily.map(function (d) { return d.value; }).concat(avg, [0, -plan]);
    var gridStep = 500;
    var top = Math.ceil((Math.max.apply(null, values) + 50) / gridStep) * gridStep;
    var bottom = Math.floor((Math.min.apply(null, values) - 50) / gridStep) * gridStep;
    var y = function (v) { return T + (top - v) / (top - bottom) * (H - T - B); };
    var step = (W - L - R) / daily.length;
    var x = function (i) { return L + step * i + step / 2; };
    var barW = Math.min(step * 0.62, 24);
    var n0 = function (v) { return root.Fmt.n(Math.abs(Math.round(v)), 0); };
    var signed = function (v) { return v === 0 ? '0' : (v > 0 ? '+' : '−') + n0(v); };
    var grid = '';
    for (var g = bottom; g <= top; g += gridStep) {
      grid += '<line class="cumul__grid' + (g === 0 ? ' cumul__grid--zero' : '') + '" x1="' + L + '" x2="' + (W - R) +
        '" y1="' + y(g).toFixed(1) + '" y2="' + y(g).toFixed(1) + '"/>' +
        '<text class="cumul__axis" x="' + (L - 6) + '" y="' + (y(g) + 4).toFixed(1) + '">' + signed(g) + '</text>';
    }
    var month = '';
    var bars = daily.map(function (d, i) {
      var y0 = y(0), y1 = y(d.value);
      var parts = String(d.date).split('-');
      var showMonth = parts[1] !== month; month = parts[1];
      return '<rect class="cumul__bar cumul__bar--' + (d.value <= 0 ? 'good' : 'bad') + '" x="' +
        (x(i) - barW / 2).toFixed(1) + '" y="' + Math.min(y0, y1).toFixed(1) + '" width="' +
        barW.toFixed(1) + '" height="' + Math.max(Math.abs(y1 - y0), 1).toFixed(1) + '" rx="3">' +
        '<title>' + P.esc(root.Dates.short(d.date)) + ': ' + (d.value <= 0 ? 'גירעון ' : 'עודף ') + n0(d.value) + '</title></rect>' +
        '<text class="cumul__tick" x="' + x(i).toFixed(1) + '" y="' + (H - B + 14) + '">' + Number(parts[2]) + '</text>' +
        (showMonth ? '<text class="cumul__tick cumul__tick--month" x="' + x(i).toFixed(1) + '" y="' + (H - B + 27) + '">' + ['ינו׳','פבר׳','מרץ','אפר׳','מאי','יוני','יולי','אוג׳','ספט׳','אוק׳','נוב׳','דצמ׳'][Number(parts[1]) - 1] + '</text>' : '');
    }).join('');
    var line = avg.map(function (v, i) {
      return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
    }).join(' ');
    var dots = avg.map(function (v, i) {
      return '<circle class="cumul__dot" cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="' +
        (i === avg.length - 1 ? 4.5 : 2.5) + '"/>';
    }).join('');
    var last = avg[avg.length - 1];
    var endLabel = '<text class="cumul__endlabel" x="' + (x(avg.length - 1) - 8).toFixed(1) + '" y="' + (y(last) + (last < -plan ? 16 : -9)).toFixed(1) + '">' + signed(last) + '</text>';
    return '<svg class="cumul__chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="מאזן יומי וממוצע מצטבר">' +
      grid +
      '<line class="cumul__plan" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(-plan).toFixed(1) + '" y2="' + y(-plan).toFixed(1) + '"/>' +
      bars + '<path class="cumul__avg" d="' + line + '"/>' + dots + endLabel +
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
   * דף ציונים בבלוקים קבועים של 3 ימים (מהיום הראשון של המעקב, כל 3 ימים). כל יום שייך לבלוק אחד בלבד,
   * ולכן אין כפל; פיצוי בתוך הבלוק נספר מעצמו. כל המטרות נבדקות על ממוצע הבלוק.
   */
  function goalsOf(state) {
    var t = state.targets || {};
    var cfg = state.balance || { baseBurn: 2150, kcalPerStep: 0.045, plannedDeficit: 550 };
    var G = [];
    var bin = function (ok) { return ok ? 1 : 0; };
    G.push({ key: 'deficit', label: 'גירעון ממוצע ' + cfg.plannedDeficit + ' לפחות', credit: function (b) { return Math.max(0, Math.min(1, b.def / cfg.plannedDeficit)); } });
    if (typeof t.proteinG === 'number') G.push({ key: 'protein', label: 'חלבון ממוצע ' + t.proteinG + ' לפחות', credit: function (b) { return bin(Math.round(b.protein) >= t.proteinG); } });
    if (typeof t.kcal === 'number') G.push({ key: 'kcal', label: 'קלוריות ממוצע עד ' + root.Fmt.n(t.kcal, 0), credit: function (b) { return bin(Math.round(b.kcal) <= t.kcal); } });
    if (typeof t.stepsGoal === 'number') G.push({ key: 'steps10', label: 'צעדים ממוצע ' + root.Fmt.n(t.stepsGoal, 0) + ' לפחות', credit: function (b) { return bin(Math.round(b.steps) >= t.stepsGoal); } });
    if (typeof t.steps === 'number') G.push({ key: 'steps', label: 'צעדים ממוצע ' + root.Fmt.n(t.steps, 0) + ' לפחות', credit: function (b) { return bin(Math.round(b.steps) >= t.steps); } });
    if (typeof t.fatG === 'number') G.push({ key: 'fat', label: 'שומן ממוצע עד ' + t.fatG, credit: function (b) { return bin(Math.round(b.fat) <= t.fatG); } });
    // מדרג: גירעון 55, חלבון 15, קלוריות 10, 10K 10, השאר 5 (סה״כ 100). אלכוהול לא נספר — הוא כבר בתוך הגירעון.
    var W = { deficit: 55, protein: 15, kcal: 10, steps10: 10, steps: 5, fat: 5 };
    G.forEach(function (g) { g.weight = W[g.key] || 5; });
    return G;
  }

  function isDry(r) {
    return !(r.meals || []).some(function (m) { return (m.items || []).some(function (i) { return i.cat === 'alcohol' && i.kcal > 0; }); });
  }

  function scoresOf(state) {
    var cfg = state.balance || { baseBurn: 2150, kcalPerStep: 0.045, plannedDeficit: 550 };
    var rows = (state.rows || []).filter(function (r) { return typeof r.kcal === 'number' && typeof r.steps === 'number'; });
    var goals = goalsOf(state);
    var byDn = {};
    rows.forEach(function (r) { byDn[dayNum(r.date)] = r; });
    var blocks = [];
    if (rows.length) {
      // גבולות קבועים: הבלוק הראשון מתחיל ביום הראשון של המעקב, וכל 3 ימים משם. לא זזים כשנסגר יום חדש.
      var anchor = dayNum(state.startDate || rows[0].date) + 2, lastDn = dayNum(rows[rows.length - 1].date);
      var endOf = function (dn) { return anchor + Math.ceil((dn - anchor) / 3) * 3; };
      for (var end = endOf(dayNum(rows[0].date)); end <= endOf(lastDn); end += 3) {
        var list = [end - 2, end - 1, end].map(function (dn) { return byDn[dn]; }).filter(Boolean);
        if (!list.length) continue;
        var m = function (f) { return list.reduce(function (a, r) { return a + f(r); }, 0) / list.length; };
        var agg = {
          def: m(function (r) { return cfg.baseBurn + r.steps * cfg.kcalPerStep - r.kcal; }),
          kcal: m(function (r) { return r.kcal; }), protein: m(function (r) { return r.proteinG || 0; }),
          fat: m(function (r) { return r.fatG || 0; }), steps: m(function (r) { return r.steps; }),
          dry: m(function (r) { return isDry(r) ? 1 : 0; })
        };
        var res = {}, cr = {}, pts = 0, max = 0;
        goals.forEach(function (g) { cr[g.key] = g.credit(agg); res[g.key] = cr[g.key] >= 1; pts += g.weight * cr[g.key]; max += g.weight; });
        var hit = goals.filter(function (g) { return res[g.key]; }).length;
        var iso = function (dn) { return new Date(dn * 864e5).toISOString().slice(0, 10); };
        blocks.push({ date: iso(end - 2), to: iso(end), n: list.length, full: list.length === 3, open: end > lastDn,
          agg: agg, res: res, credit: cr, hit: hit, of: goals.length, pts: max ? pts / max * 100 : 0 });
      }
    }
    var scored = blocks.filter(function (b) { return b.full; });
    var stats = goals.map(function (g) {
      var hit = scored.filter(function (d) { return d.res[g.key]; }).length;
      var streak = 0;
      for (var i = scored.length - 1; i >= 0 && scored[i].res[g.key]; i--) streak++;
      var best = 0, run = 0;
      scored.forEach(function (d) { run = d.res[g.key] ? run + 1 : 0; best = Math.max(best, run); });
      var avgPts = scored.length ? scored.reduce(function (a, d) { return a + d.credit[g.key]; }, 0) / scored.length * g.weight : 0;
      return { key: g.key, label: g.label, weight: g.weight, avgPts: avgPts, hit: hit, of: scored.length, pct: scored.length ? Math.round(hit / scored.length * 100) : 0, streak: streak, best: best };
    });
    var total = scored.reduce(function (a, d) { return a + d.pts; }, 0);
    var hits = scored.reduce(function (a, d) { return a + d.hit; }, 0), possible = scored.length * goals.length;
    return { goals: goals, days: blocks, blocks: blocks, stats: stats, score: scored.length ? Math.round(total / scored.length) : 0,
      flat: possible ? Math.round(hits / possible * 100) : 0 };
  }

  function scorecard() {
    var state = read();
    var sc = scoresOf(state);
    if (!sc.days.length) return P.section('ציונים', P.card(null, null, P.empty('עוד אין ימים סגורים.')));
    var nFull = sc.blocks.filter(function (b) { return b.full; }).length;
    var grade = sc.score >= 80 ? 'good' : sc.score >= 60 ? 'warn' : 'bad';
    var head = '<section class="cumul">' +
      '<div class="cumul__row"><h2 class="cumul__title">דף ציונים</h2><span class="cumul__stamp">' + nFull + ' בלוקים של 3 ימים</span></div>' +
      '<div class="score__big score--' + grade + '">' + sc.score + '<small>/100</small></div>' +
      '<div class="cumul__gap">ממוצע הניקוד של הבלוקים. כל בלוק = 3 ימים בגבולות קבועים, מהיום הראשון של המעקב; המטרות נבדקות על ממוצע הבלוק, כך שפיצוי בתוך הבלוק נספר. גירעון 55 (חלקי), חלבון 15, קלוריות 10, 10K 10, השאר 5. אלכוהול לא נספר בנפרד. בלי משקלים: ' + sc.flat + '</div>' +
    '</section>';
    var statRows = sc.stats.map(function (s) {
      var cls = s.pct >= 80 ? 'good' : s.pct >= 50 ? 'warn' : 'bad';
      var pc = s.weight ? s.avgPts / s.weight : 0, pcls = pc >= 0.8 ? 'good' : pc >= 0.5 ? 'warn' : 'bad';
      return '<tr><td>' + P.esc(s.label) + '</td><td class="n score__cell--' + pcls + '"><b>' + root.Fmt.n(s.avgPts, 0) + '/' + s.weight + '</b><small>בממוצע</small></td>' +
        '<td class="n score__cell--' + cls + '"><b>' + s.hit + '/' + s.of + '</b><small>' + s.pct + '%</small></td>' +
        '<td class="n">' + s.streak + '</td><td class="n">' + s.best + '</td>' +
        '<td><div class="score__bar"><i class="score--' + cls + '" style="width:' + s.pct + '%"></i></div></td></tr>';
    });
    var statCard = P.card('לפי מטרה', 'נקודות בממוצע לבלוק (כולל ניקוד חלקי), ובכמה בלוקים עמדת ביעד במלואו',
      P.table(['מטרה', 'נקודות', 'בלוקים מלאים', 'רצף נוכחי', 'רצף שיא', ''], statRows));
    var dayRows = sc.blocks.slice().reverse().map(function (d) {
      var label = P.esc(root.Dates.short(d.date)) + (d.to !== d.date ? '–' + P.esc(root.Dates.short(d.to)) : '');
      return '<tr' + (d.full ? '' : ' style="opacity:.55"') + '><td class="n"><bdi dir="ltr" style="white-space:nowrap">' + label + '</bdi>' +
        '<small>' + (d.agg.def < 0 ? 'עודף ' : 'גירעון ') + root.Fmt.n(Math.abs(d.agg.def), 0) + (d.full ? '' : d.open ? ' · בתהליך (' + d.n + '/3), עוד לא נספר' : ' · חלקי, לא נספר') + '</small></td>' +
        '<td class="n"><b>' + Math.round(d.pts) + '</b></td>' +
        sc.goals.map(function (g) {
          var c = d.credit[g.key], pts = Math.round(c * g.weight);
          var cls = c >= 1 ? 'ok' : c > 0 ? 'part' : 'no';
          return '<td class="score__mark score__mark--' + cls + '">' + (c >= 1 ? '✓' : c > 0 ? pts + '/' + g.weight : '✗') + '</td>';
        }).join('') + '</tr>';
    });
    var short = { kcal: 'קל׳', deficit: 'גירעון 550+', protein: 'חלבון', fat: 'שומן', steps: '6.7K', steps10: '10K', dry: 'בלי אלכ׳' };
    var dayCard = P.card('לפי בלוק', 'ציון = נקודות מ-100 · ✓ נקודות מלאות · 30/55 ניקוד חלקי · ✗ אפס',
      P.table(['ימים', 'ציון'].concat(sc.goals.map(function (g) { return (short[g.key] || g.label) + ' (' + g.weight + ')'; })), dayRows));
    return P.section('ציונים', head + statCard + dayCard +
      P.hint('רק ימים סגורים (עם צעדים). הבלוקים קבועים ולא זזים; בלוק נספר רק כשכל 3 הימים בו סגורים. גירעון לפי החשבון הנוכחי: ' + root.Fmt.n(cfg0(state).baseBurn, 0) + ' + צעדים × ' + cfg0(state).kcalPerStep + '.'));
  }

  /**
   * גיליון פיצויים: לכל אורך חלון (3–7 ימים, בגבולות קבועים מהיום הראשון של המעקב),
   * החלון הפתוח הנוכחי — כמה גירעון נצבר, כמה חסר מול התוכנית, ומה צריך בכל יום שנשאר.
   */

  function compSheetOf(state, todayIso, lens) {
    var cfg = cfg0(state); // בפועל: לפי המודל הרגיל, כמו בשאר האתר
    var rows = (state.rows || []).filter(function (r) { return typeof r.kcal === 'number' && typeof r.steps === 'number'; });
    if (!rows.length) return [];
    var by = {};
    rows.forEach(function (r) { by[dayNum(r.date)] = r; });
    var s0 = dayNum(state.startDate || rows[0].date), today = dayNum(todayIso);
    var iso = function (dn) { return new Date(dn * 864e5).toISOString().slice(0, 10); };
    // הקלוריות המותרות מחושבות לפי המינימום הנדרש (6,700), לא לפי 10,000
    var stepsRef = (state.targets && state.targets.steps) || 6700;
    var stepsGoal = (state.targets && state.targets.stepsGoal) || 10000;
    return (lens || [3, 4, 5, 6, 7]).map(function (N) {
      var a = s0 + Math.floor((today - s0) / N) * N, b = a + N - 1, sum = 0, n = 0, kc = 0, fat = 0, st = 0;
      for (var x = a; x <= b; x++) if (by[x]) { sum += cfg.baseBurn + by[x].steps * cfg.kcalPerStep - by[x].kcal; kc += by[x].kcal; fat += by[x].fatG || 0; st += by[x].steps; n++; }
      var rem = N - n, goal = cfg.plannedDeficit * N, need = goal - sum;
      var per = rem ? need / rem : null;
      var t = state.targets || {};
      var left = function (cap, used) { return rem && typeof cap === 'number' ? (cap * N - used) / rem : null; };
      return { n: N, from: iso(a), to: iso(b), closed: n, left: rem, sum: sum, behind: cfg.plannedDeficit * n - sum,
        needPerDay: per, kcalAt: per === null ? null : cfg.baseBurn + stepsRef * cfg.kcalPerStep - per, /* קדימה: אותו מודל, במינימום צעדים */ stepsRef: stepsRef,
        kcalCap: left(t.kcal, kc), fatCap: left(t.fatG, fat), stepsNeed: left(stepsGoal, st), kps: cfg.kcalPerStep, stepsGoal: stepsGoal,
        now: n ? { def: sum / n, kcal: kc / n, fat: fat / n, steps: st / n } : null,
        // כמה לאכול היום כדי שמחר ממוצע הקלוריות בחלון יהיה ירוק (עד היעד)
        greenToday: typeof t.kcal === 'number' && rem > 0 ? t.kcal * (n + 1) - kc : null,
        greenFat: typeof t.fatG === 'number' && rem > 0 ? t.fatG * (n + 1) - fat : null,
        greenSteps: rem > 0 ? stepsGoal * (n + 1) - st : null,
        // קלוריות מול התקציב (1,900 ליום) בימים הסגורים: פלוס = עודף
        kcalOver: typeof t.kcal === 'number' ? kc - t.kcal * n : null };
    });
  }

  /** היסטוריית חלונות באורך N, בגבולות הקבועים: ממוצעים ומה עמד ביעד */
  function compHistoryOf(state, N) {
    var cfg = cfg0(state), t = state.targets || {};
    var rows = (state.rows || []).filter(function (r) { return typeof r.kcal === 'number' && typeof r.steps === 'number'; });
    if (!rows.length) return [];
    var by = {};
    rows.forEach(function (r) { by[dayNum(r.date)] = r; });
    var s0 = dayNum(state.startDate || rows[0].date), last = dayNum(rows[rows.length - 1].date);
    var iso = function (dn) { return new Date(dn * 864e5).toISOString().slice(0, 10); };
    var out = [];
    for (var a = s0; a <= last; a += N) {
      var list = [];
      for (var x = a; x < a + N; x++) if (by[x]) list.push(by[x]);
      if (!list.length) continue;
      var m = function (f) { return list.reduce(function (acc, r) { return acc + f(r); }, 0) / list.length; };
      var w = { from: iso(a), to: iso(a + N - 1), closed: list.length, full: list.length === N,
        def: m(function (r) { return cfg.baseBurn + r.steps * cfg.kcalPerStep - r.kcal; }),
        kcal: m(function (r) { return r.kcal; }), fat: m(function (r) { return r.fatG || 0; }), steps: m(function (r) { return r.steps; }) };
      w.ok = { def: w.def >= cfg.plannedDeficit, kcal: typeof t.kcal !== 'number' || Math.round(w.kcal) <= t.kcal,
        fat: typeof t.fatG !== 'number' || Math.round(w.fat) <= t.fatG, steps: Math.round(w.steps) >= (t.stepsGoal || 10000) };
      w.hits = ['def', 'kcal', 'fat', 'steps'].filter(function (k) { return w.ok[k]; }).length;
      out.push(w);
    }
    return out;
  }

  function compHistory(state) {
    var n0 = function (v) { return (v < 0 ? '−' : '') + root.Fmt.n(Math.abs(v), 0); };
    var c = function (ok, txt) { return '<td class="n score__mark--' + (ok ? 'ok' : 'no') + '">' + txt + '</td>'; };
    var body = [3, 4, 5, 6, 7].map(function (N) {
      var list = compHistoryOf(state, N);
      if (!list.length) return '';
      var full = list.filter(function (w) { return w.full; });
      var good = full.filter(function (w) { return w.ok.def; }).length;
      var rows = list.slice().reverse().map(function (w) {
        var range = '<bdi dir="ltr" style="white-space:nowrap">' + P.esc(root.Dates.short(w.from)) + '–' + P.esc(root.Dates.short(w.to)) + '</bdi>';
        return '<tr' + (w.full ? '' : ' style="opacity:.6"') + '><td class="n">' + range + '<small>' + (w.full ? w.hits + '/4 יעדים' : 'פתוח · ' + w.closed + '/' + N) + '</small></td>' +
          c(w.ok.def, w.def < 0 ? 'עודף ' + root.Fmt.n(-w.def, 0) : n0(w.def)) + c(w.ok.kcal, n0(w.kcal)) + c(w.ok.fat, n0(w.fat)) + c(w.ok.steps, n0(w.steps)) + '</tr>';
      }).join('');
      return '<details class="comph"' + (N === 3 ? ' open' : '') + '><summary><b>' + N + ' ימים</b> · ' + good + '/' + full.length + ' חלונות סגורים בגירעון ' + cfg0(state).plannedDeficit + '+</summary>' +
        P.table(['חלון', 'גירעון ממוצע', 'קק״ל ממוצע', 'שומן ממוצע', 'צעדים ממוצע'], [rows]) + '</details>';
    }).join('');
    return body ? P.card('היסטוריית חלונות', 'כל החלונות מאז ההתחלה, בגבולות הקבועים. ירוק = עמד ביעד (גירעון ' + cfg0(state).plannedDeficit + '+, עד ' + root.Fmt.n((state.targets || {}).kcal || 1900, 0) + ' קק״ל, שומן עד ' + ((state.targets || {}).fatG || 65) + ', ' + root.Fmt.n((state.targets || {}).stepsGoal || 10000, 0) + ' צעדים).', body) : '';
  }

  function compSheet(state, asOfIso, sim) {
    var list = compSheetOf(state, asOfIso || root.Dates.today());
    if (!list.length) return '';
    var n0 = function (v) { return root.Fmt.n(Math.abs(v), 0); };
    var plan = cfg0(state).plannedDeficit, cap = (state.targets || {}).kcal || 1900;
    var chip = function (label, v, ok, signed) {
      var txt = signed && v < 0 ? 'עודף ' + n0(v) : n0(v);
      return '<span class="comp__chip comp__chip--' + (ok ? 'ok' : 'no') + '">' + label + ' <b>' + txt + '</b></span>';
    };
    // צבע לפי היעד: פחות מ-1,900 ביום = צריך להדק (אדום), 1,900 ומעלה = מרווח (ירוק)
    var kc = function (v) { return '<b class="score__mark--' + (v < cap ? 'no' : 'ok') + '">' + n0(Math.max(0, v)) + '</b>'; };
    var kcalOf = function (w) { return w.kcalAt === null ? null : Math.min(w.kcalAt, w.kcalCap === null ? Infinity : w.kcalCap); };
    var open = list.filter(function (w) { return w.left > 0; });
    var tight = open.slice().sort(function (x, y) { return kcalOf(x) - kcalOf(y); })[0];
    var capFat = open.length ? Math.min.apply(null, open.map(function (w) { return w.fatCap === null ? Infinity : w.fatCap; })) : null;
    var needSteps = open.length ? Math.max.apply(null, open.map(function (w) { return w.stepsNeed === null ? 0 : w.stepsNeed; })) : null;
    var gl = open.filter(function (w) { return w.closed && w.greenToday !== null; }); // חלון שמתחיל היום לא נספר: מחר יהיה בו רק יום אחד
    var green = gl.length ? Math.min.apply(null, gl.map(function (w) { return w.greenToday; })) : null;
    var greenFat = gl.length ? Math.min.apply(null, gl.map(function (w) { return w.greenFat === null ? Infinity : w.greenFat; })) : null;
    var greenSteps = gl.length ? Math.max.apply(null, gl.map(function (w) { return w.greenSteps === null ? 0 : w.greenSteps; })) : null;
    var top = tight ? '<div class="comp__top">' + (sim ? 'אחרי הסימולציה, מ-' + P.esc(root.Dates.short(new Date((dayNum(sim) + 1) * 864e5).toISOString().slice(0, 10))) + ', בכל יום: ' : 'לסגירת כל החלונות, בכל יום מהיום: ') + '<b>עד ' + kc(kcalOf(tight)) + ' קק״ל · שומן עד ' + n0(capFat) + ' · לפחות ' + n0(needSteps) + ' צעדים</b>' +
      '<small>אם תעמוד בזה בכל יום עד סוף החלון המחמיר, כל החלונות ייסגרו על היעדים. החלון המחמיר: ' + tight.n + ' ימים (<bdi dir="ltr">' + P.esc(root.Dates.short(tight.from)) + '–' + P.esc(root.Dates.short(tight.to)) + '</bdi>).</small>' +
      (green !== null && !sim ? '<div style="margin-top:8px">כדי שמחר בבוקר הכל יהיה ירוק, רק היום: <b>עד ' + kc(green) + ' קק״ל</b> · <b>שומן עד ' + n0(Math.max(0, greenFat)) + ' ג׳</b> · <b>לפחות ' + n0(Math.max(0, greenSteps)) + ' צעדים</b></div>' : '') + '</div>' : '';
    var items = list.map(function (w) {
      var range = '<bdi dir="ltr" style="white-space:nowrap">' + P.esc(root.Dates.short(w.from)) + '–' + P.esc(root.Dates.short(w.to)) + '</bdi>';
      var bal = -w.behind, kcal = kcalOf(w);
      var nowChips = function (lbl) {
        return '<div class="comp__now"><span>' + lbl + '</span>' +
          chip('גירעון', w.now.def, w.now.def >= plan, true) + chip('קק״ל', w.now.kcal, Math.round(w.now.kcal) <= cap) +
          chip('שומן', w.now.fat, Math.round(w.now.fat) <= ((state.targets || {}).fatG || 65)) + chip('צעדים', w.now.steps, Math.round(w.now.steps) >= w.stepsGoal) + '</div>';
      };
      if (!w.left) {
        var okAll = w.now.def >= plan && Math.round(w.now.kcal) <= cap;
        return '<div class="comp__w"><div class="comp__h"><b>' + w.n + ' ימים</b> · ' + range + ' · <b class="score__mark--' + (okAll ? 'ok' : 'no') + '">נסגר ' + (okAll ? 'ביעד' : 'מחוץ ליעד') + '</b></div>' +
          nowChips('ממוצע סופי:') + '<div class="comp__t">' + (bal >= 0 ? 'נסגר לפני התוכנית ב-' + n0(bal) + '.' : 'נסגר עם חוב של ' + n0(bal) + ' מול התוכנית.') + '</div></div>';
      }
      var balTxt = !w.closed ? 'החלון מתחיל היום, אין עדיין יתרה.'
        : bal >= 0 ? 'בימים שעברו עשית <b class="score__mark--ok">' + n0(bal) + '</b> גירעון יותר מהתוכנית.'
        : 'בימים שעברו חסרו <b class="score__mark--no">' + n0(bal) + '</b> גירעון מול התוכנית.';
      var why = w.kcalCap !== null && w.kcalCap <= w.kcalAt
        ? 'המגבלה: שממוצע הקלוריות בחלון יישאר עד ' + n0(cap) + '.'
        : 'המגבלה: שהגירעון הממוצע בחלון יישאר ' + n0(plan) + ' (מספיק גירעון של ' + n0(Math.max(0, w.needPerDay)) + ' ביום, בהנחה של ' + n0(w.stepsRef) + ' צעדים).';
      return '<div class="comp__w"><div class="comp__h"><b>' + w.n + ' ימים</b> · ' + range + ' · נשארו ' + w.left + ' ' + (w.left === 1 ? 'יום' : 'ימים') + '</div>' +
        (w.now ? nowChips((sim ? 'כולל הסימולציה' : 'עד עכשיו') + ' (' + w.closed + ' ' + (w.closed === 1 ? 'יום' : 'ימים') + ', ממוצע):') : '') +
        (w.closed ? '<div class="comp__now"><span>סה״כ עד עכשיו:</span>' +
          '<span class="comp__chip comp__chip--' + (w.kcalOver > 0 ? 'no' : 'ok') + '">קק״ל מול ' + n0(cap) + ' ליום: <b>' + (w.kcalOver > 0 ? 'עודף ' : 'חוסר ') + n0(w.kcalOver) + '</b></span>' +
          '<span class="comp__chip comp__chip--' + (bal >= 0 ? 'ok' : 'no') + '">גירעון מול ' + n0(plan) + ' ליום: <b>' + (bal >= 0 ? 'יתרה ' : 'חוב ') + n0(bal) + '</b></span></div>' : '') +
        '<div class="comp__t" style="margin-top:6px"><b>לסגירת החלון, בכל יום שנשאר (' + w.left + '):</b></div>' +
        '<div class="comp__big">עד ' + kc(kcal) + ' קק״ל · שומן עד <b>' + n0(w.fatCap) + '</b> · לפחות <b>' + n0(w.stepsNeed) + '</b> צעדים</div>' +
        (w.greenToday !== null && w.closed && w.left > 1 && !sim ? '<div class="comp__t" style="margin-top:6px"><b>כדי שמחר בבוקר יהיה ירוק, רק היום:</b></div>' +
          '<div class="comp__mid">עד ' + kc(w.greenToday) + ' קק״ל · שומן עד <b>' + n0(Math.max(0, w.greenFat)) + '</b> · לפחות <b>' + n0(Math.max(0, w.greenSteps)) + '</b> צעדים</div>' : '') +
        '<div class="comp__t" style="margin-top:6px">' + balTxt + ' ' + why + '</div></div>';
    }).join('');
    return P.card('גיליון פיצויים', 'לכל אורך חלון (3–7 ימים, בגבולות קבועים מ-' + P.esc(root.Dates.short(state.startDate || list[0].from)) + '): כמה מותר לאכול בכל יום שנשאר כדי שהחלון ייסגר על היעדים.',
      top + items +
      P.hint('לפי המודל (' + root.Fmt.n(cfg0(state).baseBurn, 0) + ' + צעדים × ' + cfg0(state).kcalPerStep + '). בימים שנשארו מניחים רק ' + root.Fmt.n(list[0].stepsRef, 0) + ' צעדים (המינימום); כל צעד מעבר לזה הוא בונוס. חלבון לא נכנס: הוא יעד יומי.'));
  }

  /** טאב שעות צעדים: לכל יום רצועה של 48 חצאי שעה, וממוצע לפי שעה בכל הימים */
  function stepsTab() {
    var state = read();
    var days = (state.rows || []).filter(function (r) { return r.stepsByHalfHour && typeof r.steps === 'number'; })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    if (!days.length) return P.section('שעות צעדים', P.card(null, null, P.empty('עוד אין פירוט שעות. שלח צילום של "צעדים לפי השעה ביום" מהשעון.')));
    var n0 = function (v) { return root.Fmt.n(v, 0); };
    var slots = []; for (var i = 0; i < 48; i++) slots.push(('0' + Math.floor(i / 2)).slice(-2) + ':' + (i % 2 ? '30' : '00'));
    var bars = function (vals, max, h) {
      return '<div class="stp__bars" style="height:' + h + 'px">' + vals.map(function (v, i) {
        var pct = max ? Math.max(v > 0 ? 3 : 0, v / max * 100) : 0;
        return '<i title="' + slots[i] + ' · ' + n0(v) + '" style="height:' + pct + '%"></i>';
      }).join('') + '</div><div class="stp__axis"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>';
    };
    var parts = function (vals) {
      var sum = function (a, b) { return vals.slice(a * 2, b * 2).reduce(function (x, y) { return x + y; }, 0); };
      return [['בוקר', sum(5, 12)], ['צהריים', sum(12, 18)], ['ערב', sum(18, 24)], ['לילה', sum(0, 5)]];
    };
    // ממוצע לפי שעה
    var avg = slots.map(function (sl) { return days.reduce(function (a, r) { return a + (r.stepsByHalfHour[sl] || 0); }, 0) / days.length; });
    var avgMax = Math.max.apply(null, avg);
    var tot = avg.reduce(function (a, b) { return a + b; }, 0);
    var avgParts = parts(avg).map(function (p) { return '<span class="comp__chip">' + p[0] + ': <b>' + Math.round(p[1] / (tot || 1) * 100) + '%</b></span>'; }).join('');
    var avgCard = P.card('ממוצע לפי שעה', days.length + ' ימים עם פירוט. כל עמודה = חצי שעה.',
      bars(avg, avgMax, 120) + '<div class="comp__now">' + avgParts + '</div>');
    var dayCards = days.map(function (r) {
      var vals = slots.map(function (sl) { return r.stepsByHalfHour[sl] || 0; });
      var max = Math.max.apply(null, vals), peak = slots[vals.indexOf(max)];
      var ps = parts(vals).map(function (p) { return '<span class="comp__chip">' + p[0] + ': <b>' + n0(p[1]) + '</b></span>'; }).join('');
      return '<div class="comp__w"><div class="comp__h"><b>' + P.esc(root.Dates.short(r.date)) + '</b> · ' + n0(r.steps) + ' צעדים · שיא ' + peak + ' (' + n0(max) + ')</div>' +
        bars(vals, max, 70) + '<div class="comp__now">' + ps + '</div>' +
        (r.stepsByHalfHourNote ? '<div class="comp__t" style="opacity:.6">' + P.esc(r.stepsByHalfHourNote) + '</div>' : '') + '</div>';
    }).join('');
    return P.section('שעות צעדים', avgCard + P.card('לפי יום', 'החדש למעלה.', dayCards) +
      P.hint('בוקר = 5:00–12:00, צהריים = 12:00–18:00, ערב = 18:00–24:00, לילה = 0:00–5:00.'));
  }

  /**
   * תקציב נסיעה: הספייר = כל הגירעון שנצבר מתחילת המעקב ועד היום שלפני הנסיעה (מול break even).
   * כל יום בנסיעה גורע ממנו, בשלושה תרחישים: מינימום / אמצע / מקסימום (לפי טווחי הארוחות).
   */
  function tripOf(state, trip) {
    var cfg = cfg0(state);
    var rows = (state.rows || []).filter(function (r) { return typeof r.kcal === 'number' && typeof r.steps === 'number'; });
    var burn = function (r) { return cfg.baseBurn + r.steps * cfg.kcalPerStep; };
    var before = rows.filter(function (r) { return r.date < trip.from && (!state.startDate || r.date >= state.startDate); });
    var spare = before.reduce(function (a, r) { return a + burn(r) - r.kcal; }, 0);
    var planBal = before.reduce(function (a, r) { return a + burn(r) - r.kcal - cfg.plannedDeficit; }, 0);
    var all = state.rows || [];
    var days = [], d = dayNum(trip.from), end = dayNum(trip.to);
    var iso = function (dn) { return new Date(dn * 864e5).toISOString().slice(0, 10); };
    var left = { lo: spare, mid: spare, hi: spare };
    var leftPlan = { lo: planBal, mid: planBal, hi: planBal };
    for (; d <= end; d++) {
      var date = iso(d), r = all.filter(function (x) { return x.date === date; })[0];
      var closed = r && typeof r.kcal === 'number' && typeof r.steps === 'number';
      var meals = (r && r.meals) || [];
      var lo = closed ? meals.reduce(function (a, m) { return a + (typeof m.kcalLow === 'number' ? m.kcalLow : m.kcal * 0.85); }, 0) : null;
      var hi = closed ? meals.reduce(function (a, m) { return a + (typeof m.kcalHigh === 'number' ? m.kcalHigh : m.kcal * 1.15); }, 0) : null;
      var day = { date: date, closed: closed, steps: closed ? r.steps : null, burn: closed ? burn(r) : null,
        kcal: closed ? { lo: lo, mid: r.kcal, hi: hi } : null,
        budgetUse: trip.budgetKcal - (cfg.baseBurn + (trip.stepsAssumed || 10000) * cfg.kcalPerStep) };
      if (closed) {
        // שימוש בספייר = עודף מעל השריפה (מינימום קלוריות = שימוש מינימלי)
        day.use = { lo: lo - day.burn, mid: r.kcal - day.burn, hi: hi - day.burn };
        left = { lo: left.lo - day.use.lo, mid: left.mid - day.use.mid, hi: left.hi - day.use.hi };
        var p = cfg.plannedDeficit;
        leftPlan = { lo: leftPlan.lo - day.use.lo - p, mid: leftPlan.mid - day.use.mid - p, hi: leftPlan.hi - day.use.hi - p };
      }
      day.left = { lo: left.lo, mid: left.mid, hi: left.hi };
      day.leftPlan = { lo: leftPlan.lo, mid: leftPlan.mid, hi: leftPlan.hi };
      days.push(day);
    }
    var budgetTotal = days.reduce(function (a, x) { return a + x.budgetUse; }, 0);
    return { trip: trip, spare: spare, planBal: planBal, days: days, budgetTotal: budgetTotal, left: left, leftPlan: leftPlan,
      budgetPlanTotal: budgetTotal + cfg.plannedDeficit * days.length };
  }

  /** גרפים לטאב הנסיעה: משפט מצב, פס ספייר, אכלת מול שריפה לכל יום, ומאזן מול התוכנית לאורך זמן. */
  function tripCharts(state, T, n0, sd, used, budgetSoFar, closedN) {
    var cfg = cfg0(state), trip = T.trip;
    var stepsA = trip.stepsAssumed || 10000;
    var openDays = T.days.filter(function (x) { return !x.closed; }).length;
    var esc = P.esc;

    // 1. משפט מצב
    var lines = [];
    if (closedN) {
      lines.push('ב-' + closedN + ' ' + (closedN === 1 ? 'יום' : 'ימים') + ' נגרעו מהספייר <b>' + n0(used.mid) + '</b> <small>(בין ' + n0(used.lo) + ' ל-' + n0(used.hi) + ')</small> · ~' + (used.mid / 7700).toFixed(2) + ' ק״ג.');
      lines.push('נשאר בספייר <b>' + n0(T.left.mid) + '</b> (~' + (T.left.mid / 7700).toFixed(2) + ' ק״ג). מול התוכנית: <b class="score__mark--' + (T.leftPlan.mid >= 0 ? 'ok' : 'no') + '">' + (T.leftPlan.mid >= 0 ? 'לפני ב-' : 'מאחור ב-') + n0(Math.abs(T.leftPlan.mid)) + '</b> (ביציאה: ' + (T.planBal >= 0 ? 'לפני ב-' : 'מאחור ב-') + n0(Math.abs(T.planBal)) + ').');
    }
    if (openDays) lines.push('שריפה ב-' + n0(stepsA) + ' צעדים: ~' + n0(cfg.baseBurn + stepsA * cfg.kcalPerStep) + ' (כל 1,000 צעדים = עוד ' + n0(1000 * cfg.kcalPerStep) + '). כל 1,000 קק״ל מעל השריפה = ~0.13 ק״ג מהספייר.');
    var summary = '<div class="trip__sum">' + lines.map(function (l) { return '<div>' + l + '</div>'; }).join('') + '</div>';

    // 2. פס ספייר
    var S = Math.max(T.spare, 1);
    var usedW = Math.max(0, Math.min(used.mid, S)) / S * 100;

    var bar = '<div class="trip__bar-l"><span>ספייר ביציאה: ' + n0(T.spare) + '</span></div>' +
      '<div class="trip__bar"><i class="trip__b-used" style="width:' + usedW.toFixed(1) + '%"></i></div>' +
      '<div class="kpi__legend"><span><i class="kpi__k trip__k-used"></i>נוצל ' + n0(used.mid) + '</span>' +
      '<span><i class="kpi__k trip__k-left"></i>נשאר ' + n0(T.left.mid) + '</span></div>';

    // 3. אכלת מול שריפה ותקציב לכל יום
    var W = 340, H = 190, L = 40, R = 8, Tp = 14, B = 26;
    var maxV = 0;
    T.days.forEach(function (x) { maxV = Math.max(maxV, x.closed ? Math.max(x.kcal.hi, x.burn) : 0); });
    maxV = Math.ceil(maxV / 1000) * 1000 || 5000;
    var y = function (v) { return Tp + (1 - v / maxV) * (H - Tp - B); };
    var n = T.days.length, slot = (W - L - R) / n;
    var grid = '';
    for (var g = 0; g <= maxV; g += 1000) grid += '<line class="kpi__grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g).toFixed(1) + '" y2="' + y(g).toFixed(1) + '"/><text class="kpi__tick" x="' + (L - 4) + '" y="' + (y(g) + 3).toFixed(1) + '" text-anchor="end">' + (g / 1000) + 'k</text>';
    var bars = T.days.map(function (x, i) {
      var cx = L + slot * (i + 0.5), bw = Math.min(46, slot * 0.45);
      var s = '<text class="kpi__tick" x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(root.Dates.short(x.date)) + '</text>';
      if (!x.closed) return s + '<text class="kpi__tick" x="' + cx.toFixed(1) + '" y="' + y(maxV / 2).toFixed(1) + '" text-anchor="middle">עוד לא</text>';
      var cls = x.kcal.mid <= x.burn ? 'trip__eat-ok' : 'trip__eat-no';
      s += '<rect class="' + cls + '" x="' + (cx - bw / 2).toFixed(1) + '" y="' + y(x.kcal.mid).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (y(0) - y(x.kcal.mid)).toFixed(1) + '" rx="3"><title>אכלת ' + n0(x.kcal.mid) + '</title></rect>';
      s += '<line class="trip__whisk" x1="' + cx.toFixed(1) + '" x2="' + cx.toFixed(1) + '" y1="' + y(x.kcal.hi).toFixed(1) + '" y2="' + y(x.kcal.lo).toFixed(1) + '"/>';
      s += '<line class="trip__burn" x1="' + (cx - bw / 2 - 6).toFixed(1) + '" x2="' + (cx + bw / 2 + 6).toFixed(1) + '" y1="' + y(x.burn).toFixed(1) + '" y2="' + y(x.burn).toFixed(1) + '"><title>שריפה ' + n0(x.burn) + '</title></line>';
      s += '<text class="trip__val" x="' + cx.toFixed(1) + '" y="' + (y(x.kcal.hi) - 4).toFixed(1) + '" text-anchor="middle">' + n0(x.kcal.mid) + '</text>';
      return s;
    }).join('');
    var dayChart = '<svg class="trip__svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="אכלת מול שריפה">' + grid + bars + '</svg>' +
      '<div class="kpi__legend"><span><i class="kpi__k trip__k-eat"></i>אכלת (קו דק = מינימום–מקסימום)</span><span><i class="kpi__k trip__k-burn"></i>שריפה לפי צעדים</span></div>' +
      '<small>הפער בין העמודה לקו השריפה = מה שנגרע מהספייר באותו יום.</small>';

    // 4. מאזן מול התוכנית לאורך זמן (מתחילת המעקב)
    var rows = (state.rows || []).filter(function (r) { return typeof r.kcal === 'number' && typeof r.steps === 'number' && (!state.startDate || r.date >= state.startDate); })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var acc = 0, pts = rows.map(function (r) { acc += cfg.baseBurn + r.steps * cfg.kcalPerStep - r.kcal - cfg.plannedDeficit; return { date: r.date, v: acc }; });
    var balChart = '';
    if (pts.length) {
      var d0 = dayNum(pts[0].date), d1 = dayNum(trip.to);
      var all = pts.map(function (p) { return p.v; }).concat([0]);
      var mn = Math.min.apply(null, all), mx = Math.max.apply(null, all);
      var pad = (mx - mn) * 0.1 || 500; mn -= pad; mx += pad;
      var H2 = 180, x2 = function (ds) { return L + (dayNum(ds) - d0) / Math.max(1, d1 - d0) * (W - L - R); };
      var y2 = function (v) { return Tp + (mx - v) / (mx - mn) * (H2 - Tp - B); };
      var path = function (arr) { return arr.map(function (p, i) { return (i ? 'L' : 'M') + x2(p.date).toFixed(1) + ' ' + y2(p.v).toFixed(1); }).join(' '); };
      var step = Math.pow(10, Math.floor(Math.log10(Math.max(1, (mx - mn) / 4))));
      if ((mx - mn) / step > 8) step *= 2;
      var g2 = '';
      for (var gv = Math.ceil(mn / step) * step; gv <= mx; gv += step) g2 += '<line class="kpi__grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y2(gv).toFixed(1) + '" y2="' + y2(gv).toFixed(1) + '"/><text class="kpi__tick" x="' + (L - 4) + '" y="' + (y2(gv) + 3).toFixed(1) + '" text-anchor="end">' + (Math.abs(gv) >= 1000 ? (gv / 1000).toFixed(gv % 1000 ? 1 : 0) + 'k' : gv) + '</text>';
      var shade = '<rect class="kpi__trip" x="' + (x2(trip.from) - 4).toFixed(1) + '" y="' + Tp + '" width="' + (x2(trip.to) - x2(trip.from) + 8).toFixed(1) + '" height="' + (H2 - Tp - B) + '"/>';
      var zero = '<line class="trip__zero" x1="' + L + '" x2="' + (W - R) + '" y1="' + y2(0).toFixed(1) + '" y2="' + y2(0).toFixed(1) + '"/>';
      var last = pts[pts.length - 1];
      var dots = pts.map(function (p) { return '<circle class="' + (p.v >= 0 ? 'trip__dot-ok' : 'trip__dot-no') + '" cx="' + x2(p.date).toFixed(1) + '" cy="' + y2(p.v).toFixed(1) + '" r="2.6"><title>' + esc(root.Dates.short(p.date)) + ': ' + n0(p.v) + '</title></circle>'; }).join('');
      var txs = [pts[0].date, trip.from, trip.to].filter(function (ds, i, a) { return i === 0 || x2(ds) - x2(a[i - 1]) > 34; });
      var tx = txs.map(function (ds) { return '<text class="kpi__tick" x="' + x2(ds).toFixed(1) + '" y="' + (H2 - 8) + '" text-anchor="middle">' + esc(root.Dates.short(ds)) + '</text>'; }).join('');
      balChart = '<svg class="trip__svg" viewBox="0 0 ' + W + ' ' + H2 + '" role="img" aria-label="מאזן מול התוכנית">' + g2 + shade + zero +
        '<path class="trip__act" d="' + path(pts) + '"/>' + dots +
        '<text class="trip__val" x="' + x2(last.date).toFixed(1) + '" y="' + (y2(last.v) - 7).toFixed(1) + '" text-anchor="middle">' + n0(last.v) + '</text>' + tx + '</svg>' +
        '<div class="kpi__legend"><span><i class="kpi__k trip__k-act"></i>בפועל</span><span><i class="kpi__k kpi__k--trip"></i>חו״ל</span></div>' +
        '<small>מעל 0 = לפני התוכנית (גירעון ' + n0(cfg.plannedDeficit) + ' ליום), מתחת ל-0 = מאחוריה.</small>';
    }

    return P.card('מה המצב', null, summary) +
      P.card('הספייר', 'כמה מהגירעון שצברת לפני הנסיעה כבר נוצל', bar) +
      P.card('כל יום: אכלת מול שריפה', null, dayChart) +
      (balChart ? P.card('מול התוכנית לאורך זמן', 'גירעון מצטבר פחות ' + n0(cfg.plannedDeficit) + ' ליום', balChart) : '');
  }

  /**
   * סגירת פיגור: הפיגור מול התוכנית ביום debtUntil (גירעון מצטבר פחות 550 ליום), ומשם כל יום סגור
   * מקטין אותו בגירעון שמעבר ל-550. היום הפתוח מוצג חי (ארוחות עד עכשיו).
   */
  function catchupOf(state, cu, todayIso) {
    var cfg = cfg0(state), p = cfg.plannedDeficit;
    var burnOf = function (steps) { return cfg.baseBurn + steps * cfg.kcalPerStep; };
    var rows = (state.rows || []).filter(function (r) { return typeof r.kcal === 'number' && typeof r.steps === 'number' && (!state.startDate || r.date >= state.startDate); });
    var debt = -rows.filter(function (r) { return r.date <= cu.debtUntil; }).reduce(function (a, r) { return a + burnOf(r.steps) - r.kcal - p; }, 0);
    var days = [], remaining = debt;
    rows.filter(function (r) { return r.date >= cu.from; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (r) {
      var burn = burnOf(r.steps), def = burn - r.kcal, extra = def - p;
      remaining -= extra;
      days.push({ date: r.date, kcal: r.kcal, steps: r.steps, burn: burn, def: def, extra: extra, remaining: remaining, protein: r.proteinG });
    });
    var openRow = (state.rows || []).filter(function (r) { return r.date === todayIso && typeof r.kcal !== 'number'; })[0];
    var live = null;
    if (openRow && todayIso >= cu.from) {
      var eaten = (openRow.meals || []).reduce(function (a, m) { return a + (m.kcal || 0); }, 0);
      var prot = (openRow.meals || []).reduce(function (a, m) { return a + (m.proteinG || 0); }, 0);
      live = { date: todayIso, eaten: eaten, protein: prot, steps: typeof openRow.steps === 'number' ? openRow.steps : null };
    }
    var targetExtra = burnOf(cu.targetSteps) - cu.targetKcal - p;
    var closedExtra = days.reduce(function (a, x) { return a + x.extra; }, 0);
    var avgExtra = days.length ? closedExtra / days.length : null;
    return { cu: cu, debt: debt, days: days, remaining: remaining, closed: closedExtra, live: live,
      targetExtra: targetExtra, avgExtra: avgExtra, targetBurn: burnOf(cu.targetSteps) };
  }

  function catchupTab() {
    var body = catchupCards();
    return P.section('סגירת פיגור', body || P.card(null, null, P.empty('לא הוגדר פיגור לסגירה.')));
  }

  /** כרטיסי סגירת הפיגור (מוצגים בראש טאב הנסיעה). */
  function catchupCards() {
    var state = read(), cu = state.catchup;
    if (!cu) return '';
    var cfg = cfg0(state), today = root.Dates.today();
    var C = catchupOf(state, cu, today);
    var n0 = function (v) { return (v < 0 ? '−' : '') + root.Fmt.n(Math.abs(v), 0); };
    var sd = function (x) { return P.esc(root.Dates.short(x)); };
    var pct = C.debt > 0 ? Math.max(0, Math.min(100, (C.debt - C.remaining) / C.debt * 100)) : 100;
    var trips = (state.trips || []).filter(function (t) { return t.from > today; }).sort(function (a, b) { return a.from < b.from ? -1 : 1; });
    var next = trips[0];
    var daysTo = next ? dayNum(next.from) - dayNum(today) : null; // ימים עד הטיסה, כולל היום
    var done = C.remaining <= 0;

    var lines = [];
    lines.push('הפיגור בסוף הנסיעה (' + sd(cu.debtUntil) + '): <b>' + n0(C.debt) + '</b> קק״ל (~' + (C.debt / 7700).toFixed(2) + ' ק״ג).');
    lines.push(done ? '<b class="score__mark--ok">הפיגור נסגר! לפני התוכנית ב-' + n0(-C.remaining) + '.</b>'
      : 'נסגרו עד עכשיו <b>' + n0(C.closed) + '</b> · נשאר <b class="score__mark--no">' + n0(C.remaining) + '</b> (' + Math.round(pct) + '%).');
    var tgt = 'יעד: ' + n0(cu.targetKcal) + ' קק״ל ו-' + n0(cu.targetSteps) + ' צעדים → שריפה ~' + n0(C.targetBurn) + ', גירעון ~' + n0(C.targetBurn - cu.targetKcal) + ' = <b>' + n0(C.targetExtra) + '</b> מעבר ל-' + n0(cfg.plannedDeficit) + ' ליום.';
    lines.push(tgt);
    if (!done && C.targetExtra > 0) {
      var nT = Math.ceil(C.remaining / C.targetExtra);
      lines.push('בקצב היעד: עוד <b>' + nT + '</b> ימים.' + (C.avgExtra !== null ? ' בקצב שלך עד עכשיו (' + n0(C.avgExtra) + ' ליום): ' + (C.avgExtra > 0 ? 'עוד <b>' + Math.ceil(C.remaining / C.avgExtra) + '</b> ימים.' : 'הפיגור לא קטן.') : ''));
      if (next) lines.push('עד ' + P.esc(next.name || 'הנסיעה') + ' (' + sd(next.from) + ') נשארו ' + daysTo + ' ימים → בקצב היעד יישאר בטיסה <b>' + n0(Math.max(0, C.remaining - daysTo * C.targetExtra)) + '</b>.');
    }
    var head = '<div class="trip__sum">' + lines.map(function (l) { return '<div>' + l + '</div>'; }).join('') + '</div>' +
      '<div class="trip__bar" style="margin-top:10px"><i class="trip__eat-ok" style="background:var(--good);width:' + pct.toFixed(1) + '%"></i></div>' +
      '<div class="kpi__legend"><span><i class="kpi__k trip__k-eat"></i>נסגר ' + n0(Math.max(0, C.debt - C.remaining)) + '</span><span><i class="kpi__k trip__k-left"></i>נשאר ' + n0(Math.max(0, C.remaining)) + '</span></div>';

    var liveCard = '';
    if (C.live) {
      var L = C.live, steps = L.steps || 0;
      var leftKcal = cu.targetKcal - L.eaten;
      liveCard = P.card('היום', sd(L.date) + ' · עוד לא נסגר',
        '<div class="trip__sum"><div>אכלת עד עכשיו <b>' + n0(L.eaten) + '</b> · חלבון ' + n0(L.protein) + ' ג׳ · ' +
        (L.steps !== null ? n0(steps) + ' צעדים' : 'צעדים עוד לא נרשמו') + '</div>' +
        '<div>עד יעד ' + n0(cu.targetKcal) + ': <b class="score__mark--' + (leftKcal >= 0 ? 'ok' : 'no') + '">' + (leftKcal >= 0 ? 'נשארו ' + n0(leftKcal) : 'מעל ב-' + n0(-leftKcal)) + '</b> · חלבון: ' + (L.protein >= 150 ? 'הושג' : 'חסרים ' + n0(150 - L.protein) + ' ג׳') + '</div></div>');
    }

    // גרף: הפיגור לאורך הימים, מול קצב היעד
    var W = 340, H = 190, Lm = 44, R = 10, Tp = 14, B = 26;
    var pts = [{ date: cu.debtUntil, v: C.debt }].concat(C.days.map(function (x) { return { date: x.date, v: x.remaining }; }));
    var nT2 = C.targetExtra > 0 ? Math.ceil(C.debt / C.targetExtra) : 30;
    var endDn = Math.max(dayNum(cu.debtUntil) + nT2, dayNum(pts[pts.length - 1].date) + 3);
    var d0 = dayNum(cu.debtUntil);
    var mx = Math.max(C.debt, 0) * 1.08 + 100, mn = Math.min(0, C.remaining) - 300;
    var x = function (dn) { return Lm + (dn - d0) / Math.max(1, endDn - d0) * (W - Lm - R); };
    var y = function (v) { return Tp + (mx - v) / (mx - mn) * (H - Tp - B); };
    var grid = '';
    var step = C.debt > 6000 ? 2000 : 1000;
    for (var g = 0; g <= mx; g += step) grid += '<line class="kpi__grid" x1="' + Lm + '" x2="' + (W - R) + '" y1="' + y(g).toFixed(1) + '" y2="' + y(g).toFixed(1) + '"/><text class="kpi__tick" x="' + (Lm - 4) + '" y="' + (y(g) + 3).toFixed(1) + '" text-anchor="end">' + (g / 1000) + 'k</text>';
    var shade = (state.trips || []).map(function (t) {
      var a = Math.max(dayNum(t.from), d0), b = Math.min(dayNum(t.to), endDn);
      return b < a ? '' : '<rect class="kpi__trip" x="' + x(a).toFixed(1) + '" y="' + Tp + '" width="' + (x(b) - x(a) + 2).toFixed(1) + '" height="' + (H - Tp - B) + '"/>';
    }).join('');
    var tLine = '<path class="trip__plan" d="M' + x(d0).toFixed(1) + ' ' + y(C.debt).toFixed(1) + ' L' + x(d0 + C.debt / Math.max(1, C.targetExtra)).toFixed(1) + ' ' + y(0).toFixed(1) + '"/>';
    var act = '<path class="trip__act" d="' + pts.map(function (q, i) { return (i ? 'L' : 'M') + x(dayNum(q.date)).toFixed(1) + ' ' + y(q.v).toFixed(1); }).join(' ') + '"/>' +
      pts.map(function (q) { return '<circle class="trip__dot-ok" cx="' + x(dayNum(q.date)).toFixed(1) + '" cy="' + y(q.v).toFixed(1) + '" r="2.8"><title>' + sd(q.date) + ': ' + n0(q.v) + '</title></circle>'; }).join('');
    var zero = '<line class="trip__zero" x1="' + Lm + '" x2="' + (W - R) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '"/>';
    var ticks = [d0, Math.round((d0 + endDn) / 2), endDn].map(function (dn, i) { var iso = new Date(dn * 864e5).toISOString().slice(0, 10); return '<text class="kpi__tick" x="' + x(dn).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? 'start' : i === 2 ? 'end' : 'middle') + '">' + sd(iso) + '</text>'; }).join('');
    var chart = '<svg class="trip__svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="פיגור לאורך זמן">' + grid + shade + zero + tLine + act + ticks + '</svg>' +
      '<div class="kpi__legend"><span><i class="kpi__k trip__k-act"></i>הפיגור בפועל</span><span><i class="kpi__k trip__k-plan"></i>בקצב היעד</span><span><i class="kpi__k kpi__k--trip"></i>נסיעה</span></div>';

    var rows = C.days.slice().reverse().map(function (dd) {
      var ok = dd.extra > 0;
      return '<div class="comp__w"><div class="comp__h"><b>' + sd(dd.date) + '</b> · ' + n0(dd.kcal) + ' קק״ל · ' + n0(dd.steps) + ' צעדים · חלבון ' + n0(dd.protein || 0) + '</div>' +
        '<span class="comp__chip">גירעון <b>' + n0(dd.def) + '</b></span> ' +
        '<span class="comp__chip comp__chip--' + (ok ? 'ok' : 'no') + '">' + (ok ? 'סגר ' : 'הוסיף ') + '<b>' + n0(Math.abs(dd.extra)) + '</b></span> ' +
        '<span class="comp__chip">נשאר <b>' + n0(dd.remaining) + '</b></span></div>';
    }).join('');

    return (
      P.card('סגירת הפיגור: ' + P.esc(cu.name || ''), 'פיגור = מתחת לתוכנית (גירעון ' + n0(cfg.plannedDeficit) + ' ליום) · כל יום סוגר את מה שמעבר ל-' + n0(cfg.plannedDeficit), head) +
      liveCard +
      P.card('הפיגור לאורך זמן', null, chart) +
      (rows ? P.card('יום אחרי יום', null, rows) : '') +
      P.hint('שריפה = ' + root.Fmt.n(cfg.baseBurn, 0) + ' + צעדים × ' + cfg.kcalPerStep + '. ימים בנסיעה נספרים כרגיל.'));
  }

  function tripTab() {
    var state = read();
    var trips = state.trips || [];
    if (!trips.length) return P.section('נסיעה', P.card(null, null, P.empty('אין נסיעה מוגדרת.')));
    var n0 = function (v) { return (v < 0 ? '−' : '') + root.Fmt.n(Math.abs(v), 0); };
    var sd = function (x) { return P.esc(root.Dates.short(x)); };
    var html = trips.map(function (trip) {
      var T = tripOf(state, trip);
      var used = { lo: T.spare - T.left.lo, mid: T.spare - T.left.mid, hi: T.spare - T.left.hi };
      var closedN = T.days.filter(function (x) { return x.closed; }).length;
      var budgetSoFar = T.days.filter(function (x) { return x.closed; }).reduce(function (a, x) { return a + x.budgetUse; }, 0);
      var pct = function (v) { return T.spare > 0 ? Math.round(v / T.spare * 100) : 0; };
      var head = '<div class="comp__top">' +
        '<div>ספייר ביציאה (גירעון מצטבר מול break even, עד <bdi dir="ltr">' + sd(new Date((dayNum(trip.from) - 1) * 864e5).toISOString().slice(0, 10)) + '</bdi>): <b>' + n0(T.spare) + ' קק״ל</b> (~' + (T.spare / 7700).toFixed(2) + ' ק״ג)</div>' +
        '<div>מול התוכנית (גירעון ' + n0(cfg0(state).plannedDeficit) + ' ליום) ביציאה: <b class="score__mark--' + (T.planBal >= 0 ? 'ok' : 'no') + '">' + (T.planBal >= 0 ? 'לפני ב-' : 'מאחור ב-') + n0(Math.abs(T.planBal)) + '</b></div>' +
        (closedN ? '<div style="margin-top:8px">עד עכשיו (' + closedN + ' ' + (closedN === 1 ? 'יום' : 'ימים') + '): נגרעו <b>' + n0(used.mid) + '</b> <small>(בין ' + n0(used.lo) + ' ל-' + n0(used.hi) + ')</small></div>' +
          '<div>נשאר בספייר: <b>' + n0(T.left.mid) + '</b> <small>(בין ' + n0(T.left.hi) + ' ל-' + n0(T.left.lo) + ')</small></div>' +
          '<div>מול התוכנית: <b class="score__mark--' + (T.leftPlan.mid >= 0 ? 'ok' : 'no') + '">' + n0(T.leftPlan.mid) + '</b> <small>(בין ' + n0(T.leftPlan.hi) + ' ל-' + n0(T.leftPlan.lo) + ')</small></div>' : '') +
      '</div>';
      var three = function (lbl, lo, mid, hi, cls) {
        var cell = function (name, v, k) { return '<span class="comp__chip' + (cls ? ' comp__chip--' + cls(k) : '') + '">' + name + ' <b>' + n0(v) + '</b></span>'; };
        return '<div class="comp__now"><span>' + lbl + '</span>' + cell('מינימום', lo, 'lo') + cell('אמצע', mid, 'mid') + cell('מקסימום', hi, 'hi') + '</div>';
      };
      var charts = tripCharts(state, T, n0, sd, used, budgetSoFar, closedN);
      var rows = T.days.map(function (x) {
        if (!x.closed) return '<div class="comp__w" style="opacity:.6"><div class="comp__h"><b>' + sd(x.date) + '</b> · עוד לא נסגר</div></div>';
        var ok = function (k) { return x.use[k] <= 0 ? 'ok' : 'no'; };
        return '<div class="comp__w"><div class="comp__h"><b>' + sd(x.date) + '</b> · ' + n0(x.steps) + ' צעדים · שריפה ' + n0(x.burn) + '</div>' +
          three('אכלת (קק״ל):', x.kcal.lo, x.kcal.mid, x.kcal.hi) +
          three('נגרע מהספייר:', x.use.lo, x.use.mid, x.use.hi, ok) +
          three('נשאר בספייר:', x.left.lo, x.left.mid, x.left.hi) +
          three('מול התוכנית:', x.leftPlan.lo, x.leftPlan.mid, x.leftPlan.hi, function (k) { return x.leftPlan[k] >= 0 ? 'ok' : 'no'; }) + '</div>';
      }).join('');
      return charts + P.card('נסיעה: ' + (trip.name || '') + ' · פירוט', root.Dates.short(trip.from) + ' עד ' + root.Dates.short(trip.to) + ' · מינימום / אמצע / מקסימום לפי טווחי הארוחות',
        head + rows) +
        P.hint('ספייר = כל הגירעון מול break even (שריפה = ' + root.Fmt.n(cfg0(state).baseBurn, 0) + ' + צעדים × ' + cfg0(state).kcalPerStep + ') מתחילת המעקב עד יום לפני הנסיעה. ירוק = לא נגרע מהספייר (אכלת עד השריפה).');
    }).join('');
    return P.section('נסיעה', catchupCards() + html);
  }

  // סימולציה: נשמר בזיכרון בלבד, כדי שמחר ייפתח נקי
  var compSim = { d0: {}, d1: {} };

  function simRows(state) {
    var today = root.Dates.today(), dn0 = dayNum(today);
    var iso = function (dn) { return new Date(dn * 864e5).toISOString().slice(0, 10); };
    var todayRow = (state.rows || []).filter(function (r) { return r.date === today; })[0] || {};
    var logged = (todayRow.meals || []).reduce(function (a, m) { return { k: a.k + (m.kcal || 0), p: a.p + (m.proteinG || 0), f: a.f + (m.fatG || 0) }; }, { k: 0, p: 0, f: 0 });
    var num = function (v) { return v === '' || v === undefined || v === null || isNaN(Number(v)) ? null : Number(v); };
    var mk = function (d, date, isToday) {
      var kcal = num(d.kcal), steps = num(d.steps);
      if (!isToday && kcal === null) return null;
      if (kcal === null) kcal = Math.max(Math.round(logged.k), (state.targets && state.targets.kcal) || 1900);
      if (steps === null) steps = 10000;
      var fat = num(d.fat), protein = num(d.protein);
      if (fat === null) fat = Math.round(isToday ? Math.max(logged.f, kcal * 0.03) : kcal * 0.03);
      if (protein === null) protein = 150;
      return { date: date, kcal: kcal, steps: steps, fatG: fat, proteinG: protein, meals: [], sim: true };
    };
    var r0 = mk(compSim.d0, today, true), r1 = mk(compSim.d1, iso(dn0 + 1), false);
    return { today: today, logged: logged, days: [r0].concat(r1 ? [r1] : []) };
  }

  function compTab() {
    var state = read();
    var sheet = compSheet(state);
    if (!sheet) return P.section('פיצויים', P.card(null, null, P.empty('עוד אין ימים סגורים.')));
    return P.section('פיצויים', sheet + compHistory(state));
  }

  function simTab() {
    var state = read();
    if (!(state.rows || []).some(function (r) { return typeof r.kcal === 'number' && typeof r.steps === 'number'; }))
      return P.section('סימולציה', P.card(null, null, P.empty('עוד אין ימים סגורים.')));
    var S = simRows(state);
    var simDates = S.days.map(function (r) { return r.date; });
    var rows2 = (state.rows || []).filter(function (r) { return simDates.indexOf(r.date) < 0; }).concat(S.days)
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var st2 = Object.assign({}, state, { rows: rows2 });
    var last = S.days[S.days.length - 1].date;
    var n0 = function (v) { return root.Fmt.n(Math.abs(v), 0); };
    var cfg = cfg0(state);

    // קלט
    var field = function (day, key, label, ph) {
      var v = compSim[day][key];
      return '<label class="sim__f"><span>' + label + '</span><input type="number" inputmode="numeric" data-sim="' + day + ':' + key + '" value="' + (v === undefined ? '' : P.esc(String(v))) + '" placeholder="' + ph + '"></label>';
    };
    var d0 = S.days[0];
    var inputs = '<div class="sim__grid"><div class="sim__day"><b>היום</b>' +
      field('d0', 'kcal', 'קק״ל', String(d0.kcal)) + field('d0', 'steps', 'צעדים', '10000') +
      field('d0', 'protein', 'חלבון', '150') + field('d0', 'fat', 'שומן', String(d0.fatG)) + '</div>' +
      '<div class="sim__day"><b>מחר</b> <small>(לא חובה)</small>' +
      field('d1', 'kcal', 'קק״ל', '—') + field('d1', 'steps', 'צעדים', '10000') +
      field('d1', 'protein', 'חלבון', '150') + field('d1', 'fat', 'שומן', 'אוטו׳') + '</div></div>' +
      '<button type="button" class="kpi__chip" data-sim-reset>איפוס</button>';

    // תוצאת היום/ימים
    var dayLines = S.days.map(function (r) {
      var def = cfg.baseBurn + r.steps * cfg.kcalPerStep - r.kcal;
      return '<div class="comp__t"><b>' + P.esc(root.Dates.short(r.date)) + '</b>: ' + n0(r.kcal) + ' קק״ל, ' + n0(r.steps) + ' צעדים → ' +
        (def >= 0 ? 'גירעון ' : 'עודף ') + '<b class="score__mark--' + (def >= cfg.plannedDeficit ? 'ok' : 'no') + '">' + n0(def) + '</b> (שומן ' + n0(r.fatG) + ', חלבון ' + n0(r.proteinG) + ')</div>';
    }).join('');

    // ציון צפוי לבלוק
    var sc = scoresOf(st2);
    var blk = sc.blocks.filter(function (b) { return b.date <= last && b.to >= last; })[0];
    var short = { kcal: 'קל׳', deficit: 'גירעון', protein: 'חלבון', fat: 'שומן', steps: '6.7K', steps10: '10K' };
    var blkHtml = blk ? '<div class="comp__now"><span>ציון צפוי לבלוק <bdi dir="ltr">' + P.esc(root.Dates.short(blk.date)) + '–' + P.esc(root.Dates.short(blk.to)) + '</bdi>' +
      (blk.full ? '' : ' (' + blk.n + '/3 ימים, עוד לא נסגר)') + ': <b>' + Math.round(blk.pts) + '</b>/100</span>' +
      sc.goals.map(function (g) { var c = blk.credit[g.key]; return '<span class="comp__chip comp__chip--' + (c >= 1 ? 'ok' : 'no') + '">' + (short[g.key] || g.key) + ' <b>' + Math.round(c * g.weight) + '/' + g.weight + '</b></span>'; }).join('') + '</div>' : '';

    var simCard = P.card('סימולציה: מה יהיה המצב', 'הכנס מה אתה מצפה לאכול וללכת. החישוב לפי המודל הרגיל (צעד = ' + cfg.kcalPerStep + '), בדיוק כמו שהיום ייסגר באתר. שדה ריק = ברירת מחדל: קק״ל = היעד (או מה שכבר רשום היום, אם יותר), צעדים 10,000, חלבון 150, שומן = מה שרשום או 30 ג׳ לכל 1,000 קק״ל.',
      inputs + (S.logged.k ? '<div class="comp__t">רשום היום עד עכשיו: ' + n0(S.logged.k) + ' קק״ל, חלבון ' + n0(S.logged.p) + '.</div>' : '') + dayLines + blkHtml);
    return P.section('סימולציה', simCard + compSheet(st2, last, last));
  }

  function bindComp(view) {
    view.querySelectorAll('[data-sim]').forEach(function (el) {
      el.addEventListener('change', function () {
        var k = el.dataset.sim.split(':');
        if (el.value === '') delete compSim[k[0]][k[1]]; else compSim[k[0]][k[1]] = el.value;
        if (root.App && root.App.setState) root.App.setState({});
      });
    });
    view.querySelectorAll('[data-sim-reset]').forEach(function (b) {
      b.addEventListener('click', function () { compSim = { d0: {}, d1: {} }; if (root.App && root.App.setState) root.App.setState({}); });
    });
  }

  function cfg0(state) { return state.balance || { baseBurn: 2150, kcalPerStep: 0.045, plannedDeficit: 550 }; }

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

  /**
   * break even להיום: כמה מותר לאכול כדי לא לעלות, לפי צעדים צפויים.
   * מקדם שמרני 0.035 לצעד (המודל הרגיל 0.045 כנראה אופטימי).
   */
  var BE_KCAL_PER_STEP = 0.035;
  var BE_KEY = 'coach.expectedSteps';
  function breakEvenOf(eaten, steps, base) {
    var max = Math.round(base + steps * BE_KCAL_PER_STEP);
    return { max: max, eaten: Math.round(eaten || 0), left: max - Math.round(eaten || 0) };
  }
  function expectedSteps(row, rows) {
    try {
      var saved = JSON.parse(root.localStorage.getItem(BE_KEY) || 'null');
      if (saved && saved.date === row.date && saved.steps > 0) return saved.steps;
    } catch (e) { /* בלי אחסון */ }
    if (typeof row.steps === 'number') return row.steps;
    var closed = rows.filter(function (r) { return typeof r.steps === 'number'; }).slice(-7);
    if (!closed.length) return 10000;
    return Math.round(closed.reduce(function (a, r) { return a + r.steps; }, 0) / closed.length / 100) * 100;
  }
  function breakEvenInner(be) {
    var pct = be.max > 0 ? Math.max(0, Math.min(100, Math.round(be.eaten / be.max * 100))) : 0;
    var note = be.left >= 0 ? 'נשארו ' + root.Fmt.n(be.left, 0) + ' קק״ל עד נקודת האיזון'
      : 'מעל נקודת האיזון ב-' + root.Fmt.n(-be.left, 0) + ' קק״ל';
    return '<div class="today__num"><strong>' + root.Fmt.n(be.eaten, 0) + '</strong>' +
        '<span> / ' + root.Fmt.n(be.max, 0) + ' קק״ל</span></div>' +
      '<div class="today__bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="today__left">' + P.esc(note) + '</div>';
  }
  function breakEvenBlock(row, rows, cfg) {
    if (!cfg || typeof cfg.baseBurn !== 'number') return '';
    var steps = expectedSteps(row, rows);
    var be = breakEvenOf(eatenOf(row, 'kcal'), steps, cfg.baseBurn);
    return '<div class="today__gauge today__be' + (be.left < 0 ? ' today__gauge--over' : '') + '" data-coach-be data-eaten="' + be.eaten + '" data-base="' + cfg.baseBurn + '">' +
      '<div class="today__label">נקודת איזון · מקסימום להיום</div>' +
      '<label class="today__steps">צעדים צפויים <input type="number" inputmode="numeric" min="0" step="500" value="' + steps + '" data-coach-steps data-date="' + P.esc(row.date) + '"></label>' +
      '<div data-coach-be-body>' + breakEvenInner(be) + '</div>' +
      '<div class="today__hint">בסיס ' + root.Fmt.n(cfg.baseBurn, 0) + ' ועוד ' + BE_KCAL_PER_STEP + ' לכל צעד (מקדם שמרני)</div>' +
    '</div>';
  }
  function bindBreakEven(view) {
    view.querySelectorAll('[data-coach-be]').forEach(function (box) {
      var input = box.querySelector('[data-coach-steps]');
      if (!input) return;
      input.addEventListener('input', function () {
        var steps = Math.max(0, Number(input.value) || 0);
        var be = breakEvenOf(Number(box.dataset.eaten), steps, Number(box.dataset.base));
        box.querySelector('[data-coach-be-body]').innerHTML = breakEvenInner(be);
        box.classList.toggle('today__gauge--over', be.left < 0);
        try { root.localStorage.setItem(BE_KEY, JSON.stringify({ date: input.dataset.date, steps: steps })); } catch (e) { /* בלי אחסון */ }
      });
    });
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
      breakEvenBlock(row, rows, state.balance) +
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
   * טאב המדדים: חמישה מדדים בחלון מתגלגל, ותאריך יעד שאפשר לשנות.
   * המגמה היא רגרסיה על שקילות 14 הימים האחרונים, כי ממוצע מול ממוצע
   * רועש מדי בשבועות הראשונים. השריפה בפועל = אוכל + ירידה × 7,700.
   */
  var KPI_DATE_KEY = 'coach.targetDate';
  var KPI_DEFAULT_DATE = '2027-01-31';
  var GOAL_KG = 84;
  var KPI_GOAL_KEY = 'coach.goalKg';
  var KPI_START_KEY = 'coach.pathStart';
  var KPI_MODE_KEY = 'coach.pathMode';
  var KPI_WIN_KEY = 'coach.avgWindow';
  function kpiWin() {
    try { var v = root.localStorage.getItem(KPI_WIN_KEY); return v === 'start' || v === '7' ? v : '14'; } catch (e) { return '14'; }
  }
  var kpiAsOf = null; // תאריך לצפייה בעבר; לא נשמר, כדי שמחר ייפתח על היום

  function kpiMode() {
    try { return root.localStorage.getItem(KPI_MODE_KEY) === 'trend' ? 'trend' : 'deficit'; } catch (e) { return 'deficit'; }
  }

  function kpiStart() {
    try { return root.localStorage.getItem(KPI_START_KEY) || null; } catch (e) { return null; }
  }

  function kpiGoalKg() {
    try {
      var v = Number(root.localStorage.getItem(KPI_GOAL_KEY));
      if (v >= 40 && v <= 200) return v;
    } catch (e) { /* בלי אחסון */ }
    return GOAL_KG;
  }

  function kpiTargetDate() {
    try {
      var v = root.localStorage.getItem(KPI_DATE_KEY);
      if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    } catch (e) { /* בלי אחסון */ }
    return KPI_DEFAULT_DATE;
  }

  function dayNum(iso) { return Math.round(Date.parse(iso) / 864e5); }

  function regress(points) {
    if (points.length < 3) return null;
    var n = points.length, mx = 0, my = 0;
    points.forEach(function (p) { mx += p.x; my += p.y; });
    mx /= n; my /= n;
    var sxy = 0, sxx = 0;
    points.forEach(function (p) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) * (p.x - mx); });
    if (!sxx) return null;
    var slope = sxy / sxx;
    return { slope: slope, at: function (x) { return my + slope * (x - mx); } };
  }

  function kpiOf(rows, cfg, targetDate, todayIso, goalKg, startDate, mode, avgWin) {
    mode = mode === 'trend' ? 'trend' : 'deficit';
    var goal = typeof goalKg === 'number' ? goalKg : GOAL_KG;
    if (!cfg) return null;
    var closed = rows.filter(function (r) { return typeof r.kcal === 'number' && typeof r.steps === 'number'; });
    var burn = function (r) { return cfg.baseBurn + r.steps * cfg.kcalPerStep; };
    var mean = function (list, f) { return list.length ? list.reduce(function (a, r) { return a + f(r); }, 0) / list.length : null; };
    // חלון הממוצע לכרטיסים 2, 3, 5 — אותו חלון שנבחר ב"ממוצע של": 14/7 ימים קלנדריים עד היום האחרון, או מתאריך ההתחלה
    var wRows0 = rows.filter(function (r) { return typeof r.weightKg === 'number'; });
    var endDn0 = wRows0.length ? dayNum(wRows0[wRows0.length - 1].date) : 0;
    if (closed.length) endDn0 = Math.max(endDn0, dayNum(closed[closed.length - 1].date));
    var winLen = avgWin === '7' ? 7 : avgWin === 'start' ? null : 14;
    var startDn0 = startDate ? dayNum(startDate) : (rows.length ? dayNum(rows[0].date) : endDn0);
    var wf = winLen ? endDn0 - winLen + 1 : startDn0;
    var inRange = function (a, b) { return closed.filter(function (r) { var dn = dayNum(r.date); return dn >= a && dn <= b; }); };
    var last7 = inRange(wf, endDn0);
    var prev7 = winLen ? inRange(wf - winLen, wf - 1) : [];
    var prevOk = !!winLen && prev7.length >= winLen - 1;
    var out = {
      days: last7.length,
      win: winLen ? String(winLen) : 'start',
      winFrom: last7.length ? last7[0].date : null,
      winTo: last7.length ? last7[last7.length - 1].date : null,
      kcal: mean(last7, function (r) { return r.kcal; }),
      kcalPrev: prevOk ? mean(prev7, function (r) { return r.kcal; }) : null,
      deficit: mean(last7, function (r) { return burn(r) - r.kcal; }),
      deficitPrev: prevOk ? mean(prev7, function (r) { return burn(r) - r.kcal; }) : null,
      steps: mean(last7, function (r) { return r.steps; })
    };

    // מגמה: שקילות ב-14 הימים האחרונים
    var weighed = rows.filter(function (r) { return typeof r.weightKg === 'number'; });
    var lastW = weighed.length ? weighed[weighed.length - 1] : null;
    if (lastW) {
      var end = dayNum(lastW.date);
      // השבוע הראשון של המעקב הוא בעיקר מים וגליקוגן, ולכן לא נכנס למגמה
      var skip = rows.length ? dayNum(rows[0].date) + 7 : -Infinity;
      var win = weighed.filter(function (r) { return dayNum(r.date) > end - 14 && dayNum(r.date) >= skip; });
      var fit = regress(win.map(function (r) { return { x: dayNum(r.date), y: r.weightKg }; }));
      out.weighIns = win.length;
      out.from = win[0] ? win[0].date : null;
      if (fit) {
        out.weekKg = fit.slope * 7;
        out.nowKg = fit.at(end);
        out.weekPct = out.weekKg / out.nowKg * 100;
        // שריפה בפועל: באותו חלון, ימים סגורים בלבד
        var inWin = closed.filter(function (r) { return dayNum(r.date) > end - 14 && dayNum(r.date) >= skip && dayNum(r.date) <= end; });
        if (inWin.length >= 5) {
          var eat = mean(inWin, function (r) { return r.kcal; });
          out.tdee = eat - fit.slope * KCAL_PER_KG;
          out.model = mean(inWin, burn);
          out.tdeeDays = inWin.length;
        }
      }
    }

    // אמינות הרישום: רוחב הטווח הממוצע ליום, ואחוז הקלוריות מהערכה
    var widths = last7.map(function (r) { var d = dayRange(r); return d ? d[1] - d[0] : 0; });
    out.rangeWidth = widths.length ? widths.reduce(function (a, b) { return a + b; }, 0) / widths.length : null;
    var b = basisOf(last7);
    out.estimatePct = b.total ? (b.estimate + b.none) / b.total * 100 : null;
    out.exactPct = b.total ? b.exact / b.total * 100 : null;

    // יעד בתאריך
    var start = typeof out.nowKg === 'number' ? out.nowKg : (lastW ? lastW.weightKg : null);
    var daysLeft = dayNum(targetDate) - dayNum(todayIso);
    out.target = { date: targetDate, daysLeft: daysLeft, goal: goal, fromKg: start };
    if (start !== null && daysLeft > 0) {
      var kgLeft = start - goal;
      out.target.kgLeft = kgLeft;
      out.target.perDay = kgLeft > 0 ? kgLeft * KCAL_PER_KG / daysLeft : 0;
      out.target.perWeekKg = kgLeft > 0 ? kgLeft / daysLeft * 7 : 0;
      var stepsRef = 10000; // הנחה שמרנית קבועה, לא הממוצע בפועל
      out.target.kcal = cfg.baseBurn + stepsRef * cfg.kcalPerStep - out.target.perDay;
      out.target.stepsRef = stepsRef;
    }
    // התקדמות מול מסלול היעד: קו ישר מהשקילה הראשונה ועד היעד בתאריך
    var firstW = (startDate && weighed.filter(function (r) { return r.date === startDate; })[0]) || weighed[0];
    // מתי מגיעים ליעד בקצב הנוכחי: לפי מגמת המשקל, ולפי הגירעון של 7 הימים
    if (typeof out.nowKg === 'number' && lastW) {
      var left = out.nowKg - goal, base0 = dayNum(lastW.date);
      var iso = function (dn) { return new Date(dn * 864e5).toISOString().slice(0, 10); };
      out.eta = { kgLeft: left };
      if (left <= 0) out.eta.done = true;
      else {
        if (out.weekKg < 0) { var dw = Math.ceil(left / (-out.weekKg / 7)); out.eta.byTrend = { days: dw, date: iso(base0 + dw) }; }
        if (out.deficit > 0) { var dd = Math.ceil(left * KCAL_PER_KG / out.deficit); out.eta.byDeficit = { days: dd, date: iso(base0 + dd) }; }
      }
    }
    if (firstW && typeof out.nowKg === 'number') {
      var s0 = dayNum(firstW.date), s1 = dayNum(targetDate), nowD = dayNum(lastW.date);
      if (s1 > s0) {
        // משקל ההתחלה: ממוצע השקילות בשלושה ימים לכל צד, כדי ששקילה חריגה אחת לא תזיז את כל הקו
        var near = weighed.filter(function (r) { return Math.abs(dayNum(r.date) - s0) <= 3; });
        var startKg = near.reduce(function (a, r) { return a + r.weightKg; }, 0) / near.length;
        var perDayKg = (startKg - goal) / (s1 - s0);
        var pathAt = function (dn) { return startKg - perDayKg * (dn - s0); };
        // לפי הגירעון: משקל ההתחלה פחות הגירעון המצטבר ÷ 7,700, יום סגור אחרי יום
        var model = [{ dn: s0, kg: startKg }], cum = 0;
        closed.forEach(function (r) {
          var dn = dayNum(r.date);
          if (dn < s0) return;
          cum += burn(r) - r.kcal;
          model.push({ dn: dn + 1, kg: startKg - cum / KCAL_PER_KG });
        });
        var mLast = model[model.length - 1];
        var useDef = mode === 'deficit';
        // המיקום היום הוא תמיד המשקל האמיתי (משקל המגמה). השיטה משנה רק את הקצב קדימה.
        var curD = nowD, curKg = out.nowKg;
        var ahead = pathAt(curD) - curKg;
        var paceWk = useDef ? (out.deficit || 0) * 7 / KCAL_PER_KG : (typeof out.weekKg === 'number' ? -out.weekKg : 0);
        out.path = {
          mode: mode, start: firstW.date, startKg: startKg, startRaw: firstW.weightKg, startN: near.length, end: targetDate, goal: goal,
          todayDn: curD, pathKg: pathAt(curD), nowKg: curKg, trendKg: out.nowKg, aheadKg: ahead,
          aheadDays: perDayKg > 0 ? ahead / perDayKg : null, paceWk: paceWk,
          needWk: (curKg - goal) / Math.max(1, s1 - curD) * 7,
          model: model,
          weights: weighed.map(function (r) { return { date: r.date, kg: r.weightKg }; })
        };
      }
    }
    // תחזית קדימה מהיום: שני קצבים, שניהם ממוצע מהתאריך שנבחר ועד עכשיו
    if (firstW && lastW) {
      // משקל היום: המגמה, ואם אין עדיין מספיק שקילות — ממוצע 3 השקילות האחרונות
      var nowKg2 = typeof out.nowKg === 'number' ? out.nowKg
        : weighed.slice(-3).reduce(function (a, r) { return a + r.weightKg; }, 0) / Math.min(3, weighed.length);
      var fNow = dayNum(lastW.date);
      // חלון הממוצע: מהתאריך שנבחר, או 7/14 הימים האחרונים
      var winN = avgWin === '7' ? 7 : avgWin === 'start' ? null : 14;
      var f0 = winN ? fNow - winN + 1 : dayNum(firstW.date);
      var since = closed.filter(function (r) { var dn = dayNum(r.date); return dn >= f0 && dn <= fNow; });
      var avgDef = since.length ? since.reduce(function (a, r) { return a + burn(r) - r.kcal; }, 0) / since.length : null;
      // במשקל: מהתאריך שנבחר, כמו הגירעון. אם החלון כולל את השבוע הראשון (מים) — מסמנים שהקצב מנופח
      var wf0 = f0;
      var wList = weighed.filter(function (r) { return dayNum(r.date) >= wf0; });
      var wWater = rows.length ? wf0 < dayNum(rows[0].date) + 7 : false;
      var wfit = regress(wList.map(function (r) { return { x: dayNum(r.date), y: r.weightKg }; }));
      var wN = wList.length;
      var kgLeft2 = nowKg2 - goal;
      var isoOf = function (dn) { return new Date(dn * 864e5).toISOString().slice(0, 10); };
      var eta = function (perDay) {
        if (kgLeft2 <= 0) return { done: true };
        if (!(perDay > 0)) return { never: true };
        var d = Math.ceil(kgLeft2 / perDay);
        return { days: d, dn: fNow + d, date: isoOf(fNow + d) };
      };
      var defPerDay = avgDef !== null ? avgDef / KCAL_PER_KG : null;
      var wtPerDay = wfit ? -wfit.slope : null;
      out.fwd = {
        from: firstW.date, fromDn: f0, win: avgWin || '14', wFrom: wList.length ? wList[0].date : null, todayDn: fNow, nowKg: nowKg2, nowIsTrend: typeof out.nowKg === 'number', goal: goal, kgLeft: kgLeft2,
        targetDn: dayNum(targetDate), target: targetDate,
        def: { perDay: defPerDay, avg: avgDef, days: since.length, lastDate: since.length ? since[since.length - 1].date : null, eta: eta(defPerDay) },
        wt: { perDay: wtPerDay, n: wN, water: wWater, eta: wfit ? eta(wtPerDay) : null }
      };
    }
    return out;
  }

  var TRIPS = [['2026-11-20', '2026-11-23'], ['2026-12-01', '2026-12-09']];

  function pathChart(pt) {
    var W = 340, H = 200, L = 34, R = 10, T = 10, B = 24;
    var d0 = dayNum(pt.start), d1 = dayNum(pt.end);
    var ws = pt.weights.filter(function (w) { var dn = dayNum(w.date); return dn >= d0 && dn <= d1; });
    var kgs = ws.map(function (w) { return w.kg; }).concat([pt.startKg, pt.goal, pt.nowKg]);
    var lo = Math.floor(Math.min.apply(null, kgs) - 0.5), hi = Math.ceil(Math.max.apply(null, kgs) + 0.5);
    var x = function (d) { return L + (d - d0) / (d1 - d0) * (W - L - R); };
    var y = function (k) { return T + (hi - k) / (hi - lo) * (H - T - B); };
    var grid = '';
    for (var k = lo; k <= hi; k++) {
      grid += '<line class="cumul__grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(k).toFixed(1) + '" y2="' + y(k).toFixed(1) + '"/>' +
        '<text class="cumul__tick" x="' + (L - 4) + '" y="' + (y(k) + 4).toFixed(1) + '" text-anchor="end">' + k + '</text>';
    }
    var trips = TRIPS.map(function (t) {
      var a = Math.max(dayNum(t[0]), d0), b = Math.min(dayNum(t[1]) + 1, d1);
      if (b <= a) return '';
      return '<rect class="kpi__trip" x="' + x(a).toFixed(1) + '" y="' + T + '" width="' + (x(b) - x(a)).toFixed(1) + '" height="' + (H - T - B) + '"><title>חו״ל</title></rect>';
    }).join('');
    var plan = '<line class="kpi__path" x1="' + x(d0).toFixed(1) + '" y1="' + y(pt.startKg).toFixed(1) + '" x2="' + x(d1).toFixed(1) + '" y2="' + y(pt.goal).toFixed(1) + '"/>';
    var dots = ws.map(function (w) {
      return '<circle class="kpi__dot" cx="' + x(dayNum(w.date)).toFixed(1) + '" cy="' + y(w.kg).toFixed(1) + '" r="2.6"/>';
    }).join('');
    var nd = pt.todayDn;
    var modelLine = '';
    if (pt.model.length) {
      if (pt.paceWk > 0 && nd < d1) {
        var endKg = pt.nowKg - pt.paceWk / 7 * (d1 - nd);
        modelLine += '<line class="kpi__proj" x1="' + x(nd).toFixed(1) + '" y1="' + y(pt.nowKg).toFixed(1) + '" x2="' + x(d1).toFixed(1) + '" y2="' + y(Math.max(endKg, lo)).toFixed(1) + '"/>';
      }
    }
    var now = modelLine + '<circle class="kpi__now kpi__now--' + (pt.aheadKg >= 0 ? 'good' : 'bad') + '" cx="' + x(nd).toFixed(1) + '" cy="' + y(pt.nowKg).toFixed(1) + '" r="5"/>';
    var lab = function (d, anchor) { return '<text class="cumul__tick" x="' + x(d).toFixed(1) + '" y="' + (H - 6) + '" style="text-anchor:' + anchor + '">' + P.esc(root.Dates.short(new Date(d * 864e5).toISOString().slice(0, 10))) + '</text>'; };
    var ticksX = function () {
      var span = d1 - d0, step = Math.max(7, Math.ceil(span / 6 / 7) * 7), out = '';
      for (var d = d0; d <= d1 - step * 0.5; d += step) {
        out += '<line class="cumul__grid" x1="' + x(d).toFixed(1) + '" x2="' + x(d).toFixed(1) + '" y1="' + (H - B) + '" y2="' + (H - B + 4) + '"/>' +
          lab(d, d === d0 ? 'start' : 'middle');
      }
      out += '<line class="cumul__grid" x1="' + x(d1).toFixed(1) + '" x2="' + x(d1).toFixed(1) + '" y1="' + (H - B) + '" y2="' + (H - B + 4) + '"/>' + lab(d1, 'end');
      var nd2 = pt.todayDn;
      out += '<line class="kpi__todayline" x1="' + x(nd2).toFixed(1) + '" x2="' + x(nd2).toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '"/>';
      return out;
    };
    return '<svg class="cumul__chart" direction="ltr" style="direction:ltr" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="משקל מול מסלול היעד">' +
      grid + trips + plan + dots + now + ticksX() + '</svg>' +
      '<div class="cumul__legend"><span><i class="kpi__k kpi__k--path"></i>מסלול</span><span><i class="kpi__k kpi__k--dot"></i>שקילה</span>' +
      '<span><i class="kpi__k kpi__k--model"></i>המשך בקצב ' + (pt.mode === 'deficit' ? 'הגירעון' : 'המגמה') + '</span><span><i class="kpi__k kpi__k--now"></i>המשקל שלך היום (מגמה)</span><span><i class="kpi__k kpi__k--trip"></i>חו״ל</span></div>';
  }

  function fwdChart(f) {
    var W = 340, H = 210, L = 34, R = 12, T = 12, B = 24;
    var d0 = f.todayDn;
    var ends = [f.targetDn];
    [f.def.eta, f.wt.eta].forEach(function (e) { if (e && e.dn) ends.push(e.dn); });
    var d1 = Math.min(Math.max.apply(null, ends) + 3, d0 + 365);
    var lo = Math.floor(Math.min(f.goal, f.nowKg) - 0.5), hi = Math.ceil(f.nowKg + 0.5);
    var x = function (d) { return L + (d - d0) / (d1 - d0) * (W - L - R); };
    var y = function (k) { return T + (hi - k) / (hi - lo) * (H - T - B); };
    var grid = '';
    for (var k = lo; k <= hi; k++) {
      grid += '<line class="cumul__grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(k).toFixed(1) + '" y2="' + y(k).toFixed(1) + '"/>' +
        '<text class="cumul__tick" x="' + (L - 4) + '" y="' + (y(k) + 4).toFixed(1) + '" style="text-anchor:end">' + k + '</text>';
    }
    var lab = function (d, anchor) { return '<text class="cumul__tick" x="' + x(d).toFixed(1) + '" y="' + (H - 6) + '" style="text-anchor:' + anchor + '">' + P.esc(root.Dates.short(new Date(d * 864e5).toISOString().slice(0, 10))) + '</text>'; };
    var trips = TRIPS.map(function (t) {
      var a = Math.max(dayNum(t[0]), d0), b = Math.min(dayNum(t[1]) + 1, d1);
      return b > a ? '<rect class="kpi__trip" x="' + x(a).toFixed(1) + '" y="' + T + '" width="' + (x(b) - x(a)).toFixed(1) + '" height="' + (H - T - B) + '"/>' : '';
    }).join('');
    var goalLine = '<line class="kpi__goal" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(f.goal).toFixed(1) + '" y2="' + y(f.goal).toFixed(1) + '"/>';
    var tgt = f.targetDn <= d1 ? '<line class="kpi__target-line" x1="' + x(f.targetDn).toFixed(1) + '" x2="' + x(f.targetDn).toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '"/>' +
      '<text class="kpi__lbl" x="' + (x(f.targetDn) - 3).toFixed(1) + '" y="' + (T + 10) + '" style="text-anchor:end">יעד</text>' : '';
    var line = function (e, perDay, cls) {
      if (!e || perDay === null || isNaN(perDay)) return '';
      var endD = e.dn ? Math.min(e.dn, d1) : d1;
      var endKg = Math.max(lo, Math.min(hi, f.nowKg - perDay * (endD - d0)));
      return '<line class="' + cls + '" x1="' + x(d0).toFixed(1) + '" y1="' + y(f.nowKg).toFixed(1) + '" x2="' + x(endD).toFixed(1) + '" y2="' + y(endKg).toFixed(1) + '"/>' +
        (e.dn && e.dn <= d1 ? '<circle class="' + cls + '-end" cx="' + x(e.dn).toFixed(1) + '" cy="' + y(f.goal).toFixed(1) + '" r="4"/>' : '');
    };
    var ticks = lab(d0, 'start');
    var step = Math.max(7, Math.ceil((d1 - d0) / 5 / 7) * 7);
    for (var d = d0 + step; d <= d1 - step * 0.9; d += step) ticks += lab(d, 'middle');
    ticks += lab(d1, 'end');
    return '<svg class="cumul__chart" style="direction:ltr" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="מתי אגיע ליעד">' +
      grid + trips + goalLine + tgt + line(f.def.eta, f.def.perDay, 'kpi__l-def') + line(f.wt.eta, f.wt.perDay, 'kpi__l-wt') +
      '<circle class="kpi__now kpi__now--good" cx="' + x(d0).toFixed(1) + '" cy="' + y(f.nowKg).toFixed(1) + '" r="5"/>' + ticks + '</svg>' +
      '<div class="cumul__legend"><span><i class="kpi__k kpi__k--def"></i>לפי הגירעון</span><span><i class="kpi__k kpi__k--wt"></i>לפי המשקל בפועל</span>' +
      '<span><i class="kpi__k kpi__k--goal"></i>משקל יעד</span><span><i class="kpi__k kpi__k--trip"></i>חו״ל</span></div>';
  }

  /**
   * היסטוריית התחזית: לכל יום סגור, מתי הייתי מגיע ליעד לפי מה שהיה ידוע
   * בסוף אותו יום. מחושב מחדש מהנתונים, ולכן לא צריך לשמור כלום.
   */
  function etaHistory(rows, cfg, targetDate, goalKg, startDate, limit, avgWin) {
    var closedRows = rows.filter(function (r) { return typeof r.kcal === 'number' && typeof r.steps === 'number'; });
    var out = [];
    closedRows.forEach(function (r) {
      if (startDate && r.date < startDate) return;
      var upto = rows.filter(function (x) { return x.date <= r.date; });
      var k = kpiOf(upto, cfg, targetDate, r.date, goalKg, startDate, 'deficit', avgWin);
      if (!k || !k.fwd) return;
      out.push({ date: r.date, def: k.fwd.def.eta, wt: k.fwd.wt.eta, kg: k.fwd.nowKg, avg: k.fwd.def.avg,
        wtWk: k.fwd.wt.perDay !== null ? k.fwd.wt.perDay * 7 : null, water: k.fwd.wt.water, defWk: k.fwd.def.perDay !== null ? k.fwd.def.perDay * 7 : null });
    });
    // היום הפתוח: מצב נכון לעכשיו (כולל שקילת הבוקר), גם לפני שהיום נסגר
    var last = rows.length ? rows[rows.length - 1] : null;
    if (last && !(typeof last.kcal === 'number' && typeof last.steps === 'number')) {
      var kL = kpiOf(rows, cfg, targetDate, last.date, goalKg, startDate, 'deficit', avgWin);
      if (kL && kL.fwd) out.push({ date: last.date, live: true, def: kL.fwd.def.eta, wt: kL.fwd.wt.eta, kg: kL.fwd.nowKg, avg: kL.fwd.def.avg,
        wtWk: kL.fwd.wt.perDay !== null ? kL.fwd.wt.perDay * 7 : null, water: kL.fwd.wt.water });
    }
    out.forEach(function (h, i) {
      var p = out[i - 1];
      h.dDef = p && p.def && h.def && p.def.dn && h.def.dn ? h.def.dn - p.def.dn : null;
      h.dWt = p && p.wt && h.wt && p.wt.dn && h.wt.dn ? h.wt.dn - p.wt.dn : null;
    });
    return out.slice(-(limit || 10)).reverse();
  }

  function historyBlock(list) {
    if (!list.length) return '';
    var d = function (e) { return !e ? '—' : e.done ? 'הושג' : e.never ? '—' : P.esc(root.Dates.short(e.date)); };
    var ch = function (v) {
      if (v === null) return '<td class="n"></td>';
      if (v === 0) return '<td class="n kpi__ch">=</td>';
      return '<td class="n kpi__ch kpi__ch--' + (v < 0 ? 'good' : 'bad') + '">' + (Math.abs(v) === 1 ? (v < 0 ? 'יום פחות' : 'יום יותר') : '<bdi dir="ltr">' + (v < 0 ? '−' : '+') + Math.abs(v) + '</bdi> ימים') + '</td>';
    };
    var body = list.map(function (h) {
      return '<tr><td>' + P.esc(root.Dates.short(h.date)) + '</td><td class="n"><b>' + d(h.def) + '</b></td>' + ch(h.dDef) +
        '<td class="n">' + d(h.wt) + (h.water && h.wt ? '*' : '') + '</td>' + ch(h.dWt) + '</tr>';
    }).join('');
    return '<div class="kpi__hist"><div class="kpi__title">איך התחזית השתנתה מיום ליום</div>' +
      '<table class="kpi__table"><thead><tr><th>בסוף יום</th><th>לפי גירעון</th><th>שינוי</th><th>לפי משקל</th><th>שינוי</th></tr></thead><tbody>' + body + '</tbody></table>' +
      '<div class="kpi__note">כל שורה = התחזית לפי מה שהיה ידוע בסוף אותו יום. ירוק = התקרבת, אדום = התרחקת. מחושב מחדש לפי היעד והתאריך שבחרת עכשיו.</div></div>';
  }

  /** תאריך קצר, ועם שנה כשהיא לא השנה של היום */
  function shortY(iso) {
    var y = iso.slice(2, 4), cur = new Date().toISOString().slice(2, 4);
    return root.Dates.short(iso) + (y !== cur ? '/' + y : '');
  }

  function historyTable(list) {
    if (!list.length) return '';
    var n = function (v, d) { return root.Fmt.n(Math.abs(v), d || 0); };
    var d = function (e) { return !e ? '—' : e.done ? 'הושג' : e.never ? '—' : P.esc(shortY(e.date)); };
    var body = list.map(function (h) {
      return '<tr' + (h.live ? ' class="kpi__live"' : '') + '><td>' + P.esc(root.Dates.short(h.date)) + (h.live ? ' <small>עכשיו</small>' : '') + '</td>' +
        '<td class="n">' + (h.avg === null ? '—' : h.avg < 0 ? '<bdi dir="ltr" class="kpi__ch--bad">+' + n(h.avg) + '</bdi> עודף' : n(h.avg)) + '</td>' +
        '<td class="n"><b>' + d(h.def) + '</b></td>' +
        '<td class="n">' + d(h.wt) + '</td>' +
        '<td class="n">' + (h.wtWk === null ? '—' : (h.wtWk < 0 ? '<bdi dir="ltr">+' + n(h.wtWk, 2) + '</bdi>' : n(h.wtWk, 2)) + (h.water ? '*' : '')) + '</td></tr>';
    }).join('');
    return '<div class="kpi__hist"><div class="kpi__title">היסטוריה</div>' +
      '<table class="kpi__table"><thead><tr><th>מצב נכון ל</th><th>גירעון ממוצע</th><th>לפי גירעון</th><th>לפי משקל</th><th>ק״ג לשבוע</th></tr></thead><tbody>' + body + '</tbody></table>' +
      '<div class="kpi__note">השורה "עכשיו" כוללת את שקילת הבוקר והאוכל שנרשם עד כה, ותתעדכן עד שהיום ייסגר. כל שאר השורות מחושבות לפי מה שהיה ידוע בסוף אותו יום, עם היעד והממוצע שבחרת למעלה. ק״ג לשבוע = הירידה בפועל במשקל. * = כולל את שבוע המים הראשון, ולכן מנופח.</div></div>';
  }

  function kpi() {
    var state = read();
    var cfg = state.balance;
    var rows = state.rows || [];
    var todayIso = new Date().toISOString().slice(0, 10);
    var tdate = kpiTargetDate();
    var goalKg = kpiGoalKg();
    var startDate = kpiStart();
    var winSel = kpiWin();
    var k = kpiOf(rows, cfg, tdate, todayIso, goalKg, startDate, kpiMode(), winSel);
    if (!k || !k.days) return P.section('מדדים', P.card(null, null, P.empty('עוד אין ימים סגורים.')));
    var n = function (v, d) { return root.Fmt.n(Math.abs(v), d || 0); };
    var dash = '—';
    var vs = function (cur, prev, lowerBetter, d, unit) {
      if (k.win === 'start') return '<small class="kpi__sub">מתחילת התקופה (בלי השוואה)</small>';
      if (typeof prev !== 'number') return '<small class="kpi__sub">אין עדיין ' + k.win + ' ימים קודמים להשוואה</small>';
      var diff = cur - prev;
      var good = lowerBetter ? diff < 0 : diff > 0;
      return '<small class="kpi__sub kpi__sub--' + (good ? 'good' : 'bad') + '"><bdi dir="ltr">' + (diff >= 0 ? '+' : '−') + n(diff, d) + '</bdi>' + (unit || '') + ' מול ' + k.win + ' הימים הקודמים</small>';
    };
    var winTxt = k.days + ' ימים סגורים, <bdi dir="ltr" style="white-space:nowrap">' + P.esc(root.Dates.short(k.winFrom)) + ' – ' + P.esc(root.Dates.short(k.winTo)) + '</bdi> (לפי "ממוצע של").';
    var tile = function (title, big, unit, sub, note) {
      return '<div class="kpi__tile"><div class="kpi__title">' + title + '</div>' +
        '<div class="kpi__big"><b dir="ltr">' + big + '</b><span>' + unit + '</span></div>' + (sub || '') +
        (note ? '<div class="kpi__note">' + note + '</div>' : '') + '</div>';
    };

    var t1 = typeof k.weekKg === 'number'
      ? tile('1 · קצב ירידה שבועי', (k.weekKg <= 0 ? '−' : '+') + n(k.weekKg, 2), ' ק״ג לשבוע',
          '<small class="kpi__sub kpi__sub--' + (k.weekKg <= 0 ? 'good' : 'bad') + '"><bdi dir="ltr">' + (k.weekKg <= 0 ? '−' : '+') + n(k.weekPct, 2) + '%</bdi> ממשקל הגוף לשבוע</small>',
          'מגמה (רגרסיה) על ' + k.weighIns + ' שקילות מ-' + P.esc(root.Dates.short(k.from)) + '. משקל לפי המגמה היום: ' + n(k.nowKg, 1) + ' ק״ג. טווח בריא: 0.5%–1% לשבוע.')
      : tile('1 · קצב ירידה שבועי', dash, '', '', 'צריך לפחות 3 שקילות.');
    var t2 = tile('2 · ממוצע קלוריות', n(k.kcal), ' קק״ל ליום', vs(k.kcal, k.kcalPrev, true, 0, ' קק״ל'),
      winTxt);
    var t3 = tile('3 · גירעון ממוצע', (k.deficit >= 0 ? '' : '+') + n(k.deficit), ' ' + (k.deficit >= 0 ? 'גירעון' : 'עודף') + ' ליום',
      vs(k.deficit, k.deficitPrev, false, 0, ' קק״ל'),
      winTxt + ' תוכנית: ' + n(cfg.plannedDeficit) + '. לפי המודל: ' + n(cfg.baseBurn) + ' + צעדים × ' + cfg.kcalPerStep + '.');
    var t4 = typeof k.tdee === 'number'
      ? tile('4 · שריפה בפועל מול המודל', n(k.tdee), ' קק״ל ליום',
          '<small class="kpi__sub kpi__sub--' + (k.tdee >= k.model ? 'good' : 'bad') + '">המודל: ' + n(k.model) + ' · ' + (k.tdee >= k.model ? 'שורף יותר ב-' : 'שורף פחות ב-') + n(k.tdee - k.model) + '</small>',
          'ממוצע אוכל ב-' + k.tdeeDays + ' ימים + ירידה במגמה × 7,700. בשבועיים הראשונים מים מנפחים את המספר; אמין יותר מ-20.11.')
      : tile('4 · שריפה בפועל מול המודל', dash, '', '', 'צריך לפחות 5 ימים סגורים בחלון השקילות.');
    var t5 = tile('5 · אמינות הרישום', '±' + n((k.rangeWidth || 0) / 2), ' קק״ל ליום',
      '<small class="kpi__sub">' + n(k.estimatePct || 0) + '% מהקלוריות מהערכה · ' + n(k.exactPct || 0) + '% מדויק</small>',
      'חצי מרוחב הטווח הממוצע ביום, בחלון שנבחר. ככל שקטן יותר, הגירעון אמין יותר.');

    var T = k.target, body;
    if (!(T.daysLeft > 0)) {
      body = '<p class="kpi__note">התאריך כבר עבר. בחר תאריך עתידי.</p>';
    } else if (!(T.kgLeft > 0)) {
      body = '<p class="kpi__note">כבר במשקל היעד לפי המגמה.</p>';
    } else {
      var gap = k.deficit - T.perDay;
      body = '<div class="kpi__grid kpi__grid--3">' +
        tile('גירעון נדרש', n(T.perDay), ' ליום', '<small class="kpi__sub kpi__sub--' + (gap >= 0 ? 'good' : 'bad') + '">בפועל בחלון: ' + n(k.deficit) + ' (' + (gap >= 0 ? 'מעל ב-' : 'חסר ') + n(gap) + ')</small>', '') +
        tile('קצב נדרש', n(T.perWeekKg, 2), ' ק״ג לשבוע', '<small class="kpi__sub">' + n(T.perWeekKg / T.fromKg * 100, 2) + '% לשבוע</small>', '') +
        tile('קלוריות ליום', n(T.kcal), ' קק״ל', '<small class="kpi__sub">בהנחה של ' + n(T.stepsRef) + ' צעדים ביום</small>', '') +
        '</div>' +
        '<p class="kpi__note">' + n(T.kgLeft, 1) + ' ק״ג מ-' + n(T.fromKg, 1) + ' (משקל המגמה) עד ' + T.goal + ', ב-' + T.daysLeft + ' ימים. ' +
        (T.perDay > 1100 ? '<b>קצב אגרסיבי מדי</b> — מעל 1% לשבוע בערך.' : '') + ' לא כולל את ימי חו״ל.</p>';
    }
    var goalOpts = [];
    for (var g = 700; g <= 950; g += 5) goalOpts.push(g / 10);
    if (goalOpts.indexOf(goalKg) < 0) goalOpts.push(goalKg);
    var goalSel = '<select class="kpi__sel" data-kpi-goal>' + goalOpts.map(function (v) {
      return '<option value="' + v + '"' + (v === goalKg ? ' selected' : '') + '>' + root.Fmt.n(v, 1) + '</option>';
    }).join('') + '</select>';
    var fromD = k.fwd ? k.fwd.from : (startDate || (rows[0] && rows[0].date));
    var winCtl = '<div class="kpi__win"><div class="kpi__row"><h3 class="kpi__h">ממוצע של</h3><div class="kpi__chips" style="margin:0;width:auto">' +
      [['14', '14 ימים אחרונים'], ['7', '7 ימים אחרונים'], ['start', 'מתאריך']].map(function (o) {
        return '<button type="button" class="kpi__chip" data-kpi-win="' + o[0] + '" aria-pressed="' + (winSel === o[0]) + '">' + o[1] + '</button>';
      }).join('') + '</div></div>' +
      (winSel === 'start' ? '<div class="kpi__row" style="margin-top:8px"><span>מתאריך:</span>' + startSel(rows, fromD) + '</div>' : '') +
      (k.fwd && k.fwd.def.avg !== null ? (function () {
        var iso = function (dn) { return new Date(dn * 864e5).toISOString().slice(0, 10); };
        var a = k.fwd.def.avg;
        return '<div class="kpi__avg"><b dir="ltr">' + n(a) + '</b> ' + (a >= 0 ? 'גירעון' : 'עודף') + ' ממוצע ליום' +
          '<small> · ' + k.fwd.def.days + ' ימים סגורים, <bdi dir="ltr" style="white-space:nowrap">' + P.esc(root.Dates.short(iso(Math.max(k.fwd.fromDn, dayNum(rows[0].date))))) + ' – ' + P.esc(root.Dates.short(k.fwd.def.lastDate || iso(k.fwd.todayDn))) + '</bdi></small></div>';
      })() : '') + '</div>';
    var target = '<div class="kpi__target"><div class="kpi__row"><h3 class="kpi__h">משקל יעד</h3>' + goalSel + '<span>ק״ג</span></div>' +
      '<div class="kpi__row" style="margin-top:8px"><h3 class="kpi__h">עד תאריך</h3>' +
      dateControls(tdate, todayIso) + '</div>' + body + '</div>';

    var t6 = '';
    var closedDates = rows.filter(function (r) { return typeof r.kcal === 'number' && typeof r.steps === 'number'; }).map(function (r) { return r.date; });
    var lastDate = rows.length ? rows[rows.length - 1].date : null;
    var asOf = kpiAsOf && kpiAsOf < (lastDate || '') ? kpiAsOf : null;
    var kF = asOf ? kpiOf(rows.filter(function (r) { return r.date <= asOf; }), cfg, tdate, asOf, goalKg, startDate, 'deficit', winSel) : k;
    var asOfSel = '<select class="kpi__sel" data-kpi-asof><option value="">היום (' + P.esc(root.Dates.short(lastDate)) + ')</option>' +
      closedDates.slice().reverse().filter(function (d) { return d !== lastDate; }).map(function (d) {
        return '<option value="' + d + '"' + (d === asOf ? ' selected' : '') + '>סוף יום ' + P.esc(root.Dates.short(d)) + '</option>';
      }).join('') + '</select>';
    if (kF && kF.fwd) {
      var F = kF.fwd;
      var row = function (title, e, pace, sub, cls) {
        var when = !e ? '—' : e.done ? 'הושג' : e.never ? 'לא בקצב הזה' : P.esc(shortY(e.date));
        var tag = e && e.dn ? (e.dn <= F.targetDn ? '<span class="kpi__tag kpi__tag--good">לפני היעד ב-' + (F.targetDn - e.dn) + ' ימים</span>' : '<span class="kpi__tag kpi__tag--bad">אחרי היעד ב-' + (e.dn - F.targetDn) + ' ימים</span>') : '';
        return '<div class="kpi__eta-row"><i class="kpi__k ' + cls + '"></i><span>' + title + '</span><b>' + when + '</b>' + tag + '</div>' +
          '<div class="kpi__note">' + pace + ' · ' + sub + '</div>';
      };
      t6 = '<div class="kpi__tile kpi__eta' + (asOf ? ' kpi__eta--past' : '') + '"><div class="kpi__title">6 · מתי אגיע ל-' + n(F.goal, 1) + ' (' + (asOf ? 'נכון לסוף ' + P.esc(root.Dates.short(asOf)) : 'מהיום') + ', ' + n(F.nowKg, 1) + ' ק״ג ' + (F.nowIsTrend ? 'במגמה' : 'בממוצע 3 שקילות') + ')</div>' +
        '<div class="kpi__row"><span>מצב נכון ל:</span>' + asOfSel + '</div>' +
        row('לפי הגירעון', F.def.eta, F.def.perDay !== null ? n(F.def.perDay * 7, 2) + ' ק״ג לשבוע' : '—',
          'ממוצע ' + (F.def.avg !== null ? n(F.def.avg) : '—') + ' גירעון ליום ב-' + F.def.days + ' ימים סגורים', 'kpi__k--def') +
        row('לפי המשקל בפועל', F.wt.eta, F.wt.perDay !== null ? n(F.wt.perDay * 7, 2) + ' ק״ג לשבוע' : '—',
          'מגמת ' + F.wt.n + ' שקילות' + (F.wFrom ? ' מ-' + P.esc(root.Dates.short(F.wFrom)) : '') + (F.wt.water ? ' · <b>כולל שבוע המים</b>, מנופח' : ''), 'kpi__k--wt') +
        fwdChart(F) +
        '<div class="kpi__note">שני הקצבים הם ממוצע על החלון שבחרת, וממשיכים קדימה מהמשקל של היום. לא כולל חו״ל ולא האטה.</div></div>';
    }
    if (!t6) {
      t6 = '<div class="kpi__tile kpi__eta' + (asOf ? ' kpi__eta--past' : '') + '"><div class="kpi__title">6 · מתי אגיע ל-' + n(goalKg, 1) + '</div>' +
        '<div class="kpi__row"><span>מצב נכון ל:</span>' + asOfSel + '</div>' +
        '<div class="kpi__note">אין מספיק נתונים לתאריך הזה. בחר תאריך מאוחר יותר.</div></div>';
    }
    var t7 = '';
    return '<section class="cumul kpi"><div class="cumul__row"><h2 class="cumul__title">מדדים שבועיים</h2></div>' +
      winCtl + '<div class="kpi__grid">' + t1 + t2 + t3 + t4 + t5 + '</div>' + target + t6 + t7 +
      historyTable(etaHistory(rows, cfg, tdate, goalKg, startDate, 60, winSel)) + '</section>';
  }

  /** בחירת תאריך בלי לוח שנה של הטלפון: יום, חודש, שנה וקיצורי דרך */
  function dateControls(tdate, todayIso) {
    var parts = tdate.split('-').map(Number);
    var y0 = Number(todayIso.slice(0, 4));
    var MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    var sel = function (name, opts, cur) {
      return '<select class="kpi__sel" data-kpi-part="' + name + '">' + opts.map(function (o) {
        return '<option value="' + o[0] + '"' + (o[0] === cur ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select>';
    };
    var days = [], months = [], years = [];
    for (var d = 1; d <= 31; d++) days.push([d, String(d)]);
    MONTHS.forEach(function (m, i) { months.push([i + 1, m]); });
    for (var y = y0; y <= y0 + 2; y++) years.push([y, String(y)]);
    if (parts[0] < y0 || parts[0] > y0 + 2) years.push([parts[0], String(parts[0])]);
    var base = Date.parse(todayIso);
    var chips = [4, 6, 8, 10, 12, 16].map(function (w) {
      var iso = new Date(base + w * 7 * 864e5).toISOString().slice(0, 10);
      return '<button type="button" class="kpi__chip" data-kpi-set="' + iso + '" aria-pressed="' + (iso === tdate) + '">' + w + ' שב׳</button>';
    }).join('');
    return '<div class="kpi__dates">' + sel('d', days, parts[2]) + sel('m', months, parts[1]) + sel('y', years, parts[0]) + '</div>' +
      '<div class="kpi__chips">' + chips + '</div>';
  }

  function startSel(rows, cur) {
    var opts = rows.filter(function (r) { return typeof r.weightKg === 'number'; }).map(function (r) {
      return '<option value="' + r.date + '"' + (r.date === cur ? ' selected' : '') + '>' + P.esc(root.Dates.short(r.date)) + ' · ' + root.Fmt.n(r.weightKg, 1) + '</option>';
    }).join('');
    return '<select class="kpi__sel" data-kpi-start>' + opts + '</select>';
  }

  function bindKpi(view) {
    view.querySelectorAll('[data-kpi-win]').forEach(function (b) {
      b.addEventListener('click', function () {
        try { root.localStorage.setItem(KPI_WIN_KEY, b.dataset.kpiWin); } catch (e) { /* בלי אחסון */ }
        if (root.App && root.App.setState) root.App.setState({});
      });
    });
    view.querySelectorAll('[data-kpi-asof]').forEach(function (el) {
      el.addEventListener('change', function () {
        kpiAsOf = el.value || null;
        if (root.App && root.App.setState) root.App.setState({});
      });
    });
    view.querySelectorAll('[data-kpi-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        try { root.localStorage.setItem(KPI_MODE_KEY, b.dataset.kpiMode); } catch (e) { /* בלי אחסון */ }
        if (root.App && root.App.setState) root.App.setState({});
      });
    });
    view.querySelectorAll('[data-kpi-start]').forEach(function (el) {
      el.addEventListener('change', function () {
        try { root.localStorage.setItem(KPI_START_KEY, el.value); } catch (e) { /* בלי אחסון */ }
        if (root.App && root.App.setState) root.App.setState({});
      });
    });
    var save = function (iso) {
      try { root.localStorage.setItem(KPI_DATE_KEY, iso); } catch (e) { /* בלי אחסון */ }
      if (root.App && root.App.setState) root.App.setState({});
    };
    view.querySelectorAll('[data-kpi-set]').forEach(function (b) {
      b.addEventListener('click', function () { save(b.dataset.kpiSet); });
    });
    view.querySelectorAll('[data-kpi-goal]').forEach(function (el) {
      el.addEventListener('change', function () {
        try { root.localStorage.setItem(KPI_GOAL_KEY, String(Number(el.value))); } catch (e) { /* בלי אחסון */ }
        if (root.App && root.App.setState) root.App.setState({});
      });
    });
    var box = view.querySelector('.kpi__dates');
    if (!box) return;
    box.querySelectorAll('[data-kpi-part]').forEach(function (el) {
      el.addEventListener('change', function () {
        var get = function (k) { return Number(box.querySelector('[data-kpi-part="' + k + '"]').value); };
        var y = get('y'), m = get('m'), d = get('d');
        var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
        d = Math.min(d, last);
        var pad = function (v) { return (v < 10 ? '0' : '') + v; };
        save(y + '-' + pad(m) + '-' + pad(d));
      });
    });
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
    var scoreRows = [['מטרה', 'בלוקים שעמד', 'מתוך', 'אחוז', 'רצף נוכחי', 'רצף שיא']];
    sc.stats.forEach(function (st) { scoreRows.push([st.label, st.hit, st.of, st.pct, st.streak, st.best]); });
    scoreRows.push(['', ''], ['ציון כולל', sc.score], ['', '']);
    scoreRows.push(['מ-', 'עד'].concat(sc.goals.map(function (g) { return g.label; })).concat(['נקודות', 'מטרות']));
    sc.days.forEach(function (dd) {
      scoreRows.push([dd.date, dd.to].concat(sc.goals.map(function (g) { return dd.res[g.key] ? '✓' : Math.round(dd.credit[g.key] * 100) + '%'; })).concat([Math.round(dd.pts), dd.hit + '/' + dd.of]));
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

  root.Coach = { start: start, load: load, card: card, today: today, balanceOf: balanceOf, macroTotals: macroTotals, weightAverage: weightAverage, stepsDiff: stepsDiff, stepsForGap: stepsForGap, meals: meals, groups: groups, split: split, splitOf: splitOf, trend: trend, trendOf: trendOf, forecastOf: forecastOf, weightSeries: weightSeries, macros: macros, macroOf: macroOf, scorecard: scorecard, scoresOf: scoresOf, compSheetOf: compSheetOf, compHistoryOf: compHistoryOf, compTab: compTab, simTab: simTab, stepsTab: stepsTab, tripTab: tripTab, tripOf: tripOf, catchupTab: catchupTab, catchupOf: catchupOf, bindComp: bindComp, workbookData: workbookData, exportXlsx: exportXlsx, exportButton: exportButton, basisOf: basisOf, deficitRange: deficitRange, dayRange: dayRange, catTotals: catTotals, breakEvenOf: breakEvenOf, bindBreakEven: bindBreakEven, kpi: kpi, kpiOf: kpiOf, etaHistory: etaHistory, bindKpi: bindKpi, KEY: KEY };
})(typeof window !== 'undefined' ? window : globalThis);
