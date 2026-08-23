/**
 * מסך הבית.
 *
 * המשתמש בוחר שני דברים — כמה לרדת בשבוע, ועל בסיס איזה חלון נתונים
 * לחשב — וכל המספרים במסך משתנים לפי הבחירה.
 *
 * כל החישובים רצים על ההוצאה בלי צעדים. ההליכה מוצגת בנפרד כתוספת,
 * כדי שהיעד לא יגדל בגלל שהלכת.
 */
(function (root) {
  'use strict';

  var Views = root.Views = root.Views || {};
  var Fmt = root.Fmt, Dates = root.Dates, Metrics = root.Metrics, Store = root.Store, UI = root.UI;

  var WINDOW_DAYS = [3, 5, 7, 10, 14, 21, 28];

  /**
   * חלון של n ימים דורש 2n ימי נתונים, כי הוא משווה n ימים
   * ל-n שקדמו להם. חלונות שאין להם כיסוי מלא מוצגים מנוטרלים
   * ולא מחושבים מחלון אחר.
   */
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

  var RATES = [
    { value: 0, label: 'שמירה' },
    { value: -0.25, label: '0.25' },
    { value: -0.5, label: '0.5' },
    { value: -0.75, label: '0.75' },
    { value: -1, label: '1' }
  ];

  var RELIABILITY = {
    high:    'המספר יציב.',
    medium:  'המספר בינוני באמינותו.',
    low:     'החלון קצר, אז המספר מתנדנד מאוד. עדיף להסתמך על 14 ימים ומעלה.',
    unknown: ''
  };

  var BODY = ['weightKg', 'bodyFatKg', 'muscleKg', 'waterKg'];
  var NUTRITION = ['kcal', 'proteinG', 'carbG', 'fatG', 'fiberG'];

  function fieldHtml(key, value) {
    var f = Metrics.FIELDS[key];
    var filled = Fmt.isNum(value);
    return '' +
      '<div class="field">' +
        '<label for="f-' + key + '">' + Fmt.esc(f.label) +
          (f.unit ? ' <span class="suffix">' + Fmt.esc(f.unit) + '</span>' : '') + '</label>' +
        '<input id="f-' + key + '" name="' + key + '" type="number" inputmode="decimal" ' +
          'step="' + f.step + '" value="' + (filled ? value : '') + '" ' +
          'class="' + (filled ? 'is-filled' : '') + '" autocomplete="off">' +
      '</div>';
  }

  function heroBlock(report, entry) {
    if (!report.ok) {
      var reason = report.reason === 'window'
        ? 'חלון של ' + report.windowDays + ' ימים משווה ' + report.windowDays +
          ' ימים ל-' + report.windowDays + ' שקדמו להם, ולכן דרושים ' + report.needDays +
          ' ימי נתונים. יש ' + report.haveDays + '. חסרים עוד ' + report.missingDays + '.'
        : 'אין מספיק נתונים לחישוב. צריך שקילות בבוקר ורישום קלוריות באותם ימים.';
      return UI.hero({
        label: 'לאכול היום',
        value: Fmt.EMPTY,
        sentence: reason
      });
    }

    var eaten = Fmt.isNum(entry.kcal) ? entry.kcal : null;
    var left = eaten === null ? null : report.target - eaten;
    var sentence;
    if (eaten === null) {
      sentence = 'עוד לא רשמת קלוריות היום.';
    } else if (left >= 0) {
      sentence = 'אכלת ' + Fmt.numHtml(eaten, 0) + '. נשארו ' + Fmt.numHtml(left, 0) + '.';
    } else {
      sentence = 'אכלת ' + Fmt.numHtml(eaten, 0) + ', כלומר ' + Fmt.numHtml(-left, 0) + ' מעל היעד.';
    }

    return UI.hero({
      label: 'לאכול היום',
      value: Fmt.n(report.target, 0),
      unit: 'קלוריות',
      sentence: sentence,
      facts: [
        { label: 'לשמירת משקל', value: Fmt.n(report.base, 0) },
        { label: 'גירעון יומי', value: Fmt.n(report.deficitPerDay, 0) },
        { label: 'לפי', value: report.windowDays === 'adaptive' ? 'מסתגל' : report.statsDays + ' ימים' }
      ]
    });
  }

  /** פירוק החישוב בחלון מלא: תקופה מול תקופה, כמו בגיליון */
  function blockRows(report) {
    var b = report.block;
    return '<div class="section-label">איך חושב</div>' +
      row('תקופה נוכחית', Dates.short(b.from) + '–' + Dates.short(b.to)) +
      row('תקופה קודמת', Dates.short(b.prevFrom) + '–' + Dates.short(b.prevTo)) +
      row('משקל ממוצע נוכחי', Fmt.n(b.meanWeight, 2)) +
      row('משקל ממוצע קודם', Fmt.n(b.prevMeanWeight, 2)) +
      row('שינוי', Fmt.signed(-b.deltaKg, 2) + ' ק״ג',
        Fmt.deltaClass(-b.deltaKg, 'down')) +
      row('קלוריות ממוצעות', Fmt.n(b.meanKcal, 0)) +
      row('קלוריות מירידת המשקל', Fmt.signed(b.fromWeight, 0)) +
      row('צעדים ממוצעים', Fmt.n(b.meanSteps, 0));
  }

  function row(label, value, extra) {
    return '<div class="metric-row"><span class="label">' + Fmt.esc(label) + '</span>' +
      '<span class="value' + (extra ? ' ' + extra : '') + '">' + value + '</span></div>';
  }

  function kg(value) {
    return Fmt.isNum(value) ? Fmt.signed(value, 2) + ' ק״ג' : Fmt.EMPTY;
  }

  /** התמונה המלאה של החלון שנבחר */
  function panelCard(report) {
    if (!report.ok) return '';
    var a = report.actual, t = report.theoretical;
    var label = report.windowDays === 'adaptive'
      ? 'לפי כל ההיסטוריה, במשקל גדול יותר לימים האחרונים'
      : 'חלון מלא של ' + report.statsDays + ' ימים מול ' + report.statsDays + ' שקדמו להם';

    return UI.card('מה קורה', label,
      row('כמה אתה שורף ביום', Fmt.n(report.tdee, 0) + ' ± ' + Fmt.n(report.ci95, 0)) +
      row('מזה מהליכה', '− ' + Fmt.n(report.stepKcal, 0)) +
      row('שמירת משקל בלי הליכה', Fmt.n(report.base, 0), 'value--measured') +

      (report.block ? blockRows(report) : '') +

      '<div class="section-label">עמידה ביעד</div>' +
      row('היעד היומי', Fmt.n(report.target, 0)) +
      row('אכלת בממוצע', Fmt.n(report.intake.mean, 0)) +
      row(report.gapPerDay > 0 ? 'חריגה ליום' : 'מתחת ליעד ליום',
        Fmt.signed(report.gapPerDay, 0),
        Fmt.deltaClass(report.gapPerDay, 'down')) +
      row('ימים בטווח היעד',
        report.intake.pctInRange === null ? Fmt.EMPTY
          : report.intake.inRange + ' מתוך ' + report.intake.days) +

      '<div class="section-label">ירידה צפויה לפי החשבון</div>' +
      row('מהתזונה בלבד', kg(t.withoutSteps)) +
      row('כולל ההליכה', kg(t.withSteps), 'value--measured') +

      '<div class="section-label">מה קרה בפועל</div>' +
      row('משקל', kg(a.weightChange), Fmt.deltaClass(a.weightChange, 'down')) +
      row('שומן', kg(a.fatChange), Fmt.deltaClass(a.fatChange, 'down')) +
      row('שריר', kg(a.muscleChange), Fmt.deltaClass(a.muscleChange, 'up')) +
      row('נמדד על פני', report.changeDays + ' ימים מול ה-' + report.changeDays + ' שלפניהם') +
      row('מגמת משקל',
        Fmt.isNum(report.trendPerWeek) ? Fmt.signed(report.trendPerWeek, 2) + ' ק״ג בשבוע' : Fmt.EMPTY) +

      UI.basis('"ירידה צפויה" היא מה שהחשבון מנבא. "בפועל" היא מה שהמשקל הראה. ' +
        'פער ביניהם אומר שהדיווח או השקילה לא מדויקים. ' + RELIABILITY[report.reliability]));
  }

  /** כמה לאכול בימים הקרובים כדי לסגור את הפער */
  function compensationCard(report) {
    if (!report.ok || report.gapTotal === null) return '';

    var gap = report.recent.gap;
    if (gap === null) return '';
    var over = gap > 0;

    var headline = over
      ? 'ב־' + report.recent.loggedDays + ' הימים האחרונים חרגת ב־' +
        Fmt.numHtml(gap, 0) + ' קלוריות.'
      : 'ב־' + report.recent.loggedDays + ' הימים האחרונים אכלת ' +
        Fmt.numHtml(-gap, 0) + ' קלוריות מתחת ליעד.';

    if (!report.compensationFeasible) {
      return UI.card('לסגור את הפער', null,
        '<p class="finding">' + headline + '</p>' +
        '<div class="notice">הפער גדול מכדי לסגור אותו בימים הקרובים בלי לרדת נמוך מדי. ' +
          'עדיף לחזור ליעד היומי הרגיל ולהמשיך משם.</div>');
    }

    var labels = { 1: 'מחר', 2: 'מחר ומחרתיים', 3: 'שלושה ימים', 5: 'חמישה ימים', 7: 'שבוע' };
    var rows = report.compensation.filter(function (c) { return c.feasible; }).map(function (c) {
      return '<tr><td>' + Fmt.esc(labels[c.days] || c.days + ' ימים') + '</td>' +
        '<td class="n">' + Fmt.n(c.perDay, 0) + '</td></tr>';
    }).join('');

    return UI.card('לסגור את הפער', 'כמה לאכול ביום, לפי כמה ימים תפרוס',
      '<p class="finding">' + headline + '</p>' +
      '<div class="table-scroll"><table class="data"><thead><tr>' +
        '<th>פריסה</th><th>קק״ל ליום</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      UI.basis(over
        ? 'ככל שתפרוס על יותר ימים, כל יום קל יותר. אפשרויות שיורדות נמוך מדי לא מוצגות.'
        : 'אכלת פחות מהיעד, אז המספרים גבוהים מהיעד הרגיל.'));
  }

  function bonusCard(entry, settings) {
    if (!Fmt.isNum(entry.steps)) return '';
    var kcal = entry.steps * (settings.kcalPerStep || 0.03);
    return UI.card('בונוס מהליכה', null,
      '<p class="finding">' + Fmt.numHtml(entry.steps, 0) + ' צעדים היום, בערך ' +
        Fmt.numHtml(kcal, 0) + ' קלוריות נוספות.</p>' +
      UI.basis('היעד למעלה לא כולל את זה. כל צעד הוא תוספת להורדה.'));
  }

  function render(container) {
    var state = root.App.state;
    var date = state.date > Dates.today() ? Dates.today() : state.date;
    var entries = Store.getEntries();
    var settings = Store.getSettings();
    var entry = Store.getEntry(date) || {};
    var isToday = date === Dates.today();

    var report = Metrics.windowReport(entries, settings, {
      windowDays: state.calcWindow,
      endDate: date
    });

    var html =
      heroBlock(report, entry) +

      '<div class="section-label">כמה לרדת בשבוע (ק״ג)</div>' +
      UI.chips(RATES, settings.goal.ratePerWeekKg, 'data-rate') +

      '<div class="section-label">לחשב לפי (ימים)</div>' +
      windowChips(entries, date, state.calcWindow) +

      panelCard(report) +
      compensationCard(report) +
      bonusCard(entry, settings);

    html +=
      '<div class="section-label">רישום</div>' +
      '<div class="date-nav">' +
        '<button class="step" data-step="-1" aria-label="יום קודם">›</button>' +
        '<input type="date" id="entry-date" value="' + Fmt.esc(date) + '" max="' + Dates.today() + '">' +
        '<button class="step" data-step="1" aria-label="יום הבא"' + (isToday ? ' disabled' : '') + '>‹</button>' +
        '<span class="day-badge">' + Fmt.esc('יום ' + Dates.dayName(date)) + '</span>' +
      '</div>' +

      '<form id="entry-form" novalidate>' +
        '<div class="field-grid">' + BODY.map(function (k) { return fieldHtml(k, entry[k]); }).join('') + '</div>' +
        UI.basis('שקילת הבוקר של היום משקפת את מה שאכלת אתמול. החישוב כבר מביא את זה בחשבון.') +
        '<div class="field-grid" style="margin-top:14px">' +
          NUTRITION.map(function (k) { return fieldHtml(k, entry[k]); }).join('') +
          fieldHtml('steps', entry.steps) +
        '</div>' +
        '<div class="field field-wide" style="margin-top:12px"><label for="f-note">הערה</label>' +
          '<textarea id="f-note" name="note">' + Fmt.esc(entry.note || '') + '</textarea></div>' +
        '<div id="entry-warnings"></div>' +
        '<div class="btn-row" style="margin-top:16px">' +
          '<button type="submit" class="btn btn--primary">שמירה</button>' +
        '</div>' +
      '</form>' +

      '<div class="btn-row" style="margin-top:20px">' +
        '<button type="button" class="btn" id="open-methods">שיטות חישוב</button>' +
      '</div>';

    container.innerHTML = html;
    wire(container, date);
  }

  function wire(container, date) {
    container.querySelectorAll('[data-rate]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        Store.updateSettings({ goal: { ratePerWeekKg: Number(chip.dataset.rate) } });
      });
    });

    container.querySelectorAll('[data-calc]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var raw = chip.dataset.calc;
        root.App.setState({ calcWindow: raw === 'adaptive' ? 'adaptive' : Number(raw) });
      });
    });

    container.querySelectorAll('.step').forEach(function (btn) {
      btn.addEventListener('click', function () {
        root.App.setState({ date: Dates.addDays(date, Number(btn.dataset.step)) });
      });
    });

    container.querySelector('#entry-date').addEventListener('change', function (e) {
      if (Dates.isIso(e.target.value)) root.App.setState({ date: e.target.value });
    });

    container.querySelectorAll('#entry-form input[type=number]').forEach(function (input) {
      input.addEventListener('input', function () {
        input.classList.toggle('is-filled', input.value !== '');
      });
    });

    container.querySelector('#open-methods').addEventListener('click', function () {
      root.App.setState({ view: 'methods' });
    });

    container.querySelector('#entry-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var payload = { date: date };
      Object.keys(Metrics.FIELDS).forEach(function (key) {
        var input = form.elements[key];
        if (input) payload[key] = input.value;
      });
      payload.note = form.elements.note.value;

      try {
        var result = Store.upsert(payload);
        var box = container.querySelector('#entry-warnings');
        if (box && result.warnings.length) {
          box.innerHTML = '<div class="notice">' + result.warnings.map(Fmt.esc).join('<br>') + '</div>';
        }
        root.App.toast('נשמר');
      } catch (err) {
        root.App.toast('השמירה נכשלה: ' + err.message);
      }
    });
  }

  Views.today = { id: 'today', label: 'היום', glyph: '+', render: render };
})(typeof window !== 'undefined' ? window : globalThis);
