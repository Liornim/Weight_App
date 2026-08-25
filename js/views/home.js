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

  var UNITS = [
    { value: 'kg', label: 'ק״ג' },
    { value: 'kcal', label: 'קלוריות' }
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

  /** מספרי הפתיחה: כמה זמן, כמה ירד, איפה עומדים */
  function dashboardCard(entries, settings, date) {
    var d = Metrics.dashboard(entries, settings, { endDate: date });
    if (!d.ok) return '';

    var tile = function (tone, label, value) {
      return '<div class="stat stat--' + tone + '">' +
        '<span class="k">' + Fmt.esc(label) + '</span>' +
        '<span class="v">' + value + '</span></div>';
    };

    return UI.card('התמונה הכללית', null,
      '<div class="stat-grid">' +
        tile('teal', 'ימים במעקב', d.spanDays) +
        tile('good', 'ירדת בסך הכל', Fmt.n(d.totalLoss, 1) + ' ק״ג') +
        tile('indigo', 'משקל עכשיו', Fmt.n(d.currentWeight, 1)) +
        tile('accent', 'צעדים בשבוע', Fmt.n(d.stepsWeek, 0)) +
      '</div>' +
      '<div class="metric-row" style="margin-top:16px"><span class="label">מהשיא לשפל</span>' +
        '<span class="value">' + Fmt.n(d.maxWeight, 1) + ' ← ' + Fmt.n(d.minWeight, 1) + ' ק״ג</span></div>' +
      '<div class="metric-row"><span class="label">שקילות שנרשמו</span>' +
        '<span class="value">' + d.weighIns + ' מתוך ' + d.spanDays + ' ימים</span></div>' +
      UI.basis('משקל עכשיו הוא ממוצע ' + d.currentWeightDays + ' השקילות האחרונות, לא השקילה של הבוקר.'));
  }

  /** הגירעון שנצבר בשלושה חלונות, מול הירידה שנמדדה בפועל */
  function deficitCard(entries, settings, date, unit) {
    var r = Metrics.deficitSummary(entries, settings, { endDate: date, windows: [7, 10, 14] });
    if (!r.ok) return '';

    var kcalPerKg = settings.kcalPerKg || 7700;
    var inKcal = unit === 'kcal';
    // בקילוגרמים שלילי = ירידה. בקלוריות נוח יותר להציג את הגירעון
    // כמספר חיובי, ולכן הסימן מתהפך.
    var convert = function (kg) { return inKcal ? -kg * kcalPerKg : kg; };
    var digits = inKcal ? 0 : 2;
    var goodDirection = inKcal ? 'up' : 'down';

    var cell = function (kg) {
      var v = convert(kg);
      return '<td class="n"><span class="' + Fmt.deltaClass(v, goodDirection) + '">' +
        Fmt.signed(v, digits) + '</span></td>';
    };

    var partial = false;
    var rows = r.rows.map(function (row) {
      if (!row.ok) {
        return '<tr><td>' + row.days + ' ימים</td>' +
          '<td colspan="4" class="missing">צריך ' + row.needDays + ' ימי נתונים לשני חלונות מלאים</td></tr>';
      }
      if (!row.loggedDays) {
        return '<tr><td>' + row.days + ' ימים</td>' +
          '<td colspan="4" class="missing">אין רישומים בחלון</td></tr>';
      }
      if (row.actualKg !== null && !row.actualComplete) partial = true;

      var actualValue = row.actualKg === null ? null : convert(row.actualKg);
      var actualCell = actualValue === null
        ? '<td class="n"><span class="missing">—</span></td>'
        : '<td class="n"><span class="' + Fmt.deltaClass(actualValue, goodDirection) + '">' +
          Fmt.signed(actualValue, digits) + (row.actualComplete ? '' : '*') + '</span></td>';

      return '<tr><td>' + row.days + ' ימים<br>' +
          '<span class="basis">' + Dates.short(row.current.from) + '–' + Dates.short(row.current.to) +
          (row.loggedDays < row.days ? ' · ' + row.loggedDays + ' דווחו' : '') + '</span></td>' +
        cell(row.kg.low) + cell(row.kg.mid) + cell(row.kg.high) + actualCell + '</tr>';
    }).join('');

    return UI.card('גירעון מול מציאות',
      (inKcal ? 'בקלוריות מצטברות, חיובי = גירעון. ' : 'בקילוגרמים, שלילי = ירידה. ') +
      'שלושת הראשונים הם מה שהחשבון מנבא, האחרון הוא הפרש ממוצעי המשקל',
      '<div class="table-scroll"><table class="data"><thead><tr>' +
        '<th>תקופה</th><th class="n">זהיר</th><th class="n">הערכה</th>' +
        '<th class="n">נדיב</th><th class="n">בפועל</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      UI.basis('כל שורה היא חלון מלא אחד מול החלון שלפניו, מעוגן ליום הראשון של המדידות. ' +
        '"בפועל" = ממוצע המשקל בחלון פחות ממוצע החלון הקודם' +
        (inKcal ? ', מוכפל ב-' + Fmt.n(kcalPerKg, 0) + ' קק״ל לק״ג. ' : '. ') +
        (partial ? 'כוכבית = לתקופה הקודמת אין כיסוי מלא, ולכן ההפרש קטן מהאמת. ' : '') +
        'פער גדול בין "בפועל" ל"הערכה" אומר שהדיווח או השקילה לא מדויקים.'));
  }

  /** כמה מותר לאכול בימים הקרובים ועדיין להישאר בירוק */
  function allowanceCard(entries, settings, date) {
    var r = Metrics.adaptiveTDEE(entries, { kcalPerKg: settings.kcalPerKg, endDate: date });
    if (!r.ok) return '';

    var days = r.states.slice(-14).filter(function (s) { return Fmt.isNum(s.intake); });
    if (!days.length) return '';

    var last = r.states[r.states.length - 1];
    var margin = 1.96 * last.tdeeSd;
    var stepKcal = 0;
    var burn = { low: last.tdee - margin - stepKcal, mid: last.tdee - stepKcal, high: last.tdee + margin - stepKcal };

    var carried = { low: 0, mid: 0, high: 0 };
    days.forEach(function (s) {
      var m = 1.96 * s.tdeeSd;
      carried.low += (s.tdee - m) - s.intake;
      carried.mid += s.tdee - s.intake;
      carried.high += (s.tdee + m) - s.intake;
    });

    var labels = { 1: 'מחר', 2: 'יומיים', 3: 'שלושה ימים', 5: 'חמישה ימים', 7: 'שבוע' };
    var ceiling = last.tdee + 1500;

    var rows = [1, 2, 3, 5, 7].map(function (n) {
      var cellFor = function (key) {
        var value = burn[key] + carried[key] / n;
        return '<td class="n' + (value > ceiling ? ' missing' : '') + '">' +
          (value < 0 ? '0' : Fmt.n(value, 0)) + '</td>';
      };
      return '<tr><td>' + Fmt.esc(labels[n]) + '</td>' +
        cellFor('low') + cellFor('mid') + cellFor('high') + '</tr>';
    }).join('');

    return UI.card('כמה אפשר לאכול ולהישאר בירוק', 'ממוצע יומי מרבי, לפי אורך הפריסה',
      '<div class="table-scroll"><table class="data"><thead><tr>' +
        '<th>טווח</th><th class="n">זהיר</th><th class="n">הערכה</th><th class="n">נדיב</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      UI.basis('לך לפי העמודה הזהירה — היא מבטיחה ירוק גם אם אתה שורף פחות ממה שנראה. ' +
        'מספרים אפורים גבוהים מכדי לאכול ביום אחד; פרוס על יותר ימים.'));
  }

  /** מה קרה בפועל לגוף, בשלושה חלונות, עם טווחי התאריכים */
  function bodyChangeCard(entries, date) {
    var r = Metrics.bodyChangeSummary(entries, { endDate: date, windows: [7, 10, 14] });

    var partial = false;
    var cell = function (info, goodDirection) {
      if (!info || !Fmt.isNum(info.change)) return '<td class="n"><span class="missing">—</span></td>';
      if (!info.complete) partial = true;
      return '<td class="n"><span class="' + Fmt.deltaClass(info.change, goodDirection) + '">' +
        Fmt.signed(info.change, 2) + (info.complete ? '' : '*') + '</span></td>';
    };

    var rows = r.rows.map(function (row) {
      if (!row.ok) {
        return '<tr><td>' + row.days + ' ימים</td>' +
          '<td colspan="4" class="missing">צריך ' + row.needDays + ' ימים לשני חלונות מלאים</td></tr>';
      }
      var range = Dates.short(row.current.from) + '–' + Dates.short(row.current.to);
      var against = Dates.short(row.previous.from) + '–' + Dates.short(row.previous.to);
      return '<tr><td>' + row.days + ' ימים</td>' +
        cell(row.fields.weightKg, 'down') +
        cell(row.fields.bodyFatKg, 'down') +
        cell(row.fields.muscleKg, 'up') +
        '<td class="basis" style="white-space:nowrap">' + range + '<br>מול ' + against + '</td></tr>';
    }).join('');

    var trailing = r.rows.find(function (row) { return row.ok && row.partial; });

    return UI.card('מה קרה בפועל', 'חלון מלא מול החלון שלפניו, מעוגן ליום הראשון',
      '<div class="table-scroll"><table class="data"><thead><tr>' +
        '<th>תקופה</th><th class="n">משקל</th><th class="n">שומן</th><th class="n">שריר</th>' +
        '<th>מול</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      UI.basis('בקילוגרמים. ירוק = לכיוון הרצוי — ירידה במשקל ובשומן, שמירה או עלייה בשריר. ' +
        (partial ? 'כוכבית = לחלון אין מספיק שקילות. ' : '') +
        (trailing ? 'מאז ' + Dates.short(trailing.partial.from) + ' נצברו עוד ' +
          trailing.partial.days + ' ימים שעדיין לא סוגרים חלון. ' : '') +
        'מדידות שומן ושריר במשקל ביתי רועשות, אז הן אינדיקטיביות לכיוון ולא למספר.'));
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

    var unit = root.App.state.deficitUnit || 'kg';
    var report = Metrics.windowReport(entries, settings, {
      windowDays: state.calcWindow,
      endDate: date
    });

    var html =
      heroBlock(report, entry) +

      dashboardCard(entries, settings, date) +
      bodyChangeCard(entries, date) +
      '<div class="section-label">גירעון</div>' +
      UI.chips(UNITS, unit, 'data-unit') +
      deficitCard(entries, settings, date, unit) +
      allowanceCard(entries, settings, date) +
      bonusCard(entry, settings);

    html += '<div class="btn-row" style="margin-top:20px">' +
      '<button type="button" class="btn" id="open-progress">התקדמות מלאה</button>' +
      '</div>';

    container.innerHTML = html;
    wire(container, date);
  }

  function wire(container, date) {
    container.querySelectorAll('[data-unit]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        root.App.setState({ deficitUnit: chip.dataset.unit });
      });
    });

    container.querySelector('#open-progress').addEventListener('click', function () {
      root.App.setState({ view: 'progress' });
    });
  }

  Views.today = { id: 'today', label: 'סיכום', glyph: '\u25C9', render: render };
})(typeof window !== 'undefined' ? window : globalThis);
