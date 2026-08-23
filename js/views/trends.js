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

  function chartBlock(id, title, note, intro) {
    return UI.card(title, note,
      (intro ? '<p class="finding" style="font-size:15px;margin-bottom:12px">' + intro + '</p>' : '') +
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
        if (ewmaMap[x] !== undefined) parts.push('מגמה מהירה ' + Fmt.n(ewmaMap[x], 2));
        return parts.join('  ·  ');
      }
    });
    document.getElementById('chart-weight-legend').innerHTML = legend([
      { color: COLORS.measuredFaint, label: 'שקילות' },
      { color: COLORS.measured, label: 'ממוצע 7 ימים' },
      { color: COLORS.reference, label: 'מגמה מהירה' }
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

  var TDEE_MODES = [
    { value: 'daily', label: 'יומי' },
    { value: 'cumulative', label: 'מצטבר' }
  ];

  /**
   * ההוצאה מול הצריכה — ביומי או במצטבר.
   *
   * במצטבר מוצגים סכומים רצים, והשטח בין שני הקווים הוא הגירעון
   * שנצבר. זו הדרך היחידה לראות ישירות כמה קלוריות באמת "נחסכו"
   * מתחילת התקופה, וכמה קילוגרמים זה אמור להיות.
   *
   * גבולות רצועת אי־הוודאות מסומנים בקווים: אדום בתחתית (התרחיש
   * שבו אתה שורף פחות ממה שנראה) וירוק בעליון.
   */
  function drawTdee(entries, settings, mode) {
    var r = Metrics.adaptiveTDEE(entries, { kcalPerKg: settings.kcalPerKg });
    if (!r.ok || r.states.length < 5) return false;
    var host = document.getElementById('chart-tdee');
    if (!host) return false;

    var kcalPerKg = settings.kcalPerKg || 7700;
    // הימים הראשונים נשלטים על ידי הניחוש ההתחלתי ולא על ידי הנתונים
    var states = r.states.slice(Math.min(7, r.states.length - 3));
    var from = Dates.dayIndex(states[0].date);

    var intakeRaw = Metrics.series(entries, 'kcal').filter(function (p) { return p.x >= from; });
    var intakeMa = Metrics.movingAverage(entries, 'kcal', { windowDays: 7, minPoints: 3 })
      .filter(function (d) { return d.y !== null && Dates.dayIndex(d.date) >= from; });
    var intakeByDay = lookup(intakeRaw);
    var meanIntake = Stats0(intakeRaw);

    var series = [], yDomain = null, legendItems = [], caption, hover;
    var lastGap = null, lastLow = null, lastHigh = null;

    if (mode === 'cumulative') {
      var cumBurn = 0, cumEat = 0, cumLow = 0, cumHigh = 0, missing = 0;
      var burnLine = [], eatLine = [], areaBand = [], lowLine = [], highLine = [];

      states.forEach(function (s) {
        var x = Dates.dayIndex(s.date);
        var eaten = intakeByDay[x];
        if (eaten === undefined) { eaten = meanIntake; missing++; }

        cumBurn += s.tdee;
        cumEat += eaten;
        cumLow += s.tdee - 1.96 * s.tdeeSd;
        cumHigh += s.tdee + 1.96 * s.tdeeSd;

        burnLine.push({ x: x, y: cumBurn });
        eatLine.push({ x: x, y: cumEat });
        lowLine.push({ x: x, y: cumLow });
        highLine.push({ x: x, y: cumHigh });
        areaBand.push({ x: x, lo: cumEat, hi: cumBurn });
      });

      lastGap = cumBurn - cumEat;
      lastLow = cumLow - cumEat;
      lastHigh = cumHigh - cumEat;

      series = [
        { type: 'band', color: 'rgba(13,110,103,0.14)', points: areaBand },
        { type: 'line', color: COLORS.over, width: 1.2, dash: '4 4', points: lowLine },
        { type: 'line', color: '#2E6B4F', width: 1.2, dash: '4 4', points: highLine },
        { type: 'line', color: COLORS.reference, width: 2, points: eatLine },
        { type: 'line', color: COLORS.measured, width: 2.4, points: burnLine }
      ];

      var burnMap = lookup(burnLine), eatMap = lookup(eatLine);
      hover = function (x) {
        var parts = [Dates.long(Dates.fromDayIndex(x))];
        if (burnMap[x] !== undefined) parts.push('שרף ' + Fmt.n(burnMap[x], 0));
        if (eatMap[x] !== undefined) parts.push('אכל ' + Fmt.n(eatMap[x], 0));
        if (burnMap[x] !== undefined && eatMap[x] !== undefined) {
          parts.push('פער ' + Fmt.n(burnMap[x] - eatMap[x], 0));
        }
        return parts.join('  ·  ');
      };
      caption = 'השטח בין הקווים הוא הגירעון שנצבר' +
        (missing ? '. ' + missing + ' ימים ללא רישום הושלמו לפי הממוצע' : '');
      legendItems = [
        { color: COLORS.measured, label: 'שרף — מצטבר' },
        { color: COLORS.reference, label: 'אכל — מצטבר' },
        { color: '#2E6B4F', label: 'גבול עליון' },
        { color: COLORS.over, label: 'גבול תחתון' }
      ];

    } else {
      var line = states.map(function (s) { return { x: Dates.dayIndex(s.date), y: s.tdee }; });
      var lowDaily = states.map(function (s) {
        return { x: Dates.dayIndex(s.date), y: s.tdee - 1.96 * s.tdeeSd };
      });
      var highDaily = states.map(function (s) {
        return { x: Dates.dayIndex(s.date), y: s.tdee + 1.96 * s.tdeeSd };
      });

      var values = line.map(function (p) { return p.y; })
        .concat(intakeMa.map(function (d) { return d.y; }));
      var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
      var pad = Math.max((hi - lo) * 0.35, 150);
      yDomain = [lo - pad, hi + pad];
      var clamp = function (v) { return Math.min(Math.max(v, yDomain[0]), yDomain[1]); };

      var band = states.map(function (s) {
        return {
          x: Dates.dayIndex(s.date),
          lo: clamp(s.tdee - 1.96 * s.tdeeSd),
          hi: clamp(s.tdee + 1.96 * s.tdeeSd)
        };
      });
      lowDaily.forEach(function (p) { p.y = clamp(p.y); });
      highDaily.forEach(function (p) { p.y = clamp(p.y); });

      series = [
        { type: 'band', color: COLORS.band, points: band },
        { type: 'line', color: COLORS.over, width: 1.2, dash: '4 4', points: lowDaily },
        { type: 'line', color: '#2E6B4F', width: 1.2, dash: '4 4', points: highDaily },
        { type: 'dots', color: 'rgba(75,85,165,0.35)', points: toPoints(intakeRaw), radius: 2 },
        { type: 'line', color: COLORS.reference, width: 1.8, dash: '5 3', points: toPoints(intakeMa) },
        { type: 'line', color: COLORS.measured, width: 2.4, points: line }
      ];

      var tdeeMap = lookup(line), maMap = lookup(intakeMa), rawMap = lookup(intakeRaw);
      var last = line[line.length - 1].y;
      var lastMa = intakeMa.length ? intakeMa[intakeMa.length - 1].y : null;
      if (lastMa !== null) {
        lastGap = last - lastMa;
        lastLow = lowDaily[lowDaily.length - 1].y - lastMa;
        lastHigh = highDaily[highDaily.length - 1].y - lastMa;
      }

      hover = function (x) {
        var parts = [Dates.long(Dates.fromDayIndex(x))];
        if (tdeeMap[x] !== undefined) parts.push('שורף ' + Fmt.n(tdeeMap[x], 0));
        if (rawMap[x] !== undefined) parts.push('אכל ' + Fmt.n(rawMap[x], 0));
        if (maMap[x] !== undefined) parts.push('ממוצע ' + Fmt.n(maMap[x], 0));
        if (tdeeMap[x] !== undefined && maMap[x] !== undefined) {
          parts.push('הפרש ' + Fmt.n(tdeeMap[x] - maMap[x], 0));
        }
        return parts.join('  ·  ');
      };
      caption = 'הקו הירוק מעל המקווקו הסגול = גירעון';
      legendItems = [
        { color: COLORS.measured, label: 'שורף — הערכה' },
        { color: '#2E6B4F', label: 'גבול עליון' },
        { color: COLORS.over, label: 'גבול תחתון' },
        { color: COLORS.reference, label: 'אוכל — ממוצע 7 ימים' },
        { color: 'rgba(75,85,165,0.35)', label: 'אוכל — יומי' }
      ];
    }

    var config = {
      series: series,
      height: 210,
      formatX: function (x) { return Dates.short(Dates.fromDayIndex(x)); },
      formatTick: function (v) { return Fmt.n(v, 0); },
      captionEl: document.getElementById('chart-tdee-caption'),
      idleCaption: caption,
      onHover: hover
    };
    if (yDomain) config.yDomain = yDomain;
    Chart.render(host, config);

    var unit = mode === 'cumulative' ? ' קלוריות מצטברות' : ' קלוריות ליום';
    var toKg = function (v) { return -(mode === 'cumulative' ? v : v * 7) / kcalPerKg; };

    document.getElementById('chart-tdee-legend').innerHTML =
      legend(legendItems) +
      (lastGap === null ? '' :
        '<p class="basis" style="margin-top:10px;line-height:1.7">' +
        '<strong>הפער כרגע: ' + Fmt.n(lastGap, 0) + unit + '</strong> — ' +
        Fmt.signed(toKg(lastGap), 2) + ' ק״ג.<br>' +
        'אם אתה שורף יותר ממה שנראה: ' + Fmt.signed(lastHigh, 0) +
          ' (' + Fmt.signed(toKg(lastHigh), 2) + ' ק״ג). ' +
        'אם פחות: ' + Fmt.signed(lastLow, 0) + ' (' + Fmt.signed(toKg(lastLow), 2) + ' ק״ג).' +
        '</p>');
    return true;
  }

  /** הסבר בשפה פשוטה על מקור המספר, ללא מונחים סטטיסטיים */
  function methodExplanation() {
    return '' +
      '<p class="finding" style="font-size:15px">המספר לא מגיע מנוסחה שמבוססת על גיל ומשקל, ' +
      'אלא נמדד עליך משני דברים שאתה כבר מדווח: מה אכלת, ומה קרה למשקל.</p>' +

      '<div class="formula">משקל מחר = משקל היום + (מה שאכלת − מה ששרפת) ÷ 7700</div>' +

      '<p class="card-note">כל בוקר החישוב עושה שלושה דברים:</p>' +
      '<div class="metric-row"><span class="label">1. מנבא</span>' +
        '<span class="value">מה המשקל אמור להיות היום</span></div>' +
      '<div class="metric-row"><span class="label">2. משווה</span>' +
        '<span class="value">מול השקילה בפועל</span></div>' +
      '<div class="metric-row"><span class="label">3. מתקן</span>' +
        '<span class="value">את ההערכה כמה אתה שורף</span></div>' +

      UI.basis('ככל שנצברים ימים ההערכה מתייצבת, ולכן הרצועה מצטמצמת. ' +
        'היא לא נסגרת לגמרי כי החישוב מניח שההוצאה שלך יכולה לזוז לאט לאורך זמן — ' +
        'בלי ההנחה הזו הוא לא היה מזהה האטה מטבולית.') +

      UI.basis('המספר כולל הכל: מנוחה, עיכול, תזוזה יומיומית והליכה. ' +
        'במסך "היום" מוצג מספר אחר — ההוצאה בלי הליכה — כדי שהיעד היומי לא יגדל בגלל שהלכת.');
  }

  /** ממוצע פשוט של סדרה, לצורך השלמת ימים חסרים */
  function Stats0(points) {
    if (!points.length) return 0;
    return points.reduce(function (sum, p) { return sum + p.y; }, 0) / points.length;
  }

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
    var tdeeMode = root.App.state.tdeeMode || 'daily';

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
      (hasWeight ? chartBlock('chart-weight', 'משקל',
                   'שני קווי מגמה: הממוצע חלק יותר, המהיר מגיב מוקדם יותר לשינוי אמיתי')
                 : UI.empty('אין מספיק שקילות בטווח הזה', '')) +
      (hasFat ? '<div class="section-label">הרכב גוף</div>' +
                chartBlock('chart-fat', 'שומן', 'בק״ג. נקודות = מדידות, קו = ממוצע נע') : '') +
      (hasMuscle ? chartBlock('chart-muscle', 'שריר', 'בק״ג. נקודות = מדידות, קו = ממוצע נע') : '') +
      (hasKcal ? '<div class="section-label">הוצאה</div>' +
                 UI.chips(TDEE_MODES, tdeeMode, 'data-tdee-mode') +
                 chartBlock('chart-tdee', 'כמה שורף מול כמה אוכל',
                   'שיטה: מסתגל (קלמן) · כולל הליכה',
                   tdeeMode === 'cumulative'
                     ? 'השטח בין הקווים הוא כל הגירעון שנצבר מתחילת התקופה.'
                     : 'כשהקו הירוק מעל המקווקו — אתה יורד. הרווח ביניהם הוא הגירעון היומי.') +
                 UI.details('איך מחושב "שורף"', methodExplanation()) : '') +
      (hasKcal ? '<div class="section-label">תזונה</div>' +
                 chartBlock('chart-kcal', 'קלוריות',
                   'עמודה אדומה = חריגה של יותר מ־10% מהיעד') : '') +
      (hasProtein ? chartBlock('chart-protein', 'חלבון', 'קו אדום = מינימום יומי') : '');

    if (hasWeight) drawWeight(entries, settings);
    if (hasFat) drawBodyField(entries, 'bodyFatKg', 'chart-fat', 'שומן');
    if (hasMuscle) drawBodyField(entries, 'muscleKg', 'chart-muscle', 'שריר');
    if (hasKcal) drawTdee(all, settings, tdeeMode);
    if (hasKcal) drawIntake(entries, settings, 'kcal', 'chart-kcal', 0,
      { target: kcalTarget, targetLabel: targetLabel });
    if (hasProtein) drawIntake(entries, settings, 'proteinG', 'chart-protein', 0,
      { minimum: settings.targets.proteinMinG });

    container.querySelectorAll('[data-tdee-mode]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        root.App.setState({ tdeeMode: chip.dataset.tdeeMode });
      });
    });

    container.querySelectorAll('[data-range]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        root.App.setState({ range: Number(chip.dataset.range) });
      });
    });
  }

  Views.trends = { id: 'trends', label: 'מגמות', glyph: '~', render: render };
})(typeof window !== 'undefined' ? window : globalThis);
