/**
 * מסך היעד. מבנה קבוע ופשוט:
 * כמה שורפים, מה אכלת, מה זה נותן, ומה חסר כדי להגיע ליעד.
 * הכל מוצג פעמיים — בלי צעדים ואיתם — כי אלה שני מספרים שונים
 * ששניהם נכונים, והבלבול ביניהם הוא מקור הטעות הנפוץ ביותר.
 */
(function (root) {
  'use strict';

  var Views = root.Views = root.Views || {};
  var Fmt = root.Fmt, Dates = root.Dates, Metrics = root.Metrics, Store = root.Store, UI = root.UI;

  var PERIODS = [
    { value: 7, label: '7 ימים' },
    { value: 14, label: '14 ימים' },
    { value: 28, label: '28 ימים' }
  ];

  var MODES = [
    { value: 'base', label: 'בלי צעדים' },
    { value: 'total', label: 'כולל צעדים' }
  ];

  function cell(value, digits, signed) {
    if (!Fmt.isNum(value)) return '<span class="missing">—</span>';
    return signed ? Fmt.signed(value, digits) : Fmt.n(value, digits);
  }

  function row(label, todayValue, periodValue, strong) {
    return '<tr' + (strong ? ' style="font-weight:500"' : '') + '>' +
      '<td>' + Fmt.esc(label) + '</td>' +
      '<td class="n">' + todayValue + '</td>' +
      '<td class="n">' + periodValue + '</td></tr>';
  }

  function spacer() {
    return '<tr><td colspan="3" style="border-bottom:0;padding-top:12px"></td></tr>';
  }

  function pick(frame, key, digits, signed) {
    return frame.ok ? cell(frame[key], digits, signed) : '<span class="missing">—</span>';
  }

  function balanceTable(b, mode) {
    var t = b.today, p = b.period;
    var withSteps = mode === 'total';

    var head = '<div class="table-scroll"><table class="data"><thead><tr>' +
      '<th></th><th class="n">היום</th><th>ממוצע ' + b.windowDays + ' ימים</th>' +
      '</tr></thead><tbody>' +
      row('הוצאה בלי צעדים', Fmt.n(b.base, 0), Fmt.n(b.base, 0)) +
      row('אכלת', pick(t, 'intake', 0), pick(p, 'intake', 0));

    if (!withSteps) {
      return head +
        row('גירעון', pick(t, 'nutritionDeficit', 0, true), pick(p, 'nutritionDeficit', 0, true)) +
        row('ירידה משוערת', pick(t, 'nutritionRate', 2, true), pick(p, 'nutritionRate', 2, true), true) +
        '</tbody></table></div>' +
        UI.basis('בק״ג לשבוע; שלילי = ירידה. החישוב מתעלם מהצעדים לגמרי — ' +
          'כל הליכה שתעשה היא תוספת מעבר לזה. ההוצאה היא ' +
          Fmt.n(b.base, 0) + ' ±' + Fmt.n(b.baseCi95, 0) + '.');
    }

    return head +
      row('גירעון מתזונה בלבד', pick(t, 'nutritionDeficit', 0, true), pick(p, 'nutritionDeficit', 0, true)) +
      row('ירידה משוערת מתזונה', pick(t, 'nutritionRate', 2, true), pick(p, 'nutritionRate', 2, true)) +
      spacer() +
      row('צעדים', pick(t, 'steps', 0), pick(p, 'steps', 0)) +
      row('קלוריות מצעדים', pick(t, 'stepKcal', 0), pick(p, 'stepKcal', 0)) +
      row('גירעון כולל', pick(t, 'totalDeficit', 0, true), pick(p, 'totalDeficit', 0, true)) +
      row('ירידה משוערת הכל', pick(t, 'totalRate', 2, true), pick(p, 'totalRate', 2, true), true) +
      '</tbody></table></div>' +
      UI.basis('בק״ג לשבוע; שלילי = ירידה. ההוצאה בלי צעדים היא ' +
        Fmt.n(b.base, 0) + ' ±' + Fmt.n(b.baseCi95, 0) + ', וכל השורות נושאות את אותה אי־ודאות.');
  }

  function gapTable(b, mode) {
    if (b.goalDeficit === null) {
      return UI.empty('לא הוגדר קצב יעד', 'אפשר להזין אותו במסך הנתונים, למשל 0.5− ק״ג בשבוע.');
    }
    var t = b.today, p = b.period;
    var head = '<p class="card-note">לקצב של ' + Fmt.signed(b.goalRatePerWeek, 2) +
        ' ק״ג בשבוע צריך גירעון של ' + Fmt.n(b.goalDeficit, 0) + ' קלוריות ליום</p>' +
      '<div class="table-scroll"><table class="data"><thead><tr>' +
        '<th></th><th class="n">היום</th><th>ממוצע ' + b.windowDays + ' ימים</th>' +
      '</tr></thead><tbody>';

    if (mode !== 'total') {
      return head +
        row('הפרש לסגור', pick(t, 'gapNutrition', 0, true), pick(p, 'gapNutrition', 0, true)) +
        row('כלומר לאכול', pick(t, 'intakeForGoalNutrition', 0), pick(p, 'intakeForGoalNutrition', 0), true) +
        '</tbody></table></div>' +
        UI.basis('הפרש חיובי = צריך לקצץ עוד. שלילי = אתה כבר מעבר ליעד. ' +
          'הצעדים לא נספרים כאן, אז כל הליכה מוסיפה גירעון מעבר למה שמוצג.');
    }

    return head +
      row('הפרש לסגור — תזונה בלבד', pick(t, 'gapNutrition', 0, true), pick(p, 'gapNutrition', 0, true)) +
      row('כלומר לאכול', pick(t, 'intakeForGoalNutrition', 0), pick(p, 'intakeForGoalNutrition', 0)) +
      spacer() +
      row('הפרש לסגור — עם הצעדים', pick(t, 'gapTotal', 0, true), pick(p, 'gapTotal', 0, true)) +
      row('כלומר לאכול', pick(t, 'intakeForGoalTotal', 0), pick(p, 'intakeForGoalTotal', 0), true) +
      row('או להוסיף צעדים', pick(t, 'extraSteps', 0), pick(p, 'extraSteps', 0)) +
      '</tbody></table></div>' +
      UI.basis('הפרש חיובי = צריך לקצץ עוד. שלילי = אתה כבר מעבר ליעד.');
  }

  function goalsTable(entries, settings, date, windowDays) {
    var summary = Metrics.nutritionSummary(entries, { windowDays: windowDays, endDate: date });
    var entry = entries.find(function (e) { return e.date === date; }) || {};

    var rows = [
      { key: 'proteinG', label: 'חלבון' },
      { key: 'steps', label: 'צעדים' },
      { key: 'kcal', label: 'קלוריות' }
    ].map(function (r) {
      var target = settings.targets[r.key];
      if (!Fmt.isNum(target)) return '';
      var mean = summary.fields[r.key] ? summary.fields[r.key].mean : null;
      return '<tr><td>' + Fmt.esc(r.label) + '</td>' +
        '<td class="n">' + Fmt.n(target, 0) + '</td>' +
        '<td class="n">' + cell(entry[r.key], 0) + '</td>' +
        '<td class="n">' + cell(mean, 0) + '</td>' +
        '<td class="n">' + (Fmt.isNum(mean) ? Fmt.signed(mean - target, 0) : '—') + '</td></tr>';
    }).join('');

    if (!rows) {
      return UI.empty('לא הוגדרו יעדים', 'אפשר להזין יעד חלבון וצעדים במסך הנתונים.');
    }

    return '<div class="table-scroll"><table class="data"><thead><tr>' +
      '<th></th><th class="n">יעד</th><th class="n">היום</th><th class="n">ממוצע</th><th class="n">פער</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function backLink() {
    return '<div class="btn-row" style="margin-bottom:16px">' +
      '<button type="button" class="btn btn--ghost" data-back>‹ חזרה</button></div>';
  }

  function render(container) {
    var entries = Store.getEntries();
    var settings = Store.getSettings();
    var date = root.App.state.date > Dates.today() ? Dates.today() : root.App.state.date;
    var windowDays = root.App.state.period || 7;

    if (!entries.length) {
      container.innerHTML = UI.empty('אין עדיין נתונים', 'הזן שקילה ותזונה כדי שיהיה על מה לחשב.');
      return;
    }

    var picked = Metrics.tdeeMethods(entries, settings, { endDate: date });
    var chosen = picked.chosen;
    var mode = root.App.state.stepsMode || 'base';

    var b = Metrics.energyBalance(entries, settings, {
      date: date,
      windowDays: windowDays,
      tdee: chosen ? chosen.tdee : undefined,
      tdeeCi: chosen ? chosen.ci95 : undefined
    });
    if (!b.ok) {
      container.innerHTML = UI.empty('אין מספיק נתונים',
        'צריך שקילות ודיווחי תזונה באותו חלון כדי להעריך את ההוצאה.');
      return;
    }

    var frame = b.today.ok ? b.today : b.period;
    var headlineKey = mode === 'total' ? 'intakeForGoalTotal' : 'intakeForGoalNutrition';
    var headline = Fmt.isNum(frame[headlineKey]) ? frame[headlineKey] : null;

    container.innerHTML =
      backLink() +
      UI.hero({
        label: 'לאכול היום',
        value: headline === null ? Fmt.EMPTY : Fmt.n(headline, 0),
        unit: 'קלוריות',
        sentence: mode === 'total'
          ? (b.today.ok
            ? 'כולל ' + Fmt.numHtml(b.today.stepKcal, 0) + ' קלוריות מ־' +
              Fmt.numHtml(b.today.steps, 0) + ' הצעדים שדיווחת היום.'
            : 'לפי ממוצע הצעדים של ' + windowDays + ' הימים, כי עוד לא דיווחת היום.')
          : 'בלי לספור צעדים כלל. כל הליכה שתעשה היא תוספת מעבר לזה.',
        facts: [
          { label: 'הוצאה בלי צעדים', value: Fmt.n(b.base, 0) },
          { label: 'גירעון נדרש', value: Fmt.n(b.goalDeficit, 0) },
          { label: 'שיטה', value: chosen ? chosen.short : Fmt.EMPTY }
        ]
      }) +

      '<div class="section-label">שיטת חישוב</div>' +
      UI.chips(picked.methods.map(function (m) {
        return { value: m.id, label: m.short + '  ' + Fmt.n(m.base, 0) };
      }), chosen ? chosen.id : null, 'data-method') +

      '<div class="section-label">תצוגה</div>' +
      UI.chips(MODES, mode, 'data-mode') +
      UI.chips(PERIODS, windowDays, 'data-period') +

      '<div class="section-label">מאזן</div>' +
      UI.card(null, null, balanceTable(b, mode)) +

      '<div class="section-label">מה חסר ליעד</div>' +
      UI.card(null, null, gapTable(b, mode)) +

      '<div class="section-label">יעדים</div>' +
      UI.card(null, null, goalsTable(entries, settings, date, windowDays)) +

      '<div class="btn-row" style="margin-top:20px">' +
        '<button type="button" class="btn" id="open-methods">איך חושב המספר, ובחירת שיטה</button>' +
      '</div>';

    container.querySelector('#open-methods').addEventListener('click', function () {
      root.App.setState({ view: 'methods' });
    });

    container.querySelector('[data-back]').addEventListener('click', function () {
      root.App.setState({ view: 'progress' });
    });

    container.querySelectorAll('[data-period]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        root.App.setState({ period: Number(chip.dataset.period) });
      });
    });

    container.querySelectorAll('[data-mode]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        root.App.setState({ stepsMode: chip.dataset.mode });
      });
    });

    container.querySelectorAll('[data-method]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        // השמירה בהגדרות משדרת אירוע, והמסך מצייר את עצמו מחדש
        Store.updateSettings({ tdeeMethod: chip.dataset.method });
      });
    });
  }

  Views.target = { id: 'target', label: 'יעד', glyph: '→', render: render };
})(typeof window !== 'undefined' ? window : globalThis);
