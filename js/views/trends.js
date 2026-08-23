/** מסך המגמות. כל גרף מציג מדידות גולמיות בשקיפות, וקו מוצק לממוצע הנע. */
(function (root) {
  'use strict';

  var Views = root.Views = root.Views || {};
  var Fmt = root.Fmt, Dates = root.Dates, Metrics = root.Metrics, Store = root.Store, UI = root.UI, Chart = root.Chart;

  var COLORS = {
    measured: '#0D6E67',
    measuredFaint: 'rgba(13,110,103,0.35)',
    reference: '#4B55A5',
    over: '#A32F4B',
    lean: '#4B55A5',
    band: 'rgba(13,110,103,0.10)'
  };

  var RANGES = [
    { value: 30, label: '30 יום' },
    { value: 90, label: '90 יום' },
    { value: 180, label: '180 יום' },
    { value: 0, label: 'הכל' }
  ];

  function scopedEntries(entries, rangeDays) {
    if (!rangeDays) return entries;
    return Metrics.inWindow(entries, Dates.today(), rangeDays);
  }

  function toPoints(list) {
    return list.map(function (p) { return { x: p.x, y: p.y }; });
  }

  function horizontal(points, value, color, dash) {
    var xs = points.map(function (p) { return p.x; });
    if (!xs.length || !Fmt.isNum(value)) return null;
    return {
      type: 'line',
      color: color,
      width: 1.5,
      dash: dash || '4 4',
      points: [{ x: Math.min.apply(null, xs), y: value }, { x: Math.max.apply(null, xs), y: value }]
    };
  }

  function chartBlock(id, title, note) {
    return UI.card(title, note,
      '<div class="chart" id="' + id + '"></div>' +
      '<div class="chart-caption" id="' + id + '-caption"></div>' +
      '<div class="legend" id="' + id + '-legend"></div>');
  }

  function legend(items) {
    return items.map(function (i) {
      return '<span><i style="background:' + i.color + '"></i>' + Fmt.esc(i.label) + '</span>';
    }).join('');
  }

  function lookup(list) {
    var map = {};
    list.forEach(function (p) { map[p.x] = p.y; });
    return map;
  }

  function drawWeight(entries, settings) {
    var raw = Metrics.series(entries, 'weightKg');
    if (raw.length < 2) return;
    var ma = Metrics.movingAverage(entries, 'weightKg', { windowDays: 7, minPoints: 3 })
      .filter(function (d) { return d.y !== null; });

    // שני קווי מגמה: ממוצע נע רגיל, וממוצע מעריכי בשיטת Hacker's Diet.
    // המעריכי מגיב מהר יותר לשינוי אמיתי, הרגיל חלק יותר.
    var ewmaLine = Metrics.ewma(entries, 'weightKg', { alpha: 0.1 });

    var series = [
      { type: 'dots', color: COLORS.measuredFaint, points: toPoints(raw), radius: 2.5 },
      { type: 'line', color: COLORS.reference, width: 1.6, dash: '5 3', points: toPoints(ewmaLine) },
      { type: 'line', color: COLORS.measured, width: 2.2, points: toPoints(ma) }
    ];
    var target = horizontal(raw, settings.goal.targetWeightKg, COLORS.over, '2 4');
    if (target) series.push(target);

    var rawMap = lookup(raw), maMap = lookup(ma), ewmaMap = lookup(ewmaLine);
    Chart.render(document.getElementById('chart-weight'), {
      series: series,
      height: 200,
      formatX: function (x) { return Dates.short(Dates.fromDayIndex(x)); },
      formatTick: function (v) { return Fmt.n(v, 1); },
      captionEl: document.getElementById('chart-weight-caption'),
      idleCaption: 'העבר את האצבע על הגרף',
      onHover: function (x) {
        var parts = [Dates.long(Dates.fromDayIndex(x))];
        if (rawMap[x] !== undefined) parts.push('שקילה ' + Fmt.n(rawMap[x], 1));
        if (maMap[x] !== undefined) parts.push('ממוצע ' + Fmt.n(maMap[x], 2));
        if (ewmaMap[x] !== undefined) parts.push('מעריכי ' + Fmt.n(ewmaMap[x], 2));
        return parts.join('  ·  ');
      }
    });
    document.getElementById('chart-weight-legend').innerHTML = legend([
      { color: COLORS.measuredFaint, label: 'שקילות' },
      { color: COLORS.measured, label: 'ממוצע נע 7 ימים' },
      { color: COLORS.reference, label: 'מגמה מעריכית' }
    ].concat(target ? [{ color: COLORS.over, label: 'משקל יעד' }] : []));
  }

  function drawComposition(entries) {
    var derived = Metrics.deriveAll(entries);
    var fat = Metrics.movingAverage(derived, 'bodyFatKg', { windowDays: 7, minPoints: 3 })
      .filter(function (d) { return d.y !== null; });
    var lean = Metrics.movingAverage(derived, 'leanKg', { windowDays: 7, minPoints: 3 })
      .filter(function (d) { return d.y !== null; });
    if (fat.length < 2) return;

    var fatMap = lookup(fat), leanMap = lookup(lean);
    Chart.render(document.getElementById('chart-comp'), {
      series: [
        { type: 'line', color: COLORS.measured, width: 2.2, points: toPoints(fat) },
        { type: 'line', color: COLORS.lean, width: 2.2, points: toPoints(lean) }
      ],
      height: 190,
      formatX: function (x) { return Dates.short(Dates.fromDayIndex(x)); },
      formatTick: function (v) { return Fmt.n(v, 0); },
      captionEl: document.getElementById('chart-comp-caption'),
      idleCaption: 'ממוצע נע של שבעה ימים',
      onHover: function (x) {
        var parts = [Dates.long(Dates.fromDayIndex(x))];
        if (fatMap[x] !== undefined) parts.push('שומן ' + Fmt.n(fatMap[x], 2));
        if (leanMap[x] !== undefined) parts.push('רזה ' + Fmt.n(leanMap[x], 2));
        return parts.join('  ·  ');
      }
    });
    document.getElementById('chart-comp-legend').innerHTML = legend([
      { color: COLORS.measured, label: 'שומן (ק״ג)' },
      { color: COLORS.lean, label: 'מסה רזה (ק״ג)' }
    ]);
  }

  function drawIntake(entries, settings, field, elementId, digits) {
    var raw = Metrics.series(entries, field);
    if (raw.length < 2) return;
    var target = settings.targets[field];
    var ma = Metrics.movingAverage(entries, field, { windowDays: 7, minPoints: 3 })
      .filter(function (d) { return d.y !== null; });

    var bars = raw.map(function (p) {
      return {
        x: p.x, y: p.y,
        color: Fmt.isNum(target) && p.y > target * 1.1 ? COLORS.over : COLORS.measuredFaint
      };
    });

    var series = [
      { type: 'bars', color: COLORS.measuredFaint, points: bars },
      { type: 'line', color: COLORS.measured, width: 2, points: toPoints(ma) }
    ];
    var targetLine = horizontal(raw, target, COLORS.reference);
    if (targetLine) series.push(targetLine);

    var rawMap = lookup(raw), maMap = lookup(ma);
    Chart.render(document.getElementById(elementId), {
      series: series,
      height: 190,
      yDomain: [0, Math.max.apply(null, raw.map(function (p) { return p.y; }).concat(Fmt.isNum(target) ? [target] : [])) * 1.1],
      formatX: function (x) { return Dates.short(Dates.fromDayIndex(x)); },
      formatTick: function (v) { return Fmt.n(v, 0); },
      captionEl: document.getElementById(elementId + '-caption'),
      idleCaption: Fmt.isNum(target) ? 'קו סגול = יעד יומי' : 'לא הוגדר יעד',
      onHover: function (x) {
        var parts = [Dates.long(Dates.fromDayIndex(x))];
        if (rawMap[x] !== undefined) parts.push(Fmt.n(rawMap[x], digits));
        if (maMap[x] !== undefined) parts.push('ממוצע ' + Fmt.n(maMap[x], digits));
        if (Fmt.isNum(target) && rawMap[x] !== undefined) parts.push('פער ' + Fmt.signed(rawMap[x] - target, digits));
        return parts.join('  ·  ');
      }
    });
    document.getElementById(elementId + '-legend').innerHTML = legend([
      { color: COLORS.measuredFaint, label: 'יומי' },
      { color: COLORS.measured, label: 'ממוצע נע' }
    ].concat(Fmt.isNum(target) ? [{ color: COLORS.reference, label: 'יעד' }] : []));
  }

  /** מסלול ה-TDEE לפי המסנן, עם רצועת אי־ודאות — כאן רואים אם ההוצאה זזה */
  function drawTdee(entries, settings) {
    var r = Metrics.adaptiveTDEE(entries, { kcalPerKg: settings.kcalPerKg });
    if (!r.ok || r.states.length < 5) return false;

    // הימים הראשונים נשלטים על ידי הניחוש ההתחלתי, לא על ידי הנתונים
    var states = r.states.slice(Math.min(6, r.states.length - 3));
    var band = states.map(function (s) {
      return { x: Dates.dayIndex(s.date), lo: s.tdee - 1.96 * s.tdeeSd, hi: s.tdee + 1.96 * s.tdeeSd };
    });
    var line = states.map(function (s) { return { x: Dates.dayIndex(s.date), y: s.tdee }; });
    var intake = Metrics.series(entries, 'kcal').filter(function (p) {
      return p.x >= line[0].x;
    });

    var host = document.getElementById('chart-tdee');
    if (!host) return false;

    var tdeeMap = {}, sdMap = {};
    states.forEach(function (s) {
      tdeeMap[Dates.dayIndex(s.date)] = s.tdee;
      sdMap[Dates.dayIndex(s.date)] = 1.96 * s.tdeeSd;
    });

    Chart.render(host, {
      series: [
        { type: 'band', color: COLORS.band, points: band },
        { type: 'dots', color: COLORS.measuredFaint, points: toPoints(intake), radius: 2 },
        { type: 'line', color: COLORS.measured, width: 2.2, points: line }
      ],
      height: 200,
      formatX: function (x) { return Dates.short(Dates.fromDayIndex(x)); },
      formatTick: function (v) { return Fmt.n(v, 0); },
      captionEl: document.getElementById('chart-tdee-caption'),
      idleCaption: 'הרצועה היא רווח הסמך — היא מצטמצמת ככל שנצברים ימים',
      onHover: function (x) {
        var parts = [Dates.long(Dates.fromDayIndex(x))];
        if (tdeeMap[x] !== undefined) parts.push('TDEE ' + Fmt.n(tdeeMap[x], 0) + ' ±' + Fmt.n(sdMap[x], 0));
        return parts.join('  ·  ');
      }
    });
    document.getElementById('chart-tdee-legend').innerHTML = legend([
      { color: COLORS.measured, label: 'TDEE מוערך' },
      { color: COLORS.measuredFaint, label: 'צריכה יומית' }
    ]);
    return true;
  }

  function render(container) {
    var all = Store.getEntries();
    var settings = Store.getSettings();
    var rangeDays = root.App.state.range;
    var entries = scopedEntries(all, rangeDays);

    if (all.length < 3) {
      container.innerHTML = UI.empty('צריך עוד קצת נתונים',
        'גרפים נפתחים אחרי שלוש רשומות לפחות. יש כרגע ' + all.length + '.');
      return;
    }

    var hasWeight = Metrics.series(entries, 'weightKg').length >= 2;
    var hasFat = Metrics.series(entries, 'bodyFatKg').length >= 2;
    var hasKcal = Metrics.series(entries, 'kcal').length >= 2;
    var hasProtein = Metrics.series(entries, 'proteinG').length >= 2;

    container.innerHTML = '' +
      '<div class="section-label">טווח</div>' +
      UI.chips(RANGES, rangeDays, 'data-range') +
      '<div class="section-label">משקל</div>' +
      (hasWeight ? chartBlock('chart-weight', 'משקל', 'נקודות = שקילות, קו מלא = ממוצע נע, מקווקו = מגמה מעריכית')
                 : UI.empty('אין מספיק שקילות בטווח הזה', '')) +
      (hasFat ? '<div class="section-label">הרכב גוף</div>' +
                chartBlock('chart-comp', 'שומן מול מסה רזה', 'שניהם כממוצע נע, כי המדידה היומית רועשת') : '') +
      (hasKcal ? '<div class="section-label">הוצאה</div>' +
                 chartBlock('chart-tdee', 'מסלול ה-TDEE', 'איך ההערכה השתנתה עם הזמן, ורוחב אי־הוודאות') : '') +
      (hasKcal ? '<div class="section-label">תזונה</div>' +
                 chartBlock('chart-kcal', 'קלוריות', 'עמודה אדומה = חריגה של יותר מ־10% מהיעד') : '') +
      (hasProtein ? chartBlock('chart-protein', 'חלבון', null) : '');

    if (hasWeight) drawWeight(entries, settings);
    if (hasFat) drawComposition(entries);
    if (hasKcal) drawTdee(all, settings);
    if (hasKcal) drawIntake(entries, settings, 'kcal', 'chart-kcal', 0);
    if (hasProtein) drawIntake(entries, settings, 'proteinG', 'chart-protein', 0);

    container.querySelectorAll('[data-range]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        root.App.setState({ range: Number(chip.dataset.range) });
      });
    });
  }

  Views.trends = { id: 'trends', label: 'מגמות', glyph: '~', render: render };
})(typeof window !== 'undefined' ? window : globalThis);
