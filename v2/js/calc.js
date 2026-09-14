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

    var note = state.basis === 'adaptive'
      ? P.card(null, null,
          P.hint('החישוב המסתגל מעדכן את ההערכה בכל שקילה ואין לו סבבים ' +
            'שאפשר לעקוב אחריהם. הטבלה מסמנת חלון של שבוע במקומו; ' +
            'בחירת חלון מספרי למעלה תסמן אותו.'))
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
      comparison(entries, settings, state));
  }

  root.CalcTab = {
    render: render,
    LENGTHS: LENGTHS,
    windowOf: windowOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
