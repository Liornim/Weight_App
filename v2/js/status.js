/**
 * Status — התמונה המלאה.
 *
 * מסך אחד שעונה על ארבע שאלות בסדר שבו הן נשאלות: כמה לאכול היום,
 * כמה חרגתי עד עכשיו, מה המשקל עושה, ומה ההרכב עושה.
 *
 * כל מספר כאן מגיע מאותם מנועים שמזינים את שאר המסכים — אין כאן
 * חישוב נוסף, רק בחירה של מה להציג ובאיזה סדר.
 */
(function (root) {
  'use strict';

  var Fmt = root.Fmt, Dates = root.Dates, Metrics = root.Metrics,
      Store = root.Store, P = root.Parts;

  /** החלון הארוך ביותר שיש לו נתונים — המספר היציב ביותר */
  function bestWindow(entries, settings, date, state) {
    var found = null;
    P.WINDOWS.forEach(function (days) {
      var r = Metrics.dayAligned(entries, settings, { days: days, endDate: date });
      if (r.ok) found = { days: days, data: r };
    });
    return found;
  }

  /** כמה לאכול היום */
  function todayCard(entries, settings, state, best) {
    if (!best) {
      return P.card('כמה לאכול היום', null,
        P.empty('צריך עוד ימים של שקילה ורישום אוכל.'));
    }

    var r = best.data;
    var withSteps = state.stepsMode === 'on';
    var spend = withSteps ? r.tdee : r.base;

    var rate = Math.abs((settings.goal || {}).ratePerWeekKg || 0);
    var deficit = (rate * r.kcalPerKg) / 7;
    var target = spend - deficit;

    var today = Store.getEntry(state.date) || {};
    var eaten = Fmt.isNum(today.kcal) ? today.kcal : null;
    var left = eaten === null ? null : target - eaten;

    return P.card('כמה לאכול היום', 'לפי ' + best.days + ' הימים האחרונים',
      '<div class="big-number">' +
        '<span class="v num">' + Fmt.n(target, 0) + '</span>' +
        '<span class="u">קלוריות</span>' +
      '</div>' +

      (eaten === null
        ? P.hint('עוד לא רשמת אוכל היום.')
        : '<div class="progress-line">' +
            '<div class="progress-fill" style="width:' +
              Math.min(100, Math.round((eaten / target) * 100)) + '%"></div>' +
          '</div>' +
          '<p class="lead" style="margin-top:10px">' +
            (left >= 0
              ? 'אכלת ' + Fmt.numHtml(eaten, 0) + ', נשארו לך ' +
                Fmt.numHtml(left, 0) + '.'
              : 'אכלת ' + Fmt.numHtml(eaten, 0) + ', ' +
                Fmt.numHtml(-left, 0) + ' מעל היעד.') +
          '</p>') +

      P.hint('שורף ' + Fmt.n(spend, 0) + (withSteps ? ' כולל הליכה' : ' בלי הליכה') +
        ', פחות גירעון של ' + Fmt.n(deficit, 0) + ' ליום — ' +
        Fmt.n(rate, 2) + ' ק״ג בשבוע. הטווח הוא ±' + Fmt.n(r.ci95, 0) + '.'));
  }

  /** כמה חרגת, ומה זה שווה בקילוגרמים */
  function driftCard(entries, settings, state, best) {
    /**
     * חלון ההשוואה כאן אינו חייב להיות זהה לזה של היעד: targetGaps
     * דורש שני סבבים ולכן פוסל חלונות ארוכים יותר. נבחר הארוך ביותר
     * שכן עובד, כי שם הרעש הקטן ביותר.
     */
    var gaps = Metrics.targetGaps(entries, settings, {
      endDate: state.date, windows: P.WINDOWS,
      withSteps: state.stepsMode === 'on'
    });

    var usable = gaps.rows.filter(function (r) { return r.ok; });
    if (!usable.length) return '';

    var row = usable[usable.length - 1];

    var perDay = row.gapPerDay.kcal;
    var total = perDay * row.loggedDays;
    var kg = total / (settings.kcalPerKg || 7700);
    var over = perDay > 0;

    return P.card('מול היעד',
      'לפי ' + row.days + ' ימים · ' + row.loggedDays + ' דווחו',
      P.tiles([
        P.tile(over ? 'bad' : 'good', 'ליום',
          Fmt.signed(perDay, 0), 'קלוריות'),
        P.tile(over ? 'bad' : 'good', 'מצטבר',
          Fmt.signed(total, 0), 'קלוריות'),
        P.tile(over ? 'bad' : 'good', 'שווה ערך',
          Fmt.signed(kg, 2), 'ק״ג')
      ]) +
      P.hint(over
        ? 'בקצב הזה אתה מוסיף ' + Fmt.n(Math.abs(kg), 2) + ' ק״ג על התקופה ' +
          'במקום לרדת. הפער הוא ' + Fmt.n(perDay, 0) + ' קלוריות ביום.'
        : 'אתה מתחת ליעד ב-' + Fmt.n(Math.abs(perDay), 0) + ' קלוריות ביום, ' +
          'כלומר הגירעון בפועל גדול מהמתוכנן.'));
  }

  /** מה הגוף עושה */
  function bodyCard(entries, state) {
    var best = null;
    P.WINDOWS.forEach(function (days) {
      var r = Metrics.compositionWindow(entries, { days: days, endDate: state.date });
      if (r.ok) best = r;
    });

    if (!best) return '';

    var f = best.fields;
    var sig = best.significance;

    var line = function (label, field, digits, good) {
      var entry = f[field];
      if (!entry || !Fmt.isNum(entry.mean)) return '';

      var real = !sig[field] || sig[field].real;
      var change = Fmt.isNum(entry.change)
        ? P.delta(entry.change, digits, good)
        : '<span class="flat">—</span>';

      return '<div class="status-row' + (real ? '' : ' within-noise') + '">' +
        '<span class="status-label">' + P.esc(label) + '</span>' +
        '<span class="status-value num">' + Fmt.n(entry.mean, 1) + '</span>' +
        '<span class="status-change num">' + change + '</span>' +
      '</div>';
    };

    var share = best.fatShare;

    return P.card('הגוף', 'ממוצע ' + best.days + ' ימים, מול התקופה שלפניה',
      line('משקל', 'weightKg', 2, 'down') +
      line('שומן', 'bodyFatKg', 2, 'down') +
      line('שריר', 'muscleKg', 2, 'up') +
      (share && Fmt.isNum(share.change)
        ? '<div class="status-row">' +
            '<span class="status-label">אחוז שומן</span>' +
            '<span class="status-value num">' + Fmt.n(share.now, 1) + '%</span>' +
            '<span class="status-change num">' + P.delta(share.change, 2, 'down') +
            '</span></div>'
        : '') +
      P.hint('המספר האמצעי הוא הממוצע בתקופה, והימני הוא השינוי מולה. ' +
        'שורה בהירה היא שינוי שאינו גדול מרעש המדידה.'));
  }

  function render(state) {
    var entries = Store.getEntries();
    var settings = Store.getSettings();

    if (!entries.length) {
      return P.section('המצב',
        P.card(null, null, P.empty('עוד אין נתונים. אפשר להתחיל בטאב ההזנה.')));
    }

    var best = bestWindow(entries, settings, state.date, state);

    var stepsPicker =
      '<label class="pick-label">איך להתייחס להליכה</label>' +
      P.chips([
        { value: 'off', label: 'בלי צעדים' },
        { value: 'on', label: 'עם צעדים' }
      ], state.stepsMode === 'on' ? 'on' : 'off', 'data-steps');

    return P.section('המצב',
      todayCard(entries, settings, state, best) +
      driftCard(entries, settings, state, best) +
      bodyCard(entries, state) +
      P.card('הגדרת הקצב', null,
        stepsPicker +
        P.hint('כל המספרים במסך הזה מחושבים על החלון הארוך ביותר שיש לו ' +
          'מספיק נתונים — שם הרעש הקטן ביותר. ' +
          'לפירוט לפי אורכי חלון אחרים יש את שאר הטאבים.')));
  }

  root.StatusTab = { render: render, bestWindow: bestWindow };
})(typeof window !== 'undefined' ? window : globalThis);
