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

  function partsOf(state) {
    var n = Number(state.splitParts);
    return (n === 2 || n === 3 || n === 4) ? n : 2;
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

  /** טבלת המקטעים — מאיפה המספר מגיע */
  function splitCard(split, chosen, state) {
    var rows = split.rows.map(function (r) {
      var active = r === chosen;
      return '<tr' + (active ? ' class="now"' : '') +
        ' data-split-row="' + r.index + '">' +
        '<td class="n">' + r.index + (active ? ' ✓' : '') + '</td>' +
        '<td class="date-cell">' + P.esc(Dates.short(r.from) + '–' + Dates.short(r.to)) +
          '<span class="sub">' + r.days + ' ימים</span></td>' +
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
      P.table(
        [{ label: '#', n: true }, { label: 'תקופה', n: true },
          'משקל', 'שינוי', 'אכלת', 'צעדים', 'תחזוקה'],
        [rows],
        { hint: 'אפשר ללחוץ על שורה כדי למדוד מולה. ברירת המחדל היא המקטע ' +
          'האחרון, העדכני ביותר — אבל גם הרועש ביותר, ולכן שווה להשוות ' +
          'למקטעים האחרים ולחלוקות אחרות.' }));
  }

  /** התקציב עצמו, עם המאקרו */
  function budgetCard(chosen, settings, state) {
    var rate = Math.abs((settings.goal || {}).ratePerWeekKg || 0);
    var kcalPerKg = settings.kcalPerKg || 7700;
    var deficit = (rate * kcalPerKg) / 7;

    // ההליכה של המקטע הנבחר, כדי שהתקציב יהיה מספר אחד
    var stepKcal = chosen.stepKcal || 0;
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
      '<div class="calc num">' +
        'תחזוקה        ' + Fmt.n(chosen.maintenance, 0) + '\n' +
        'גירעון        −' + Fmt.n(deficit, 0) +
          '  (' + Fmt.n(rate, 2) + ' ק״ג בשבוע)\n' +
        'הליכה         +' + Fmt.n(stepKcal, 0) + '\n' +
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

      P.hint('ההליכה נלקחת מהמקטע הנבחר ולכן התקציב אחיד בכל השורות. ' +
        'ביום שתלך הרבה יותר או פחות, הפער שלמטה ישקף את זה.'));
  }

  /** איפה אני עומד מול התקציב */
  function standingCard(entries, budget, macros, state) {
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

    var rows = LENGTHS.map(function (days) {
      var to = state.date;
      var from = Dates.addDays(to, -(days - 1));
      var kcal = mean(from, to, 'kcal');
      if (kcal === null) {
        return '<tr><td class="n">' + days + '</td>' +
          '<td colspan="7" class="flat">אין רישום</td></tr>';
      }

      var gap = kcal - budget;
      var predicted = (gap * days) / 7700;

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
        '<td class="n">' + Fmt.signed(predicted, 2) + '</td>' +
        '<td class="n">' + (actual === null ? '—' : P.delta(actual, 2, 'down')) +
        '</td></tr>';
    }).join('');

    return P.card('איפה אני עומד', 'כל אורך חלון מול אותו תקציב',
      P.table(
        [{ label: 'ימים', n: true }, 'אכלת', 'פער', 'חלבון', 'שומן', 'פחמ׳',
          'צפוי ק״ג', 'בפועל'],
        [rows],
        { hint: '"פער" הוא כמה אכלת מעל התקציב או מתחתיו. "צפוי" הוא מה ' +
          'שהפער המצטבר אמור לעשות למשקל, ו"בפועל" הוא מה שקרה — ממוצע ' +
          'החלון מול ממוצע החלון שלפניו. כשהשניים רחוקים לאורך כל השורות, ' +
          'התקציב עצמו צריך בדיקה.' }));
  }

  function render(state) {
    var entries = Store.getEntries();
    var settings = Store.getSettings();

    var split = Metrics.periodSplit(entries, {
      parts: partsOf(state), endDate: state.date,
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
    var budget = chosen.maintenance - deficit + (chosen.stepKcal || 0);

    var targets = settings.targets || {};
    var protein = Fmt.isNum(targets.proteinG) ? targets.proteinG : 170;
    var fatShare = Fmt.isNum(targets.fatShare) ? targets.fatShare : 0.30;
    var fat = (budget * fatShare) / 9;
    var macros = {
      protein: protein,
      fat: fat,
      carbs: Math.max((budget - protein * 4 - fat * 9) / 4, 0)
    };

    return P.section('תקציב',
      splitCard(split, chosen, state) +
      budgetCard(chosen, settings, state) +
      standingCard(entries, budget, macros, state));
  }

  root.BudgetTab = { render: render, SPLITS: SPLITS, LENGTHS: LENGTHS, partsOf: partsOf };
})(typeof window !== 'undefined' ? window : globalThis);
