/**
 * Controls — פס הבקרה המשותף.
 *
 * שתי הבחירות שמשפיעות על כל המספרים באפליקציה — כמה לרדת בשבוע,
 * ועל בסיס איזה חלון לחשב — יושבות כאן ומופיעות בכל מסך. קודם הן
 * היו בתוך מסך אחד, וזה יצר מצב שבו המספרים משתנים בלי שברור למה.
 */
(function (root) {
  'use strict';

  var Fmt = root.Fmt, Dates = root.Dates, Metrics = root.Metrics, Store = root.Store, UI = root.UI;

  var WINDOW_DAYS = [3, 5, 7, 10, 14, 21, 28];

  /** קצב הירידה נשמר תמיד כק״ג לשבוע; הקלוריות נגזרות ממנו */
  function toWeeklyKcal(rateKg, kcalPerKg) {
    return -(rateKg || 0) * (kcalPerKg || Metrics.DEFAULT_KCAL_PER_KG);
  }

  function toRate(weeklyKcal, kcalPerKg) {
    return -(weeklyKcal || 0) / (kcalPerKg || Metrics.DEFAULT_KCAL_PER_KG);
  }

  /** הטווחים שכל חלון משווה, כדי שהבחירה לא תהיה מספר מופשט */
  function windowRanges(entries, endDate) {
    return WINDOW_DAYS.map(function (days) {
      var blocks = Metrics.blockWindows(entries, { days: days, count: 1, endDate: endDate });
      var row = blocks.rows[0];
      return {
        days: days,
        available: !!(row && row.complete),
        current: row ? { from: row.from, to: row.to } : null,
        previous: row ? { from: row.prevFrom, to: row.prevTo } : null,
        needDays: days * 2
      };
    });
  }

  function windowChips(entries, endDate, active, ranges) {
    var options = [{ value: 'adaptive', label: 'מסתגל', title: 'כל ההיסטוריה, במשקל גדול יותר לאחרונים' }];
    ranges.forEach(function (w) {
      options.push({
        value: w.days,
        label: String(w.days),
        disabled: !w.available,
        title: w.available && w.current
          ? Dates.short(w.current.from) + '–' + Dates.short(w.current.to) +
            ' מול ' + Dates.short(w.previous.from) + '–' + Dates.short(w.previous.to)
          : 'צריך ' + w.needDays + ' ימי נתונים'
      });
    });
    return UI.chips(options, active, 'data-calc');
  }

  /** טבלה קטנה שמראה מה מושווה בכל אופציה */
  function rangesTable(ranges, active) {
    var rows = ranges.map(function (w) {
      var isActive = String(w.days) === String(active);
      if (!w.available || !w.current) {
        return '<tr><td class="n">' + w.days + '</td>' +
          '<td colspan="2" class="missing">צריך ' + w.needDays + ' ימים</td></tr>';
      }
      return '<tr' + (isActive ? ' style="font-weight:500;background:var(--measured-10)"' : '') + '>' +
        '<td class="n">' + w.days + (isActive ? ' ✓' : '') + '</td>' +
        '<td class="date-cell">' + Fmt.esc(Dates.short(w.current.from) + '–' + Dates.short(w.current.to)) + '</td>' +
        '<td class="date-cell">' + Fmt.esc(Dates.short(w.previous.from) + '–' + Dates.short(w.previous.to)) + '</td></tr>';
    }).join('');

    return '<div class="table-scroll" style="margin-top:10px"><table class="data"><thead><tr>' +
        '<th class="n">ימים</th><th class="date-cell">חלון נוכחי</th><th class="date-cell">מול</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function render(container) {
    var entries = Store.getEntries();
    var settings = Store.getSettings();
    var state = root.App.state;
    var date = state.date > Dates.today() ? Dates.today() : state.date;

    var rate = Fmt.isNum(settings.goal.ratePerWeekKg) ? settings.goal.ratePerWeekKg : 0;
    var slider = Math.min(Math.abs(rate), 1.5);
    var kcalPerKg = settings.kcalPerKg || Metrics.DEFAULT_KCAL_PER_KG;
    var weekly = toWeeklyKcal(rate, kcalPerKg);
    var daily = weekly / 7;

    var ranges = windowRanges(entries, date);
    var selected = ranges.find(function (w) { return String(w.days) === String(state.calcWindow); });
    var windowLabel = state.calcWindow === 'adaptive'
      ? 'מסתגל'
      : state.calcWindow + ' ימים' +
        (selected && selected.current
          ? ' (' + Dates.short(selected.current.from) + '–' + Dates.short(selected.current.to) + ')'
          : '');

    // מה שהבחירות האלה מייצרות בפועל — המספר שהמשתמש בא לראות
    var report = Metrics.windowReport(entries, settings, {
      windowDays: state.calcWindow, endDate: date
    });

    var summary = (slider === 0 ? 'שמירת משקל' : Fmt.n(slider, 2) + ' ק״ג בשבוע') +
      ' · ' + windowLabel +
      (report.ok ? ' · לאכול ' + Fmt.n(report.target, 0) : ' · אין נתונים לחלון');

    container.innerHTML =
      '<details class="fold controls"' + (state.controlsOpen ? ' open' : '') + '>' +
        '<summary><span>' + Fmt.esc(summary) + '</span></summary>' +
        '<div class="fold-body">' +

          '<div class="slider-head">' +
            '<label for="rate-slider">כמה לרדת בשבוע</label>' +
            '<span class="num slider-value">' + Fmt.n(slider, 2) + ' ק״ג</span>' +
          '</div>' +
          '<input type="range" id="rate-slider" min="0" max="1.5" step="0.05" ' +
            'value="' + slider + '">' +
          '<div class="slider-scale"><span>שמירה</span><span>0.75</span><span>1.5</span></div>' +

          '<div class="field-grid" style="margin-top:14px">' +
            '<div class="field"><label for="rate-week">גירעון לשבוע ' +
              '<span class="suffix">קק״ל</span></label>' +
              '<input id="rate-week" type="number" step="100" value="' +
                (weekly ? Math.round(weekly) : '') + '"></div>' +
            '<div class="field"><label for="rate-day">גירעון ליום ' +
              '<span class="suffix">קק״ל</span></label>' +
              '<input id="rate-day" type="number" step="25" value="' +
                (daily ? Math.round(daily) : '') + '"></div>' +
          '</div>' +

          '<div class="section-label">לחשב לפי (ימים)</div>' +
          windowChips(entries, date, state.calcWindow, ranges) +
          rangesTable(ranges, state.calcWindow) +
          (report.ok
            ? '<div class="metric-row" style="margin-top:10px"><span class="label">שורף לפי החלון</span>' +
                '<span class="value">' + Fmt.n(report.tdee, 0) + ' ± ' + Fmt.n(report.ci95, 0) + '</span></div>' +
              '<div class="metric-row"><span class="label">בלי הליכה</span>' +
                '<span class="value">' + Fmt.n(report.base, 0) + '</span></div>' +
              '<div class="metric-row" style="font-weight:500"><span class="label">צריכה צפויה</span>' +
                '<span class="value">' + Fmt.n(report.target, 0) + ' קק״ל</span></div>'
            : '<div class="notice">' +
                (report.reason === 'window'
                  ? 'לחלון הזה דרושים ' + report.needDays + ' ימי נתונים, יש ' + report.haveDays + '.'
                  : 'אין מספיק נתונים לחישוב.') +
              '</div>') +
          UI.basis('חלון של n ימים משווה חלון מלא לחלון המלא שלפניו, ולכן דורש פי שניים ימי נתונים. ' +
            'מנוטרל = אין עדיין כיסוי מלא.') +

        '</div>' +
      '</details>';

    wire(container, kcalPerKg);
  }

  function wire(container, kcalPerKg) {
    var fold = container.querySelector('details.controls');
    fold.addEventListener('toggle', function () {
      // נשמר במצב ולא ב-DOM, אחרת הפס נסגר בכל רינדור מחדש
      root.App.state.controlsOpen = fold.open;
    });

    var slider = container.querySelector('#rate-slider');
    var label = container.querySelector('.slider-value');

    slider.addEventListener('input', function () {
      label.textContent = Fmt.n(Number(slider.value), 2) + ' ק״ג';
    });
    slider.addEventListener('change', function () {
      Store.updateSettings({ goal: { ratePerWeekKg: -Number(slider.value) } });
    });

    container.querySelector('#rate-week').addEventListener('change', function (e) {
      var value = Store.toNumber(e.target.value);
      if (value === null) return;
      Store.updateSettings({ goal: { ratePerWeekKg: toRate(Math.abs(value), kcalPerKg) } });
    });

    container.querySelector('#rate-day').addEventListener('change', function (e) {
      var value = Store.toNumber(e.target.value);
      if (value === null) return;
      Store.updateSettings({ goal: { ratePerWeekKg: toRate(Math.abs(value) * 7, kcalPerKg) } });
    });

    container.querySelectorAll('[data-calc]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var raw = chip.dataset.calc;
        root.App.setState({ calcWindow: raw === 'adaptive' ? 'adaptive' : Number(raw) });
      });
    });
  }

  root.Controls = { render: render, toWeeklyKcal: toWeeklyKcal, toRate: toRate };
})(typeof window !== 'undefined' ? window : globalThis);
