/**
 * Dash — הלוח כולו, מקטע אחרי מקטע.
 *
 * הסדר נקבע לפי מה שמניע: כמה ירדתי, כמה לאכול היום, כמה נשאר
 * ליעד, ואז הפירוט. כל נתון מופיע פעם אחת בלבד — מה שהיה כפול
 * באפליקציה הקודמת אוחד למקום אחד.
 */
(function (root) {
  'use strict';

  var Fmt = root.Fmt, Dates = root.Dates, Metrics = root.Metrics,
      Store = root.Store, P = root.Parts, Chart = root.Chart;

  var COLORS = {
    brand: '#12857C',
    brandLite: '#1DB5A6',
    good: '#2E9E6B',
    warn: '#E07A34',
    bad: '#C8385A',
    violet: '#6B4FE0',
    faint: 'rgba(18,133,124,0.30)',
    violetFaint: 'rgba(107,79,224,0.28)',
    band: 'rgba(18,133,124,0.10)'
  };

  var WEIGHT_MODES = [
    { value: 'rolling', label: 'מתגלגל' },
    { value: 'blocks', label: 'חלונות מלאים' }
  ];

  var WINDOW_DAYS = [3, 5, 7, 10, 14, 21, 28];

  // ---------------------------------------------------------- כותרת

  function top(state, entries, settings) {
    var d = Metrics.dashboard(entries, settings, { endDate: state.date });
    var stamp = Dates.long(state.date) + '  ·  ' + root.App.BUILD;

    if (!d.ok) {
      return '<header class="top"><div class="top-row"><h1>מדדים</h1>' +
        '<span class="stamp">' + P.esc(stamp) + '</span></div>' +
        '<div class="headline"><span class="k">אין עדיין נתונים</span></div></header>';
    }

    var goal = settings.goal.targetWeightKg;
    var progress = '';

    if (Fmt.isNum(goal) && Fmt.isNum(d.maxWeight) && Fmt.isNum(d.currentWeight)) {
      var total = d.maxWeight - goal;
      var done = d.maxWeight - d.currentWeight;
      var pct = total > 0 ? Math.max(Math.min(done / total, 1), 0) : 0;
      progress =
        '<div class="progress">' +
          '<div class="progress-head"><span>מהשיא אל היעד</span>' +
            '<span>' + Fmt.n(pct * 100, 0) + '%</span></div>' +
          '<div class="progress-track"><div class="progress-fill" style="width:' +
            (pct * 100).toFixed(1) + '%"></div></div>' +
          '<div class="progress-foot"><span>' + Fmt.n(goal, 1) + '</span>' +
            '<span>נשאר ' + Fmt.n(Math.max(d.currentWeight - goal, 0), 1) + ' ק״ג</span>' +
            '<span>' + Fmt.n(d.maxWeight, 1) + '</span></div>' +
        '</div>';
    }

    return '<header class="top">' +
      '<div class="top-row"><h1>מדדים</h1><span class="stamp">' + P.esc(stamp) + '</span></div>' +
      '<div class="headline">' +
        '<span class="k">ירדת מאז שהתחלת</span>' +
        '<span class="v">' + Fmt.n(d.totalLoss, 1) + '</span>' +
        '<span class="u">ק״ג · ' + d.spanDays + ' ימים במעקב · משקל מגמה ' +
          Fmt.n(d.currentWeight, 1) + '</span>' +
      '</div>' + progress +
    '</header>';
  }

  // ------------------------------------------------------- היום

  function todaySection(state, entries, settings) {
    var report = Metrics.windowReport(entries, settings, {
      windowDays: state.window, endDate: state.date
    });

    if (!report.ok) {
      return P.section('היום', P.card(null, null,
        P.empty(report.reason === 'window'
          ? 'לחלון של ' + state.window + ' ימים דרושים ' + report.needDays +
            ' ימי נתונים, ויש ' + report.haveDays + '.'
          : 'צריך שקילות ורישום קלוריות באותם ימים.')));
    }

    var entry = Store.getEntry(state.date) || {};
    var eaten = Fmt.isNum(entry.kcal) ? entry.kcal : null;
    var target = report.target;
    var pct = eaten === null ? 0 : Math.min(eaten / target, 1.35);
    var over = eaten !== null && eaten > target;

    var meter =
      '<div class="meter">' +
        '<div class="meter-track">' +
          '<div class="meter-fill' + (over ? ' meter-fill--over' : '') + '" style="width:' +
            (Math.min(pct, 1.35) / 1.35 * 100).toFixed(1) + '%"></div>' +
          '<div class="meter-mark" style="inset-inline-start:' + (1 / 1.35 * 100).toFixed(1) + '%"></div>' +
        '</div>' +
        '<div class="meter-legend"><span>' +
          (eaten === null ? 'עוד לא רשמת היום' : 'אכלת ' + Fmt.n(eaten, 0)) + '</span>' +
          '<span>יעד ' + Fmt.n(target, 0) + '</span></div>' +
      '</div>';

    var left = eaten === null ? target : target - eaten;
    var bigValue = over ? Fmt.n(eaten - target, 0) : Fmt.n(Math.max(left, 0), 0);
    var bigLabel = eaten === null ? 'קלוריות להיום'
      : over ? 'קלוריות מעל היעד' : 'קלוריות נשארו';

    var body =
      '<div class="big big--' + (over ? 'bad' : 'brand') + '">' + bigValue +
        ' <small>' + bigLabel + '</small></div>' +
      meter +
      P.tiles([
        P.tile('', 'שמירת משקל', Fmt.n(report.base, 0), 'בלי הליכה'),
        P.tile('warn', 'גירעון יומי', Fmt.n(report.deficitPerDay, 0),
          Fmt.signed(report.ratePerWeekKg, 2) + ' ק״ג בשבוע'),
        P.tile('', 'שורף ביום', Fmt.n(report.tdee, 0), '± ' + Fmt.n(report.ci95, 0))
      ]);

    return P.section('היום', P.card(null, null, body));
  }

  // ------------------------------------------------------- משקל

  function weightSection(state, entries, settings) {
    var body = P.chips(WEIGHT_MODES, state.weightMode, 'data-wmode') +
      P.chart('chart-weight', 200);

    var tableHtml = state.weightMode === 'blocks'
      ? blocksTable(entries, state)
      : rollingTable(entries, state);

    return P.section('משקל', P.card(null, null, body) + P.card(null, null, tableHtml));
  }

  function blocksTable(entries, state) {
    var r = Metrics.weightBlocks(entries, { days: state.window === 'adaptive' ? 7 : state.window,
      endDate: state.date });
    if (!r.rows.length) return P.empty('אין עדיין מספיק שקילות.');

    var rows = r.rows.slice().reverse().slice(0, 8).map(function (row) {
      return '<tr><td class="n">' + row.index + '</td>' +
        '<td class="n">' + P.esc(Dates.short(row.from) + '–' + Dates.short(row.to)) +
          '<span class="sub">' + row.days + ' ימים' + (row.partial ? ' · פתוח' : '') + '</span></td>' +
        '<td class="n">' + Fmt.n(row.mean, 2) + '</td>' +
        '<td class="n">' + P.delta(row.change, 2, 'down') + '</td></tr>';
    }).join('');

    return P.table(
      [{ label: 'חלון', n: true }, { label: 'תקופה', n: true }, 'ממוצע', 'שינוי'],
      [rows],
      { hint: 'חלונות רצופים מהיום הראשון. כל חלון מושווה לחלון שלפניו, ' +
        'ולכן שני מספרים עוקבים אינם חולקים ימים.' });
  }

  function rollingTable(entries, state) {
    var r = Metrics.rollingWindows(entries, {
      endDate: state.date, lengths: [3, 5, 7, 10, 14]
    });

    var rows = r.rows.map(function (row) {
      if (!row.ok || !row.covered) {
        return '<tr><td class="n">' + row.days + '</td>' +
          '<td colspan="3" class="flat">אין עדיין ' + (row.days * 2) + ' ימי נתונים</td></tr>';
      }
      return '<tr' + (String(row.days) === String(state.window) ? ' class="now"' : '') + '>' +
        '<td class="n">' + row.days + '</td>' +
        '<td class="n">' + P.esc(Dates.short(row.current.from) + '–' + Dates.short(row.current.to)) +
          '<span class="sub">מול ' + P.esc(Dates.short(row.previous.from) + '–' +
            Dates.short(row.previous.to)) + '</span></td>' +
        '<td class="n">' + Fmt.n(row.meanWeight, 2) + '</td>' +
        '<td class="n">' + P.delta(-row.deltaKg, 2, 'down') + '</td></tr>';
    }).join('');

    return P.table(
      [{ label: 'ימים', n: true }, { label: 'תקופה', n: true }, 'ממוצע', 'שינוי'],
      [rows],
      { hint: 'כל חלון מסתיים היום ומושווה לימים שקדמו לו מיד. ' +
        'תמיד עדכני, אבל שני מספרים עוקבים חולקים ימים.' });
  }

  // -------------------------------------------------- הרכב גוף

  function bodySection(state, entries) {
    var r = Metrics.bodyChangeSummary(entries, {
      endDate: state.date, windows: [7, 14, 28]
    });

    var rows = r.rows.map(function (row) {
      if (!row.ok) {
        return '<tr><td>' + row.days + ' ימים</td>' +
          '<td colspan="3" class="flat">צריך ' + row.needDays + ' ימים</td></tr>';
      }
      return '<tr><td>' + row.days + ' ימים' +
          '<span class="sub">' + P.esc(Dates.short(row.current.from) + '–' +
            Dates.short(row.current.to)) + '</span></td>' +
        '<td class="n">' + P.delta(row.fields.weightKg.change, 2, 'down') + '</td>' +
        '<td class="n">' + P.delta(row.fields.bodyFatKg.change, 2, 'down') + '</td>' +
        '<td class="n">' + P.delta(row.fields.muscleKg.change, 2, 'up') + '</td></tr>';
    }).join('');

    return P.section('הרכב גוף',
      P.card(null, null, P.chart('chart-body', 170)) +
      P.card(null, null, P.table(
        [{ label: 'תקופה', n: false }, 'משקל', 'שומן', 'שריר'],
        [rows],
        { hint: 'בקילוגרמים, חלון מלא מול החלון שלפניו. ' +
          'מדידות שומן ושריר במשקל ביתי רועשות — הכיוון אמין, המספר פחות.' })));
  }

  // ---------------------------------------------------- תזונה

  function nutritionSection(state, entries, settings) {
    var macro = Metrics.macroSplit(entries, { endDate: state.date, windowDays: state.period });
    if (!macro.ok) {
      return P.section('תזונה', P.card(null, null, P.empty('אין עדיין רישומי תזונה.')));
    }

    var labels = { proteinG: 'חלבון', carbG: 'פחמימות', fatG: 'שומן' };
    var colors = { proteinG: COLORS.brand, carbG: COLORS.violet, fatG: COLORS.warn };

    // הפס מחולק לפי מה שהמאקרו מסביר, ולכן הוא תמיד מסתכם ל-100%.
    // אם סכום המאקרו לא תואם את הקלוריות שדווחו, זה נאמר בנפרד —
    // חלוקה לפי הקלוריות המדווחות הייתה יוצרת פס שחורג או חסר.
    var explained = macro.parts.reduce(function (sum, p) { return sum + p.kcal; }, 0);
    var shareOf = function (p) { return explained ? p.kcal / explained : 0; };

    var segments = macro.parts.filter(function (p) { return p.kcal > 0; }).map(function (p) {
      return '<div class="split-seg" style="width:' + (shareOf(p) * 100).toFixed(1) +
        '%;background:' + colors[p.field] + '"></div>';
    }).join('');

    var legend = macro.parts.map(function (p) {
      return '<span class="split-key"><i style="background:' + colors[p.field] + '"></i>' +
        P.esc(labels[p.field]) + ' ' + Fmt.n(shareOf(p) * 100, 0) + '% · ' +
        Fmt.n(p.gramsPerDay, 0) + ' גר׳</span>';
    }).join('');

    var mismatch = Math.abs(macro.unexplainedShare) > 0.05
      ? P.hint('סכום המאקרו ' +
          (macro.unexplained > 0 ? 'נמוך ב-' : 'גבוה ב-') +
          Fmt.n(Math.abs(macro.unexplainedShare) * 100, 0) +
          '% מהקלוריות שדיווחת. בדרך כלל זה ימים שנרשמו בלי פירוט מלא.')
      : '';

    var protein = macro.parts.find(function (p) { return p.field === 'proteinG'; });
    var target = settings.targets.proteinG;

    return P.section('תזונה',
      P.card('מאיפה מגיעות הקלוריות', state.period + ' הימים האחרונים',
        '<div class="split">' + segments + '</div>' +
        '<div class="split-keys">' + legend + '</div>' +
        mismatch +
        P.tiles([
          P.tile('', 'ממוצע יומי', Fmt.n(macro.kcalPerDay, 0), 'קלוריות'),
          P.tile(Fmt.isNum(target) && protein.gramsPerDay >= target ? 'good' : 'warn',
            'חלבון ליום', Fmt.n(protein.gramsPerDay, 0),
            Fmt.isNum(target) ? 'יעד ' + Fmt.n(target, 0) : 'גרם'),
          P.tile('violet', 'צפיפות חלבון', Fmt.n(macro.proteinDensity, 1), 'גר׳ ל-100 קק״ל')
        ])) +
      P.card(null, null, P.chart('chart-kcal', 170)));
  }

  // ------------------------------------------------- התקדמות

  function progressSection(state, entries, settings) {
    var period = Metrics.periodTarget(entries, settings, {
      endDate: state.date, days: state.period, windowDays: state.window, horizons: [1, 3, 7]
    });
    if (!period.ok) return '';

    var kcalPerKg = settings.kcalPerKg || 7700;
    var tone = period.carried.low > 0 ? 'good' : period.carried.mid > 0 ? 'warn' : 'bad';
    var verdict = period.carried.low > 0
      ? 'בירוק בכל התרחישים'
      : period.carried.mid > 0
        ? 'בירוק לפי ההערכה, לא בטוח בתרחיש הזהיר'
        : 'בעודף';

    var rows = [
      { k: 'זהיר', v: P.delta(period.carried.low, 0, 'up') },
      { k: 'הערכה', v: P.delta(period.carried.mid, 0, 'up') },
      { k: 'נדיב', v: P.delta(period.carried.high, 0, 'up') }
    ];

    var planRows = ['low', 'mid', 'high'].map(function (key) {
      var names = { low: 'זהיר', mid: 'הערכה', high: 'נדיב' };
      return '<tr><td>' + names[key] + '</td>' +
        period.plan[key].map(function (option) {
          return '<td class="n">' + Fmt.n(Math.max(option.perDay, 0), 0) + '</td>';
        }).join('') + '</tr>';
    }).join('');

    var labels = period.todayLogged
      ? ['מחר', '3 ימים', 'שבוע']
      : ['היום', '3 ימים', 'שבוע'];

    return P.section('התקופה',
      P.card(null, state.period + ' הימים האחרונים · ' +
        Dates.short(period.period.from) + '–' + Dates.short(period.period.to),
        '<div class="big big--' + (tone === 'good' ? 'good' : tone === 'bad' ? 'bad' : 'brand') + '">' +
          Fmt.signed(period.carried.mid / kcalPerKg, 2) + '<small>ק״ג לפי המאזן</small></div>' +
        '<p class="note" style="margin-top:8px">' + P.esc(verdict) + '</p>' +
        P.rows(rows) +
        P.table(['תרחיש'].concat(labels), [planRows],
          { hint: 'כמה לאכול ביום כדי שהתקופה תיסגר בגירעון, לפי מספר הימים שתפרוס עליהם.' })));
  }

  // ------------------------------------------------- הגדרות

  function settingsSection(state, entries, settings) {
    var rate = Fmt.isNum(settings.goal.ratePerWeekKg) ? Math.abs(settings.goal.ratePerWeekKg) : 0;

    var windowOptions = [{ value: 'adaptive', label: 'מסתגל' }];
    Metrics.availableWindows(entries, { endDate: state.date, candidates: WINDOW_DAYS })
      .forEach(function (w) {
        windowOptions.push({
          value: w.days, label: String(w.days), disabled: !w.available,
          title: w.available ? '' : 'צריך ' + w.needDays + ' ימי נתונים'
        });
      });

    var body =
      '<div class="field"><label for="goal-weight">משקל יעד (ק״ג)</label>' +
        '<input id="goal-weight" type="number" step="0.1" value="' +
        (Fmt.isNum(settings.goal.targetWeightKg) ? settings.goal.targetWeightKg : '') + '"></div>' +

      '<div class="field"><label for="rate">קצב ירידה — ' +
        '<span class="num" id="rate-label">' + Fmt.n(rate, 2) + '</span> ק״ג בשבוע</label>' +
        '<input id="rate" type="range" min="0" max="1.5" step="0.05" value="' + rate + '"></div>' +

      '<label class="note">בסיס החישוב</label>' +
      P.chips(windowOptions, state.window, 'data-window') +

      '<label class="note">אורך התקופה</label>' +
      P.chips([{ value: 7, label: 'שבוע' }, { value: 14, label: 'שבועיים' },
        { value: 28, label: 'חודש' }], state.period, 'data-period') +

      '<div style="display:flex;gap:8px;margin-top:14px">' +
        '<button type="button" class="btn btn--primary" id="pull">משיכה מהגיליון</button>' +
        '<button type="button" class="btn" id="open-old">האפליקציה הקודמת</button>' +
      '</div>' +
      '<div id="pull-status"></div>';

    return P.section('הגדרות', P.fold('קצב, יעד ובסיס החישוב', body, state.settingsOpen));
  }

  // ------------------------------------------------- גרפים

  function drawCharts(state, entries, settings) {
    // בזמן רינדור חלקי — למשל לפני שיש מספיק נתונים — חלק מהמיכלים
    // אינם קיימים. בלי ההגנה הזו כל ציור מפיל שגיאה בקונסול.
    var host = function (id) { return document.getElementById(id); };
    var setKeys = function (id, html) {
      var box = host(id + '-keys');
      if (box) box.innerHTML = html;
    };

    var toPoints = function (list) {
      return list.map(function (p) { return { x: Dates.dayIndex(p.date), y: p.y }; });
    };

    // משקל: נקודות, ממוצע נע, וקו היעד
    var raw = Metrics.series(entries, 'weightKg');
    var ma = Metrics.movingAverage(entries, 'weightKg', { windowDays: 7, minPoints: 3 })
      .filter(function (d) { return d.y !== null; });

    if (raw.length >= 2 && host('chart-weight')) {
      var series = [
        { type: 'dots', color: COLORS.faint, points: toPoints(raw), radius: 2.5 },
        { type: 'line', color: COLORS.brand, width: 2.6, points: toPoints(ma) }
      ];
      var goal = settings.goal.targetWeightKg;
      if (Fmt.isNum(goal)) {
        var xs = toPoints(raw).map(function (p) { return p.x; });
        series.push({
          type: 'line', color: COLORS.warn, width: 1.6, dash: '6 4', ignoreExtent: true,
          points: [{ x: Math.min.apply(null, xs), y: goal },
                   { x: Math.max.apply(null, xs), y: goal }]
        });
      }

      var rawMap = {}, maMap = {};
      raw.forEach(function (p) { rawMap[Dates.dayIndex(p.date)] = p.y; });
      ma.forEach(function (p) { maMap[p.x] = p.y; });

      Chart.render(host('chart-weight'), {
        series: series,
        height: 200,
        formatX: function (x) { return Dates.short(Dates.fromDayIndex(x)); },
        formatTick: function (v) { return Fmt.n(v, 1); },
        captionEl: host('chart-weight-caption'),
        idleCaption: 'העבר אצבע על הגרף לפרטים',
        onHover: function (x) {
          var parts = [Dates.long(Dates.fromDayIndex(x))];
          if (rawMap[x] !== undefined) parts.push('שקילה ' + Fmt.n(rawMap[x], 2));
          if (maMap[x] !== undefined) parts.push('מגמה ' + Fmt.n(maMap[x], 2));
          return parts.join('  ·  ');
        }
      });
      setKeys('chart-weight', P.keys([
        { color: COLORS.faint, label: 'שקילות', shape: 'dot' },
        { color: COLORS.brand, label: 'ממוצע 7 ימים' }
      ].concat(Fmt.isNum(settings.goal.targetWeightKg)
        ? [{ color: COLORS.warn, label: 'משקל יעד', shape: 'dash' }] : [])));
    }

    // הרכב גוף: שומן ושריר, כל אחד בסקאלה שלו
    var fat = Metrics.movingAverage(entries, 'bodyFatKg', { windowDays: 7, minPoints: 3 })
      .filter(function (d) { return d.y !== null; });
    var muscle = Metrics.movingAverage(entries, 'muscleKg', { windowDays: 7, minPoints: 3 })
      .filter(function (d) { return d.y !== null; });

    if (fat.length >= 2 && muscle.length >= 2 && host('chart-body')) {
      // מנרמלים את השריר לטווח השומן כדי ששניהם ייראו על ציר אחד
      var fatValues = fat.map(function (p) { return p.y; });
      var fatLo = Math.min.apply(null, fatValues), fatHi = Math.max.apply(null, fatValues);
      var muscleValues = muscle.map(function (p) { return p.y; });
      var mLo = Math.min.apply(null, muscleValues), mHi = Math.max.apply(null, muscleValues);
      var scale = function (v) {
        if (mHi === mLo) return (fatLo + fatHi) / 2;
        return fatLo + ((v - mLo) / (mHi - mLo)) * (fatHi - fatLo);
      };

      var fatMap = {}, muscleMap = {};
      fat.forEach(function (p) { fatMap[p.x] = p.y; });
      muscle.forEach(function (p) { muscleMap[p.x] = p.y; });

      Chart.render(host('chart-body'), {
        series: [
          { type: 'line', color: COLORS.bad, width: 2.4, points: toPoints(fat) },
          { type: 'line', color: COLORS.good, width: 2.4, dash: '5 3',
            points: muscle.map(function (p) { return { x: p.x, y: scale(p.y) }; }) }
        ],
        height: 170,
        formatX: function (x) { return Dates.short(Dates.fromDayIndex(x)); },
        formatTick: function (v) { return Fmt.n(v, 1); },
        captionEl: host('chart-body-caption'),
        idleCaption: 'ציר המספרים שייך לשומן; השריר מוצג לפי הכיוון בלבד',
        onHover: function (x) {
          var parts = [Dates.long(Dates.fromDayIndex(x))];
          if (fatMap[x] !== undefined) parts.push('שומן ' + Fmt.n(fatMap[x], 2));
          if (muscleMap[x] !== undefined) parts.push('שריר ' + Fmt.n(muscleMap[x], 2));
          return parts.join('  ·  ');
        }
      });
      setKeys('chart-body', P.keys([
        { color: COLORS.bad, label: 'שומן (ק״ג)' },
        { color: COLORS.good, label: 'שריר — כיוון בלבד', shape: 'dash' }
      ]));
    }

    // קלוריות מול היעד
    var kcal = Metrics.series(entries, 'kcal');
    if (kcal.length >= 2 && host('chart-kcal')) {
      var report = Metrics.windowReport(entries, settings, {
        windowDays: state.window, endDate: state.date
      });
      var target = report.ok ? report.target : null;
      var kcalMa = Metrics.movingAverage(entries, 'kcal', { windowDays: 7, minPoints: 3 })
        .filter(function (d) { return d.y !== null; });

      // חריגה של יותר מ-10% מהיעד נצבעת אדום, כדי שהיא תיראה בלי לספור
      var bars = toPoints(kcal).map(function (p) {
        return Fmt.isNum(target) && p.y > target * 1.1
          ? { x: p.x, y: p.y, color: COLORS.bad }
          : p;
      });

      var kcalSeries = [
        { type: 'bars', color: COLORS.faint, points: bars },
        { type: 'line', color: COLORS.brand, width: 2.4, points: toPoints(kcalMa) }
      ];
      if (Fmt.isNum(target)) {
        var kx = bars.map(function (p) { return p.x; });
        kcalSeries.push({
          type: 'line', color: COLORS.warn, width: 1.6, dash: '6 4', ignoreExtent: true,
          points: [{ x: Math.min.apply(null, kx), y: target },
                   { x: Math.max.apply(null, kx), y: target }]
        });
      }

      var kcalMap = {};
      kcal.forEach(function (p) { kcalMap[Dates.dayIndex(p.date)] = p.y; });

      Chart.render(host('chart-kcal'), {
        series: kcalSeries,
        height: 170,
        formatX: function (x) { return Dates.short(Dates.fromDayIndex(x)); },
        formatTick: function (v) { return Fmt.n(v, 0); },
        captionEl: host('chart-kcal-caption'),
        idleCaption: Fmt.isNum(target) ? 'הקו הכתום הוא היעד היומי' : 'לא הוגדר יעד',
        onHover: function (x) {
          var parts = [Dates.long(Dates.fromDayIndex(x))];
          if (kcalMap[x] !== undefined) parts.push('אכלת ' + Fmt.n(kcalMap[x], 0));
          if (Fmt.isNum(target) && kcalMap[x] !== undefined) {
            parts.push('מול היעד ' + Fmt.signed(kcalMap[x] - target, 0));
          }
          return parts.join('  ·  ');
        }
      });
      setKeys('chart-kcal', P.keys([
        { color: COLORS.faint, label: 'יומי', shape: 'dot' },
        { color: COLORS.brand, label: 'ממוצע 7 ימים' }
      ].concat(Fmt.isNum(target) ? [{ color: COLORS.warn, label: 'יעד', shape: 'dash' }] : [])));
    }
  }

  function render(container, state) {
    var entries = Store.getEntries();
    var settings = Store.getSettings();

    if (!entries.length) {
      container.innerHTML = top(state, entries, settings) +
        P.section('התחלה', P.card(null, null,
          P.empty('אין עדיין נתונים. אפשר למשוך אותם מהגיליון בהגדרות למטה.'))) +
        settingsSection(state, entries, settings);
      return;
    }

    container.innerHTML =
      top(state, entries, settings) +
      todaySection(state, entries, settings) +
      weightSection(state, entries, settings) +
      progressSection(state, entries, settings) +
      bodySection(state, entries) +
      nutritionSection(state, entries, settings) +
      settingsSection(state, entries, settings);

    drawCharts(state, entries, settings);
  }

  root.Dash = { render: render, COLORS: COLORS };
})(typeof window !== 'undefined' ? window : globalThis);
