/**
 * מסך השיטות: איך התקבל כל אחד ממספרי ה-TDEE.
 * לכל שיטה מוצגת הנוסחה, כל מספר שנכנס לתוכה, והתוצאה.
 * זה גם המקום שבו בוחרים באיזו שיטה שאר האפליקציה תשתמש.
 */
(function (root) {
  'use strict';

  var Views = root.Views = root.Views || {};
  var Fmt = root.Fmt, Dates = root.Dates, Metrics = root.Metrics, Store = root.Store, UI = root.UI;

  function stepRow(step) {
    var value;
    if (step.text !== undefined) {
      value = Fmt.esc(step.text);
    } else if (!Fmt.isNum(step.value)) {
      value = Fmt.EMPTY;
    } else if (step.pm) {
      value = '± ' + Fmt.n(step.value, step.digits);
    } else if (step.signed) {
      value = Fmt.signed(step.value, step.digits);
    } else {
      value = Fmt.n(step.value, step.digits);
    }
    if (step.unit) value += ' ' + Fmt.esc(step.unit);

    return '<div class="metric-row"' + (step.strong ? ' style="font-weight:500"' : '') + '>' +
      '<span class="label">' + Fmt.esc(step.label) + '</span>' +
      '<span class="value">' + value + '</span></div>';
  }

  /** מעקב יום־יום של המסנן, שמראה איך ההערכה זזה */
  function traceTable(trace) {
    if (!trace || !trace.length) return '';
    var rows = trace.map(function (s) {
      return '<tr><td class="n">' + Fmt.esc(Dates.short(s.date)) + '</td>' +
        '<td class="n">' + Fmt.n(s.weight, 2) + '</td>' +
        '<td class="n">' + Fmt.n(s.tdee, 0) + '</td>' +
        '<td class="n">±' + Fmt.n(s.ci95, 0) + '</td>' +
        '<td>' + (s.observed ? 'נשקל' : '—') + '</td></tr>';
    }).join('');

    return '<div class="section-label">חמשת הימים האחרונים</div>' +
      '<div class="table-scroll"><table class="data"><thead><tr>' +
        '<th>תאריך</th><th>משקל מגמה</th><th class="n">TDEE</th><th class="n">±</th><th></th>' +
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

  function render(container) {
    var entries = Store.getEntries();
    var settings = Store.getSettings();

    if (!entries.length) {
      container.innerHTML = UI.empty('אין עדיין נתונים', 'הזן שקילות ותזונה כדי שיהיה מה להעריך.');
      return;
    }

    var result = Metrics.tdeeMethods(entries, settings);
    if (!result.methods.length) {
      container.innerHTML = UI.empty('אין מספיק נתונים',
        'כל השיטות דורשות שקילות ודיווחי תזונה באותו חלון זמן.');
      return;
    }

    var chosen = result.chosen;
    var values = result.methods.map(function (m) { return m.base; });
    var spread = Math.max.apply(null, values) - Math.min.apply(null, values);

    var summaryRows = result.methods.map(function (m) {
      return '<tr' + (m.id === chosen.id ? ' style="font-weight:500"' : '') + '>' +
        '<td>' + Fmt.esc(m.name) + (m.id === chosen.id ? ' ✓' : '') + '</td>' +
        '<td class="n">' + Fmt.n(m.base, 0) + '</td>' +
        '<td class="n">±' + Fmt.n(m.ci95, 0) + '</td></tr>';
    }).join('');

    container.innerHTML =
      '<div class="btn-row" style="margin-bottom:16px">' +
        '<button type="button" class="btn btn--ghost" id="back-to-target">‹ חזרה ליעד</button>' +
      '</div>' +
      UI.hero({
        label: 'בשימוש כרגע',
        value: Fmt.n(chosen.base, 0),
        unit: 'קק״ל ליום בלי צעדים  ' + Fmt.pm(chosen.ci95, 0),
        sentence: Fmt.esc(chosen.name) + '. ' + Fmt.esc(chosen.summary),
        facts: [
          { label: 'כולל צעדים', value: Fmt.n(chosen.tdee, 0) },
          { label: 'צעדים ממוצעים', value: Fmt.n(result.meanSteps, 0) },
          { label: 'קק״ל לצעד', value: Fmt.n(result.kcalPerStep, 3) }
        ]
      }) +

      '<div class="section-label">כל השיטות</div>' +
      UI.card(null, null,
        '<div class="table-scroll"><table class="data"><thead><tr>' +
          '<th>שיטה</th><th class="n">בלי צעדים</th><th class="n">±</th>' +
        '</tr></thead><tbody>' + summaryRows + '</tbody></table></div>' +
        UI.basis(spread < 200
          ? 'הפער בין השיטות הוא ' + Math.round(spread) + ' קלוריות — קטן מרווח הסמך של כל אחת מהן. הן מסכימות.'
          : 'הפער בין השיטות הוא ' + Math.round(spread) + ' קלוריות. שיטות עם חלון קצר רועשות יותר, ' +
            'ולכן פער גדול לא בהכרח אומר שמשהו השתנה.')) +

      '<div class="section-label">איך כל אחת חושבה</div>' +
      result.methods.map(function (m) { return methodBlock(m, chosen.id); }).join('');

    container.querySelector('#back-to-target').addEventListener('click', function () {
      root.App.setState({ view: 'today' });
    });

    container.querySelectorAll('[data-pick]').forEach(function (button) {
      button.addEventListener('click', function () {
        Store.updateSettings({ tdeeMethod: button.dataset.pick });
        root.App.toast('כל המסכים מחשבים עכשיו לפי השיטה הזו');
      });
    });
  }

  Views.methods = { id: 'methods', label: 'שיטות', glyph: '∑', render: render };
})(typeof window !== 'undefined' ? window : globalThis);
