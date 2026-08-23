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

  /**
   * שומן ושריר בשני גרפים נפרדים, ולא באותו גרף.
   * שומן נע סביב 22 ק״ג ושריר סביב 35, ובגרף משותף כל אחד מהם
   * נראה כקו ישר כי הסקאלה נשלטת על ידי המרחק ביניהם.
   */
  function drawBodyField(entries, field, elementId, label) {
    var line = Metrics.movingAverage(entries, field, { windowDays: 7, minPoints: 3 })
      .filter(function (d) { return d.y !== null; });
    var raw = Metrics.series(entries, field);
    if (line.length < 2) return false;

    var host = document.getElementById(elementId);
    if (!host) return false;

    var lineMap = lookup(line), rawMap = lookup(raw);
    Chart.render(host, {
      series: [
        { type: 'dots', color: COLORS.measuredFaint, points: toPoints(raw), radius: 2 },
        { type: 'line', color: COLORS.measured, width: 2.2, points: toPoints(line) }
      ],
      height: 180,
      formatX: function (x) { return Dates.short(Dates.fromDayIndex(x)); },
      formatTick: function (v) { return Fmt.n(v, 1); },
      captionEl: document.getElementById(elementId + '-caption'),
      idleCaption: 'קו = ממוצע נע של שבעה ימים',
      onHover: function (x) {
        var parts = [Dates.long(Dates.fromDayIndex(x))];
        if (rawMap[x] !== undefined) parts.push('מדידה ' + Fmt.n(rawMap[x], 1));
        if (lineMap[x] !== undefined) parts.push('ממוצע ' + Fmt.n(lineMap[x], 2));
        return parts.join('  ·  ');
      }
    });
    document.getElementById(elementId + '-legend').innerHTML = legend([
      { color: COLORS.measuredFaint, label: 'מדידות' },
      { color: COLORS.measured, label: label + ' — ממוצע נע' }
    ]);
    return true;
  }

  /**
   * גרף צריכה יומית מול יעד.
   * options.target הוא היעד בפועל — לקלוריות הוא מגיע מהשיטה שנבחרה
   * במסך הבית ולא משדה קבוע בהגדרות, אחרת לא ברור לאיזה יעד הכוונה
   * כשיש כמה הערכות TDEE במקביל.
   */
  function drawIntake(entries, settings, field, elementId, digits, options) {
    var opts = options || {};
    var raw = Metrics.series(entries, field);
    if (raw.length < 2) return;
    var target = Fmt.isNum(opts.target) ? opts.target : settings.targets[field];
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

    var minLine = Fmt.isNum(opts.minimum) ? horizontal(raw, opts.minimum, COLORS.over, '2 3') : null;
    if (minLine) series.push(minLine);

    var rawMap = lookup(raw), maMap = lookup(ma);
    Chart.render(document.getElementById(elementId), {
      series: series,
      height: 190,
      yDomain: [0, Math.max.apply(null, raw.map(function (p) { return p.y; }).concat(Fmt.isNum(target) ? [target] : [])) * 1.1],
      formatX: function (x) { return Dates.short(Dates.fromDayIndex(x)); },
      formatTick: function (v) { return Fmt.n(v, 0); },
      captionEl: document.getElementById(elementId + '-caption'),
      idleCaption: Fmt.isNum(target)
        ? 'קו סגול = ' + (opts.targetLabel || 'יעד יומי')
        : 'לא הוגדר יעד',
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
    ].concat(Fmt.isNum(target) ? [{ color: COLORS.reference, label: opts.targetLabel || 'יעד' }] : [])
     .concat(minLine ? [{ color: COLORS.over, label: 'מינימום ' + Fmt.n(opts.minimum, 0) }] : []));
  }

  /**
   * מסלול ההוצאה לאורך זמן, מול הצריכה בפועל.
   *
   * שתי החלטות שנועדו להפוך אותו לקריא:
   * הסקאלה נקבעת לפי הקווים עצמם והרצועה נחתכת אליה, אחרת רווח סמך
   * רחב מוחץ את כל השאר לקו ישר. והשיטה נכתבת במפורש, כי יש כמה
   * הערכות TDEE במקביל ובלי ציון מפורש לא ברור איזו מהן מוצגת.
   */
  function drawTdee(entries, settings) {
    var r = Metrics.adaptiveTDEE(entries, { kcalPerKg: settings.kcalPerKg });
    if (!r.ok || r.states.length < 5) return false;
    var host = document.getElementById('chart-tdee');
    if (!host) return false;

    // הימים הראשונים נשלטים על ידי הניחוש ההתחלתי ולא על ידי הנתונים
    var states = r.states.slice(Math.min(7, r.states.length - 3));
    var line = states.map(function (s) { return { x: Dates.dayIndex(s.date), y: s.tdee }; });
    var intakeRaw = Metrics.series(entries, 'kcal').filter(function (p) { return p.x >= line[0].x; });
    var intakeMa = Metrics.movingAverage(entries, 'kcal', { windowDays: 7, minPoints: 3 })
      .filter(function (d) { return d.y !== null && Dates.dayIndex(d.date) >= line[0].x; });

    // סקאלה לפי הקווים, ורק אז חיתוך הרצועה אליה
    var values = line.map(function (p) { return p.y; })
      .concat(intakeMa.map(function (d) { return d.y; }));
    var lo = Math.min.apply(null, values);
    var hi = Math.max.apply(null, values);
    var pad = Math.max((hi - lo) * 0.35, 150);
    var yLo = lo - pad, yHi = hi + pad;
    var clamp = function (v) { return Math.min(Math.max(v, yLo), yHi); };

    var band = states.map(function (s) {
      return {
        x: Dates.dayIndex(s.date),
        lo: clamp(s.tdee - 1.96 * s.tdeeSd),
        hi: clamp(s.tdee + 1.96 * s.tdeeSd)
      };
    });

    var tdeeMap = {}, sdMap = {};
    states.forEach(function (s) {
      tdeeMap[Dates.dayIndex(s.date)] = s.tdee;
      sdMap[Dates.dayIndex(s.date)] = 1.96 * s.tdeeSd;
    });
    var rawMap = lookup(intakeRaw), maMap = lookup(intakeMa);

    Chart.render(host, {
      series: [
        { type: 'band', color: COLORS.band, points: band },
        { type: 'dots', color: 'rgba(75,85,165,0.35)', points: toPoints(intakeRaw), radius: 2 },
        { type: 'line', color: COLORS.reference, width: 1.8, dash: '5 3', points: toPoints(intakeMa) },
        { type: 'line', color: COLORS.measured, width: 2.4, points: line }
      ],
      height: 210,
      yDomain: [yLo, yHi],
      formatX: function (x) { return Dates.short(Dates.fromDayIndex(x)); },
      formatTick: function (v) { return Fmt.n(v, 0); },
      captionEl: document.getElementById('chart-tdee-caption'),
      idleCaption: 'הרצועה היא טווח אי־הוודאות של ההוצאה',
      onHover: function (x) {
        var parts = [Dates.long(Dates.fromDayIndex(x))];
        if (tdeeMap[x] !== undefined) parts.push('שורף ' + Fmt.n(tdeeMap[x], 0) + ' ±' + Fmt.n(sdMap[x], 0));
        if (rawMap[x] !== undefined) parts.push('אכל ' + Fmt.n(rawMap[x], 0));
        if (maMap[x] !== undefined) parts.push('ממוצע ' + Fmt.n(maMap[x], 0));
        return parts.join('  ·  ');
      }
    });
    document.getElementById('chart-tdee-legend').innerHTML = legend([
      { color: COLORS.measured, label: 'שורף — מסתגל (קלמן), כולל הליכה' },
      { color: COLORS.reference, label: 'אוכל — ממוצע נע' },
      { color: 'rgba(75,85,165,0.35)', label: 'אוכל — יומי' }
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
    var hasMuscle = Metrics.series(entries, 'muscleKg').length >= 2;

    // אותו יעד שמוצג במסך הבית, לפי אותה שיטה שנבחרה שם
    var report = Metrics.windowReport(all, settings, {
      windowDays: root.App.state.calcWindow,
      endDate: Dates.today()
    });
    var kcalTarget = report.ok ? report.target : settings.targets.kcal;
    var targetLabel = report.ok
      ? 'יעד לפי ' + (report.windowDays === 'adaptive' ? 'החישוב המסתגל' : 'חלון ' + report.statsDays + ' ימים')
      : 'יעד';

    container.innerHTML = '' +
      '<div class="section-label">טווח</div>' +
      UI.chips(RANGES, rangeDays, 'data-range') +
      '<div class="section-label">משקל</div>' +
      (hasWeight ? chartBlock('chart-weight', 'משקל', 'נקודות = שקילות, קו מלא = ממוצע נע, מקווקו = מגמה מעריכית')
                 : UI.empty('אין מספיק שקילות בטווח הזה', '')) +
      (hasFat ? '<div class="section-label">הרכב גוף</div>' +
                chartBlock('chart-fat', 'שומן', 'בק״ג. נקודות = מדידות, קו = ממוצע נע') : '') +
      (hasMuscle ? chartBlock('chart-muscle', 'שריר', 'בק״ג. נקודות = מדידות, קו = ממוצע נע') : '') +
      (hasKcal ? '<div class="section-label">הוצאה</div>' +
                 chartBlock('chart-tdee', 'כמה שורף מול כמה אוכל', 'ההוצאה המסתגלת עם טווח אי־הוודאות, מול הצריכה בפועל') : '') +
      (hasKcal ? '<div class="section-label">תזונה</div>' +
                 chartBlock('chart-kcal', 'קלוריות',
                   'עמודה אדומה = חריגה של יותר מ־10% מהיעד') : '') +
      (hasProtein ? chartBlock('chart-protein', 'חלבון', 'קו אדום = מינימום יומי') : '');

    if (hasWeight) drawWeight(entries, settings);
    if (hasFat) drawBodyField(entries, 'bodyFatKg', 'chart-fat', 'שומן');
    if (hasMuscle) drawBodyField(entries, 'muscleKg', 'chart-muscle', 'שריר');
    if (hasKcal) drawTdee(all, settings);
    if (hasKcal) drawIntake(entries, settings, 'kcal', 'chart-kcal', 0,
      { target: kcalTarget, targetLabel: targetLabel });
    if (hasProtein) drawIntake(entries, settings, 'proteinG', 'chart-protein', 0,
      { minimum: settings.targets.proteinMinG });

    container.querySelectorAll('[data-range]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        root.App.setState({ range: Number(chip.dataset.range) });
      });
    });
  }

  Views.trends = { id: 'trends', label: 'מגמות', glyph: '~', render: render };
})(typeof window !== 'undefined' ? window : globalThis);
