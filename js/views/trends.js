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
        { type: 'line', color: COLORS.over, width: 1, points: lowLine, opacity: 0.55 },
        { type: 'line', color: '#2E6B4F', width: 1, points: highLine, opacity: 0.55 },
        { type: 'line', color: COLORS.reference, width: 2.2, points: eatLine },
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
      // ההיסטוריה מוצגת אחרי המעבר לאחור: כל יום מוערך גם לפי מה
      // שקרה אחריו. היום האחרון זהה בשתי השיטות.
      var pick = function (s) { return Fmt.isNum(s.smoothTdee) ? s.smoothTdee : s.tdee; };
      var pickSd = function (s) { return Fmt.isNum(s.smoothTdeeSd) ? s.smoothTdeeSd : s.tdeeSd; };

      var line = states.map(function (s) { return { x: Dates.dayIndex(s.date), y: pick(s) }; });
      var lowDaily = states.map(function (s) {
        return { x: Dates.dayIndex(s.date), y: pick(s) - 1.96 * pickSd(s) };
      });
      var highDaily = states.map(function (s) {
        return { x: Dates.dayIndex(s.date), y: pick(s) + 1.96 * pickSd(s) };
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
        { type: 'line', color: COLORS.over, width: 1, points: lowDaily, opacity: 0.45 },
        { type: 'line', color: '#2E6B4F', width: 1, points: highDaily, opacity: 0.45 },
        { type: 'dots', color: 'rgba(75,85,165,0.4)', points: toPoints(intakeRaw), radius: 2 },
        { type: 'line', color: COLORS.reference, width: 2.2, points: toPoints(intakeMa) },
        { type: 'line', color: COLORS.measured, width: 2.6, points: line }
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
      var spread = Math.max.apply(null, line.map(function (p) { return p.y; })) -
                   Math.min.apply(null, line.map(function (p) { return p.y; }));
      caption = spread < 120
        ? 'הקו הירוק ישר כי ההוצאה שלך יציבה — כל התנועה היא באכילה'
        : 'ירוק מעל סגול = גירעון. הקו הדק הוא מה שנראה באותו יום.';
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

    var stability = '';
    if (mode !== 'cumulative') {
      var ys = line.map(function (p) { return p.y; });
      var range = Math.max.apply(null, ys) - Math.min.apply(null, ys);
      stability = range < 120
        ? ' ההוצאה שלך יציבה לאורך כל התקופה — טווח של ' + Fmt.n(range, 0) +
          ' קלוריות בלבד. כלומר כל השינוי בגירעון מגיע ממה שאתה אוכל, לא ממה שאתה שורף.'
        : ' ההוצאה נעה בטווח של ' + Fmt.n(range, 0) + ' קלוריות בתקופה.';
    }

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
        Fmt.esc(stability) +
        '</p>');
    return true;
  }

  /**
   * שלושת ההפרשים לכל יום: בין מה שנאכל בפועל לבין הגבול התחתון,
   * ההערכה המרכזית והגבול העליון. זה מה שמראה אם הגירעון של אותו יום
   * ודאי, או שהוא תלוי בשאלה איפה בתוך הטווח נמצאת ההוצאה האמיתית.
   */
  function gapsTable(entries, settings) {
    var r = Metrics.adaptiveTDEE(entries, { kcalPerKg: settings.kcalPerKg });
    if (!r.ok) return UI.empty('אין מספיק נתונים', '');

    var days = r.states.slice(-14).filter(function (s) { return Fmt.isNum(s.intake); });
    if (!days.length) return UI.empty('אין ימים עם רישום קלוריות', '');

    var sum = { intake: 0, tdee: 0, low: 0, mid: 0, high: 0 };
    var cell = function (v) {
      return '<td class="n"><span class="' + Fmt.deltaClass(v, 'up') + '">' +
        Fmt.signed(v, 0) + '</span></td>';
    };

    var rows = days.slice().reverse().map(function (s) {
      var margin = 1.96 * s.tdeeSd;
      var mid = s.tdee - s.intake;
      var low = (s.tdee - margin) - s.intake;
      var high = (s.tdee + margin) - s.intake;
      return '<tr><td class="date-cell">' + Fmt.esc(Dates.short(s.date)) + '</td>' +
        '<td class="n">' + Fmt.n(s.intake, 0) + '</td>' +
        '<td class="n">' + Fmt.n(s.tdee, 0) + '</td>' +
        cell(low) + cell(mid) + cell(high) + '</tr>';
    }).join('');

    days.forEach(function (s) {
      var margin = 1.96 * s.tdeeSd;
      sum.intake += s.intake;
      sum.tdee += s.tdee;
      sum.low += (s.tdee - margin) - s.intake;
      sum.mid += s.tdee - s.intake;
      sum.high += (s.tdee + margin) - s.intake;
    });

    var kcalPerKg = settings.kcalPerKg || 7700;
    var totalRow = '<tr class="summary" style="font-weight:500;border-top:2px solid var(--rule-strong)">' +
      '<td>סה״כ ' + days.length + ' ימים</td>' +
      '<td class="n">' + Fmt.n(sum.intake, 0) + '</td>' +
      '<td class="n">' + Fmt.n(sum.tdee, 0) + '</td>' +
      cell(sum.low) + cell(sum.mid) + cell(sum.high) + '</tr>' +
      '<tr class="summary"><td>בקילוגרמים</td><td class="n">—</td><td class="n">—</td>' +
      '<td class="n">' + Fmt.signed(-sum.low / kcalPerKg, 2) + '</td>' +
      '<td class="n">' + Fmt.signed(-sum.mid / kcalPerKg, 2) + '</td>' +
      '<td class="n">' + Fmt.signed(-sum.high / kcalPerKg, 2) + '</td></tr>';

    return '<div class="table-scroll"><table class="data"><thead><tr>' +
        '<th class="date-cell">יום</th><th class="n">אכלת</th><th class="n">שורף</th>' +
        '<th class="n">גבול תחתון</th><th class="n">הערכה</th><th class="n">גבול עליון</th>' +
      '</tr></thead><tbody>' + rows + totalRow + '</tbody></table></div>' +
      UI.basis('ירוק = גירעון, אדום = עודף. שורת הסה״כ היא המצטבר של התקופה, ' +
        'ומתחתיה אותו מספר בקילוגרמים. יום שכל שלושת התרחישים בו ירוקים הוא יום ' +
        'שבו ירדת בוודאות.');
  }

  /**
   * כמה מותר לאכול בימים הקרובים ועדיין להישאר בירוק.
   *
   * המצטבר הנוכחי הוא G, וההוצאה היומית B. אם אוכלים X ליום במשך N ימים,
   * המצטבר החדש הוא G + N×(B − X). התנאי להישאר בירוק הוא שהוא לא יורד
   * מאפס, ומכאן:  X ≤ B + G/N.
   *
   * זה מחושב שלוש פעמים, לפי שלושת התרחישים של ההוצאה. העמודה הזהירה
   * היא זו שמבטיחה ירוק גם אם אתה שורף פחות ממה שנראה.
   */
  function allowanceTable(entries, settings) {
    var r = Metrics.adaptiveTDEE(entries, { kcalPerKg: settings.kcalPerKg });
    if (!r.ok) return '';

    var days = r.states.slice(-14).filter(function (s) { return Fmt.isNum(s.intake); });
    if (!days.length) return '';

    var last = r.states[r.states.length - 1];
    var margin = 1.96 * last.tdeeSd;
    var burn = { low: last.tdee - margin, mid: last.tdee, high: last.tdee + margin };

    var carried = { low: 0, mid: 0, high: 0 };
    days.forEach(function (s) {
      var m = 1.96 * s.tdeeSd;
      carried.low += (s.tdee - m) - s.intake;
      carried.mid += s.tdee - s.intake;
      carried.high += (s.tdee + m) - s.intake;
    });

    var labels = { 1: 'מחר', 2: 'יומיים', 3: 'שלושה ימים', 5: 'חמישה ימים', 7: 'שבוע' };
    var practicalCeiling = last.tdee + 1500;

    var rows = [1, 2, 3, 5, 7].map(function (n) {
      var cellFor = function (key) {
        var value = burn[key] + carried[key] / n;
        var over = value > practicalCeiling;
        return '<td class="n' + (over ? ' missing' : '') + '">' +
          (value < 0 ? '0' : Fmt.n(value, 0)) + '</td>';
      };
      return '<tr><td>' + Fmt.esc(labels[n]) + '</td>' +
        cellFor('low') + cellFor('mid') + cellFor('high') + '</tr>';
    }).join('');

    return '<div class="table-scroll"><table class="data"><thead><tr>' +
        '<th>טווח</th><th class="n">זהיר</th><th class="n">הערכה</th><th class="n">נדיב</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      UI.basis('הממוצע היומי המרבי שעדיין משאיר את הסה״כ בירוק. ' +
        'העמודה הזהירה מבטיחה ירוק גם אם אתה שורף פחות ממה שנראה — לך לפיה. ' +
        'מספרים אפורים הם מעל מה שסביר לאכול ביום אחד; פשוט תפרוס על יותר ימים.');
  }

  /** החשבון עצמו, יום אחרי יום: ניבוי, מדידה, תיקון */
  function derivationTable(entries, settings) {
    var r = Metrics.adaptiveTDEE(entries, { kcalPerKg: settings.kcalPerKg });
    if (!r.ok) return '';

    var rows = r.states.slice(-8).reverse().map(function (s) {
      return '<tr><td class="n">' + Fmt.esc(Dates.short(s.date)) + '</td>' +
        '<td class="n">' + Fmt.n(s.predictedWeight, 2) + '</td>' +
        '<td class="n">' + (Fmt.isNum(s.measuredWeight) ? Fmt.n(s.measuredWeight, 2) : '—') + '</td>' +
        '<td class="n">' + (Fmt.isNum(s.residual) ? Fmt.signed(s.residual, 2) : '—') + '</td>' +
        '<td class="n">' + Fmt.n(s.tdee, 0) + '</td></tr>';
    }).join('');

    return '<div class="table-scroll"><table class="data"><thead><tr>' +
        '<th>יום</th><th class="n">ניבוי</th><th class="n">נמדד</th>' +
        '<th class="n">הפרש</th><th class="n">שורף אחרי התיקון</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      UI.basis('משקל גבוה מהניבוי אומר ששרפת פחות ממה שהמערכת חשבה, וההערכה יורדת. ' +
        'ההפרש לא נלקח במלואו: חלק ממנו מיוחס לרעש נוזלים ולא לשריפה.');
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
                     : 'הקו הירוק העבה = כמה שורף. הסגול = כמה אוכל. ' +
                       'כשהירוק מעל הסגול אתה יורד, והרווח ביניהם הוא הגירעון.') +
                 UI.details('איך מחושב "שורף"',
                   methodExplanation() +
                   '<div class="section-label">החשבון של הימים האחרונים</div>' +
                   derivationTable(all, settings)) +
                 '<div class="section-label">הגירעון היומי, בשלושה תרחישים</div>' +
                 UI.card(null, null, gapsTable(all, settings)) +
                 '<div class="section-label">כמה אפשר לאכול ולהישאר בירוק</div>' +
                 UI.card(null, null, allowanceTable(all, settings)) : '') +
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
