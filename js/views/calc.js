/**
 * מסך החישוב. כאן נקבע איך הכל מחושב, ורק כאן.
 * מסך הסיכום מציג תוצאות; הבחירות שמשפיעות עליהן יושבות במקום אחד.
 */
(function (root) {
  'use strict';

  var Views = root.Views = root.Views || {};
  var Fmt = root.Fmt, Dates = root.Dates, Metrics = root.Metrics, Store = root.Store, UI = root.UI;

  var WINDOW_DAYS = [3, 5, 7, 10, 14, 21, 28];

  var RATES = [
    { value: 0, label: 'שמירה' },
    { value: -0.25, label: '0.25' },
    { value: -0.5, label: '0.5' },
    { value: -0.75, label: '0.75' },
    { value: -1, label: '1' }
  ];

  function windowChips(entries, endDate, active) {
    var options = [{ value: 'adaptive', label: 'מסתגל' }];
    Metrics.availableWindows(entries, { endDate: endDate, candidates: WINDOW_DAYS })
      .forEach(function (w) {
        options.push({
          value: w.days,
          label: String(w.days),
          disabled: !w.available,
          title: w.available ? '' : 'צריך ' + w.needDays + ' ימי נתונים, יש ' + w.haveDays
        });
      });
    return UI.chips(options, active, 'data-calc');
  }

  function stepRow(step) {
    var value;
    if (step.text !== undefined) value = Fmt.esc(step.text);
    else if (!Fmt.isNum(step.value)) value = Fmt.EMPTY;
    else if (step.pm) value = '± ' + Fmt.n(step.value, step.digits);
    else if (step.signed) value = Fmt.signed(step.value, step.digits);
    else value = Fmt.n(step.value, step.digits);
    if (step.unit) value += ' ' + Fmt.esc(step.unit);

    return '<div class="metric-row"' + (step.strong ? ' style="font-weight:500"' : '') + '>' +
      '<span class="label">' + Fmt.esc(step.label) + '</span>' +
      '<span class="value">' + value + '</span></div>';
  }

  function traceTable(trace) {
    if (!trace || !trace.length) return '';
    var rows = trace.map(function (s) {
      return '<tr><td class="date-cell">' + Fmt.esc(Dates.short(s.date)) + '</td>' +
        '<td class="n">' + Fmt.n(s.weight, 2) + '</td>' +
        '<td class="n">' + Fmt.n(s.tdee, 0) + '</td>' +
        '<td class="n">±' + Fmt.n(s.ci95, 0) + '</td></tr>';
    }).join('');

    return '<div class="section-label">חמשת הימים האחרונים</div>' +
      '<div class="table-scroll"><table class="data"><thead><tr>' +
        '<th class="date-cell">תאריך</th><th class="n">משקל מגמה</th><th class="n">TDEE</th><th class="n">±</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function methodBlock(method, chosenId) {
    var isChosen = method.id === chosenId;
    var body =
      '<p class="card-note">' + Fmt.esc(method.summary) + '</p>' +
      '<div class="formula">' + Fmt.esc(method.formula) + '</div>' +
      method.derivation.map(stepRow).join('') +
      '<div class="metric-row" style="font-weight:500"><span class="label">בלי צעדים</span>' +
        '<span class="value">' + Fmt.n(method.base, 0) + '</span></div>' +
      traceTable(method.trace) +
      UI.basis(method.note) +
      '<div class="btn-row" style="margin-top:14px">' +
        (isChosen
          ? '<span class="basis" style="margin:0">זו השיטה שמזינה את שאר המסכים</span>'
          : '<button type="button" class="btn" data-pick="' + Fmt.esc(method.id) + '">להשתמש בשיטה הזו</button>') +
      '</div>';

    return UI.details(
      method.name + '  ·  ' + Fmt.n(method.base, 0) + ' ± ' + Fmt.n(method.ci95, 0) + (isChosen ? '  ✓' : ''),
      body);
  }

  /** כל הסבבים המלאים של החלון שנבחר, כמו בגיליון */
  function blocksTable(entries, settings, date) {
    var days = root.App.state.calcWindow;
    if (days === 'adaptive') {
      return UI.card('סבבים', null,
        UI.empty('החישוב המסתגל אינו עובד בסבבים',
          'הוא מעדכן את ההערכה בכל שקילה. בחר חלון מספרי בפס הבקרה כדי לראות סבבים.'));
    }

    var r = Metrics.blockWindows(entries, {
      days: days, count: 12, endDate: date,
      kcalPerKg: settings.kcalPerKg, kcalPerStep: settings.kcalPerStep
    });
    // סבב שאין בו מספיק שקילות אינו בר־השוואה, גם אם התאריכים חלפו
    var usable = r.rows.filter(function (row) { return row.complete; });
    var skipped = r.rows.length - usable.length;
    if (!usable.length) {
      return UI.card('סבבים', null,
        UI.empty('אין עדיין שני סבבים מלאים',
          'סבב של ' + days + ' ימים דורש ' + (days * 2) + ' ימי נתונים.'));
    }

    var rows = usable.slice().reverse().map(function (row) {
      return '<tr><td class="n">' + row.index + '</td>' +
        '<td class="date-cell">' + Fmt.esc(Dates.short(row.from) + '–' + Dates.short(row.to)) + '</td>' +
        '<td class="n">' + Fmt.n(row.meanWeight, 2) + '</td>' +
        '<td class="n">' + Fmt.n(row.prevMeanWeight, 2) + '</td>' +
        '<td class="n"><span class="' + Fmt.deltaClass(-row.deltaKg, 'down') + '">' +
          Fmt.signed(-row.deltaKg, 2) + '</span></td>' +
        '<td class="n">' + Fmt.n(row.meanKcal, 0) + '</td>' +
        '<td class="n">' + Fmt.n(row.meanSteps, 0) + '</td>' +
        '<td class="n">' + Fmt.signed(row.fromWeight, 0) + '</td>' +
        '<td class="n">−' + Fmt.n(row.fromSteps, 0) + '</td>' +
        '<td class="n"><strong>' + Fmt.n(row.base, 0) + '</strong></td></tr>';
    }).join('');

    return UI.card('סבבים של ' + days + ' ימים',
      usable.length + ' סבבים מלאים מאז ' + Dates.short(r.first) +
      (skipped ? ' · ' + skipped + ' סבבים ללא מספיק שקילות לא מוצגים' : '') +
      '. סבב חלקי בסוף אינו נספר',
      '<div class="table-scroll"><table class="data"><thead><tr>' +
        '<th class="n">סבב</th><th class="date-cell">תקופה</th>' +
        '<th class="n">משקל</th><th class="n">קודם</th><th class="n">שינוי</th>' +
        '<th class="n">קלוריות</th><th class="n">צעדים</th>' +
        '<th class="n">ממשקל</th><th class="n">מצעדים</th><th class="n">תחזוקה</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      UI.basis('"תחזוקה" = קלוריות ממוצעות + קלוריות מירידת המשקל − קלוריות מצעדים. ' +
        'זו ההוצאה בלי הליכה, ולכן היא מה שמזין את היעד היומי. ' +
        'רעש השקילה שנמדד אצלך: ' + Fmt.n(r.weightNoiseSd, 2) + ' ק״ג.'));
  }

  function render(container) {
    var entries = Store.getEntries();
    var settings = Store.getSettings();
    var date = root.App.state.date > Dates.today() ? Dates.today() : root.App.state.date;

    if (!entries.length) {
      container.innerHTML = UI.empty('אין עדיין נתונים', 'הזן שקילות ותזונה כדי שיהיה מה להעריך.');
      return;
    }

    var report = Metrics.windowReport(entries, settings, {
      windowDays: root.App.state.calcWindow,
      endDate: date
    });

    var hero = report.ok
      ? UI.hero({
          label: 'שמירת משקל, בלי הליכה',
          value: Fmt.n(report.base, 0),
          unit: 'קק״ל ליום  ' + Fmt.pm(report.ci95, 0),
          sentence: 'היעד היומי נגזר מהמספר הזה פחות הגירעון שבחרת.',
          facts: [
            { label: 'כולל הליכה', value: Fmt.n(report.tdee, 0) },
            { label: 'גירעון יומי', value: Fmt.n(report.deficitPerDay, 0) },
            { label: 'לאכול היום', value: Fmt.n(report.target, 0) }
          ]
        })
      : UI.hero({
          label: 'שמירת משקל',
          value: Fmt.EMPTY,
          sentence: report.reason === 'window'
            ? 'לחלון של ' + report.windowDays + ' ימים דרושים ' + report.needDays +
              ' ימי נתונים. יש ' + report.haveDays + '.'
            : 'אין מספיק נתונים לחישוב.'
        });

    var picked = Metrics.tdeeMethods(entries, settings, { endDate: date });
    var chosen = picked.chosen;

    var summaryRows = picked.methods.map(function (m) {
      return '<tr' + (chosen && m.id === chosen.id ? ' style="font-weight:500"' : '') + '>' +
        '<td>' + Fmt.esc(m.name) + (chosen && m.id === chosen.id ? ' ✓' : '') + '</td>' +
        '<td class="n">' + Fmt.n(m.base, 0) + '</td>' +
        '<td class="n">±' + Fmt.n(m.ci95, 0) + '</td></tr>';
    }).join('');

    container.innerHTML =
      hero +

      UI.basis('את קצב הירידה ואת חלון החישוב אפשר לשנות בפס שבראש המסך, בכל דף.') +

      '<div class="section-label">סבבים</div>' +
      blocksTable(entries, settings, date) +

      (picked.methods.length
        ? '<div class="section-label">השוואת שיטות</div>' +
          UI.card(null, null,
            '<div class="table-scroll"><table class="data"><thead><tr>' +
              '<th>שיטה</th><th class="n">בלי צעדים</th><th class="n">±</th>' +
            '</tr></thead><tbody>' + summaryRows + '</tbody></table></div>') +
          '<div class="section-label">איך כל אחת חושבה</div>' +
          picked.methods.map(function (m) { return methodBlock(m, chosen ? chosen.id : null); }).join('')
        : '');

    container.querySelectorAll('[data-pick]').forEach(function (button) {
      button.addEventListener('click', function () {
        Store.updateSettings({ tdeeMethod: button.dataset.pick });
        root.App.toast('כל המסכים מחשבים עכשיו לפי השיטה הזו');
      });
    });
  }

  Views.calc = { id: 'calc', label: 'חישוב', glyph: '=', render: render };
})(typeof window !== 'undefined' ? window : globalThis);
