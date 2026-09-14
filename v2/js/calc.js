/**
 * Calc — טאב החישוב.
 *
 * מראה איך מגיעים למספר, שלב אחר שלב, עם הנתונים האמיתיים. הכוונה
 * היא שאפשר יהיה לבדוק כל שורה בעיפרון ולהגיע לאותה תוצאה — ואם לא,
 * זה באג ולא "ככה המערכת מחשבת".
 *
 * שיטת הסבבים היא היחידה שניתן להציג כך. החישוב המסתגל מעדכן את
 * ההערכה בכל שקילה ואין לו טבלה שאפשר לעקוב אחריה, ולכן כשהוא נבחר
 * מוצג במקומו חלון של שבוע.
 */
(function (root) {
  'use strict';

  var Fmt = root.Fmt, Dates = root.Dates, Metrics = root.Metrics,
      Store = root.Store, P = root.Parts;

  var LENGTHS = P.WINDOWS;

  var STEPS_MODES = [
    { value: 'off', label: 'בלי צעדים' },
    { value: 'on', label: 'עם צעדים' }
  ];

  function windowOf(state) {
    return state.basis === 'adaptive' ? 7 : Number(state.basis);
  }

  /**
   * שרשרת החישוב במודל המיושר: שקילת פתיחה, ימי אוכל, שקילת סגירה.
   */
  function alignedDerivation(entries, settings, state, days) {
    var r = Metrics.dayAligned(entries, settings, { days: days, endDate: state.date });

    if (!r.ok) {
      var why = r.reason === 'no-closing-weigh-in'
        ? 'צריך שקילה בבוקר שאחרי היום האחרון שנרשם בו אוכל, כדי לסגור אותו.'
        : r.reason === 'no-opening-weigh-in'
          ? 'חסרה שקילה ב' + Dates.short(r.needDate) + ', הבוקר שפותח את החלון.'
          : 'אין מספיק ימים עם רישום אוכל.';
      return P.card('איך הגענו למספר', null, P.empty(why));
    }

    var rate = Math.abs(settings.goal.ratePerWeekKg || 0);
    var deficit = (rate * r.kcalPerKg) / 7;
    var withSteps = state.stepsMode === 'on';
    var target = (withSteps ? r.tdee : r.base) - deficit;

    var step = function (number, title, body, result) {
      return '<div class="step">' +
        '<div class="step-head"><span class="step-num">' + number + '</span>' +
          '<span class="step-title">' + P.esc(title) + '</span></div>' +
        '<div class="step-body">' + body + '</div>' +
        (result ? '<div class="step-result num">' + result + '</div>' : '') +
      '</div>';
    };

    var calc = function (text) {
      return '<div class="calc num">' + P.esc(text) + '</div>';
    };

    return P.card('איך הגענו למספר',
      'חלון של ' + days + ' ימי אוכל · ' + Dates.short(r.foodFrom) + '–' +
      Dates.short(r.foodTo),

      step(1, 'שתי שקילות שסוגרות את ימי האוכל',
        '<p>המשקל של הבוקר סוגר את היום שלפניו, ולכן ל-' + days + ' ימי אוכל ' +
        'דרושות ' + (days + 1) + ' שקילות.</p>' +
        calc(Dates.short(r.startDate) + ' בוקר   ' + Fmt.n(r.startWeight, 1) + '\n' +
             '  ' + r.loggedDays + ' ימי אוכל\n' +
             Dates.short(r.endDate) + ' בוקר   ' + Fmt.n(r.endWeight, 1)),
        Fmt.signed(r.deltaKg, 2) + ' ק״ג') +

      step(2, 'תרגום לקלוריות',
        '<p>כל קילוגרם הוא ' + Fmt.n(r.kcalPerKg, 0) + ' קלוריות, והשינוי נפרס ' +
        'על ' + days + ' ימי האוכל.</p>' +
        calc(Fmt.n(Math.abs(r.deltaKg), 2) + ' × ' + Fmt.n(r.kcalPerKg, 0) +
             ' ÷ ' + days + ' = ' + Fmt.n(Math.abs(r.fromWeight), 0)),
        Fmt.signed(r.fromWeight, 0) + ' קק״ל ליום') +

      step(3, 'ההוצאה',
        '<p>ממוצע של ' + r.loggedDays + ' ימי אוכל, ועוד מה שהמשקל מראה.</p>' +
        calc('קלוריות ממוצעות  ' + Fmt.n(r.meanKcal, 0) + '\n' +
             'מהשינוי במשקל    ' + Fmt.signed(r.fromWeight, 0)),
        Fmt.n(r.tdee, 0) + ' קק״ל') +

      step(4, 'ההליכה',
        (r.meanSteps === null
          ? '<p>אין רישום צעדים בימים האלה.</p>'
          : '<p>' + Fmt.numHtml(r.meanSteps, 0) + ' צעדים ביום.</p>' +
            calc(Fmt.n(r.meanSteps, 0) + ' × ' + Fmt.n(r.kcalPerStep, 3) +
                 ' = ' + Fmt.n(r.stepKcal, 0))) +
        '<p>' + (withSteps ? 'נספרת ביעד.' : 'אינה נספרת, ולכן מגדילה את הגירעון.') +
        '</p>',
        (withSteps ? Fmt.n(r.tdee, 0) : Fmt.n(r.base, 0)) + ' קק״ל') +

      step(5, 'הגירעון',
        '<p>' + Fmt.n(rate, 2) + ' ק״ג בשבוע, פרוס על שבעה ימים.</p>' +
        calc(Fmt.n(rate, 2) + ' × ' + Fmt.n(r.kcalPerKg, 0) + ' ÷ 7 = ' +
             Fmt.n(deficit, 0)),
        '−' + Fmt.n(deficit, 0) + ' קק״ל') +

      '<div class="final">' +
        '<span class="k">היעד</span>' +
        '<span class="v num">' + Fmt.n(target, 0) + '</span>' +
        '<span class="s">קלוריות ליום</span>' +
      '</div>' +

      P.hint('שתי שקילות הקצה נושאות את מלוא רעש השקילה, ולכן הרווח כאן ' +
        'רחב מבהשוואת ממוצעים: ±' + Fmt.n(r.ci95, 0) + ' קלוריות. ' +
        'בתמורה, כל קלוריה נמדדת מול השינוי שהיא עצמה גרמה.'));
  }

  /**
   * אותו חישוב לכל אורכי החלון, בטבלה אחת.
   *
   * לצד הסבב המלא מוצג גם הסבב שעדיין נאסף והמספר שנגזר ממנו —
   * "8 מתוך 14" לבדו אינו אומר כלום, ואילו המספר שלצידו עונה על
   * השאלה לאן זה הולך.
   */
  function comparison(entries, settings, state) {
    var withSteps = state.stepsMode === 'on';
    var active = windowOf(state);

    var rows = LENGTHS.map(function (days) {
      var r = Metrics.dayAligned(entries, settings, { days: days, endDate: state.date });

      if (!r.ok) {
        var why = r.reason === 'no-complete-block'
          ? 'עוד לא הושלם סבב: ' + r.have + ' מתוך ' + r.need + ' ימים'
          : r.reason === 'no-closing-weigh-in'
            ? 'חסרה שקילה סוגרת'
            : 'אין מספיק נתונים';
        return '<tr><td class="n">' + days + '</td>' +
          '<td colspan="6" class="flat">' + P.esc(why) + '</td></tr>';
      }

      var value = withSteps ? r.tdee : r.base;
      var noisy = r.ci95 > 600;
      var isActive = String(days) === String(active);

      // הסבב שנאסף, אם יש
      var next = r.pending
        ? '<span class="num">' + Fmt.n(withSteps ? r.pending.tdee : r.pending.base, 0) +
          '</span><span class="sub">' + r.pending.days + '/' + days + ' ימים</span>'
        : r.openDays
          ? '<span class="flat">' + r.openDays + '/' + days + '</span>' +
            '<span class="sub">אין שקילה סוגרת</span>'
          : '<span class="flat">—</span><span class="sub">נסגר בדיוק</span>';

      return '<tr' + (isActive ? ' class="now"' : '') + '>' +
        '<td class="n">' + days + (isActive ? ' ✓' : '') + '</td>' +
        '<td class="date-cell">' + P.esc(Dates.short(r.foodFrom) + '–' + Dates.short(r.foodTo)) +
          '<span class="sub">סבב ' + r.blockIndex + '/' + r.blockCount + '</span></td>' +
        '<td class="n">' + Fmt.n(r.startWeight, 1) + '</td>' +
        '<td class="n">' + Fmt.n(r.endWeight, 1) + '</td>' +
        '<td class="n">' + Fmt.n(r.meanKcal, 0) + '</td>' +
        '<td class="n"><strong>' + Fmt.n(value, 0) + '</strong>' +
          '<span class="sub' + (noisy ? ' warn' : '') + '">±' +
          Fmt.n(r.ci95, 0) + '</span></td>' +
        '<td class="n pending-cell">' + next + '</td></tr>';
    }).join('');

    return P.card('כל אורכי החלון', 'אותו חישוב בדיוק, על תקופות שונות',
      P.table([
        { label: 'ימים', n: true }, { label: 'תקופה', n: true },
        'י.פ', 'י.ס', 'קלוריות', 'תחזוקה', 'הסבב הבא'
      ], [rows],
      { hint: 'הסבבים נספרים מיום האוכל הראשון קדימה, ומוצג האחרון שהושלם. ' +
        'העמודה האחרונה היא הסבב שעדיין נאסף: המספר שנגזר ממה שכבר יש בו, ' +
        'ולצידו כמה ימים מתוך החלון. הוא רועש יותר מהמספר שמשמאלו, ' +
        'ויתייצב ככל שהסבב יתקדם.' }));
  }

  function render(state) {
    var entries = Store.getEntries();
    var settings = Store.getSettings();
    var days = windowOf(state);

    var note = state.basis === 'adaptive'
      ? P.card(null, null,
          P.hint('החישוב המסתגל מעדכן את ההערכה בכל שקילה ואין לו טבלה ' +
            'שאפשר לעקוב אחריה שלב־שלב. מוצג כאן חלון של שבוע במקומו; ' +
            'בחירת חלון מספרי למעלה תציג אותו.'))
      : '';

    // הבחירה משנה את שלב 4 ואת היעד, ולכן היא צריכה להיות כאן
    // ולא רק במסך היעדים
    var stepsPicker =
      '<label class="pick-label">איך להתייחס להליכה</label>' +
      P.chips(STEPS_MODES, state.stepsMode === 'on' ? 'on' : 'off', 'data-steps');

    return P.section('החישוב',
      root.Dash.controls(state, entries, state.date, {
        extra: stepsPicker,
        note: 'המשקל של הבוקר סוגר את היום שלפניו.'
      }) +
      note +
      alignedDerivation(entries, settings, state, days) +
      comparison(entries, settings, state));
  }

  root.CalcTab = {
    render: render,
    LENGTHS: LENGTHS,
    windowOf: windowOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
