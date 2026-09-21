/**
 * Weight — טאב המשקל.
 *
 * אותה שאלה נשאלת בכמה אורכי חלון במקביל: מה קרה למשקל. חלון קצר
 * מגיב מהר ורועש, ארוך יציב ואיטי. הצגתם יחד מראה מתי הם מסכימים —
 * וזה הרגע שבו אפשר להאמין למספר.
 *
 * החלון האחרון בכל אורך הוא לרוב חלקי, ולכן הוא מסומן ואינו נכנס
 * לחישוב הסיכום: ממוצע של יום אחד מול ממוצע של שבוע אינו השוואה.
 */
(function (root) {
  'use strict';

  var Fmt = root.Fmt, Dates = root.Dates, Metrics = root.Metrics,
      Store = root.Store, P = root.Parts;

  var LENGTHS = P.WINDOWS;
  var SHOW = 4;

  /**
   * שלושת המדדים, באותה טבלה בדיוק.
   *
   * good קובע איזה כיוון נחשב טוב: במשקל ובשומן ירידה, בשריר עלייה.
   * זה משנה רק את הצבע, לא את החישוב.
   */
  var METRICS = [
    { value: 'weightKg', label: 'משקל', good: 'down', unit: 'ק״ג' },
    { value: 'bodyFatKg', label: 'שומן', good: 'down', unit: 'ק״ג' },
    { value: 'muscleKg', label: 'שריר', good: 'up', unit: 'ק״ג' }
  ];

  function metricOf(state) {
    return METRICS.filter(function (m) {
      return m.value === state.weightMetric;
    })[0] || METRICS[0];
  }

  /**
   * שורות של שלושת המדדים יחד, לפי תקופה.
   *
   * הם נמדדים באותה שקילה ולכן שייכים לאותה שורה: ירידה במשקל בלי
   * ירידה בשומן היא סיפור אחר מירידה בשניהם, ובטבלאות נפרדות אי
   * אפשר לראות את זה.
   */
  function combinedRows(entries, date, days) {
    var byMetric = {};
    METRICS.forEach(function (m) {
      byMetric[m.value] = Metrics.weightBlocks(entries,
        { days: days, endDate: date, field: m.value });
    });

    var base = byMetric.weightKg;
    if (!base || base.rows.length < 2) return null;

    var recent = base.rows.slice(-SHOW - 1).slice(-SHOW).reverse();

    return recent.map(function (row) {
      var values = [];
      var cells = METRICS.map(function (m) {
        // אותה תקופה בדיוק, בכל אחד מהמדדים
        var match = (byMetric[m.value].rows || []).filter(function (r) {
          return r.from === row.from && r.to === row.to;
        })[0];

        if (!match || !Fmt.isNum(match.mean)) {
          values.push(null, null);
          return '<td class="n flat">—</td><td class="n flat">—</td>';
        }

        values.push(match.mean, Fmt.isNum(match.change) ? match.change : null);
        return '<td class="n">' + Fmt.n(match.mean, 2) + '</td>' +
          '<td class="n">' + P.delta(match.change, 2, m.good) + '</td>';
      }).join('');

      return {
        values: values,
        partial: row.partial,
        period: '<td>' + P.esc(Dates.short(row.from) + '–' + Dates.short(row.to)) +
          '<span class="sub">' + row.days + ' ימים' +
          (row.partial ? ' · עדיין פתוח' : '') + '</span></td>',
        cells: cells
      };
    });
  }

  function rowHtml(r) {
    return '<tr' + (r.partial ? ' class="partial"' : '') + '>' + r.period + r.cells + '</tr>';
  }

  /**
   * השורה העליונה של כל חלון, זו מתחת לזו.
   *
   * כל כרטיס מתחת מראה חלון אחד לאורך זמן. הטבלה הזו מראה את
   * הרגע האחרון בכל אורכי החלון יחד — כך רואים במבט אחד אם
   * הקצרים והארוכים מסכימים על הכיוון.
   */
  function latestCard(entries, date) {
    var firsts = [];
    var rows = LENGTHS.map(function (days) {
      var list = combinedRows(entries, date, days);
      if (!list || !list.length) return '';
      var first = list[0];
      firsts.push(first.values);
      return '<tr' + (first.partial ? ' class="partial"' : '') + '>' +
        '<td class="n"><strong>' + days + '</strong></td>' +
        first.period + first.cells + '</tr>';
    }).filter(Boolean).join('');

    if (!rows) return '';

    /**
     * ממוצע כל השורות, עמודה אחר עמודה.
     *
     * כל חלון לבדו רועש בדרכו; הממוצע שלהם מקזז חלק מהרעש הזה. הוא
     * כולל גם שורות פתוחות, ולכן שורה של יום בודד מושכת אותו.
     */
    var goods = ['down', 'down', 'up'];
    var average = [0, 1, 2, 3, 4, 5].map(function (col) {
      var list = firsts.map(function (v) { return v[col]; })
        .filter(function (v) { return Fmt.isNum(v); });
      if (!list.length) return '<td class="n flat">—</td>';

      var mean = list.reduce(function (a, b) { return a + b; }, 0) / list.length;
      return col % 2 === 0
        ? '<td class="n"><strong>' + Fmt.n(mean, 2) + '</strong></td>'
        : '<td class="n"><strong>' + P.delta(mean, 2, goods[(col - 1) / 2]) +
          '</strong></td>';
    }).join('');

    rows += '<tr class="total">' +
      '<td class="n"><strong>ממוצע</strong></td>' +
      '<td><span class="sub">' + firsts.length + ' חלונות</span></td>' +
      average + '</tr>';

    return P.card('השורה האחרונה בכל חלון', 'מהקצר לארוך',
      P.table(
        [{ label: 'ימים', n: true }, { label: 'תקופה', n: false },
          'משקל', 'שינוי', 'שומן', 'שינוי', 'שריר', 'שינוי'],
        [rows],
        { hint: 'כל שורה היא השורה העליונה של הכרטיס המתאים למטה. ' +
          'שורה חיוורת היא חלון שעדיין פתוח ולכן חלקי.' }));
  }

  /** מחשב את סיכום החלונות המלאים האחרונים */
  function summarise(blocks) {
    var complete = blocks.filter(function (row) { return !row.partial; });
    if (complete.length < 2) return null;

    var used = complete.slice(-SHOW);
    var changes = used.filter(function (row) { return Fmt.isNum(row.change); })
      .map(function (row) { return row.change; });
    if (!changes.length) return null;

    var means = used.map(function (row) { return row.mean; });
    var days = used.reduce(function (sum, row) { return sum + row.days; }, 0);
    var total = used[used.length - 1].mean - used[0].mean;
    var perWindow = changes.reduce(function (sum, v) { return sum + v; }, 0) / changes.length;

    return {
      count: used.length,
      meanWeight: means.reduce(function (sum, v) { return sum + v; }, 0) / means.length,
      perWindow: perWindow,
      perDay: perWindow / used[0].days,
      total: total,
      days: days,
      from: used[0].from,
      to: used[used.length - 1].to
    };
  }

  function windowCard(entries, date, days) {
    var list = combinedRows(entries, date, days);
    if (!list) return '';
    var rows = list.map(rowHtml).join('');

    var r = Metrics.weightBlocks(entries, { days: days, endDate: date });
    var summary = summarise(r.rows);
    var foot = summary
      ? '<div class="wsum">' +
          '<div><span class="k">ממוצע משקל</span><span class="v num">' +
            Fmt.n(summary.meanWeight, 2) + '</span></div>' +
          '<div><span class="k">שינוי לחלון</span><span class="v num">' +
            P.delta(summary.perWindow, 2, 'down') + '</span></div>' +
          '<div><span class="k">שינוי ליום</span><span class="v num">' +
            P.delta(summary.perDay, 3, 'down') + '</span></div>' +
          '<div><span class="k">שינוי כולל</span><span class="v num">' +
            P.delta(summary.total, 2, 'down') + '</span></div>' +
        '</div>' +
        P.hint('הסיכום מבוסס על ' + summary.count + ' חלונות מלאים, ' +
          Dates.short(summary.from) + '–' + Dates.short(summary.to) +
          '. חלון שעדיין פתוח מוצג אך אינו נספר.')
      : P.hint('צריך שני חלונות מלאים כדי לסכם.');

    return P.card('כל ' + days + ' ימים', null,
      P.table(
        [{ label: 'תקופה', n: false },
          'משקל', 'שינוי', 'שומן', 'שינוי', 'שריר', 'שינוי'],
        [rows]) + foot);
  }

  /**
   * איזה אורך חלון לסמוך עליו.
   *
   * לא "הכי טוב" במובן של הירידה הגדולה ביותר — זו בחירה של המספר
   * שמחמיא ביותר. החלון הארוך ביותר שיש לו לפחות שלושה חלונות
   * מלאים הוא זה שהרעש בו הקטן ביותר, ולכן הוא מייצג.
   */
  function recommend(entries, date, field) {
    var best = null;

    LENGTHS.forEach(function (days) {
      var r = Metrics.weightBlocks(entries,
        { days: days, endDate: date, field: field || 'weightKg' });
      var complete = r.rows.filter(function (row) { return !row.partial; });
      if (complete.length < 3) return;
      var summary = summarise(r.rows);
      if (summary) best = { days: days, summary: summary };
    });

    return best;
  }

  function render(state) {
    var entries = Store.getEntries();
    var settings = Store.getSettings();
    var date = state.date;

    var d = Metrics.dashboard(entries, settings, { endDate: date });
    if (!d.ok) {
      return P.section('משקל', P.card(null, null, P.empty('עוד אין מספיק שקילות.')));
    }

    var pick = recommend(entries, date);

    // הערך הנוכחי של כל מדד, כממוצע שבוע ולא כמדידה בודדת
    var current = function (field) {
      var r = Metrics.weightBlocks(entries,
        { days: 7, endDate: date, field: field });
      var complete = r.rows.filter(function (row) { return !row.partial; });
      return complete.length ? complete[complete.length - 1].mean : null;
    };

    var tile = function (m) {
      var value = current(m.value);
      return P.tile('', m.label, value === null ? '—' : Fmt.n(value, 1),
        'ממוצע שבוע');
    };

    var head = P.card(null, null,
      P.tiles(METRICS.map(tile)) +
      P.hint('ימים במעקב: ' + d.spanDays + ', מ-' + Dates.short(d.firstDate) +
        '. הערכים הם ממוצע שבוע ולא מדידה בודדת.') +
      (pick
        ? '<p class="lead" style="margin-top:14px">לפי חלונות של ' + pick.days +
          ' ימים — הארוך ביותר שיש לו מספיק נתונים — המשקל ' +
          (pick.summary.perDay < -0.005 ? 'יורד ' : pick.summary.perDay > 0.005 ? 'עולה ' : 'יציב, ') +
          (Math.abs(pick.summary.perDay) > 0.005
            ? Fmt.numHtml(Math.abs(pick.summary.perDay * 7), 2) + ' ק״ג בשבוע.'
            : 'בלי שינוי משמעותי.') + '</p>'
        : '') +
      P.hint('כל חלון מסכם את הממוצע בתקופה שלו ומשווה לתקופה שלפניה. ' +
        'חלון קצר מגיב מהר אבל רועש; ארוך יציב אבל איטי. ' +
        'כשכולם מצביעים לאותו כיוון — זה אמיתי. ' +
        'השומן והשריר מוסקים ממדידת התנגדות אחת ולכן רועשים מהמשקל ' +
        'ותלויים זה בזה; שינוי קטן בהם אינו אומר הרבה.'));

    var cards = LENGTHS.map(function (days) {
      return windowCard(entries, date, days);
    }).filter(Boolean).join('');

    return P.section('משקל, שומן ושריר לפי חלונות',
      head + latestCard(entries, date) + cards);
  }

  root.WeightTab = {
    render: render, summarise: summarise, recommend: recommend,
    LENGTHS: LENGTHS, METRICS: METRICS, metricOf: metricOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
