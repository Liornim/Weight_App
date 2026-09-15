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

      /**
       * החלון המתגלגל: אותו אורך, נגמר ביום האחרון שאפשר לסגור.
       * הוא באותה רמת דיוק כמו הסבב המעוגן ועדכני יותר ממנו,
       * בניגוד לסבב חלקי שרק מגדיל את הרעש.
       */
      var roll = r.rolling;
      var next = roll
        ? (roll.sameAsBlock
            ? '<span class="flat">זהה</span><span class="sub">אותה תקופה</span>'
            : '<span class="num">' + Fmt.n(withSteps ? roll.tdee : roll.base, 0) +
              '</span><span class="sub">' + P.esc(Dates.short(roll.foodFrom) + '–' +
              Dates.short(roll.foodTo)) + '</span>')
        : '<span class="flat">—</span><span class="sub">אין שקילה סוגרת</span>';

      return '<tr' + (isActive ? ' class="now"' : '') + '>' +
        '<td class="n">' + days + (isActive ? ' ✓' : '') + '</td>' +
        '<td class="date-cell">' + P.esc(Dates.short(r.foodFrom) + '–' + Dates.short(r.foodTo)) +
          '<span class="sub">סבב ' + r.blockIndex + '/' + r.blockCount + '</span></td>' +
        '<td class="n">' + Fmt.n(r.startWeight, 1) + '</td>' +
        '<td class="n">' + Fmt.n(r.endWeight, 1) + '</td>' +
        '<td class="n">' + Fmt.n(r.meanKcal, 0) + '</td>' +
        '<td class="n"><strong>' + Fmt.n(value, 0) + '</strong>' +
          '<span class="sub' + (noisy ? ' warn' : '') + '">±' +
          Fmt.n(r.ci95, 0) + '</span>' +
          '<span class="sub">' + r.weighIns + ' שקילות</span></td>' +
        '<td class="n pending-cell">' + next + '</td></tr>';
    }).join('');

    return P.card('כל אורכי החלון', 'אותו חישוב בדיוק, על תקופות שונות',
      P.table([
        { label: 'ימים', n: true }, { label: 'תקופה', n: true },
        'י.פ', 'י.ס', 'קלוריות', 'סבב מלא', 'אחרונים'
      ], [rows],
      { hint: '"סבב מלא" נספר מיום האוכל הראשון קדימה — היסטוריה מסודרת. ' +
        '"אחרונים" הוא חלון באותו אורך שנגמר ביום האחרון שאפשר לסגור, ' +
        'כלומר מה קורה עכשיו. שניהם באותו אורך ובאותה שיטה — רגרסיה על ' +
        'כל השקילות שבטווח, ולא על שתי נקודות קצה. ' +
        'כשהם מסכימים אפשר להאמין למספר.' }));
  }

  /**
   * מה מגביל את הטווח.
   *
   * כשהטבלה מראה תאריכים ישנים משמעותית מהיום, הסיבה כמעט תמיד
   * אחת: היום האחרון שאפשר לסגור אינו היום האחרון שיש בו נתונים.
   * להציג את זה חוסך ניחושים.
   */
  function coverage(entries) {
    var weighed = entries.filter(function (e) { return Fmt.isNum(e.weightKg); });
    var eaten = entries.filter(function (e) { return Fmt.isNum(e.kcal); });
    if (!weighed.length || !eaten.length) return null;

    var byDate = {};
    entries.forEach(function (e) { byDate[e.date] = e; });

    var closable = eaten.filter(function (e) {
      var next = byDate[Dates.addDays(e.date, 1)];
      return next && Fmt.isNum(next.weightKg);
    });

    return {
      lastWeighed: weighed[weighed.length - 1].date,
      lastEaten: eaten[eaten.length - 1].date,
      lastClosable: closable.length ? closable[closable.length - 1].date : null,
      weighIns: weighed.length,
      meals: eaten.length
    };
  }

  function coverageCard(entries, state) {
    var c = coverage(entries);
    if (!c) return '';

    var stale = c.lastClosable &&
      Dates.diffDays(c.lastClosable, state.date) > 3;

    if (!stale) return '';

    // מה חוסם: אין אוכל אחרי, או שאין שקילה שסוגרת אותו
    var blocked = c.lastEaten > c.lastClosable
      ? 'יש רישום אוכל עד ' + Dates.short(c.lastEaten) + ', אבל אין שקילה ' +
        'בבוקר שאחרי הימים האלה — ולכן אי אפשר לסגור אותם.'
      : 'הרישום האחרון של אוכל הוא ' + Dates.short(c.lastEaten) + '.';

    return P.card('הטווח נעצר ב' + Dates.short(c.lastClosable), null,
      P.empty(blocked) +
      P.hint('שקילה אחרונה: ' + Dates.short(c.lastWeighed) + ' · ' +
        'אוכל אחרון: ' + Dates.short(c.lastEaten) + ' · ' +
        'סה״כ ' + c.weighIns + ' שקילות ו-' + c.meals + ' ימי אוכל. ' +
        'כל חלון נסגר בשקילה של הבוקר שאחרי היום האחרון שלו, ' +
        'ולכן יום אוכל בלי שקילה למחרת אינו נספר.'));
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
      coverageCard(entries, state) +
      comparison(entries, settings, state));
  }

  root.CalcTab = {
    render: render,
    LENGTHS: LENGTHS,
    windowOf: windowOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
