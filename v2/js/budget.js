/**
 * Budget — טאב התקציב.
 *
 * התחזוקה נמדדת מהשוואת מקטעים גדולים — חצי, שליש או רבע מהתקופה —
 * ולא מחלונות קצרים. זו המסקנה מבדיקה על נתונים אמיתיים: חלון של
 * שבוע נתן "תחזוקה" שנעה בין 1,300 ל-3,600, בעוד חלוקה לחצי נתנה
 * תשובה אחת יציבה.
 *
 * מהתחזוקה נגזר תקציב אחד, קבוע לכל השורות, וכל אורכי החלון נמדדים
 * מולו. עמודת "בפועל" היא בדיקת האיכות: אם המשקל זז אחרת ממה שהמאזן
 * חוזה לאורך כל השורות, התקציב עצמו שגוי.
 */
(function (root) {
  'use strict';

  var Fmt = root.Fmt, Dates = root.Dates, Metrics = root.Metrics,
      Store = root.Store, P = root.Parts;

  var SPLITS = [
    { value: 2, label: 'חצי' },
    { value: 3, label: 'שליש' },
    { value: 4, label: 'רבע' }
  ];

  var LENGTHS = [3, 5, 7, 10, 14, 21, 28];

  /**
   * אילו אורכי חלון להציג.
   *
   * "הכל" הוא כל אורך מ-3 עד 28. הוא ארוך מדי לרוב השימושים, ולכן
   * ברירת המחדל היא קבוצה מייצגת — אבל כשמחפשים משהו ספציפי, הצגת
   * כולם היא מה שמאפשרת לראות איפה המספרים מתייצבים.
   */
  var WINDOW_SETS = [
    { value: 'few', label: 'עיקריים' },
    { value: 'short', label: 'קצרים' },
    { value: 'long', label: 'ארוכים' },
    { value: 'all', label: 'הכל' }
  ];

  function lengthsOf(state) {
    var set = state.budgetWindows;
    if (set === 'all') return P.WINDOWS;
    if (set === 'short') return P.WINDOWS.filter(function (d) { return d <= 10; });
    if (set === 'long') return P.WINDOWS.filter(function (d) { return d >= 10; });
    return LENGTHS;
  }

  var ANCHORS = [
    { value: 'end', label: 'עד היום' },
    { value: 'start', label: 'מתחילת המעקב' }
  ];

  var WALK_MODES = [
    { value: 'on', label: 'עם הליכה רגילה' },
    { value: 'off', label: 'בלי הליכה' }
  ];

  function partsOf(state) {
    var n = Number(state.splitParts);
    return (n === 2 || n === 3 || n === 4) ? n : 2;
  }

  function anchorOf(state) {
    return state.splitAnchor === 'start' ? 'start' : 'end';
  }

  /** האם ההליכה נכללת בתקציב */
  function withWalk(state) {
    return state.budgetWalk !== 'off';
  }

  /** המקטע שנבחר; ברירת המחדל היא האחרון */
  function chosenRow(split, state) {
    if (state.splitRow) {
      var found = split.rows.filter(function (r) {
        return String(r.index) === String(state.splitRow) &&
          Fmt.isNum(r.maintenance);
      })[0];
      if (found) return found;
    }
    return split.selected;
  }

  /**
   * שורת הכותרת: כמה זמן נמדד, וממתי.
   *
   * אורך המעקב הוא מה שקובע כמה אפשר לסמוך על המספרים שמתחת —
   * חלוקה לרבע על חודש נותנת מקטעים של שבוע, וכאלה נבלעים ברעש.
   */
  function trackCard(entries, state) {
    if (!entries.length) return '';

    var first = entries[0].date;
    var last = entries[entries.length - 1].date;
    var span = Dates.diffDays(first, last) + 1;

    var weighed = entries.filter(function (e) { return Fmt.isNum(e.weightKg); }).length;
    var eaten = entries.filter(function (e) { return Fmt.isNum(e.kcal); }).length;

    // גודל המקטע בחלוקה הנוכחית — זה מה שבאמת קובע את הרעש
    var size = Math.floor(entries.length / partsOf(state));

    return P.card(null, null,
      P.tiles([
        P.tile('', 'ימים במעקב', span, Dates.short(first) + ' ואילך'),
        P.tile('', 'שקילות', weighed, 'ימי אוכל ' + eaten),
        P.tile(size < 14 ? 'warn' : 'good', 'מקטע', size + ' ימים',
          'בחלוקה הנוכחית')
      ]) +
      (size < 14
        ? P.hint('מקטע של ' + size + ' ימים קצר יחסית לתנודה היומית שלך, ' +
          'ולכן התחזוקה שנגזרת ממנו רועשת. חלוקה גסה יותר תיתן מספר יציב יותר.')
        : ''));
  }

  /** טבלת המקטעים — מאיפה המספר מגיע */
  function splitCard(split, chosen, state) {
    var rows = split.rows.map(function (r) {
      var active = r === chosen;
      return '<tr' + (active ? ' class="now"' : '') +
        ' data-split-row="' + r.index + '">' +
        '<td class="n">' + r.index + (active ? ' ✓' : '') + '</td>' +
        '<td class="date-cell">' + P.esc(Dates.short(r.from) + '–' + Dates.short(r.to)) +
          '<span class="sub' + (r.full ? '' : ' warn') + '">' + r.days + ' ימים' +
          (r.full ? '' : ' · חלקי') + '</span></td>' +
        '<td class="n">' + (Fmt.isNum(r.weight) ? Fmt.n(r.weight, 2) : '—') + '</td>' +
        '<td class="n">' + (Fmt.isNum(r.change) ? P.delta(r.change, 2, 'down') : '—') + '</td>' +
        '<td class="n">' + (Fmt.isNum(r.kcal) ? Fmt.n(r.kcal, 0) : '—') + '</td>' +
        '<td class="n">' + (Fmt.isNum(r.steps) ? Fmt.n(r.steps, 0) : '—') + '</td>' +
        '<td class="n"><strong>' +
          (Fmt.isNum(r.maintenance) ? Fmt.n(r.maintenance, 0) : '—') +
        '</strong></td></tr>';
    }).join('');

    return P.card('מול מה אני נמדד', 'כל מקטע מושווה לזה שלפניו',
      P.chips(SPLITS, partsOf(state), 'data-split') +
      '<label class="pick-label">מאיפה לספור</label>' +
      P.chips(ANCHORS, anchorOf(state), 'data-anchor') +
      P.table(
        [{ label: '#', n: true }, { label: 'תקופה', n: true },
          'משקל', 'שינוי', 'אכלת', 'צעדים', 'תחזוקה'],
        [rows],
        { hint: 'אפשר ללחוץ על שורה כדי למדוד מולה. ' +
          '"עד היום" מסיים את המקטע האחרון היום; "מתחילת המעקב" סופר ' +
          'מהשקילה הראשונה, ואז המקטע האחרון עשוי לצאת חלקי ומסומן ככזה. ' +
          'ברירת המחדל היא המקטע המלא האחרון.' }));
  }

  /** התקציב עצמו, עם המאקרו */
  function budgetCard(chosen, settings, state) {
    var rate = Math.abs((settings.goal || {}).ratePerWeekKg || 0);
    var kcalPerKg = settings.kcalPerKg || 7700;
    var deficit = (rate * kcalPerKg) / 7;

    /**
     * ההליכה נכללת או לא, לפי הבחירה.
     *
     * "עם הליכה רגילה" מוסיף את ההליכה הממוצעת של המקטע הנבחר —
     * מספר שנמדד מהנתונים, לא הנחה. הוא מוצג במפורש, כדי שיהיה
     * ברור מה "רגילה" אומרת וכדי שאפשר יהיה לעקוב אחריו.
     *
     * "בלי הליכה" הוא התקציב לפני שזזים: כל צעד מגדיל את הגירעון
     * בפועל.
     */
    var walk = withWalk(state);
    var usual = chosen.steps || 0;
    var stepKcal = walk ? (chosen.stepKcal || 0) : 0;
    var budget = chosen.maintenance - deficit + stepKcal;

    var targets = settings.targets || {};
    var protein = Fmt.isNum(targets.proteinG) ? targets.proteinG : 170;
    var fatShare = Fmt.isNum(targets.fatShare) ? targets.fatShare : 0.30;

    var fat = (budget * fatShare) / 9;
    var carbs = Math.max((budget - protein * 4 - fat * 9) / 4, 0);

    var pct = function (grams, perGram) {
      return Math.round(((grams * perGram) / budget) * 100);
    };

    return P.card('התקציב', null,
      P.chips(WALK_MODES, walk ? 'on' : 'off', 'data-walk') +

      '<div class="calc num">' +
        'תחזוקה        ' + Fmt.n(chosen.maintenance, 0) + '\n' +
        'גירעון        −' + Fmt.n(deficit, 0) +
          '  (' + Fmt.n(rate, 2) + ' ק״ג בשבוע)\n' +
        (walk
          ? 'הליכה רגילה   +' + Fmt.n(chosen.stepKcal || 0, 0) +
            '  (' + Fmt.n(usual, 0) + ' צעדים)\n'
          : 'הליכה         אינה נספרת\n') +
      '</div>' +

      '<div class="big-number">' +
        '<span class="v num">' + Fmt.n(budget, 0) + '</span>' +
        '<span class="u">קלוריות ליום</span>' +
      '</div>' +

      P.table(['', { label: 'תקציב', n: true }, { label: 'מהקלוריות', n: true }],
        [
          '<tr><td>חלבון</td><td class="n">' + Fmt.n(protein, 0) + ' ג</td>' +
            '<td class="n">' + pct(protein, 4) + '%</td></tr>' +
          '<tr><td>שומן</td><td class="n">' + Fmt.n(fat, 0) + ' ג</td>' +
            '<td class="n">' + pct(fat, 9) + '%</td></tr>' +
          '<tr><td>פחמימות</td><td class="n">' + Fmt.n(carbs, 0) + ' ג</td>' +
            '<td class="n">' + pct(carbs, 4) + '%</td></tr>'
        ]) +

      P.hint(walk
        ? '"הליכה רגילה" היא ' + Fmt.n(usual, 0) + ' צעדים — הממוצע שלך ' +
          'במקטע ' + P.esc(Dates.short(chosen.from) + '–' + Dates.short(chosen.to)) +
          ', לא הנחה. ביום שתלך יותר או פחות מזה, הטבלה שלמטה תראה ' +
          'את ההפרש בעמודת "מצעדים".'
        : 'ההליכה אינה נספרת בתקציב, ולכן כל צעד שתלך מגדיל את הגירעון ' +
          'בפועל. זה התקציב שלפני שזזים.'));
  }

  /**
   * ההליכה הרגילה — מה היא, והאם היא זזה.
   *
   * "רגילה" אינו מספר קבוע: הוא הממוצע של המקטע הנבחר, והוא משתנה
   * ככל שההרגלים משתנים. הצגת כל המקטעים זה לצד זה מראה אם ההליכה
   * יציבה או במגמה — וזה משנה את התחזוקה, כי היא נמדדת בניכוי
   * ההליכה של אותו מקטע.
   */
  function walkCard(split, chosen, settings) {
    var perStep = Fmt.isNum(settings.kcalPerStep) ? settings.kcalPerStep : 0.045;

    var rows = split.rows.map(function (r) {
      if (!Fmt.isNum(r.steps)) return '';
      var active = r === chosen;
      var kcal = r.steps * perStep;

      return '<tr' + (active ? ' class="now"' : '') + '>' +
        '<td class="date-cell">' + P.esc(Dates.short(r.from) + '–' + Dates.short(r.to)) +
          (active ? '<span class="sub">הנבחר</span>' : '') + '</td>' +
        '<td class="n">' + Fmt.n(r.steps, 0) + '</td>' +
        '<td class="n">' + Fmt.n(kcal, 0) + '</td>' +
        '<td class="n">' + (Fmt.isNum(r.maintenance) ? Fmt.n(r.maintenance, 0) : '—') +
        '</td></tr>';
    }).join('');

    var withSteps = split.rows.filter(function (r) { return Fmt.isNum(r.steps); });
    var first = withSteps.length ? withSteps[0].steps : null;
    var last = withSteps.length ? withSteps[withSteps.length - 1].steps : null;
    var drift = (first === null || last === null) ? null : last - first;

    return P.card('ההליכה הרגילה', 'הממוצע בכל מקטע',
      P.table(
        [{ label: 'תקופה', n: true }, 'צעדים', 'קק״ל', 'תחזוקה'],
        [rows],
        { hint: 'התחזוקה נמדדת בניכוי ההליכה של אותו מקטע, ולכן שינוי ' +
          'בהרגלי ההליכה מזיז אותה. ' +
          (drift === null ? ''
            : Math.abs(drift) < 500
              ? 'ההליכה שלך יציבה לאורך התקופה.'
              : drift > 0
                ? 'ההליכה עלתה ב-' + Fmt.n(drift, 0) + ' צעדים מתחילת המעקב.'
                : 'ההליכה ירדה ב-' + Fmt.n(-drift, 0) + ' צעדים מתחילת המעקב.') }));
  }

  /**
   * איפה אני עומד מול התקציב.
   *
   * הצפי מפוצל לשני מקורות, כי הם שני דברים שונים שאפשר לשנות
   * בנפרד: מה שאכלת מול התקציב, ומה שהלכת מעבר למה שכבר בתוכו.
   *
   * במצב "עם צעדים" התקציב כבר מכיל את ההליכה הממוצעת של המקטע
   * הנבחר, ולכן עמודת הצעדים מודדת רק את ההפרש ממנה — הלכת יותר
   * מהרגיל או פחות. במצב "בלי צעדים" הבסיס הוא אפס, וכל ההליכה
   * נספרת שם.
   */
  function standingCard(entries, budget, macros, state, baseSteps, perStep) {
    var byDate = {};
    entries.forEach(function (e) { byDate[e.date] = e; });

    var mean = function (from, to, field) {
      var values = [];
      for (var d = from; d <= to; d = Dates.addDays(d, 1)) {
        var day = byDate[d];
        if (day && Fmt.isNum(day[field])) values.push(day[field]);
      }
      return values.length ? values.reduce(function (a, b) { return a + b; }, 0) /
        values.length : null;
    };

    var rows = lengthsOf(state).map(function (days) {
      var to = state.date;
      var from = Dates.addDays(to, -(days - 1));
      var kcal = mean(from, to, 'kcal');
      if (kcal === null) {
        return '<tr><td class="n">' + days + '</td>' +
          '<td colspan="10" class="flat">אין רישום</td></tr>';
      }

      var gap = kcal - budget;
      var fromFood = (gap * days) / 7700;

      // ההליכה מעבר למה שכבר מגולם בתקציב
      var steps = mean(from, to, 'steps');
      var extraSteps = steps === null ? 0 : (steps - baseSteps) * perStep;
      var fromWalk = (-extraSteps * days) / 7700;

      var predicted = fromFood + fromWalk;

      // בפועל: ממוצע החלון מול ממוצע החלון שלפניו
      var prevTo = Dates.addDays(from, -1);
      var prevFrom = Dates.addDays(prevTo, -(days - 1));
      var now = mean(from, to, 'weightKg');
      var before = mean(prevFrom, prevTo, 'weightKg');
      var actual = (now === null || before === null) ? null : now - before;

      var macro = function (field, target) {
        var value = mean(from, to, field);
        if (value === null) return '<td class="n flat">—</td>';
        var over = value - target;
        return '<td class="n">' + Fmt.n(value, 0) +
          '<span class="sub' + (Math.abs(over) > target * 0.15 ? ' warn' : '') + '">' +
          Fmt.signed(over, 0) + '</span></td>';
      };

      return '<tr><td class="n">' + days + '</td>' +
        '<td class="n">' + Fmt.n(kcal, 0) + '</td>' +
        '<td class="n">' + P.delta(gap, 0, 'down') + '</td>' +
        macro('proteinG', macros.protein) +
        macro('fatG', macros.fat) +
        macro('carbG', macros.carbs) +
        '<td class="n">' + (steps === null ? '—' : Fmt.n(steps, 0)) +
          (steps === null ? '' : '<span class="sub">' +
            Fmt.signed(steps - baseSteps, 0) + '</span>') + '</td>' +
        '<td class="n">' + Fmt.signed(fromFood, 2) + '</td>' +
        '<td class="n">' + Fmt.signed(fromWalk, 2) + '</td>' +
        '<td class="n"><strong>' + Fmt.signed(predicted, 2) + '</strong></td>' +
        '<td class="n">' + (actual === null ? '—' : P.delta(actual, 2, 'down')) +
        '</td></tr>';
    }).join('');

    return P.card('איפה אני עומד', 'כל אורך חלון מול אותו תקציב',
      '<label class="pick-label">אילו חלונות להציג</label>' +
      P.chips(WINDOW_SETS, state.budgetWindows || 'few', 'data-windows') +
      P.table(
        [{ label: 'ימים', n: true }, 'אכלת', 'פער', 'חלבון', 'שומן', 'פחמ׳',
          'צעדים', 'מתזונה', 'מצעדים', 'צפוי', 'בפועל'],
        [rows],
        { hint: (baseSteps
            ? '"מצעדים" מודד את ההפרש מההליכה הרגילה, ' +
              Fmt.n(baseSteps, 0) + ' צעדים — הלכת יותר מזה והוא מוריד, ' +
              'פחות מזה והוא מוסיף. '
            : '"מצעדים" הוא מלוא תרומת ההליכה, ולכן תמיד מוריד. ') +
          '"מתזונה" הוא מה שהפער באוכל אמור לעשות למשקל. שניהם יחד הם ' +
          '"צפוי", ו"בפועל" הוא מה שקרה — ממוצע החלון מול ממוצע החלון ' +
          'שלפניו. כשהצפוי והבפועל רחוקים לאורך כל השורות, התקציב עצמו ' +
          'צריך בדיקה.' }));
  }

  function render(state) {
    var entries = Store.getEntries();
    var settings = Store.getSettings();

    var split = Metrics.periodSplit(entries, {
      parts: partsOf(state), endDate: state.date, anchor: anchorOf(state),
      kcalPerKg: settings.kcalPerKg, kcalPerStep: settings.kcalPerStep
    });

    if (!split.ok) {
      return P.section('תקציב',
        P.card(null, null,
          P.empty(split.reason === 'too-short'
            ? 'צריך לפחות ' + split.need + ' ימים לחלוקה הזו, יש ' + split.have + '.'
            : 'אין מספיק נתונים להשוואה בין המקטעים.')));
    }

    var chosen = chosenRow(split, state);

    var rate = Math.abs((settings.goal || {}).ratePerWeekKg || 0);
    var deficit = (rate * (settings.kcalPerKg || 7700)) / 7;
    var budget = chosen.maintenance - deficit +
      (withWalk(state) ? (chosen.stepKcal || 0) : 0);

    var targets = settings.targets || {};
    var protein = Fmt.isNum(targets.proteinG) ? targets.proteinG : 170;
    var fatShare = Fmt.isNum(targets.fatShare) ? targets.fatShare : 0.30;
    var fat = (budget * fatShare) / 9;
    var macros = {
      protein: protein,
      fat: fat,
      carbs: Math.max((budget - protein * 4 - fat * 9) / 4, 0)
    };

    // הבסיס שהתקציב כבר מגלם: במצב "בלי צעדים" אין כזה
    var perStep = Fmt.isNum(settings.kcalPerStep) ? settings.kcalPerStep : 0.045;
    var baseSteps = withWalk(state) ? (chosen.steps || 0) : 0;

    return P.section('תקציב',
      trackCard(entries, state) +
      splitCard(split, chosen, state) +
      budgetCard(chosen, settings, state) +
      walkCard(split, chosen, settings) +
      standingCard(entries, budget, macros, state, baseSteps, perStep));
  }

  root.BudgetTab = {
    render: render, SPLITS: SPLITS, ANCHORS: ANCHORS, LENGTHS: LENGTHS,
    WINDOW_SETS: WINDOW_SETS, lengthsOf: lengthsOf,
    partsOf: partsOf, anchorOf: anchorOf, withWalk: withWalk
  };
})(typeof window !== 'undefined' ? window : globalThis);
