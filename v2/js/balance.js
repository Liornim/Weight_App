/**
 * Balance — טאב המאזן.
 *
 * כרטיס לכל אורך חלון, בסדר שבו הדברים קורים במציאות: שקילת פתיחה
 * בבוקר, מה שנאכל והלכת בין לבין, שקילת סגירה בבוקר שאחרי. ואז
 * החישוב, על אותם מספרים בדיוק שמופיעים מעליו.
 *
 * הכוונה היא שאפשר יהיה לקחת כרטיס אחד, לבדוק אותו בעיפרון,
 * ולהגיע לאותה תוצאה.
 */
(function (root) {
  'use strict';

  var Fmt = root.Fmt, Dates = root.Dates, Metrics = root.Metrics,
      Store = root.Store, P = root.Parts;

  var LENGTHS = P.WINDOWS;

  function line(label, when, value, unit, kind) {
    return '<div class="bal-line' + (kind ? ' bal-line--' + kind : '') + '">' +
      '<span class="bal-label">' + P.esc(label) + '</span>' +
      '<span class="bal-when">' + P.esc(when) + '</span>' +
      '<span class="bal-value num">' + value +
        (unit ? ' <span class="bal-unit">' + P.esc(unit) + '</span>' : '') + '</span>' +
    '</div>';
  }

  /**
   * הסבב שעדיין נאסף, עם ההערכה שנגזרת ממה שכבר יש.
   *
   * "8 מתוך 14" לבדו לא אומר כלום. המספר שמתלווה אליו אומר לאן זה
   * הולך — ומופיע מוחלש, כי הוא נשען על פחות ימים ולכן רועש יותר.
   */
  function rollingBlock(r, withSteps) {
    var p = r.rolling;
    var value = withSteps ? p.tdee : p.base;
    var prev = p.previous ? (withSteps ? p.previous.tdee : p.previous.base) : null;
    var move = prev === null ? null : value - prev;

    return '<div class="pending">' +
      '<div class="pending-head">' + p.days + ' הימים האחרונים · ' +
        P.esc(Dates.short(p.foodFrom) + '–' + Dates.short(p.foodTo)) + '</div>' +
      '<div class="bal-line"><span class="bal-label">י.פ</span>' +
        '<span class="bal-when">' + P.esc(Dates.short(p.startDate)) + '</span>' +
        '<span class="bal-value num">' + Fmt.n(p.startWeight, 1) + '</span></div>' +
      '<div class="bal-line"><span class="bal-label">קלוריות</span>' +
        '<span class="bal-when">ממוצע ליום</span>' +
        '<span class="bal-value num">' + Fmt.n(p.meanKcal, 0) + '</span></div>' +
      '<div class="bal-line"><span class="bal-label">י.ס</span>' +
        '<span class="bal-when">' + P.esc(Dates.short(p.endDate)) + '</span>' +
        '<span class="bal-value num">' + Fmt.n(p.endWeight, 1) + '</span></div>' +
      '<div class="pending-result">' +
        '<span class="k">תחזוקה</span>' +
        '<span class="v num">' + Fmt.n(value, 0) + '</span>' +
        '<span class="s">± ' + Fmt.n(p.ci95, 0) + '</span>' +
      '</div>' +
      '<p class="pending-note">' +
        (p.sameAsBlock
          ? 'התקופה הזו זהה לסבב שמעליה.'
          : 'אותו אורך חלון, נגמר ביום האחרון שאפשר לסגור — ולכן באותה ' +
            'רמת דיוק ועדכני יותר.') +
        (move === null ? ''
          : ' לעומת ' + p.days + ' הימים שלפניהם (' +
            Fmt.n(prev, 0) + '): ' +
            (Math.abs(move) < 50 ? 'כמעט ללא שינוי.'
              : move > 0 ? 'עלייה של ' + Fmt.n(move, 0) + '.'
              : 'ירידה של ' + Fmt.n(-move, 0) + '.')) +
      '</p>' +
    '</div>';
  }

  function card(entries, settings, state, days) {
    var r = Metrics.dayAligned(entries, settings, { days: days, endDate: state.date });

    if (!r.ok) {
      var why = r.reason === 'no-closing-weigh-in'
        ? 'חסרה שקילה בבוקר שאחרי היום האחרון שנרשם בו אוכל'
        : r.reason === 'no-opening-weigh-in'
          ? 'חסרה שקילה ב' + Dates.short(r.needDate)
          : r.reason === 'no-complete-block'
            ? 'עוד לא הושלם סבב אחד: יש ' + r.have + ' ימים מתוך ' + r.need
            : 'אין מספיק ימים עם רישום אוכל';

      return P.card(P.windowLabel(days), null, P.empty(why));
    }

    var span = Dates.short(r.foodFrom) + '–' + Dates.short(r.foodTo);
    var withSteps = state.stepsMode === 'on';
    var maintenance = withSteps ? r.tdee : r.base;

    var rate = Math.abs(settings.goal.ratePerWeekKg || 0);
    var deficit = (rate * r.kcalPerKg) / 7;

    // הנוסחה על אותם מספרים שמופיעים מעליה
    var formula = Fmt.n(r.meanKcal, 0) +
      (r.fromWeight >= 0 ? ' + ' : ' − ') + Fmt.n(Math.abs(r.fromWeight), 0) +
      (withSteps || r.meanSteps === null ? '' : ' − ' + Fmt.n(r.stepKcal, 0)) +
      ' = ' + Fmt.n(maintenance, 0);

    var partial = r.loggedDays < days;

    /**
     * תחזוקה מחוץ לתחום סביר אומרת שהחלון מדד רעש ולא מטבוליזם.
     * בחלון קצר תנודת נוזלים אחת מספיקה כדי להוציא מספר שלילי או
     * חמשת-אלפים, ובלי סימון הוא נראה כמו נתון.
     */
    var implausible = maintenance < 800 || maintenance > 6000;

    return P.card(P.windowLabel(days),
      span + ' · סבב ' + r.blockIndex + ' מתוך ' + r.blockCount,

      line('י.פ', Dates.short(r.startDate), Fmt.n(r.startWeight, 1), 'ק״ג', 'edge') +
      line('קלוריות', span, Fmt.n(r.meanKcal, 0), 'ממוצע ליום') +
      (r.meanSteps === null
        ? line('צעדים', span, '—', '')
        : line('צעדים', span, Fmt.n(r.meanSteps, 0), 'ממוצע ליום')) +
      line('י.ס', Dates.short(r.endDate), Fmt.n(r.endWeight, 1), 'ק״ג', 'edge') +

      '<div class="bal-calc">' +
        '<div class="bal-calc-head">חישוב תחזוקה</div>' +
        '<div class="calc num">' +
          'שינוי במשקל   ' + Fmt.n(r.deltaKg, 2) + ' ק״ג\n' +
          'בקלוריות      ' + Fmt.signed(r.fromWeight, 0) + ' ליום\n' +
          (withSteps || r.meanSteps === null ? '' :
            'מהליכה        −' + Fmt.n(r.stepKcal, 0) + ' ליום\n') +
          '\n' + formula +
        '</div>' +
        '<div class="bal-result' + (implausible ? ' bal-result--bad' : '') + '">' +
          '<span class="k">תחזוקה</span>' +
          '<span class="v num">' + Fmt.n(maintenance, 0) + '</span>' +
          '<span class="s">± ' + Fmt.n(r.ci95, 0) + '</span>' +
        '</div>' +
        (deficit > 0 && !implausible
          ? '<div class="bal-result bal-result--target">' +
            '<span class="k">יעד אחרי גירעון</span>' +
            '<span class="v num">' + Fmt.n(maintenance - deficit, 0) + '</span>' +
            '<span class="s">−' + Fmt.n(deficit, 0) + '</span>' +
          '</div>'
          : '') +
      '</div>' +

      (implausible
        ? P.hint('המספר הזה אינו סביר כתחזוקה, ולכן החלון הזה מדד בעיקר ' +
          'תנודת נוזלים: שינוי של ' + Fmt.n(Math.abs(r.deltaKg), 2) + ' ק״ג על ' +
          days + ' ימים מתורגם ל-' + Fmt.n(Math.abs(r.fromWeight), 0) +
          ' קלוריות ליום, והוא גדול מדי מכדי לשקף שומן.')
        : '') +

      (partial
        ? P.hint('רק ' + r.loggedDays + ' מתוך ' + days + ' הימים בחלון יש בהם ' +
          'רישום אוכל, ולכן הממוצע נשען על פחות ימים מהחלון.')
        : '') +

      (r.rolling ? rollingBlock(r, withSteps) : '') +

      (r.openDays
        ? P.hint('הסבב הבא כבר התחיל — ' + r.openDays + ' מתוך ' + days +
          ' ימים — ויוצג כסבב מלא כשיושלם.')
        : ''));
  }

  function render(state) {
    var entries = Store.getEntries();
    var settings = Store.getSettings();

    var intro = P.card(null, null,
      '<p class="lead">כל כרטיס הוא מאזן סגור: שקילה פותחת, מה שנכנס ויצא ' +
      'בין לבין, ושקילה סוגרת.</p>' +
      P.hint('י.פ היא יתרת הפתיחה — המשקל בבוקר שפותח את החלון. ' +
        'י.ס היא יתרת הסגירה — המשקל בבוקר שאחרי היום האחרון, כי מה שנאכל ' +
        'ביום מופיע במשקל של הבוקר שאחריו. ' +
        'לכן לחלון של N ימי אוכל יש N+1 שקילות.') +
      P.hint('הסבבים נספרים מיום האוכל הראשון קדימה ברצף, ומוצג האחרון ' +
        'שהושלם. לכן כל אורך חלון נגמר בתאריך אחר — ואילו סבב שעדיין ' +
        'נאסף אינו מוצג, כדי שלא ייראה כמלא.'));

    var cards = LENGTHS.map(function (days) {
      return card(entries, settings, state, days);
    }).join('');

    var stepsPicker =
      '<label class="pick-label">איך להתייחס להליכה</label>' +
      P.chips([
        { value: 'off', label: 'בלי צעדים' },
        { value: 'on', label: 'עם צעדים' }
      ], state.stepsMode === 'on' ? 'on' : 'off', 'data-steps');

    return P.section('מאזן לפי חלון',
      root.Dash.controls(state, entries, state.date, {
        extra: stepsPicker,
        note: 'המשקל של הבוקר סוגר את היום שלפניו.'
      }) +
      intro + cards);
  }

  root.BalanceTab = { render: render, LENGTHS: LENGTHS };
})(typeof window !== 'undefined' ? window : globalThis);
