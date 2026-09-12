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

  var LENGTHS = [3, 5, 7, 10, 14, 21, 28];
  var SHOW = 4;

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
    var r = Metrics.weightBlocks(entries, { days: days, endDate: date });
    if (r.rows.length < 2) return '';

    var recent = r.rows.slice(-SHOW - 1).slice(-SHOW).reverse();

    var rows = recent.map(function (row) {
      return '<tr' + (row.partial ? ' class="partial"' : '') + '>' +
        '<td>' + P.esc(Dates.short(row.from) + '–' + Dates.short(row.to)) +
          '<span class="sub">' + row.days + ' ימים' +
          (row.partial ? ' · עדיין פתוח' : '') + '</span></td>' +
        '<td class="n">' + Fmt.n(row.mean, 2) + '</td>' +
        '<td class="n">' + P.delta(row.change, 2, 'down') + '</td></tr>';
    }).join('');

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
      P.table([{ label: 'תקופה', n: false }, 'ממוצע', 'שינוי'], [rows]) + foot);
  }

  /**
   * איזה אורך חלון לסמוך עליו.
   *
   * לא "הכי טוב" במובן של הירידה הגדולה ביותר — זו בחירה של המספר
   * שמחמיא ביותר. החלון הארוך ביותר שיש לו לפחות שלושה חלונות
   * מלאים הוא זה שהרעש בו הקטן ביותר, ולכן הוא מייצג.
   */
  function recommend(entries, date) {
    var best = null;

    LENGTHS.forEach(function (days) {
      var r = Metrics.weightBlocks(entries, { days: days, endDate: date });
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

    var head = P.card(null, null,
      P.tiles([
        P.tile('', 'ימים במעקב', d.spanDays, Dates.short(d.firstDate) + ' ואילך'),
        P.tile('good', 'ירדת', Fmt.n(d.totalLoss, 1) + ' ק״ג', 'חצי ראשון מול שני'),
        P.tile('', 'משקל היום', Fmt.n(d.currentWeight, 1), 'ממוצע ולא שקילה')
      ]) +
      (pick
        ? '<p class="lead" style="margin-top:14px">לפי חלונות של ' + pick.days +
          ' ימים — הארוך ביותר שיש לו מספיק נתונים — אתה ' +
          (pick.summary.perDay < -0.005 ? 'יורד ' : pick.summary.perDay > 0.005 ? 'עולה ' : 'יציב, ') +
          (Math.abs(pick.summary.perDay) > 0.005
            ? Fmt.numHtml(Math.abs(pick.summary.perDay * 7), 2) + ' ק״ג בשבוע.'
            : 'בלי שינוי משמעותי.') + '</p>'
        : '') +
      P.hint('כל חלון מסכם את המשקל הממוצע בתקופה שלו ומשווה לתקופה שלפניה. ' +
        'חלון קצר מגיב מהר אבל רועש; ארוך יציב אבל איטי. ' +
        'כשכולם מצביעים לאותו כיוון — זה אמיתי.'));

    var cards = LENGTHS.map(function (days) {
      return windowCard(entries, date, days);
    }).filter(Boolean).join('');

    return P.section('משקל לפי חלונות', head + cards);
  }

  root.WeightTab = { render: render, summarise: summarise, recommend: recommend, LENGTHS: LENGTHS };
})(typeof window !== 'undefined' ? window : globalThis);
