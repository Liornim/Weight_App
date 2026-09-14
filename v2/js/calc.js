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

  var LENGTHS = [3, 5, 7, 10, 14, 21, 28];

  var STEPS_MODES = [
    { value: 'off', label: 'בלי צעדים' },
    { value: 'on', label: 'עם צעדים' }
  ];

  function windowOf(state) {
    return state.basis === 'adaptive' ? 7 : Number(state.basis);
  }

  /** שרשרת החישוב לחלון אחד, שלב אחר שלב */
  function derivation(entries, settings, state, days) {
    var r = Metrics.blockWindows(entries, {
      days: days, count: 1, endDate: state.date,
      kcalPerKg: settings.kcalPerKg, kcalPerStep: settings.kcalPerStep
    });

    var row = r.rows[0];
    if (!row || !row.complete) {
      return P.card('איך הגענו למספר', null,
        P.empty('לחלון של ' + days + ' ימים צריך שני סבבים מלאים, כלומר ' +
          (days * 2) + ' ימי נתונים.'));
    }

    var kcalPerKg = settings.kcalPerKg || 7700;
    var rate = Math.abs(settings.goal.ratePerWeekKg || 0);
    var deficit = (rate * kcalPerKg) / 7;
    var withSteps = state.stepsMode === 'on';
    var target = (withSteps ? row.tdee : row.base) - deficit;

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

    return P.card('איך הגענו למספר', 'חלון של ' + days + ' ימים · סבב ' + row.index,
      step(1, 'ההפרש במשקל בין שני הסבבים',
        '<p>הסבב הנוכחי ' + P.esc(Dates.short(row.from) + '–' + Dates.short(row.to)) +
        ' מושווה לסבב שלפניו ' + P.esc(Dates.short(row.prevFrom) + '–' +
          Dates.short(row.prevTo)) + '.</p>' +
        calc('ממוצע קודם   ' + Fmt.n(row.prevMeanWeight, 3) + '\n' +
             'ממוצע נוכחי  ' + Fmt.n(row.meanWeight, 3)),
        Fmt.signed(-row.deltaKg, 3) + ' ק״ג') +

      step(2, 'תרגום לקלוריות',
        '<p>כל קילוגרם הוא ' + Fmt.n(kcalPerKg, 0) + ' קלוריות, והשינוי נפרס ' +
        'על ' + days + ' ימים.</p>' +
        calc(Fmt.n(Math.abs(row.deltaKg), 3) + ' × ' + Fmt.n(kcalPerKg, 0) +
             ' ÷ ' + days + ' = ' + Fmt.n(Math.abs(row.fromWeight), 0)),
        Fmt.signed(row.fromWeight, 0) + ' קק״ל ליום') +

      step(3, 'ההוצאה',
        '<p>אם אכלת ' + Fmt.numHtml(row.meanKcal, 0) + ' בממוצע וירדת בקצב הזה, ' +
        'שרפת את הסכום שלהם. זו מדידה מהמשקל, לא נוסחה.</p>' +
        calc('קלוריות ממוצעות  ' + Fmt.n(row.meanKcal, 0) + '\n' +
             'מהשינוי במשקל    ' + Fmt.signed(row.fromWeight, 0)),
        Fmt.n(row.tdee, 0) + ' קק״ל') +

      step(4, 'ההליכה',
        '<p>' + Fmt.numHtml(row.meanSteps, 0) + ' צעדים ביום, ' +
        Fmt.n(settings.kcalPerStep || 0.04, 3) + ' קלוריות לצעד.</p>' +
        calc(Fmt.n(row.meanSteps, 0) + ' × ' + Fmt.n(settings.kcalPerStep || 0.04, 3) +
             ' = ' + Fmt.n(row.fromSteps, 0)) +
        '<p>' + (withSteps
          ? 'בחרת לספור אותה, ולכן היא נשארת ביעד.'
          : 'בחרת לא לספור אותה, ולכן היא יורדת מההוצאה והופכת לתוספת לגירעון.') +
        '</p>',
        (withSteps ? Fmt.n(row.tdee, 0) : Fmt.n(row.base, 0)) + ' קק״ל') +

      step(5, 'הגירעון',
        '<p>' + Fmt.n(rate, 2) + ' ק״ג בשבוע, פרוס על שבעה ימים.</p>' +
        calc(Fmt.n(rate, 2) + ' × ' + Fmt.n(kcalPerKg, 0) + ' ÷ 7 = ' +
             Fmt.n(deficit, 0)),
        '−' + Fmt.n(deficit, 0) + ' קק״ל') +

      '<div class="final">' +
        '<span class="k">היעד</span>' +
        '<span class="v num">' + Fmt.n(target, 0) + '</span>' +
        '<span class="s">קלוריות ליום</span>' +
      '</div>' +

      P.hint('רווח הסמך של החלון הזה הוא ±' + Fmt.n(row.ci95, 0) + ' קלוריות. ' +
        'כלומר היעד יכול לנוע בין ' + Fmt.n(target - row.ci95, 0) + ' ל-' +
        Fmt.n(target + row.ci95, 0) + '. ' +
        (row.ci95 > 600
          ? 'זה רחב מדי כדי לפעול לפיו — חלון ארוך יותר ייתן מספר צר בהרבה.'
          : 'זה טווח שאפשר לעבוד איתו.')));
  }

  /** אותה שרשרת לכל אורכי החלון, בטבלה אחת */
  function comparison(entries, settings, state) {
    var rows = LENGTHS.map(function (days) {
      var r = Metrics.blockWindows(entries, {
        days: days, count: 1, endDate: state.date,
        kcalPerKg: settings.kcalPerKg, kcalPerStep: settings.kcalPerStep
      });
      var row = r.rows[0];

      if (!row || !row.complete) {
        return '<tr><td class="n">' + days + '</td>' +
          '<td colspan="8" class="flat">צריך ' + (days * 2) + ' ימים</td></tr>';
      }

      var noisy = row.ci95 > 600;
      var active = String(days) === String(windowOf(state));

      return '<tr' + (active ? ' class="now"' : '') + '>' +
        '<td class="n">' + days + (active ? ' ✓' : '') + '</td>' +
        '<td class="date-cell">' + P.esc(Dates.short(row.from) + '–' + Dates.short(row.to)) +
          '<span class="sub">מול ' + P.esc(Dates.short(row.prevFrom) + '–' +
            Dates.short(row.prevTo)) + '</span></td>' +
        '<td class="n">' + Fmt.n(row.meanWeight, 2) + '</td>' +
        '<td class="n">' + Fmt.n(row.prevMeanWeight, 2) + '</td>' +
        '<td class="n">' + P.delta(-row.deltaKg, 2, 'down') + '</td>' +
        '<td class="n">' + Fmt.n(row.meanKcal, 0) + '</td>' +
        '<td class="n">' + Fmt.signed(row.fromWeight, 0) + '</td>' +
        '<td class="n">−' + Fmt.n(row.fromSteps, 0) + '</td>' +
        '<td class="n"><strong>' + Fmt.n(row.base, 0) + '</strong>' +
          '<span class="sub' + (noisy ? ' warn' : '') + '">±' +
          Fmt.n(row.ci95, 0) + '</span></td></tr>';
    }).join('');

    return P.card('כל אורכי החלון', 'אותו חישוב בדיוק, על תקופות שונות',
      P.table([
        { label: 'ימים', n: true }, { label: 'תקופה', n: true },
        'משקל', 'קודם', 'שינוי', 'קלוריות', 'ממשקל', 'מצעדים', 'תחזוקה'
      ], [rows],
      { hint: '"תחזוקה" היא ההוצאה בלי הליכה: קלוריות ממוצעות ועוד מה שהמשקל ' +
        'מראה, פחות הצעדים. המספר הקטן מתחתיה הוא רוחב אי־הוודאות — ' +
        'ככל שהחלון קצר יותר הוא גדול יותר, כי אותו רעש שקילה מתחלק ' +
        'בפחות ימים.' }));
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
      root.Dash.controls(state, entries, state.date, { extra: stepsPicker }) +
      note +
      derivation(entries, settings, state, days) +
      comparison(entries, settings, state));
  }

  root.CalcTab = { render: render, LENGTHS: LENGTHS, windowOf: windowOf };
})(typeof window !== 'undefined' ? window : globalThis);
