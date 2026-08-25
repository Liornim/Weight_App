/**
 * Metrics — כל החישובים של האפליקציה.
 *
 * שני עקרונות שמנחים את הקובץ הזה:
 * 1. אף מספר לא מוצג בלי לדעת על כמה נתונים הוא נשען. כל פונקציה מחזירה
 *    גם n / coverage / rווח סמך, ומחזירה null כשאין מספיק נתונים
 *    במקום להחזיר אפס שנראה כמו מדידה.
 * 2. מדידות בודדות ממשקל חכם רועשות מאוד (נוזלים, שעה ביום, מלח).
 *    לכן מגמות מחושבות ברגרסיה על החלון כולו, ולא כהפרש בין שתי נקודות.
 */
(function (root) {
  'use strict';

  var Stats = root.Stats;
  var Dates = root.Dates;

  /** שדות המערכת. label משמש בטפסים ובדוחות, אין כפילות של מחרוזות. */
  var FIELDS = {
    weightKg:  { key: 'weightKg',  label: 'משקל',   unit: 'ק״ג', group: 'body',      digits: 1, step: 0.1 },
    bodyFatKg: { key: 'bodyFatKg', label: 'שומן',   unit: 'ק״ג', group: 'body',      digits: 1, step: 0.1 },
    muscleKg:  { key: 'muscleKg',  label: 'שריר',   unit: 'ק״ג', group: 'body',      digits: 1, step: 0.1 },
    waterKg:   { key: 'waterKg',   label: 'נוזלים', unit: 'ק״ג', group: 'body',      digits: 1, step: 0.1 },
    kcal:      { key: 'kcal',      label: 'קלוריות', unit: 'קק״ל', group: 'nutrition', digits: 0, step: 1 },
    proteinG:  { key: 'proteinG',  label: 'חלבון',  unit: 'גר׳', group: 'nutrition', digits: 0, step: 1 },
    carbG:     { key: 'carbG',     label: 'פחמימה', unit: 'גר׳', group: 'nutrition', digits: 0, step: 1 },
    fatG:      { key: 'fatG',      label: 'שומן',   unit: 'גר׳', group: 'nutrition', digits: 0, step: 1 },
    fiberG:    { key: 'fiberG',    label: 'סיבים',  unit: 'גר׳', group: 'nutrition', digits: 0, step: 0.1 },
    steps:     { key: 'steps',     label: 'צעדים',  unit: '',    group: 'activity',  digits: 0, step: 1 }
  };

  var BODY_FIELDS = ['weightKg', 'bodyFatKg', 'muscleKg', 'waterKg'];
  var NUTRITION_FIELDS = ['kcal', 'proteinG', 'carbG', 'fatG', 'fiberG'];

  /** ברירת מחדל: קק״ל לק״ג רקמה מעורבת. שומן טהור ≈ 9400, לכן 7700 שמרני. */
  var DEFAULT_KCAL_PER_KG = 7700;

  function num(v) {
    return typeof v === 'number' && isFinite(v) ? v : null;
  }

  /** מוסיף שדות נגזרים לרשומה בודדת (מסה רזה, אחוז שומן) */
  function derive(entry) {
    if (!entry) return entry;
    var w = num(entry.weightKg), f = num(entry.bodyFatKg);
    var out = Object.assign({}, entry);
    out.leanKg = (w !== null && f !== null) ? w - f : null;
    out.bodyFatPct = (w !== null && f !== null && w > 0) ? (f / w) * 100 : null;
    return out;
  }

  function deriveAll(entries) {
    return (entries || []).map(derive);
  }

  /** ממיין לפי תאריך עולה ומחזיר עותק */
  function sorted(entries) {
    return (entries || []).slice().sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
  }

  function inWindow(entries, endDate, windowDays) {
    var start = Dates.addDays(endDate, -(windowDays - 1));
    return sorted(entries).filter(function (e) {
      return e.date >= start && e.date <= endDate;
    });
  }

  /** [{x: dayIndex, y: value, date}] עבור שדה נתון, ללא ערכים חסרים */
  function series(entries, field) {
    return sorted(deriveAll(entries))
      .map(function (e) {
        return { date: e.date, x: Dates.dayIndex(e.date), y: num(e[field]) };
      })
      .filter(function (p) { return p.y !== null; });
  }

  /**
   * ממוצע נע אחורי. לכל תאריך: ממוצע הערכים ב-windowDays הימים האחרונים.
   * מחזיר null כשאין לפחות minPoints מדידות — ממוצע על מדידה אחת הוא לא ממוצע.
   */
  function movingAverage(entries, field, options) {
    var opts = options || {};
    var windowDays = opts.windowDays || 7;
    var minPoints = opts.minPoints || 3;
    var points = series(entries, field);
    if (!points.length) return [];

    var from = opts.from || points[0].date;
    var to = opts.to || points[points.length - 1].date;

    return Dates.range(from, to).map(function (date) {
      var start = Dates.addDays(date, -(windowDays - 1));
      var vals = points
        .filter(function (p) { return p.date >= start && p.date <= date; })
        .map(function (p) { return p.y; });
      return {
        date: date,
        x: Dates.dayIndex(date),
        y: vals.length >= minPoints ? Stats.mean(vals) : null,
        n: vals.length
      };
    });
  }

  /** הערך האחרון של הממוצע הנע שאינו null */
  function latestMovingAverage(entries, field, options) {
    var opts = Object.assign({}, options);
    if (opts.to === undefined) opts.to = Dates.today();
    var ma = movingAverage(entries, field, opts);
    for (var i = ma.length - 1; i >= 0; i--) {
      if (ma[i].y !== null) return ma[i];
    }
    return null;
  }

  /**
   * מגמה: שיפוע רגרסיה על החלון, מתורגם ליחידות לשבוע.
   * מחזיר גם רווח סמך — הפער בין "יורד חצי קילו בשבוע" לבין
   * "יורד חצי קילו בשבוע ± 700 גרם" הוא כל ההבדל.
   */
  function trend(entries, field, options) {
    var opts = options || {};
    var windowDays = opts.windowDays || 14;
    var endDate = opts.endDate || Dates.today();
    var minPoints = opts.minPoints || 5;

    var points = series(inWindow(entries, endDate, windowDays), field);
    if (points.length < minPoints) {
      return { ok: false, reason: 'insufficient', n: points.length, needed: minPoints, windowDays: windowDays };
    }

    var spanDays = points[points.length - 1].x - points[0].x;
    var reg = Stats.linearRegression(points);
    if (!reg) {
      return { ok: false, reason: 'insufficient', n: points.length, needed: minPoints, windowDays: windowDays };
    }

    return {
      ok: true,
      windowDays: windowDays,
      n: points.length,
      spanDays: spanDays,
      slopePerDay: reg.slope,
      perWeek: reg.slope * 7,
      ci95PerWeek: reg.ci95 === null ? null : reg.ci95 * 7,
      r2: reg.r2,
      // ההפרש הצפוי על פני החלון, לפי הקו ולא לפי שתי נקודות קצה
      changeOverWindow: reg.slope * spanDays,
      ci95Change: reg.ci95 === null ? null : reg.ci95 * spanDays,
      from: points[0].date,
      to: points[points.length - 1].date,
      fitStart: reg.at(points[0].x),
      fitEnd: reg.at(points[points.length - 1].x)
    };
  }

  /** אילו מהימים האחרונים מכילים נתון בשדה מסוים */
  function coverage(entries, options) {
    var opts = options || {};
    var windowDays = opts.windowDays || 7;
    var endDate = opts.endDate || Dates.today();
    var field = opts.field || null;
    var byDate = {};
    (entries || []).forEach(function (e) { byDate[e.date] = e; });

    var days = Dates.lastDays(endDate, windowDays).map(function (date) {
      var e = byDate[date];
      var has = !!e && (field ? num(e[field]) !== null : hasAnyValue(e));
      return { date: date, has: has };
    });
    var count = days.filter(function (d) { return d.has; }).length;
    return { days: days, count: count, total: windowDays, pct: count / windowDays };
  }

  function hasAnyValue(entry) {
    return Object.keys(FIELDS).some(function (k) { return num(entry[k]) !== null; });
  }

  /**
   * הערכת TDEE מהנתונים עצמם, לא מנוסחה.
   *
   *   TDEE = צריכה ממוצעת − (שינוי משקל ליום × קק״ל לק״ג)
   *
   * זה המדד היחיד כאן שבאמת אומר "כמה אתה שורף", כי הוא נמדד עליך
   * ולא על ממוצע האוכלוסייה. הוא שווה משהו רק אם שני האגפים אמינים,
   * ולכן יש כאן בדיקות סף מפורשות.
   */
  function estimateTDEE(entries, options) {
    var opts = options || {};
    var windowDays = opts.windowDays || 14;
    var endDate = opts.endDate || Dates.today();
    var kcalPerKg = opts.kcalPerKg || DEFAULT_KCAL_PER_KG;

    var windowEntries = inWindow(entries, endDate, windowDays);
    var kcalPoints = series(windowEntries, 'kcal');
    var weightPoints = series(windowEntries, 'weightKg');

    var minKcalDays = Math.max(7, Math.ceil(windowDays * 0.6));
    var minWeightDays = Math.max(6, Math.ceil(windowDays * 0.5));

    var base = {
      ok: false,
      windowDays: windowDays,
      kcalDays: kcalPoints.length,
      weightDays: weightPoints.length,
      minKcalDays: minKcalDays,
      minWeightDays: minWeightDays
    };

    if (kcalPoints.length < minKcalDays) {
      return Object.assign(base, { reason: 'kcal' });
    }
    if (weightPoints.length < minWeightDays) {
      return Object.assign(base, { reason: 'weight' });
    }

    var span = weightPoints[weightPoints.length - 1].x - weightPoints[0].x;
    if (span < windowDays * 0.6) {
      return Object.assign(base, { reason: 'span', spanDays: span });
    }

    var reg = Stats.linearRegression(weightPoints);
    if (!reg) return Object.assign(base, { reason: 'weight' });

    var kcalValues = kcalPoints.map(function (p) { return p.y; });
    var meanKcal = Stats.mean(kcalValues);
    var sdKcal = Stats.stdDev(kcalValues);

    var tdee = meanKcal - reg.slope * kcalPerKg;

    // שני מקורות אי־ודאות: רעש במגמת המשקל, ורעש בדיווח הקלוריות.
    var slopeError = reg.seSlope === null ? null : reg.seSlope * kcalPerKg;
    var intakeError = sdKcal === null ? null : sdKcal / Math.sqrt(kcalValues.length);
    var se = Stats.combineErrors([slopeError, intakeError]);

    return {
      ok: true,
      windowDays: windowDays,
      tdee: tdee,
      ci95: se === null ? null : 1.96 * se,
      meanKcal: meanKcal,
      sdKcal: sdKcal,
      slopePerDay: reg.slope,
      slopePerWeek: reg.slope * 7,
      r2: reg.r2,
      kcalDays: kcalPoints.length,
      weightDays: weightPoints.length,
      spanDays: span,
      kcalPerKg: kcalPerKg,
      // הגירעון בפועל שנמדד בחלון הזה
      deficit: tdee - meanKcal
    };
  }

  /** מריץ את הערכת ה-TDEE על כמה חלונות ובוחר את הצר ביותר שעבר את הסף */
  function estimateTDEEMulti(entries, options) {
    var opts = options || {};
    var windows = opts.windows || [28, 21, 14];
    var results = windows.map(function (w) {
      return estimateTDEE(entries, Object.assign({}, opts, { windowDays: w }));
    });
    var valid = results.filter(function (r) { return r.ok && r.ci95 !== null; });
    valid.sort(function (a, b) { return a.ci95 - b.ci95; });
    return { best: valid[0] || results.find(function (r) { return r.ok; }) || null, all: results };
  }

  /**
   * מאיפה הגיע שינוי המשקל: שומן או מסה רזה.
   * מחושב מהקווים ולא מנקודות הקצה, כי מדידת שומן בודדת יכולה לזוז ב-800 גרם
   * רק בגלל רמת הנוזלים באותו בוקר.
   */
  function composition(entries, options) {
    var opts = options || {};
    var windowDays = opts.windowDays || 28;

    // רק ימים שבהם נמדדו גם משקל וגם שומן. כך שלוש הרגרסיות רצות על
    // אותם ימים בדיוק, והחלקים מסתכמים לשלם: Δמשקל = Δשומן + Δרזה.
    var paired = deriveAll(entries).filter(function (e) {
      return num(e.weightKg) !== null && num(e.bodyFatKg) !== null;
    });

    var settings = { windowDays: windowDays, endDate: opts.endDate };
    var weight = trend(paired, 'weightKg', settings);
    var fat = trend(paired, 'bodyFatKg', settings);
    var lean = trend(paired, 'leanKg', settings);

    var out = {
      ok: weight.ok && fat.ok,
      windowDays: windowDays,
      pairedDays: weight.ok ? weight.n : inWindow(paired, opts.endDate || Dates.today(), windowDays).length,
      weight: weight,
      fat: fat,
      lean: lean
    };

    if (out.ok && Math.abs(weight.changeOverWindow) > 0.15) {
      out.fatShare = fat.changeOverWindow / weight.changeOverWindow;
      out.leanShare = lean.ok ? lean.changeOverWindow / weight.changeOverWindow : null;
    } else {
      out.fatShare = null;
      out.leanShare = null;
      if (out.ok) out.reason = 'stable'; // שינוי קטן מדי מכדי לפרק אותו
    }
    return out;
  }

  /** ממוצעי תזונה בחלון, כולל כמה ימים באמת נכנסו לחישוב */
  function nutritionSummary(entries, options) {
    var opts = options || {};
    var windowDays = opts.windowDays || 7;
    var endDate = opts.endDate || Dates.today();
    var windowEntries = inWindow(entries, endDate, windowDays);

    var out = { windowDays: windowDays, endDate: endDate, fields: {} };
    NUTRITION_FIELDS.concat(['steps']).forEach(function (field) {
      var values = series(windowEntries, field).map(function (p) { return p.y; });
      out.fields[field] = {
        mean: Stats.mean(values),
        sd: Stats.stdDev(values),
        min: Stats.min(values),
        max: Stats.max(values),
        total: Stats.sum(values),
        days: values.length,
        coverage: values.length / windowDays
      };
    });
    return out;
  }

  /**
   * עמידה ביעדים. tolerance הוא סטייה יחסית שנחשבת "בטווח".
   * pctInRange חשוב לא פחות מהממוצע: ממוצע מושלם יכול להיות
   * שילוב של יומיים גבוהים ויומיים נמוכים.
   */
  function adherence(entries, targets, options) {
    var opts = options || {};
    var windowDays = opts.windowDays || 7;
    var endDate = opts.endDate || Dates.today();
    var tolerance = opts.tolerance === undefined ? 0.1 : opts.tolerance;
    var windowEntries = inWindow(entries, endDate, windowDays);

    var out = {};
    NUTRITION_FIELDS.forEach(function (field) {
      var target = num((targets || {})[field]);
      var values = series(windowEntries, field).map(function (p) { return p.y; });
      var mean = Stats.mean(values);
      var inRange = target === null ? null : values.filter(function (v) {
        return Math.abs(v - target) <= target * tolerance;
      }).length;
      out[field] = {
        target: target,
        mean: mean,
        days: values.length,
        gap: (mean === null || target === null) ? null : mean - target,
        gapPct: (mean === null || !target) ? null : (mean - target) / target,
        inRange: inRange,
        pctInRange: (inRange === null || !values.length) ? null : inRange / values.length
      };
    });
    return { windowDays: windowDays, endDate: endDate, tolerance: tolerance, fields: out };
  }

  /**
   * תקציב שבועי: כמה נשאר לשבוע הנוכחי וכמה זה ליום שנותר.
   * עובד על שבוע ראשון–שבת, ומתייחס לימים בלי דיווח כאל 0 — לכן
   * מוחזר גם loggedDays כדי שיהיה ברור מה נכלל.
   */
  function weekBudget(entries, targets, options) {
    var opts = options || {};
    var date = opts.date || Dates.today();
    var dailyTarget = num((targets || {}).kcal);
    if (dailyTarget === null) return { ok: false, reason: 'no-target' };

    var start = Dates.weekStart(date);
    var days = Dates.range(start, Dates.addDays(start, 6));
    var byDate = {};
    (entries || []).forEach(function (e) { byDate[e.date] = e; });

    var consumed = 0, loggedDays = 0, elapsedDays = 0;
    days.forEach(function (d) {
      if (d > date) return;
      elapsedDays++;
      var v = byDate[d] ? num(byDate[d].kcal) : null;
      if (v !== null) { consumed += v; loggedDays++; }
    });

    var weekTarget = dailyTarget * 7;
    var remainingDays = 7 - elapsedDays + 1; // כולל היום
    var todayLogged = byDate[date] ? num(byDate[date].kcal) : null;
    if (todayLogged !== null) remainingDays -= 1;

    var remaining = weekTarget - consumed;
    return {
      ok: true,
      weekStart: start,
      weekTarget: weekTarget,
      consumed: consumed,
      remaining: remaining,
      elapsedDays: elapsedDays,
      loggedDays: loggedDays,
      remainingDays: Math.max(remainingDays, 0),
      perRemainingDay: remainingDays > 0 ? remaining / remainingDays : null,
      missingDays: elapsedDays - loggedDays
    };
  }

  /** השוואת חלון נוכחי מול החלון שקדם לו */
  function comparePeriods(entries, options) {
    var opts = options || {};
    var windowDays = opts.windowDays || 14;
    var endDate = opts.endDate || Dates.today();
    var prevEnd = Dates.addDays(endDate, -windowDays);

    function snapshot(end) {
      var win = inWindow(entries, end, windowDays);
      var withLean = deriveAll(win);
      var row = { from: Dates.addDays(end, -(windowDays - 1)), to: end, fields: {} };
      BODY_FIELDS.concat(['leanKg', 'bodyFatPct']).forEach(function (f) {
        var vals = series(withLean, f).map(function (p) { return p.y; });
        row.fields[f] = { mean: Stats.mean(vals), days: vals.length };
      });
      NUTRITION_FIELDS.concat(['steps']).forEach(function (f) {
        var vals = series(win, f).map(function (p) { return p.y; });
        row.fields[f] = { mean: Stats.mean(vals), days: vals.length };
      });
      return row;
    }

    var current = snapshot(endDate);
    var previous = snapshot(prevEnd);
    var deltas = {};
    Object.keys(current.fields).forEach(function (f) {
      var a = current.fields[f].mean, b = previous.fields[f].mean;
      deltas[f] = (a === null || b === null) ? null : a - b;
    });
    return { windowDays: windowDays, current: current, previous: previous, deltas: deltas };
  }

  /**
   * יעד קלוריות נגזר: ה-TDEE שנמדד, פחות הגירעון שנדרש כדי לרדת
   * בקצב המבוקש. עדיף על נוסחה, כי הוא מבוסס על מה שקרה בפועל.
   */
  function suggestedKcal(tdee, ratePerWeekKg, kcalPerKg) {
    if (num(tdee) === null || num(ratePerWeekKg) === null) return null;
    return tdee + (ratePerWeekKg * (kcalPerKg || DEFAULT_KCAL_PER_KG)) / 7;
  }

  /**
   * מתי נגיע למשקל היעד אם הקצב הנוכחי יימשך.
   * מחזיר null כשהמגמה מנוגדת ליעד — עדיף לא להציג תאריך מאשר להמציא אחד.
   */
  function projection(currentWeight, targetWeight, perWeek, fromDate) {
    if (num(currentWeight) === null || num(targetWeight) === null || num(perWeek) === null) return null;
    var gap = targetWeight - currentWeight;
    if (Math.abs(gap) < 0.05) return { weeks: 0, date: fromDate || Dates.today(), gap: gap };
    if (perWeek === 0 || (gap > 0) !== (perWeek > 0)) return { weeks: null, date: null, gap: gap };
    var weeks = gap / perWeek;
    return {
      weeks: weeks,
      gap: gap,
      date: Dates.addDays(fromDate || Dates.today(), Math.round(weeks * 7))
    };
  }

  /**
   * ממוצע נע מעריכי בשיטת The Hacker's Diet.
   * המגמה זזה בכל יום עשירית מהמרחק בין המדידה לבינה, כך שנקודה
   * חריגה אחת מזיזה את הקו ב-10% מהסטייה בלבד.
   * יתרון על ממוצע נע רגיל: לא מאבד ימים בהתחלה, ולא "קופץ"
   * כשמדידה ישנה יוצאת מהחלון.
   */
  function ewma(entries, field, options) {
    var opts = options || {};
    var alpha = opts.alpha === undefined ? 0.1 : opts.alpha;
    var points = series(entries, field);
    if (!points.length) return [];

    var trend = null;
    return points.map(function (p) {
      trend = trend === null ? p.y : trend + alpha * (p.y - trend);
      return { date: p.date, x: p.x, y: trend, raw: p.y, deviation: p.y - trend };
    });
  }

  function latestEwma(entries, field, options) {
    var line = ewma(entries, field, options);
    return line.length ? line[line.length - 1] : null;
  }

  /**
   * TDEE מסתגל: בונה רצף יומי רציף ומריץ עליו מסנן קלמן.
   * שים לב להיסט: השקילה של בוקר יום D משקפת את האכילה של D-1,
   * ולכן ברירת המחדל מזיזה את הצריכה יום אחד קדימה מול המשקל.
   */
  function adaptiveTDEE(entries, options) {
    var opts = options || {};
    var endDate = opts.endDate || Dates.today();
    var windowDays = opts.windowDays || 120;
    var intakeLag = opts.intakeLag === undefined ? 1 : opts.intakeLag;

    var windowEntries = inWindow(entries, endDate, windowDays);
    if (!windowEntries.length) return { ok: false, reason: 'empty' };

    var byDate = {};
    windowEntries.forEach(function (e) { byDate[e.date] = e; });

    var days = Dates.range(windowEntries[0].date, endDate).map(function (date) {
      var weightEntry = byDate[date];
      // הצריכה שמשפיעה על שקילת הבוקר של date היא זו של היום שקדם לו
      var intakeEntry = byDate[Dates.addDays(date, -intakeLag)];
      return {
        date: date,
        weight: weightEntry ? num(weightEntry.weightKg) : null,
        intake: intakeEntry ? num(intakeEntry.kcal) : null
      };
    });

    var result = root.Kalman.run(days, opts);
    if (!result.ok) return result;
    result.final.intakeLag = intakeLag;
    result.final.deficit = result.final.tdee - result.final.meanIntake;
    return result;
  }

  /**
   * יעד יומי נגזר: ה-TDEE הנמדד פחות הגירעון שדרוש לקצב המבוקש.
   * מכיוון שה-TDEE מתעדכן, גם היעד מתעדכן — בלי שצריך לגעת בהגדרות.
   */
  function derivedTarget(settings, tdee) {
    var manual = num((settings.targets || {}).kcal);
    if (!settings.autoTargetFromTdee || num(tdee) === null) {
      return { kcal: manual, source: 'manual', tdee: num(tdee) };
    }
    var rate = num((settings.goal || {}).ratePerWeekKg) || 0;
    var value = tdee + (rate * (settings.kcalPerKg || DEFAULT_KCAL_PER_KG)) / 7;
    return { kcal: value, source: 'tdee', tdee: tdee, ratePerWeekKg: rate, manual: manual };
  }

  /**
   * מחשבון פיצוי: כמה לאכול בימים הקרובים כדי שהממוצע לתקופה יפגוש את היעד.
   *
   * מצב 'rolling' (ברירת מחדל) מסתכל על חלון נע שמסתיים היום — תמיד יש
   * תשובה, גם באמצע השבוע. מצב 'week' עובד על שבוע קלנדרי ראשון–שבת.
   *
   * ימים בלי דיווח לא נספרים כאפס. הם יוצאים מהחישוב לגמרי, והיעד
   * מחושב על הימים שכן ידועים — אחרת יום ששכחת לרשום היה מייצר
   * "אשראי" מדומה של יום שלם.
   */
  function catchUp(entries, options) {
    var opts = options || {};
    var target = num(opts.targetDaily);
    if (target === null) return { ok: false, reason: 'no-target' };

    var days = opts.days || 7;
    var endDate = opts.endDate || Dates.today();
    var mode = opts.mode === 'week' ? 'week' : 'rolling';
    var floor = num(opts.floor);
    var ceiling = num(opts.ceiling);

    var byDate = {};
    (entries || []).forEach(function (e) { byDate[e.date] = e; });

    var window, remaining;
    if (mode === 'week') {
      var start = Dates.weekStart(endDate);
      window = Dates.range(start, Dates.addDays(start, 6));
      remaining = window.filter(function (d) { return d >= endDate; });
    } else {
      window = Dates.lastDays(endDate, days);
      remaining = [endDate];
    }

    var past = window.filter(function (d) { return d < endDate; });
    var logged = [], missing = [];
    past.forEach(function (d) {
      var v = byDate[d] ? num(byDate[d].kcal) : null;
      if (v === null) missing.push(d); else logged.push({ date: d, kcal: v });
    });

    var todayLogged = byDate[endDate] ? num(byDate[endDate].kcal) : null;
    var consumed = logged.reduce(function (s, d) { return s + d.kcal; }, 0);

    // כמה ימים ייכללו בממוצע בסוף: הידועים + אלה שנותרו
    var countedDays = logged.length + remaining.length;
    var needed = target * countedDays - consumed;
    var perRemainingDay = remaining.length ? needed / remaining.length : null;

    var result = {
      ok: true,
      mode: mode,
      window: { from: window[0], to: window[window.length - 1] },
      days: window.length,
      loggedDays: logged.length,
      missingDays: missing.length,
      missing: missing,
      remainingDays: remaining.length,
      consumed: consumed,
      target: target,
      meanSoFar: logged.length ? consumed / logged.length : null,
      todayLogged: todayLogged,
      needed: needed,
      perRemainingDay: perRemainingDay
    };

    // האם הפיצוי בכלל אפשרי, ואם לא — על פני כמה ימים כן
    result.belowFloor = floor !== null && perRemainingDay !== null && perRemainingDay < floor;
    result.aboveCeiling = ceiling !== null && perRemainingDay !== null && perRemainingDay > ceiling;
    result.feasible = !result.belowFloor && !result.aboveCeiling;

    // פריסה חלופית: אותו חוב, על פני יותר ימים
    result.spread = [1, 2, 3, 5, 7].map(function (n) {
      var perDay = target + (needed - target * remaining.length) / n;
      return {
        days: n,
        perDay: perDay,
        feasible: (floor === null || perDay >= floor) && (ceiling === null || perDay <= ceiling)
      };
    });

    // ההמלצה בפועל. אם סגירת הפער ביום אחד אינה סבירה, ההמלצה היא
    // הפריסה הקצרה ביותר שכן סבירה — כך אף מסך לא מציג מספר שאסור
    // לפעול לפיו.
    var feasibleSpread = result.spread.filter(function (x) { return x.feasible; })[0];
    result.recommended = result.feasible
      ? { perDay: perRemainingDay, days: remaining.length, spread: false }
      : (feasibleSpread
        ? { perDay: feasibleSpread.perDay, days: feasibleSpread.days, spread: true }
        : { perDay: target, days: remaining.length, spread: false, fallback: true });

    return result;
  }

  /** סטיית התקן של רעש השקילה, נאמדת מהשאריות סביב הממוצע הנע */
  function weightNoiseSd(entries, options) {
    var ma = movingAverage(entries, 'weightKg', Object.assign({ windowDays: 7, minPoints: 3 }, options));
    var byDate = {};
    ma.forEach(function (d) { if (d.y !== null) byDate[d.date] = d.y; });
    var residuals = series(entries, 'weightKg')
      .filter(function (p) { return byDate[p.date] !== undefined; })
      .map(function (p) { return p.y - byDate[p.date]; });
    var sd = Stats.stdDev(residuals);
    return sd === null ? 0.6 : Math.max(sd, 0.15);
  }

  /**
   * שיטת בלוקים: משווה ממוצע של n ימים לממוצע n הימים שקדמו להם.
   * זו השיטה הידנית הנפוצה, והיא נכונה במבנה — אבל רועשת מאוד בחלונות
   * קצרים, ולכן כל שורה מוחזרת עם רווח הסמך שלה. בלי המספר הזה
   * קל להסתכל על שורה בודדת ולהסיק ממנה מסקנה שאין לה כיסוי.
   */
  function blockWindows(entries, options) {
    var opts = options || {};
    var n = opts.days || 7;
    var endDate = opts.endDate || Dates.today();
    var count = opts.count || 4;
    var kcalPerKg = opts.kcalPerKg || DEFAULT_KCAL_PER_KG;
    var noiseSd = opts.weightNoiseSd || weightNoiseSd(entries);
    var stepCost = num(opts.kcalPerStep);
    if (stepCost === null) stepCost = 0.030;
    var all = sorted(entries);
    var first = all.length ? all[0].date : null;

    var rows = [];
    for (var i = 0; i < count; i++) {
      var to = Dates.addDays(endDate, -i * n);
      var from = Dates.addDays(to, -(n - 1));
      var prevTo = Dates.addDays(from, -1);
      var prevFrom = Dates.addDays(prevTo, -(n - 1));

      var cur = inWindow(entries, to, n);
      var prev = inWindow(entries, prevTo, n);

      var w = Stats.mean(series(cur, 'weightKg').map(function (p) { return p.y; }));
      var wPrev = Stats.mean(series(prev, 'weightKg').map(function (p) { return p.y; }));
      var kcalValues = series(cur, 'kcal').map(function (p) { return p.y; });
      var kcal = Stats.mean(kcalValues);
      var stepsValues = series(cur, 'steps').map(function (p) { return p.y; });

      var weighIns = series(cur, 'weightKg').length;
      var prevWeighIns = series(prev, 'weightKg').length;
      var minWeighIns = Math.max(2, Math.ceil(n / 2));

      // חלון נחשב מלא רק אם שתי התקופות נמצאות בתוך טווח הנתונים
      // ויש בשתיהן מספיק שקילות. חלון חלקי מייצר "תחזוקה" שנראית
      // אמיתית אבל מבוססת על השוואה לתקופה שלא קיימת.
      var complete = !!(first && first <= prevFrom) &&
        weighIns >= minWeighIns && prevWeighIns >= minWeighIns;

      if (w === null || wPrev === null || kcal === null) continue;

      var deltaKg = wPrev - w;                  // חיובי = ירידה
      var fromWeight = (deltaKg * kcalPerKg) / n;

      // אי־ודאות: רעש בשני ממוצעי המשקל, ועוד פיזור הצריכה
      var weightErr = (Math.sqrt(2) * noiseSd / Math.sqrt(n)) * kcalPerKg / n;
      var sdKcal = Stats.stdDev(kcalValues);
      var intakeErr = sdKcal === null ? 0 : sdKcal / Math.sqrt(kcalValues.length);

      rows.push({
        index: i,
        from: from, to: to, prevFrom: prevFrom, prevTo: prevTo,
        days: n,
        meanWeight: w, prevMeanWeight: wPrev, deltaKg: deltaKg,
        meanKcal: kcal, meanSteps: Stats.mean(stepsValues),
        fromWeight: fromWeight,
        fromSteps: Stats.mean(stepsValues) === null ? 0 : Stats.mean(stepsValues) * stepCost,
        complete: complete,
        tdee: kcal + fromWeight,
        ci95: 1.96 * Math.sqrt(weightErr * weightErr + intakeErr * intakeErr),
        weighIns: weighIns,
        prevWeighIns: prevWeighIns,
        loggedDays: kcalValues.length
      });
    }
    return { days: n, weightNoiseSd: noiseSd, rows: rows };
  }

  /**
   * ההוצאה בלי הליכה ייעודית.
   *
   *   בסיס = TDEE נמדד − (צעדים ממוצעים × עלות לצעד)
   *
   * שים לב שהעלות לצעד היא נטו — רק התוספת מעבר למה שהיה נשרף
   * ממילא באותן דקות. ערך ברוטו, כמו שמדווח בשעונים, יחסיר פעמיים
   * את חילוף החומרים במנוחה.
   *
   * הפירוק הזה מגיע מהפיזיולוגיה ולא מהנתונים: כשספירת הצעדים יציבה,
   * אי אפשר להפריד סטטיסטית בין הבסיס לתרומת הצעדים.
   */
  function baselineWithoutSteps(entries, settings, options) {
    var opts = options || {};
    var kcalPerStep = num(opts.kcalPerStep);
    if (kcalPerStep === null) kcalPerStep = num((settings || {}).kcalPerStep);
    if (kcalPerStep === null) kcalPerStep = 0.030;

    var tdee = num(opts.tdee);
    var tdeeCi = num(opts.tdeeCi);
    if (tdee === null) {
      var adaptive = adaptiveTDEE(entries, { kcalPerKg: (settings || {}).kcalPerKg, endDate: opts.endDate });
      if (!adaptive.ok) return { ok: false, reason: adaptive.reason };
      tdee = adaptive.final.tdee;
      tdeeCi = adaptive.final.ci95;
    }

    var windowDays = opts.windowDays || 28;
    var stepValues = series(inWindow(entries, opts.endDate || Dates.today(), windowDays), 'steps')
      .map(function (p) { return p.y; });
    var meanSteps = Stats.mean(stepValues);
    if (meanSteps === null) {
      return { ok: true, tdee: tdee, ci95: tdeeCi, meanSteps: null, stepKcal: 0, base: tdee, kcalPerStep: kcalPerStep };
    }

    var stepKcal = meanSteps * kcalPerStep;
    // הטווח המקובל לעלות נטו לצעד הוא 0.025 עד 0.040
    var stepUncertainty = meanSteps * (0.040 - 0.025) / 2;
    var ci95 = Stats.combineErrors([tdeeCi, stepUncertainty]);

    return {
      ok: true,
      tdee: tdee,
      tdeeCi: tdeeCi,
      meanSteps: meanSteps,
      stepDays: stepValues.length,
      kcalPerStep: kcalPerStep,
      stepKcal: stepKcal,
      stepUncertainty: stepUncertainty,
      base: tdee - stepKcal,
      ci95: ci95,
      low: tdee - stepKcal - ci95,
      high: tdee - stepKcal + ci95,
      /** תחזוקה בכמות צעדים נתונה */
      maintenanceAt: function (steps, level) {
        var b = level === 'low' ? this.low : level === 'high' ? this.high : this.base;
        return b + steps * this.kcalPerStep;
      }
    };
  }

  /**
   * מאזן אנרגיה פשוט ליום או לתקופה. עונה על ארבע שאלות ברצף:
   * כמה שורפים בלי ללכת, כמה אכלת, מה זה נותן, ומה חסר כדי להגיע ליעד.
   *
   * הכל מחושב פעמיים — פעם בלי הצעדים ופעם איתם — כי אלה שני מספרים
   * שונים ששניהם נכונים, ובלבול ביניהם הוא המקור הנפוץ ביותר לטעות.
   */
  function energyBalance(entries, settings, options) {
    var opts = options || {};
    var date = opts.date || Dates.today();
    var windowDays = opts.windowDays || 7;

    var baseline = baselineWithoutSteps(entries, settings, {
      endDate: date,
      tdee: opts.tdee,
      tdeeCi: opts.tdeeCi
    });
    if (!baseline.ok) return { ok: false, reason: baseline.reason };

    var kcalPerKg = (settings || {}).kcalPerKg || DEFAULT_KCAL_PER_KG;
    var kcalPerStep = baseline.kcalPerStep;
    var base = baseline.base;

    var goalRate = num((settings.goal || {}).ratePerWeekKg);
    var goalDeficit = goalRate === null ? null : -(goalRate * kcalPerKg) / 7;

    function frame(intake, steps, label) {
      if (intake === null) return { label: label, ok: false };
      var stepKcal = steps === null ? 0 : steps * kcalPerStep;
      var nutritionDeficit = base - intake;
      var totalDeficit = nutritionDeficit + stepKcal;

      var out = {
        label: label,
        ok: true,
        intake: intake,
        steps: steps,
        stepKcal: stepKcal,
        nutritionDeficit: nutritionDeficit,
        totalDeficit: totalDeficit,
        nutritionRate: -(nutritionDeficit * 7) / kcalPerKg,
        totalRate: -(totalDeficit * 7) / kcalPerKg
      };

      if (goalDeficit !== null) {
        // חיובי = צריך לקצץ עוד; שלילי = אתה כבר מעבר ליעד
        out.gapNutrition = goalDeficit - nutritionDeficit;
        out.gapTotal = goalDeficit - totalDeficit;
        out.intakeForGoalNutrition = base - goalDeficit;
        out.intakeForGoalTotal = base + stepKcal - goalDeficit;
        out.extraSteps = out.gapTotal > 0 ? out.gapTotal / kcalPerStep : 0;
      }
      return out;
    }

    var todayEntry = (entries || []).find(function (e) { return e.date === date; });
    var windowEntries = inWindow(entries, date, windowDays);
    var meanKcal = Stats.mean(series(windowEntries, 'kcal').map(function (p) { return p.y; }));
    var meanSteps = Stats.mean(series(windowEntries, 'steps').map(function (p) { return p.y; }));

    return {
      ok: true,
      date: date,
      windowDays: windowDays,
      base: base,
      baseCi95: baseline.ci95,
      tdee: baseline.tdee,
      kcalPerStep: kcalPerStep,
      goalRatePerWeek: goalRate,
      goalDeficit: goalDeficit,
      today: frame(todayEntry ? num(todayEntry.kcal) : null,
                   todayEntry ? num(todayEntry.steps) : null, 'היום'),
      period: frame(meanKcal, meanSteps, windowDays + ' ימים')
    };
  }

  /**
   * כל שיטות הערכת ה-TDEE, כל אחת עם הדרך שבה התקבלה.
   * שדה derivation הוא רשימת שלבים בשפה פשוטה — הוא קיים כדי
   * שאפשר יהיה להציג את החשבון עצמו ולא רק את התוצאה.
   */
  function tdeeMethods(entries, settings, options) {
    var opts = options || {};
    var endDate = opts.endDate || Dates.today();
    var kcalPerKg = (settings || {}).kcalPerKg || DEFAULT_KCAL_PER_KG;
    var kcalPerStep = num((settings || {}).kcalPerStep);
    if (kcalPerStep === null) kcalPerStep = 0.030;

    var stepWindow = series(inWindow(entries, endDate, 28), 'steps').map(function (p) { return p.y; });
    var meanSteps = Stats.mean(stepWindow);
    var stepKcal = meanSteps === null ? 0 : meanSteps * kcalPerStep;

    var methods = [];

    // --- מסנן קלמן ---
    var adaptive = adaptiveTDEE(entries, { kcalPerKg: kcalPerKg, endDate: endDate });
    if (adaptive.ok) {
      var f = adaptive.final;
      var tail = adaptive.states.slice(-5).map(function (s) {
        return { date: s.date, tdee: s.tdee, ci95: 1.96 * s.tdeeSd, weight: s.weight, observed: s.observed };
      });
      methods.push({
        id: 'kalman',
        name: 'מסנן קלמן',
        short: 'קלמן',
        tdee: f.tdee,
        ci95: f.ci95,
        formula: 'משקל מחר = משקל היום + (צריכה − הוצאה) ÷ ' + kcalPerKg,
        summary: 'מתחיל מניחוש, ומתקן אותו בכל בוקר לפי הפער בין המשקל שניבא למשקל שנמדד.',
        derivation: [
          { label: 'ימים שעובדו', value: f.totalDays, digits: 0 },
          { label: 'מתוכם עם שקילה', value: f.observedDays, digits: 0 },
          { label: 'מתוכם עם דיווח תזונה', value: f.loggedDays, digits: 0 },
          { label: 'צריכה ממוצעת', value: f.meanIntake, digits: 0 },
          { label: 'משקל מגמה של המסנן', value: f.trendWeight, digits: 2 },
          { label: 'הערכה סופית', value: f.tdee, digits: 0, strong: true },
          { label: 'רווח סמך', value: f.ci95, digits: 0, pm: true }
        ],
        trace: tail,
        note: 'ההערכה מעדיפה ימים אחרונים, ולכן היא הראשונה לזהות שינוי מטבולי. ' +
              'רוחב רווח הסמך לא יורד מתחת לרצפה מסוימת, כי המודל מניח שההוצאה יכולה לנוע.'
      });
    }

    // --- רגרסיה ---
    var ols = estimateTDEEMulti(entries, { kcalPerKg: kcalPerKg, endDate: endDate }).best;
    if (ols && ols.ok) {
      var slopeKcal = ols.slopePerDay * kcalPerKg;
      var intakeErr = ols.sdKcal === null ? 0 : ols.sdKcal / Math.sqrt(ols.kcalDays);
      var totalErr = ols.ci95 / 1.96;
      var weightErr = Math.sqrt(Math.max(totalErr * totalErr - intakeErr * intakeErr, 0));
      methods.push({
        id: 'regression',
        name: 'רגרסיה על ' + ols.windowDays + ' יום',
        short: 'רגרסיה',
        tdee: ols.tdee,
        ci95: ols.ci95,
        formula: 'TDEE = צריכה ממוצעת − (שיפוע המשקל ליום × ' + kcalPerKg + ')',
        summary: 'מעביר קו ישר בין כל השקילות בחלון, ומתרגם את השיפוע לקלוריות.',
        derivation: [
          { label: 'אורך החלון', value: ols.windowDays, digits: 0 },
          { label: 'שקילות בחלון', value: ols.weightDays, digits: 0 },
          { label: 'ימי תזונה בחלון', value: ols.kcalDays, digits: 0 },
          { label: 'צריכה ממוצעת', value: ols.meanKcal, digits: 0 },
          { label: 'פיזור יומי בצריכה', value: ols.sdKcal, digits: 0, pm: true },
          { label: 'שיפוע המשקל', value: ols.slopePerWeek, digits: 3, signed: true, unit: 'ק״ג לשבוע' },
          { label: 'השיפוע בקלוריות', value: -slopeKcal, digits: 0, signed: true },
          { label: 'התאמת הקו', value: ols.r2, digits: 2, unit: 'R²' },
          { label: 'הערכה סופית', value: ols.tdee, digits: 0, strong: true },
          { label: 'אי־ודאות ממגמת המשקל', value: 1.96 * weightErr, digits: 0, pm: true },
          { label: 'אי־ודאות מדיווח הקלוריות', value: 1.96 * intakeErr, digits: 0, pm: true },
          { label: 'רווח סמך', value: ols.ci95, digits: 0, pm: true }
        ],
        note: 'כל הימים בחלון נספרים במשקל שווה, ולכן ההערכה יציבה אבל מגיבה לאט לשינוי.'
      });
    }

    // --- בלוקים ---
    [14, 7].forEach(function (days) {
      var blocks = blockWindows(entries, { days: days, count: 1, kcalPerKg: kcalPerKg, endDate: endDate });
      if (!blocks.rows.length) return;
      var b = blocks.rows[0];
      methods.push({
        id: 'block' + days,
        name: 'בלוקים ' + days + ' יום',
        short: days + ' יום',
        tdee: b.tdee,
        ci95: b.ci95,
        formula: 'TDEE = צריכה ממוצעת + (שינוי המשקל × ' + kcalPerKg + ') ÷ ' + days,
        summary: 'משווה את ממוצע ' + days + ' הימים האחרונים לממוצע ' + days + ' הימים שלפניהם.',
        derivation: [
          { label: 'תקופה נוכחית', text: Dates.short(b.from) + ' עד ' + Dates.short(b.to) },
          { label: 'תקופה קודמת', text: Dates.short(b.prevFrom) + ' עד ' + Dates.short(b.prevTo) },
          { label: 'משקל ממוצע נוכחי', value: b.meanWeight, digits: 2 },
          { label: 'משקל ממוצע קודם', value: b.prevMeanWeight, digits: 2 },
          { label: 'שינוי', value: -b.deltaKg, digits: 2, signed: true, unit: 'ק״ג' },
          { label: 'השינוי בקלוריות ליום', value: b.fromWeight, digits: 0, signed: true },
          { label: 'צריכה ממוצעת', value: b.meanKcal, digits: 0 },
          { label: 'הערכה סופית', value: b.tdee, digits: 0, strong: true },
          { label: 'רווח סמך', value: b.ci95, digits: 0, pm: true }
        ],
        note: 'רעש השקילה שנמדד אצלך הוא ' + Stats.round(blocks.weightNoiseSd, 2) + ' ק״ג. ' +
              'הוא מוכפל ב-' + kcalPerKg + ' ומחולק ב-' + days +
              ', ולכן חלון קצר מייצר רווח סמך רחב מאוד.'
      });
    });

    methods.forEach(function (m) {
      m.base = m.tdee - stepKcal;
      m.stepKcal = stepKcal;
    });

    var chosenId = (settings || {}).tdeeMethod;
    var chosen = methods.find(function (m) { return m.id === chosenId; }) || methods[0] || null;

    return { methods: methods, chosen: chosen, meanSteps: meanSteps, stepKcal: stepKcal, kcalPerStep: kcalPerStep };
  }

  /**
   * דוח התקדמות בשפה פשוטה.
   *
   * לכל תקופה: כמה זז המשקל ואחוז השומן, בהשוואה לתקופה שקדמה לה.
   * חלונות קצרים נכללים כי משתמשים רוצים לראות אותם, אבל מסומנים
   * כרועשים — 3 ימים זה בעיקר נוזלים.
   */
  function progressReport(entries, settings, options) {
    var opts = options || {};
    var endDate = opts.endDate || Dates.today();
    var periods = opts.periods || [3, 5, 7, 14];
    var derived = deriveAll(entries);

    function blockMean(end, days, field) {
      var start = Dates.addDays(end, -(days - 1));
      var values = derived
        .filter(function (e) { return e.date >= start && e.date <= end; })
        .map(function (e) { return num(e[field]); })
        .filter(function (v) { return v !== null; });
      return { mean: Stats.mean(values), n: values.length };
    }

    var rows = periods.map(function (days) {
      var prevEnd = Dates.addDays(endDate, -days);
      var w = blockMean(endDate, days, 'weightKg');
      var wPrev = blockMean(prevEnd, days, 'weightKg');
      var f = blockMean(endDate, days, 'bodyFatPct');
      var fPrev = blockMean(prevEnd, days, 'bodyFatPct');

      return {
        days: days,
        weighIns: w.n,
        weightChange: (w.mean === null || wPrev.mean === null) ? null : w.mean - wPrev.mean,
        weightNow: w.mean,
        fatPctChange: (f.mean === null || fPrev.mean === null) ? null : f.mean - fPrev.mean,
        fatPctNow: f.mean,
        // חלון קצר מדי מכדי להבדיל בין שינוי אמיתי לתנודת נוזלים
        noisy: days < 7,
        ok: w.mean !== null && wPrev.mean !== null
      };
    });

    // האם הקצב בפועל תואם את התוכנית
    var goalRate = num((settings.goal || {}).ratePerWeekKg);
    var trendResult = trend(entries, 'weightKg', { windowDays: 14, endDate: endDate });
    if (!trendResult.ok) trendResult = trend(entries, 'weightKg', { windowDays: 28, endDate: endDate });

    var plan = { ok: false };
    if (trendResult.ok && goalRate !== null && goalRate !== 0) {
      var actual = trendResult.perWeek;
      var ratio = actual / goalRate;   // 1 = בדיוק בתוכנית
      var status;
      if (ratio < 0) status = 'wrongWay';
      else if (ratio < 0.6) status = 'behind';
      else if (ratio > 1.5) status = 'fast';
      else status = 'onTrack';

      plan = {
        ok: true,
        goalRate: goalRate,
        actualRate: actual,
        ci95: trendResult.ci95PerWeek,
        ratio: ratio,
        status: status,
        windowDays: trendResult.windowDays,
        // הפרש הקלוריות היומי שיחזיר אותך לקצב המתוכנן
        kcalAdjustment: ((actual - goalRate) * (settings.kcalPerKg || DEFAULT_KCAL_PER_KG)) / 7
      };
    }

    return { endDate: endDate, rows: rows, plan: plan, trend: trendResult };
  }

  /**
   * אילו אורכי חלון אפשר להציג. חלון של n ימים דורש 2n ימי נתונים,
   * כי הוא משווה n ימים ל-n שקדמו להם.
   */
  function availableWindows(entries, options) {
    var opts = options || {};
    var endDate = opts.endDate || Dates.today();
    var candidates = opts.candidates || [3, 5, 7, 10, 14, 21, 28];
    var all = sorted(entries);
    if (!all.length) {
      return candidates.map(function (n) {
        return { days: n, available: false, haveDays: 0, needDays: 2 * n };
      });
    }

    var haveDays = (Dates.diffDays(all[0].date, endDate) || 0) + 1;
    return candidates.map(function (n) {
      var blocks = blockWindows(entries, { days: n, count: 1, endDate: endDate });
      var row = blocks.rows[0];
      return {
        days: n,
        available: !!(row && row.complete),
        haveDays: haveDays,
        needDays: 2 * n,
        missingDays: Math.max(2 * n - haveDays, 0)
      };
    });
  }

  /**
   * דוח אחד שמזין את כל מסך הבית, לפי חלון שהמשתמש בוחר.
   *
   * windowDays יכול להיות מספר ימים, או 'adaptive' — ואז ההערכה מגיעה
   * מהמסנן שמשקלל את כל ההיסטוריה ומעדיף ימים אחרונים.
   *
   * כל החישובים כאן רצים על ההוצאה בלי צעדים. ההליכה מוצגת בנפרד
   * כתוספת, כדי שהיעד היומי לא יגדל בגלל שהלכת.
   */
  function windowReport(entries, settings, options) {
    var opts = options || {};
    var endDate = opts.endDate || Dates.today();
    var kcalPerKg = (settings || {}).kcalPerKg || DEFAULT_KCAL_PER_KG;
    var kcalPerStep = num((settings || {}).kcalPerStep);
    if (kcalPerStep === null) kcalPerStep = 0.030;
    var window = opts.windowDays === 'adaptive' ? 'adaptive' : Number(opts.windowDays || 14);
    if (!entries || !entries.length) return { ok: false, windowDays: window, reason: 'insufficient' };

    // --- ההוצאה, לפי החלון שנבחר ---
    var tdee = null, ci95 = null, source = null, effectiveDays = null, block = null;
    if (window === 'adaptive') {
      var adaptive = adaptiveTDEE(entries, { kcalPerKg: kcalPerKg, endDate: endDate });
      if (adaptive.ok) {
        tdee = adaptive.final.tdee;
        ci95 = adaptive.final.ci95;
        source = 'adaptive';
        effectiveDays = adaptive.final.totalDays;
      }
    } else {
      var blocks = blockWindows(entries, {
        days: window, count: 1, kcalPerKg: kcalPerKg, kcalPerStep: kcalPerStep, endDate: endDate
      });
      var row = blocks.rows[0];
      // רק חלון מלא. אחרת מוחזרת תשובה שאומרת כמה ימים חסרים,
      // ולא הערכה מחלון אחר שמתחזה לזה שנבחר.
      if (!row || !row.complete) {
        var status = availableWindows(entries, { endDate: endDate, candidates: [window] })[0];
        return {
          ok: false, windowDays: window, reason: 'window',
          haveDays: status.haveDays, needDays: status.needDays, missingDays: status.missingDays
        };
      }
      tdee = row.tdee;
      ci95 = row.ci95;
      source = 'block';
      effectiveDays = window;
      block = row;
    }
    if (tdee === null) return { ok: false, windowDays: window, reason: 'insufficient' };

    // --- צעדים: מחוץ לחשבון, ומוצגים בנפרד ---
    var statsDays = window === 'adaptive' ? 28 : window;
    var windowEntries = inWindow(entries, endDate, statsDays);

    // ממוצע הצעדים נלקח עד אתמול בלבד. ההליכה של היום עוד לא השפיעה
    // על אף שקילה, ולכן היא לא אמורה להזיז את היעד של היום — אחרת
    // רישום צעדים היה מוריד למשתמש את הקצבה, וזה הפוך מהכוונה.
    var stepValues = series(inWindow(entries, Dates.addDays(endDate, -1), statsDays), 'steps')
      .map(function (p) { return p.y; });
    var meanSteps = Stats.mean(stepValues);
    var stepKcal = meanSteps === null ? 0 : meanSteps * kcalPerStep;
    var base = tdee - stepKcal;

    // --- היעד היומי ---
    var rate = num((settings.goal || {}).ratePerWeekKg) || 0;
    var deficitPerDay = -(rate * kcalPerKg) / 7;
    var target = base - deficitPerDay;

    // --- מה נאכל בפועל ---
    var kcalValues = series(windowEntries, 'kcal').map(function (p) { return p.y; });
    var meanIntake = Stats.mean(kcalValues);
    var inRange = kcalValues.filter(function (v) {
      return Math.abs(v - target) <= target * 0.1;
    }).length;

    var gapPerDay = meanIntake === null ? null : meanIntake - target;
    var gapTotal = gapPerDay === null ? null : gapPerDay * kcalValues.length;

    // --- ירידה תאורטית: מה שמאזן האנרגיה מנבא ---
    var days = statsDays;
    var theoretical = { withoutSteps: null, withSteps: null };
    if (meanIntake !== null) {
      theoretical.withoutSteps = -((base - meanIntake) * days) / kcalPerKg;
      theoretical.withSteps = -((tdee - meanIntake) * days) / kcalPerKg;
    }

    // --- מה שקרה בפועל, מול התקופה שקדמה ---
    var derived = deriveAll(entries);
    function blockMean(end, n, field) {
      var start = Dates.addDays(end, -(n - 1));
      var values = derived
        .filter(function (e) { return e.date >= start && e.date <= end; })
        .map(function (e) { return num(e[field]); })
        .filter(function (v) { return v !== null; });
      return { mean: Stats.mean(values), n: values.length };
    }
    function change(field, n) {
      var now = blockMean(endDate, n, field);
      var prev = blockMean(Dates.addDays(endDate, -n), n, field);
      return (now.mean === null || prev.mean === null) ? null : now.mean - prev.mean;
    }

    // השוואת "מה קרה בפועל" דורשת גם את התקופה שקדמה. חלון של 28 יום
    // על היסטוריה של חודש לא ימצא תקופה קודמת, ולכן יורדים לחלון
    // הארוך ביותר שיש לו בן זוג.
    var changeDays = days;
    var actual = null;
    [days, 14, 7].forEach(function (n) {
      if (actual) return;
      changeDays = n;
      var candidate = {
        weightChange: change('weightKg', n),
        fatChange: change('bodyFatKg', n),
        muscleChange: change('muscleKg', n),
        fatPctChange: change('bodyFatPct', n),
        weighIns: series(windowEntries, 'weightKg').length
      };
      if (candidate.weightChange !== null) actual = candidate;
    });
    if (!actual) {
      changeDays = days;
      actual = { weightChange: null, fatChange: null, muscleChange: null, fatPctChange: null,
                 weighIns: series(windowEntries, 'weightKg').length };
    }

    var trendResult = trend(entries, 'weightKg', { windowDays: Math.max(days, 7), endDate: endDate });

    // --- פיצוי ---
    // הפער שמפצים עליו הוא תמיד של השבוע האחרון, ולא של חלון הניתוח.
    // חריגה שנצברה על פני חודש אי אפשר לסגור בימים הקרובים, וטבלה
    // שמנסה לעשות זאת מחזירה מספרים חסרי משמעות.
    var floor = num(opts.floor) || 1200;
    var recentDays = Math.min(7, days);
    var recentKcal = series(inWindow(entries, endDate, recentDays), 'kcal')
      .map(function (p) { return p.y; });
    var recentGap = recentKcal.length
      ? recentKcal.reduce(function (acc, v) { return acc + (v - target); }, 0)
      : null;

    var compensation = [1, 2, 3, 5, 7].map(function (n) {
      var perDay = recentGap === null ? target : target - recentGap / n;
      return { days: n, perDay: perDay, feasible: perDay >= floor };
    });
    var anyFeasible = compensation.some(function (c) { return c.feasible; });

    return {
      ok: true,
      windowDays: window,
      effectiveDays: effectiveDays,
      statsDays: days,
      source: source,
      block: block,
      tdee: tdee,
      ci95: ci95,
      // אמינות בשפה פשוטה, לפי רוחב רווח הסמך
      reliability: ci95 === null ? 'unknown' : ci95 < 250 ? 'high' : ci95 < 500 ? 'medium' : 'low',
      meanSteps: meanSteps,
      stepKcal: stepKcal,
      base: base,
      ratePerWeekKg: rate,
      deficitPerDay: deficitPerDay,
      target: target,
      intake: {
        mean: meanIntake,
        days: kcalValues.length,
        coverage: kcalValues.length / days,
        inRange: inRange,
        pctInRange: kcalValues.length ? inRange / kcalValues.length : null
      },
      gapPerDay: gapPerDay,
      gapTotal: gapTotal,
      recent: { days: recentDays, loggedDays: recentKcal.length, gap: recentGap },
      compensationFeasible: anyFeasible,
      theoretical: theoretical,
      actual: actual,
      changeDays: changeDays,
      trendPerWeek: trendResult.ok ? trendResult.perWeek : null,
      compensation: compensation
    };
  }

  /**
   * חלונות רצופים שמעוגנים ליום הראשון של המדידות.
   *
   * חלון 1 מתחיל ביום הראשון, חלון 2 אחריו, וכן הלאה — בדיוק כמו
   * בגיליון. זה שונה מחלון נע שמסתיים היום: שם כל יום שעובר מזיז
   * את שתי התקופות, וההשוואה בין "14 עד היום" ל"14 עד אתמול" חופפת
   * ב-13 ימים ולכן כמעט חסרת משמעות.
   *
   * מוחזרים החלון המלא האחרון והחלון שלפניו, יחד עם החלון החלקי
   * שעוד מצטבר.
   */
  function anchoredBlocks(entries, days, options) {
    var opts = options || {};
    var endDate = opts.endDate || Dates.today();
    var all = sorted(entries);
    if (!all.length || !days) return { ok: false, reason: 'empty' };

    var start = opts.startDate || all[0].date;
    var span = (Dates.diffDays(start, endDate) || 0) + 1;
    var completeCount = Math.floor(span / days);

    function block(index) {
      var from = Dates.addDays(start, index * days);
      return { index: index + 1, from: from, to: Dates.addDays(from, days - 1) };
    }

    if (completeCount < 2) {
      return {
        ok: false, reason: 'blocks', days: days,
        completeBlocks: completeCount,
        needDays: days * 2, haveDays: span
      };
    }

    var current = block(completeCount - 1);
    var previous = block(completeCount - 2);

    // מה שנצבר מאז סוף החלון המלא האחרון
    var partialFrom = Dates.addDays(current.to, 1);
    var partialDays = (Dates.diffDays(partialFrom, endDate) || -1) + 1;

    return {
      ok: true,
      days: days,
      startDate: start,
      completeBlocks: completeCount,
      current: current,
      previous: previous,
      partial: partialDays > 0
        ? { from: partialFrom, to: endDate, days: partialDays, index: completeCount + 1 }
        : null
    };
  }

  /**
   * סיכום הגירעון לכמה חלונות בבת אחת, לצד השינוי שנמדד בפועל.
   *
   * הסתירה בין השניים היא המידע החשוב: אם החשבון מנבא ירידה של קילו
   * והמשקל לא זז, אחד משני הצדדים לא מדויק — הדיווח או השקילה.
   */
  function deficitSummary(entries, settings, options) {
    var opts = options || {};
    var endDate = opts.endDate || Dates.today();
    var windows = opts.windows || [7, 10, 14];
    var kcalPerKg = (settings || {}).kcalPerKg || DEFAULT_KCAL_PER_KG;

    var adaptive = adaptiveTDEE(entries, { kcalPerKg: kcalPerKg, endDate: endDate });
    if (!adaptive.ok) return { ok: false, reason: adaptive.reason };

    var byDate = {};
    adaptive.states.forEach(function (s) { byDate[s.date] = s; });

    var allSorted = sorted(entries);
    var firstDate = allSorted.length ? allSorted[0].date : null;

    /** ממוצע המשקל בטווח נתון */
    function blockMean(range) {
      var values = series(entries, 'weightKg')
        .filter(function (p) { return p.date >= range.from && p.date <= range.to; })
        .map(function (p) { return p.y; });
      return { mean: Stats.mean(values), n: values.length };
    }

    var rows = windows.map(function (days) {
      var blocks = anchoredBlocks(entries, days, { endDate: endDate });
      if (!blocks.ok) {
        return {
          days: days, ok: false, reason: blocks.reason,
          completeBlocks: blocks.completeBlocks, needDays: blocks.needDays,
          loggedDays: 0, sum: { low: 0, mid: 0, high: 0, intake: 0, tdee: 0 },
          kg: { low: null, mid: null, high: null }, actualKg: null
        };
      }

      var sum = { low: 0, mid: 0, high: 0, intake: 0, tdee: 0 };
      var counted = 0;

      // הגירעון נסכם על אותו חלון שבו נמדד השינוי במשקל
      Dates.range(blocks.current.from, blocks.current.to).forEach(function (date) {
        var st = byDate[date];
        if (!st || !num(st.intake)) return;
        var margin = 1.96 * st.tdeeSd;
        sum.low += (st.tdee - margin) - st.intake;
        sum.mid += st.tdee - st.intake;
        sum.high += (st.tdee + margin) - st.intake;
        sum.intake += st.intake;
        sum.tdee += st.tdee;
        counted++;
      });

      var current = blockMean(blocks.current);
      var previous = blockMean(blocks.previous);
      var minWeighIns = Math.max(2, Math.ceil(days / 2));
      var complete = current.n >= minWeighIns && previous.n >= minWeighIns;

      return {
        days: days,
        ok: true,
        blockIndex: blocks.current.index,
        current: blocks.current,
        previous: blocks.previous,
        partial: blocks.partial,
        loggedDays: counted,
        sum: sum,
        kg: {
          low: -sum.low / kcalPerKg,
          mid: -sum.mid / kcalPerKg,
          high: -sum.high / kcalPerKg
        },
        actualKg: (current.mean === null || previous.mean === null)
          ? null : current.mean - previous.mean,
        actualComplete: complete,
        currentMean: current.mean,
        previousMean: previous.mean
      };
    });

    return { ok: true, endDate: endDate, rows: rows };
  }

  /**
   * שינוי במשקל, בשומן ובשריר לכמה חלונות.
   * כל חלון מושווה לחלון שקדם לו, ומוחזרים גם טווחי התאריכים —
   * בלעדיהם המספר חסר משמעות.
   */
  function bodyChangeSummary(entries, options) {
    var opts = options || {};
    var endDate = opts.endDate || Dates.today();
    var windows = opts.windows || [7, 10, 14];
    var fields = opts.fields || ['weightKg', 'bodyFatKg', 'muscleKg'];

    var derived = deriveAll(entries);

    function blockMean(range, field) {
      var values = derived
        .filter(function (e) { return e.date >= range.from && e.date <= range.to; })
        .map(function (e) { return num(e[field]); })
        .filter(function (v) { return v !== null; });
      return { mean: Stats.mean(values), n: values.length };
    }

    var rows = windows.map(function (days) {
      var blocks = anchoredBlocks(entries, days, { endDate: endDate });
      var row = { days: days, ok: blocks.ok, fields: {} };

      if (!blocks.ok) {
        row.reason = blocks.reason;
        row.completeBlocks = blocks.completeBlocks;
        row.needDays = blocks.needDays;
        row.haveDays = blocks.haveDays;
        fields.forEach(function (field) { row.fields[field] = { change: null }; });
        return row;
      }

      row.current = blocks.current;
      row.previous = blocks.previous;
      row.partial = blocks.partial;
      row.blockIndex = blocks.current.index;

      fields.forEach(function (field) {
        var now = blockMean(blocks.current, field);
        var before = blockMean(blocks.previous, field);
        var minWeighIns = Math.max(2, Math.ceil(days / 2));
        row.fields[field] = {
          change: (now.mean === null || before.mean === null) ? null : now.mean - before.mean,
          complete: now.n >= minWeighIns && before.n >= minWeighIns,
          currentMean: now.mean,
          previousMean: before.mean,
          measurements: now.n
        };
      });
      return row;
    });

    return { endDate: endDate, rows: rows };
  }

  /** מספרי הפתיחה של מסך הבית */
  function dashboard(entries, settings, options) {
    var opts = options || {};
    var endDate = opts.endDate || Dates.today();
    var sortedEntries = sorted(entries);
    if (!sortedEntries.length) return { ok: false };

    var weights = series(entries, 'weightKg');
    var first = sortedEntries[0].date;
    var spanDays = (Dates.diffDays(first, endDate) || 0) + 1;

    var maxWeight = Stats.max(weights.map(function (p) { return p.y; }));
    var minWeight = Stats.min(weights.map(function (p) { return p.y; }));

    var recentSteps = series(inWindow(entries, endDate, 7), 'steps').map(function (p) { return p.y; });
    var allSteps = series(entries, 'steps').map(function (p) { return p.y; });
    var ma = latestMovingAverage(entries, 'weightKg', { to: endDate });

    return {
      ok: true,
      firstDate: first,
      spanDays: spanDays,
      loggedDays: sortedEntries.length,
      weighIns: weights.length,
      maxWeight: maxWeight,
      minWeight: minWeight,
      // הירידה מהשיא לשפל, ללא קשר למתי כל אחד מהם נמדד
      totalLoss: (maxWeight === null || minWeight === null) ? null : maxWeight - minWeight,
      currentWeight: ma ? ma.y : null,
      currentWeightDays: ma ? ma.n : 0,
      stepsWeek: Stats.mean(recentSteps),
      stepsAll: Stats.mean(allSteps)
    };
  }

  /** BMR לפי Mifflin-St Jeor — משמש רק כנקודת פתיחה לפני שיש מספיק נתונים */
  function bmrMifflin(profile, weightKg) {
    var w = num(weightKg), h = num((profile || {}).heightCm), age = num((profile || {}).ageYears);
    if (w === null || h === null || age === null) return null;
    var base = 10 * w + 6.25 * h - 5 * age;
    return profile.sex === 'female' ? base - 161 : base + 5;
  }

  function ageFromBirthDate(birthDate, onDate) {
    if (!Dates.isIso(birthDate)) return null;
    var days = Dates.diffDays(birthDate, onDate || Dates.today());
    return days === null ? null : days / 365.25;
  }

  root.Metrics = {
    FIELDS: FIELDS,
    BODY_FIELDS: BODY_FIELDS,
    NUTRITION_FIELDS: NUTRITION_FIELDS,
    DEFAULT_KCAL_PER_KG: DEFAULT_KCAL_PER_KG,
    derive: derive,
    deriveAll: deriveAll,
    sorted: sorted,
    inWindow: inWindow,
    series: series,
    movingAverage: movingAverage,
    ewma: ewma,
    latestEwma: latestEwma,
    adaptiveTDEE: adaptiveTDEE,
    latestMovingAverage: latestMovingAverage,
    trend: trend,
    coverage: coverage,
    hasAnyValue: hasAnyValue,
    estimateTDEE: estimateTDEE,
    estimateTDEEMulti: estimateTDEEMulti,
    composition: composition,
    nutritionSummary: nutritionSummary,
    adherence: adherence,
    weekBudget: weekBudget,
    catchUp: catchUp,
    blockWindows: blockWindows,
    baselineWithoutSteps: baselineWithoutSteps,
    energyBalance: energyBalance,
    progressReport: progressReport,
    windowReport: windowReport,
    deficitSummary: deficitSummary,
    dashboard: dashboard,
    bodyChangeSummary: bodyChangeSummary,
    anchoredBlocks: anchoredBlocks,
    availableWindows: availableWindows,
    tdeeMethods: tdeeMethods,
    weightNoiseSd: weightNoiseSd,
    derivedTarget: derivedTarget,
    comparePeriods: comparePeriods,
    suggestedKcal: suggestedKcal,
    projection: projection,
    bmrMifflin: bmrMifflin,
    ageFromBirthDate: ageFromBirthDate
  };
})(typeof window !== 'undefined' ? window : globalThis);
