/**
 * מסך המצב. הרעיון: לא לזרוק מספרים, אלא לומר משפט אחד ברור
 * ומיד אחריו על מה הוא נשען וכמה הוא בטוח.
 */
(function (root) {
  'use strict';

  var Views = root.Views = root.Views || {};
  var Fmt = root.Fmt, Dates = root.Dates, Metrics = root.Metrics, Store = root.Store, UI = root.UI;

  var WINDOWS = [
    { value: 14, label: '14 יום' },
    { value: 28, label: '28 יום' },
    { value: 56, label: '56 יום' }
  ];

  function weightCard(entries, windowDays) {
    var t = Metrics.trend(entries, 'weightKg', { windowDays: windowDays });
    var ma = Metrics.latestMovingAverage(entries, 'weightKg', {});
    var ewmaNow = Metrics.latestEwma(entries, 'weightKg', { alpha: 0.1 });
    var strip = UI.coverageStrip(entries, { windowDays: Math.min(windowDays, 14), field: 'weightKg', caption: 'ימים נשקלו' });

    if (!t.ok) {
      return (UI.empty('עוד לא מספיק שקילות',
          'צריך לפחות ' + t.needed + ' שקילות בתוך ' + windowDays + ' הימים האחרונים כדי לחשב מגמה. יש כרגע ' + t.n + '.') +
        strip);
    }

    var direction = t.perWeek < -0.02 ? 'יורד' : t.perWeek > 0.02 ? 'עולה' : 'יציב';
    var sentence = t.perWeek > -0.02 && t.perWeek < 0.02
      ? 'המשקל יציב — השינוי השבועי קטן מ־' + Fmt.numHtml(0.02, 2) + ' ק״ג.'
      : 'המשקל ' + direction + ' בקצב של ' + Fmt.numHtml(Math.abs(t.perWeek), 2) + ' ק״ג בשבוע.';

    // רוחב רווח הסמך הוא מדד האמינות האמיתי כאן
    var uncertain = t.ci95PerWeek !== null && Math.abs(t.ci95PerWeek) > Math.abs(t.perWeek);
    var caveat = uncertain
      ? 'הרעש בנתונים גדול מהמגמה עצמה. גם כיוון השינוי עוד לא ודאי — צריך עוד ימים.'
      : null;

    return ('<p class="finding">' + sentence + '</p>' +
      UI.readout({ value: t.perWeek, digits: 2, unit: 'ק״ג לשבוע', margin: t.ci95PerWeek, signed: true }) +
      (ma ? '<div class="metric-row" style="margin-top:12px"><span class="label">ממוצע נע נוכחי (7 ימים)</span>' +
        '<span class="value">' + Fmt.n(ma.y, 2) + ' ק״ג</span></div>' : '') +
      (ewmaNow ? '<div class="metric-row"><span class="label">מגמה מעריכית (Hacker\'s Diet)</span>' +
        '<span class="value">' + Fmt.n(ewmaNow.y, 2) + ' ק״ג · סטייה ' + Fmt.signed(ewmaNow.deviation, 2) + '</span></div>' : '') +
      '<div class="metric-row"><span class="label">שינוי מצטבר בחלון</span><span class="value">' +
        Fmt.signed(t.changeOverWindow, 2) + ' ק״ג</span></div>' +
      strip +
      UI.basis(t.n + ' שקילות על פני ' + (t.spanDays + 1) + ' ימים · R² = ' + Fmt.n(t.r2, 2)) +
      (caveat ? '<div class="notice">' + Fmt.esc(caveat) + '</div>' : '')
    );
  }

  function tdeeCard(entries, settings) {
    var multi = Metrics.estimateTDEEMulti(entries, { kcalPerKg: settings.kcalPerKg });
    var best = multi.best;

    if (!best || !best.ok) {
      var widest = multi.all[0];
      var reasons = {
        kcal: 'חסרים ימים עם דיווח קלוריות (' + widest.kcalDays + ' מתוך ' + widest.minKcalDays + ' הדרושים).',
        weight: 'חסרות שקילות (' + widest.weightDays + ' מתוך ' + widest.minWeightDays + ' הדרושות).',
        span: 'השקילות מרוכזות בקטע קצר מדי בתוך החלון.'
      };
      return UI.card('כמה אתה באמת שורף', null,
        UI.empty('אין עדיין מספיק נתונים',
          (reasons[widest.reason] || 'חסרים נתונים.') +
          ' ההערכה הזו נבנית מהשילוב של מה שאכלת ומה שקרה למשקל, ולכן צריך את שניהם באותו חלון זמן.'));
    }

    var suggested = Metrics.suggestedKcal(best.tdee, settings.goal.ratePerWeekKg, settings.kcalPerKg);
    var body = '' +
      '<p class="finding">לפי מה שאכלת ומה שקרה למשקל, שריפה יומית של ' +
        Fmt.numHtml(best.tdee, 0) + ' קלוריות.</p>' +
      UI.readout({ value: best.tdee, digits: 0, unit: 'קק״ל ליום', margin: best.ci95 }) +
      '<div class="metric-row" style="margin-top:12px"><span class="label">צריכה ממוצעת בחלון</span>' +
        '<span class="value">' + Fmt.n(best.meanKcal, 0) + ' ± ' + Fmt.n(best.sdKcal, 0) + '</span></div>' +
      '<div class="metric-row"><span class="label">גירעון בפועל</span>' +
        '<span class="value">' + Fmt.signed(best.deficit, 0) + ' ליום</span></div>';

    if (Fmt.isNum(suggested)) {
      body += '<div class="metric-row"><span class="label">יעד לקצב של ' +
        Fmt.signed(settings.goal.ratePerWeekKg, 2) + ' ק״ג בשבוע</span>' +
        '<span class="value">' + Fmt.n(suggested, 0) + ' קק״ל</span></div>';
    }

    body += UI.basis('חלון ' + best.windowDays + ' יום · ' + best.kcalDays + ' ימי תזונה · ' +
      best.weightDays + ' שקילות · ' + best.kcalPerKg + ' קק״ל לק״ג');

    if (best.ci95 > 400) {
      body += '<div class="notice">רווח הסמך רחב. אל תשנה יעדים על סמך המספר הזה עדיין — עוד שבוע של דיווח יצמצם אותו משמעותית.</div>';
    }

    return UI.card('כמה אתה באמת שורף', 'הערכה מהנתונים שלך, לא מנוסחה כללית', body);
  }

  /**
   * TDEE מסתגל. מוצג לצד ההערכה מהרגרסיה בכוונה: כששתי שיטות שונות
   * מסכימות אפשר לסמוך על המספר, וכשהן חלוקות זה עצמו הממצא.
   */
  function adaptiveCard(entries, settings) {
    var r = Metrics.adaptiveTDEE(entries, { kcalPerKg: settings.kcalPerKg });
    if (!r.ok) {
      var why = r.reason === 'intake'
        ? 'צריך לפחות שלושה ימים עם דיווח קלוריות.'
        : 'צריך לפחות שקילה אחת בטווח.';
      return UI.card('TDEE מסתגל', null, UI.empty('אין מספיק נתונים', why));
    }

    var f = r.final;
    var ols = Metrics.estimateTDEEMulti(entries, { kcalPerKg: settings.kcalPerKg }).best;
    var agreement = '';
    if (ols && ols.ok) {
      var gap = Math.abs(f.tdee - ols.tdee);
      agreement = gap < 150
        ? 'שתי השיטות מסכימות בפער של ' + Math.round(gap) + ' קלוריות, וזה מחזק את ההערכה.'
        : 'הפער בין השיטות הוא ' + Math.round(gap) + ' קלוריות. המסנן נותן משקל גדול יותר לימים האחרונים, ' +
          'אז פער גדול מרמז שההוצאה שלך השתנתה לאחרונה.';
    }

    return UI.card('TDEE מסתגל', 'מסנן קלמן — מתעדכן בכל יום ועוקב אחרי שינויים',
      UI.readout({ value: f.tdee, digits: 0, unit: 'קק״ל ליום', margin: f.ci95 }) +
      '<div class="metric-row" style="margin-top:12px"><span class="label">משקל מגמה של המסנן</span>' +
        '<span class="value">' + Fmt.n(f.trendWeight, 2) + ' ק״ג</span></div>' +
      '<div class="metric-row"><span class="label">גירעון מול הצריכה הממוצעת</span>' +
        '<span class="value">' + Fmt.signed(f.deficit, 0) + ' ליום</span></div>' +
      (ols && ols.ok
        ? '<div class="metric-row"><span class="label">לשם השוואה, רגרסיה על ' + ols.windowDays + ' יום</span>' +
          '<span class="value">' + Fmt.n(ols.tdee, 0) + ' ± ' + Fmt.n(ols.ci95, 0) + '</span></div>'
        : '') +
      (agreement ? '<p class="basis">' + Fmt.esc(agreement) + '</p>' : '') +
      UI.basis(f.totalDays + ' ימים ברצף · ' + f.observedDays + ' שקילות · ' + f.loggedDays +
        ' ימי תזונה · הצריכה מוזזת ' + f.intakeLag + ' יום אחורה מול השקילה'));
  }

  /** בדיקת שפיות למדידות המשקל מול נוסחאות מפורסמות */
  function scaleCheckCard(entries, settings) {
    var last = null;
    for (var i = entries.length - 1; i >= 0; i--) {
      if (Fmt.isNum(entries[i].weightKg) && Fmt.isNum(entries[i].bodyFatKg)) { last = entries[i]; break; }
    }
    if (!last) return '';

    var age = Metrics.ageFromBirthDate(settings.profile.birthDate);
    var check = root.BodyComp.fatCrossCheck(last.bodyFatKg, last.weightKg,
      settings.profile.heightCm, age, settings.profile.sex);

    if (!check.ok) {
      return UI.card('בדיקת שפיות למשקל', null,
        UI.empty('חסר פרופיל', 'גובה, תאריך לידה ומין נדרשים כדי להשוות את קריאת השומן לנוסחאות מקובלות. אפשר להזין אותם במסך הנתונים.'));
    }

    var verdict;
    if (Math.abs(check.gap) < 2) {
      verdict = 'קריאת השומן של המשקל תואמת את האומדנים מהנוסחאות.';
    } else if (check.gap < 0) {
      verdict = 'המשקל מדווח על פחות שומן מכל הנוסחאות. ביו־אימפדנס נוטה לזה כשרמת הנוזלים גבוהה.';
    } else {
      verdict = 'המשקל מדווח על יותר שומן מהנוסחאות. שקילה במצב התייבשות מטה לכיוון הזה.';
    }

    return UI.card('בדיקת שפיות למשקל', 'Deurenberg, Boer ו-Hume מול הקריאה של המשקל',
      '<p class="finding">' + Fmt.esc(verdict) + '</p>' +
      '<div class="metric-row" style="margin-top:12px"><span class="label">קריאת המשקל</span>' +
        '<span class="value">' + Fmt.n(check.measured, 1) + ' ק״ג · ' + Fmt.n(check.measuredPct, 1) + '%</span></div>' +
      '<div class="metric-row"><span class="label">ממוצע הנוסחאות</span>' +
        '<span class="value">' + Fmt.n(check.estimateMean, 1) + ' ק״ג · ' + Fmt.n(check.estimatePct, 1) + '%</span></div>' +
      '<div class="metric-row"><span class="label">פער</span>' +
        '<span class="value">' + Fmt.signed(check.gap, 1) + ' ק״ג</span></div>' +
      UI.basis('הנוסחאות עצמן חלוקות בטווח של ' + Fmt.n(check.spread, 1) +
        ' ק״ג, אז אל תתייחס לאף אחת מהן כאמת. הן שימושיות רק כדי לזהות קריאה חריגה.'));
  }

  function compositionCard(entries, windowDays) {
    var c = Metrics.composition(entries, { windowDays: windowDays });
    if (!c.ok) {
      return UI.card(null, null,
        UI.empty('חסרות מדידות שומן', 'צריך שקילות עם אחוז שומן לאורך ' + windowDays + ' הימים האחרונים.'));
    }
    if (c.fatShare === null) {
      return UI.card(null, null,
        '<p class="finding">המשקל כמעט לא זז בחלון הזה, אז אין מה לפרק.</p>' +
        UI.basis(c.weight.n + ' שקילות · שינוי ' + Fmt.signed(c.weight.changeOverWindow, 2) + ' ק״ג'));
    }

    var total = c.weight.changeOverWindow;
    var fat = c.fat.changeOverWindow;
    var lean = c.lean.ok ? c.lean.changeOverWindow : null;
    var verb = total < 0 ? 'ירדת' : 'עלית';

    return UI.card(null, 'מחושב מקווי המגמה, לא מהפרש בין שתי שקילות', 
      '<p class="finding">מתוך ' + Fmt.numHtml(Math.abs(total), 2) + ' ק״ג ש' + verb + ' ב־' + windowDays +
        ' הימים האחרונים, ' + Fmt.numHtml(Math.abs(fat), 2) + ' ק״ג שומן' +
        (lean === null ? '' : ' ו־' + Fmt.numHtml(Math.abs(lean), 2) + ' ק״ג מסה רזה') + '.</p>' +
      '<div class="metric-row" style="margin-top:12px"><span class="label">חלק השומן בשינוי</span>' +
        '<span class="value">' + Fmt.pct(c.fatShare, 0) + '</span></div>' +
      UI.basis(c.pairedDays + ' ימים שנמדדו בהם גם משקל וגם שומן · מדידות שומן במשקל ביתי רועשות, ' +
        'אז הפירוק אינדיקטיבי לכיוון ולא למספר המדויק.'));
  }

  function adherenceCard(entries, settings, effectiveTargets) {
    settings = Object.assign({}, settings, { targets: effectiveTargets });
    var hasTarget = Metrics.NUTRITION_FIELDS.some(function (f) { return Fmt.isNum(settings.targets[f]); });
    if (!hasTarget) {
      return UI.card(null, null,
        UI.empty('לא הוגדרו יעדים', 'אפשר להגדיר יעדי קלוריות ומאקרו במסך הנתונים.'));
    }
    var a = Metrics.adherence(entries, settings.targets, { windowDays: 7 });
    var rows = Metrics.NUTRITION_FIELDS.map(function (field) {
      var f = a.fields[field];
      return UI.gauge({
        label: Metrics.FIELDS[field].label,
        value: f.mean,
        target: f.target,
        digits: Metrics.FIELDS[field].digits
      }) + (f.pctInRange === null ? '' :
        '<p class="basis" style="margin-top:-6px">' + f.inRange + ' מתוך ' + f.days +
        ' ימים בטווח של ±10% מהיעד</p>');
    }).join('');

    return UI.card(null, 'שבעה ימים אחרונים · הקו הסגול הוא היעד',
      rows + UI.coverageStrip(entries, { windowDays: 7, field: 'kcal', caption: 'ימים עם תזונה' }));
  }

  function projectionCard(entries, settings, windowDays) {
    var target = settings.goal.targetWeightKg;
    if (!Fmt.isNum(target)) return '';
    var ma = Metrics.latestMovingAverage(entries, 'weightKg', {});
    var t = Metrics.trend(entries, 'weightKg', { windowDays: windowDays });
    if (!ma || !t.ok) return '';

    var p = Metrics.projection(ma.y, target, t.perWeek);
    if (!p) return '';

    var body;
    if (p.weeks === 0) {
      body = '<p class="finding">אתה במשקל היעד.</p>';
    } else if (p.date === null) {
      body = '<p class="finding">בקצב הנוכחי לא מתקרבים ליעד של ' + Fmt.numHtml(target, 1) + ' ק״ג.</p>';
    } else {
      body = '<p class="finding">בקצב הנוכחי תגיע ל־' + Fmt.numHtml(target, 1) + ' ק״ג בסביבות ' +
        '<span class="num">' + Fmt.esc(Dates.long(p.date)) + '</span>, בעוד ' +
        Fmt.numHtml(p.weeks, 0) + ' שבועות.</p>';
    }
    return UI.card('תחזית', null, body +
      UI.basis('הנחה של קצב קבוע. בפועל הקצב מאט ככל שהמשקל יורד.'));
  }

  var COMPARE_ROWS = [
    { field: 'weightKg', digits: 2, good: null },
    { field: 'bodyFatKg', digits: 2, good: 'down' },
    { field: 'leanKg', digits: 2, good: 'up', label: 'מסה רזה' },
    { field: 'kcal', digits: 0, good: null },
    { field: 'proteinG', digits: 0, good: 'up' },
    { field: 'steps', digits: 0, good: 'up' }
  ];

  function compareCard(entries, windowDays, settings) {
    var c = Metrics.comparePeriods(entries, { windowDays: windowDays });
    // כשמוגדר קצב יעד, ירידה במשקל "טובה" רק אם היעד הוא ירידה
    var weightGood = Fmt.isNum(settings.goal.ratePerWeekKg)
      ? (settings.goal.ratePerWeekKg < 0 ? 'down' : 'up') : null;

    var rows = COMPARE_ROWS.map(function (row) {
      var current = c.current.fields[row.field];
      var previous = c.previous.fields[row.field];
      if (!current || (current.mean === null && previous.mean === null)) return '';
      var delta = c.deltas[row.field];
      var good = row.field === 'weightKg' ? weightGood : row.good;
      var label = row.label || (Metrics.FIELDS[row.field] ? Metrics.FIELDS[row.field].label : row.field);
      return '<tr>' +
        '<td>' + Fmt.esc(label) + '</td>' +
        '<td class="n">' + Fmt.n(current.mean, row.digits) + '</td>' +
        '<td class="n">' + Fmt.n(previous.mean, row.digits) + '</td>' +
        '<td class="n ' + (good ? Fmt.deltaClass(delta, good) : '') + '">' + Fmt.signed(delta, row.digits) + '</td>' +
        '</tr>';
    }).join('');

    if (!rows) return '';

    return UI.card(null,
      windowDays + ' הימים האחרונים מול ' + windowDays + ' הימים שלפניהם',
      '<div class="table-scroll"><table class="data"><thead><tr>' +
        '<th>מדד</th><th>עכשיו</th><th>קודם</th><th>שינוי</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      UI.basis('ממוצעים של כל תקופה. תקופה עם מעט דיווחים תיראה מדויקת יותר משהיא.'));
  }

  /** משפט אחד שמסכם איפה עומדים, לפני כל הפירוט */
  function headline(trend, ma, adaptive) {
    if (!trend.ok) {
      return UI.hero({
        label: 'איפה עומדים',
        value: Fmt.EMPTY,
        sentence: 'עוד אין מספיק שקילות כדי לזהות מגמה. צריך לפחות ' + trend.needed + ', יש ' + trend.n + '.'
      });
    }

    var direction = trend.perWeek < -0.02 ? 'יורד' : trend.perWeek > 0.02 ? 'עולה' : 'יציב';
    var sentence = direction === 'יציב'
      ? 'המשקל עומד במקום.'
      : 'זה הקצב שעולה מ-' + trend.n + ' השקילות של ' + trend.windowDays + ' הימים האחרונים.';

    if (trend.ci95PerWeek !== null && Math.abs(trend.ci95PerWeek) > Math.abs(trend.perWeek)) {
      sentence += ' הרעש עדיין גדול מהמגמה, אז גם הכיוון לא ודאי.';
    }

    return UI.hero({
      label: 'קצב שבועי',
      value: Fmt.signed(trend.perWeek, 2),
      unit: 'ק״ג בשבוע  ' + Fmt.pm(trend.ci95PerWeek, 2),
      sentence: sentence,
      facts: [
        { label: 'משקל מגמה', value: ma ? Fmt.n(ma.y, 2) : Fmt.EMPTY },
        { label: 'שורף ביום', value: adaptive.ok ? Fmt.n(adaptive.final.tdee, 0) : Fmt.EMPTY },
        { label: 'שינוי בחלון', value: Fmt.signed(trend.changeOverWindow, 2) }
      ]
    });
  }

  function backLink() {
    return '<div class="btn-row" style="margin-bottom:16px">' +
      '<button type="button" class="btn btn--ghost" data-back>‹ חזרה</button></div>';
  }

  function render(container) {
    var entries = Store.getEntries();
    var settings = Store.getSettings();
    var windowDays = root.App.state.window;

    // אם ההתאמה האוטומטית פעילה, יעד הקלוריות נגזר מה-TDEE הנוכחי
    var adaptive = Metrics.adaptiveTDEE(entries, { kcalPerKg: settings.kcalPerKg });
    var derived = Metrics.derivedTarget(settings, adaptive.ok ? adaptive.final.tdee : null);
    var effective = Object.assign({}, settings.targets, { kcal: derived.kcal });

    if (!entries.length) {
      container.innerHTML = UI.empty('אין עדיין נתונים',
        'הזן שקילה ראשונה במסך "היום", או ייבא קובץ קיים במסך "נתונים".');
      return;
    }

    var t = Metrics.trend(entries, 'weightKg', { windowDays: windowDays });
    var maNow = Metrics.latestMovingAverage(entries, 'weightKg', {});

    container.innerHTML = '' +
      backLink() +
      headline(t, maNow, adaptive) +
      UI.chips(WINDOWS, windowDays, 'data-window') +
      '<div class="section-label">הפירוט</div>' +
      UI.details('מגמת המשקל', weightCard(entries, windowDays)) +
      UI.details('כמה אתה שורף', adaptiveCard(entries, settings) + tdeeCard(entries, settings)) +
      UI.details('מאיפה מגיע השינוי', compositionCard(entries, windowDays) + scaleCheckCard(entries, settings)) +
      UI.details('עמידה ביעדים', adherenceCard(entries, settings, effective)) +
      UI.details('מול התקופה הקודמת', compareCard(entries, windowDays, settings) +
        projectionCard(entries, settings, windowDays));

    container.querySelector('[data-back]').addEventListener('click', function () {
      root.App.setState({ view: 'progress' });
    });

    container.querySelectorAll('[data-window]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        root.App.setState({ window: Number(chip.dataset.window) });
      });
    });
  }

  Views.status = { id: 'status', label: 'מצב', glyph: '±', render: render };
})(typeof window !== 'undefined' ? window : globalThis);
