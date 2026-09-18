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

  /**
   * כמה חרגת מהיעד.
   *
   * זו אינה מדידה עצמאית אלא זהות: היעד עצמו נגזר ממה שאכלת ומהשינוי
   * במשקל, ולכן
   *
   *   פער = אכלתי − (אכלתי + מהמשקל − הליכה − גירעון)
   *       = גירעון + הליכה − מהמשקל
   *
   * מה שאכלת מצטמצם לגמרי, וכל טעות ברישום הקלוריות נבלעת בשני
   * הצדדים. מה שנשאר הוא הגירעון שתכננת, ועוד ההליכה כשבחרת לא
   * לספור אותה ביעד, פחות מה שהמשקל מראה בפועל.
   *
   * זה נכון רק כששני המספרים מגיעים מאותו חלון ומאותו מנוע. כשהם
   * הגיעו משניים שונים, נוצר פער מדומה של מאות קלוריות.
   */
  function driftCard(entries, settings, state, best) {
    if (!best) return '';

    var r = best.data;
    var withSteps = state.stepsMode === 'on';
    var spend = withSteps ? r.tdee : r.base;

    var rate = Math.abs((settings.goal || {}).ratePerWeekKg || 0);
    var deficit = (rate * r.kcalPerKg) / 7;
    var target = spend - deficit;

    var perDay = r.meanKcal - target;
    var total = perDay * r.loggedDays;
    var kcalPerKg = settings.kcalPerKg || 7700;
    var kg = total / kcalPerKg;
    var over = perDay > 0;

    // מה המשקל מראה בפועל, בקילוגרמים לשבוע
    var actualRate = (-r.deltaKg / r.days) * 7;

    return P.card('מול היעד',
      'לפי ' + r.days + ' ימים · ' + P.esc(Dates.short(r.foodFrom) + '–' +
        Dates.short(r.foodTo)),
      P.tiles([
        P.tile(over ? 'bad' : 'good', 'ליום', Fmt.signed(perDay, 0), 'קלוריות'),
        P.tile(over ? 'bad' : 'good', 'מצטבר', Fmt.signed(total, 0), 'קלוריות'),
        P.tile(over ? 'bad' : 'good', 'שווה ערך', Fmt.signed(kg, 2), 'ק״ג')
      ]) +

      '<div class="calc num">' +
        'גירעון מתוכנן   ' + Fmt.n(deficit, 0) + '\n' +
        (withSteps ? '' : 'הליכה שלא ביעד  ' + Fmt.n(r.stepKcal, 0) + '\n') +
        'מה שהמשקל מראה  ' + Fmt.n(r.fromWeight, 0) + '\n' +
        '\n' +
        Fmt.n(deficit, 0) +
        (withSteps ? '' : ' + ' + Fmt.n(r.stepKcal, 0)) +
        ' − ' + Fmt.n(r.fromWeight, 0) + ' = ' + Fmt.n(perDay, 0) +
      '</div>' +

      P.hint('הפער אינו מדידה נפרדת אלא זהות: מה שאכלת מצטמצם משני ' +
        'הצדדים, ולכן טעות ברישום הקלוריות אינה משפיעה עליו כלל. ' +
        'תכננת ' + Fmt.n(rate, 2) + ' ק״ג בשבוע, והמשקל מראה ' +
        Fmt.n(Math.abs(actualRate), 2) + ' ק״ג בשבוע' +
        (actualRate < 0 ? ' בעלייה' : '') + '.' +
        (withSteps ? ''
          : ' ההליכה מופיעה בפער כי בחרת לא לספור אותה ביעד — ' +
            'במצב "עם צעדים" הפער יקטן ב-' + Fmt.n(r.stepKcal, 0) + '.')));
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
