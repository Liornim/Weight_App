/**
 * Targets — טאב היעדים.
 *
 * אותה שאלה בכל אורך חלון: אכלת יותר או פחות ממה שתכננת, ובכמה.
 * הכל מוצג כממוצע ליום ולא כסכום, כי "7,807 קלוריות מעל" לא אומר
 * לאף אחד כלום, ואילו "558 ביום מעל" הוא מספר שאפשר לפעול לפיו.
 *
 * הסכום עדיין מופיע בפירוט, יחד עם התרגום לקילוגרמים — שם הוא כן
 * מעניין, כי הוא מסביר את המשקל.
 */
(function (root) {
  'use strict';

  var Fmt = root.Fmt, Dates = root.Dates, Metrics = root.Metrics,
      Store = root.Store, P = root.Parts;

  var LENGTHS = [3, 5, 7, 10, 14, 21, 28];

  var MACROS = [
    { key: 'protein', label: 'חלבון', unit: 'גר׳', good: 'up', digits: 0 },
    { key: 'fat', label: 'שומן', unit: 'גר׳', good: 'down', digits: 0 },
    { key: 'carbs', label: 'פחמימות', unit: 'גר׳', good: 'down', digits: 0 }
  ];

  /** שורה בטבלת הסיכום: פער יומי בקלוריות ובמאקרו */
  function summaryRow(row) {
    if (!row.ok) {
      return '<tr><td>' + row.days + ' ימים</td>' +
        '<td colspan="4" class="flat">' +
        (row.reason === 'no-intake' ? 'אין רישום אוכל' : 'צריך ' + row.needDays + ' ימים') +
        '</td></tr>';
    }

    var cell = function (value, digits, good) {
      if (!Fmt.isNum(value)) return '<td class="n flat">—</td>';
      return '<td class="n">' + P.delta(value, digits, good) + '</td>';
    };

    // ההבחנה חשובה: חלון של 3 ימים שבו דווחו 2 מתאר ממוצע של
    // יומיים, ולכן הוא רגיש יותר ליום חריג
    var coverage = row.loggedDays + ' מתוך ' + row.days + ' ימים עם רישום';

    return '<tr><td>' + row.days + ' ימים' +
        '<span class="sub' + (row.loggedDays < row.days ? ' warn' : '') + '">' +
        P.esc(coverage) + '</span></td>' +
      cell(row.gapPerDay.kcal, 0, 'down') +
      cell(row.gapPerDay.protein, 0, 'up') +
      cell(row.gapPerDay.fat, 0, 'down') +
      cell(row.gapPerDay.carbs, 0, 'down') +
    '</tr>';
  }

  /** פירוט לחלון אחד: בפועל, יעד והפרש */
  function detail(row) {
    if (!row.ok) return '';

    var line = function (label, actual, target, digits, unit, good) {
      var gap = (Fmt.isNum(actual) && Fmt.isNum(target)) ? actual - target : null;
      return '<tr><td>' + P.esc(label) + '</td>' +
        '<td class="n">' + (Fmt.isNum(actual) ? Fmt.n(actual, digits) : '—') + '</td>' +
        '<td class="n">' + (Fmt.isNum(target) ? Fmt.n(target, digits) : '—') + '</td>' +
        '<td class="n">' + P.delta(gap, digits, good) +
          (unit ? ' <span class="sub-inline">' + P.esc(unit) + '</span>' : '') + '</td></tr>';
    };

    var totalKcal = row.gapPerDay.kcal * row.loggedDays;
    var kg = totalKcal / row.kcalPerKg;

    var rows = line('קלוריות', row.actual.kcal, row.target.kcal, 0, '', 'down') +
      line('בניכוי הליכה', row.actual.netKcal, row.target.kcal, 0, '', 'down') +
      MACROS.map(function (macro) {
        return line(macro.label, row.actual[macro.key], row.target[macro.key],
          macro.digits, macro.unit, macro.good);
      }).join('');

    return '<details class="round"><summary>' + row.days + ' ימים — ' +
      (row.gapPerDay.kcal > 0 ? 'אכלת ' + Fmt.n(row.gapPerDay.kcal, 0) + ' מעל היעד'
        : 'אכלת ' + Fmt.n(-row.gapPerDay.kcal, 0) + ' מתחת ליעד') +
      ' ליום</summary>' +
      P.table([{ label: 'ליום', n: false }, 'בפועל', 'יעד', 'הפרש'], [rows]) +
      P.hint('ההוצאה לפי חלון זה: ' + Fmt.n(row.tdee, 0) + ' קק״ל, ובלי הליכה ' +
        Fmt.n(row.base, 0) + '. ' +
        'מצטבר על ' + row.loggedDays + ' הימים שדווחו: ' +
        Fmt.n(Math.abs(totalKcal), 0) + ' קלוריות ' +
        (totalKcal > 0 ? 'מעל' : 'מתחת') + ' — ' + Fmt.n(Math.abs(kg), 2) + ' ק״ג.') +
      '</details>';
  }

  /**
   * היעד שלפיו נמדד הפער.
   *
   * שתי בחירות משפיעות עליו: על סמך כמה זמן לחשב את ההוצאה, וכמה
   * להיזהר בהערכה. "זהיר" מניח הוצאה נמוכה יותר, ולכן היעד יורד
   * והפער מול מה שאכלת גדל. אותן בחירות בדיוק כמו במסך הסיכום,
   * כדי ששני המסכים לא יספרו סיפורים שונים.
   */
  function targetFor(entries, settings, state) {
    var raw = root.Dash.report(entries, settings, state.date, state);
    return root.Dash.adjust(raw, state.caution);
  }

  function render(state) {
    var entries = Store.getEntries();
    var settings = Store.getSettings();

    var chosen = targetFor(entries, settings, state);

    var r = Metrics.targetGaps(entries, settings, {
      endDate: state.date, windows: LENGTHS,
      overrideTarget: chosen.ok ? chosen.target : null
    });

    var usable = r.rows.filter(function (row) { return row.ok; });
    if (!usable.length) {
      return P.section('יעד מול בפועל',
        P.card(null, null, P.empty('צריך עוד ימים של שקילה ורישום אוכל.')));
    }

    // החלון הארוך ביותר הוא המייצג ביותר, ולכן הוא זה שמסכם
    var main = usable[usable.length - 1];
    var verdict = main.gapPerDay.kcal > 50
      ? 'לפי ' + main.days + ' הימים האחרונים אתה אוכל בממוצע ' +
        Fmt.numHtml(main.gapPerDay.kcal, 0) + ' קלוריות ביום מעל היעד.'
      : main.gapPerDay.kcal < -50
        ? 'לפי ' + main.days + ' הימים האחרונים אתה אוכל בממוצע ' +
          Fmt.numHtml(-main.gapPerDay.kcal, 0) + ' קלוריות ביום מתחת ליעד.'
        : 'לפי ' + main.days + ' הימים האחרונים אתה בערך על היעד.';

    var head = P.card(null, null,
      '<p class="lead">' + verdict + '</p>' +
      P.tiles([
        P.tile(main.gapPerDay.kcal > 0 ? 'bad' : 'good', 'קלוריות ליום',
          Fmt.signed(main.gapPerDay.kcal, 0), 'מול היעד'),
        P.tile(Fmt.isNum(main.gapPerDay.protein) && main.gapPerDay.protein >= 0 ? 'good' : 'warn',
          'חלבון ליום', Fmt.isNum(main.gapPerDay.protein)
            ? Fmt.signed(main.gapPerDay.protein, 0) + ' גר׳' : '—', 'מול היעד'),
        P.tile(Fmt.isNum(main.gapPerDay.fat) && main.gapPerDay.fat > 0 ? 'warn' : 'good',
          'שומן ליום', Fmt.isNum(main.gapPerDay.fat)
            ? Fmt.signed(main.gapPerDay.fat, 0) + ' גר׳' : '—', 'מול היעד')
      ]) +
      P.hint(chosen.ok
        ? 'היעד שלפיו נמדד הפער הוא ' + Fmt.n(chosen.target, 0) + ' קלוריות ליום, ' +
          'לפי הבחירות שלמעלה. החלבון הוא היעד שהגדרת, השומן רבע מהקלוריות, ' +
          'והפחמימות הן מה שנשאר.'
        : 'היעד לכל חלון מחושב מההוצאה שאותו חלון מודד, פחות הגירעון שבחרת.'));

    var missing = ['protein', 'fat', 'carbs'].filter(function (key) {
      return usable.every(function (row) { return !Fmt.isNum(row.actual[key]); });
    });
    var labels = { protein: 'חלבון', fat: 'שומן', carbs: 'פחמימות' };

    var missingNote = missing.length
      ? P.hint('אין רישום של ' + missing.map(function (k) { return labels[k]; }).join(', ') +
        ' בימים האלה, ולכן העמודות ריקות. אפשר להזין אותם בטאב ההזנה.')
      : '';

    var table = P.card('פער יומי, לפי אורך חלון', 'מספר חיובי = מעל היעד',
      P.table(
        [{ label: 'חלון', n: false }, 'קלוריות', 'חלבון', 'שומן', 'פחמימות'],
        [r.rows.map(summaryRow).join('')],
        { hint: 'הממוצע מחושב רק על הימים שיש בהם רישום. ' +
          'בחלון של 3 ימים שבו דווחו 2, מדובר בממוצע של יומיים — ' +
          'ולכן יום חריג אחד מזיז אותו הרבה. ' +
          'חלון ארוך יותר אמין יותר, וכשכל השורות מצביעות לאותו כיוון זו מגמה.' }) +
      missingNote);

    var details = '<div class="rounds">' +
      usable.map(detail).join('') + '</div>';

    return P.section('יעד מול בפועל',
      root.Dash.controls(state, entries, state.date) +
      head + table +
      P.card('פירוט לכל חלון', null, details));
  }

  root.TargetsTab = { render: render, LENGTHS: LENGTHS };
})(typeof window !== 'undefined' ? window : globalThis);
