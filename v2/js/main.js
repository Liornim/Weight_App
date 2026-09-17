/**
 * Main — הדף הראשי.
 *
 * משקל, שומן ושריר זה לצד זה, בכל אורכי החלון. שלושתם נמדדים באותה
 * שקילה וחולקים את אותו רעש, אבל הם מספרים סיפורים שונים: ירידה של
 * חצי קילו שכולה שומן אינה אותה ירידה כמו חצי קילו שחציו שריר.
 *
 * העמודה שקובעת היא אחוז השומן. משקל יורד עם ירידה באחוז השומן הוא
 * ירידה אמיתית; משקל יורד בלי שינוי באחוז הוא בעיקר נוזלים.
 */
(function (root) {
  'use strict';

  var Fmt = root.Fmt, Dates = root.Dates, Metrics = root.Metrics,
      Store = root.Store, P = root.Parts;

  var LENGTHS = [3, 4, 5, 6, 7, 8, 9, 10, 14, 21, 28];

  function cell(entry, digits, good) {
    if (!entry || !Fmt.isNum(entry.change)) {
      return '<td class="n flat">—</td>';
    }
    return '<td class="n">' + P.delta(entry.change, digits, good) +
      '<span class="sub">' + Fmt.n(entry.mean, 1) + '</span></td>';
  }

  function row(entries, days, endDate, active) {
    var r = Metrics.composition(entries, { days: days, endDate: endDate });

    if (!r.ok) {
      return '<tr><td class="n">' + days + '</td>' +
        '<td colspan="5" class="flat">' +
        (r.reason === 'need-two-blocks'
          ? 'צריך ' + r.need + ' ימים, יש ' + r.have
          : 'אין מספיק שקילות') + '</td></tr>';
    }

    var f = r.fields;
    var share = r.fatShare;

    return '<tr' + (active ? ' class="now"' : '') + '>' +
      '<td class="n">' + days + (active ? ' ✓' : '') + '</td>' +
      '<td class="date-cell">' + P.esc(Dates.short(r.from) + '–' + Dates.short(r.to)) +
        '<span class="sub">מול ' + P.esc(Dates.short(r.prevFrom) + '–' +
          Dates.short(r.prevTo)) + '</span></td>' +
      cell(f.weightKg, 2, 'down') +
      cell(f.bodyFatKg, 2, 'down') +
      cell(f.muscleKg, 2, 'up') +
      (share && Fmt.isNum(share.change)
        ? '<td class="n">' + P.delta(share.change, 2, 'down') +
          '<span class="sub">' + Fmt.n(share.now, 1) + '%</span></td>'
        : '<td class="n flat">—</td>') +
    '</tr>';
  }

  /** קריאה של המגמה: מה המשקל עשה, ומה זה היה בפועל */
  function verdict(entries, endDate) {
    // החלון הארוך ביותר שיש לו שני סבבים מלאים הוא המייצג
    var best = null;
    LENGTHS.forEach(function (days) {
      var r = Metrics.composition(entries, { days: days, endDate: endDate });
      if (r.ok) best = r;
    });

    if (!best) return '';

    var weight = best.fields.weightKg.change;
    var fat = best.fields.bodyFatKg.change;
    var muscle = best.fields.muscleKg.change;

    if (!Fmt.isNum(weight)) return '';

    var direction = Math.abs(weight) < 0.15 ? 'יציב'
      : weight < 0 ? 'יורד' : 'עולה';

    var detail = '';
    if (Fmt.isNum(fat) && Fmt.isNum(muscle)) {
      if (weight < -0.15 && fat < -0.1 && muscle >= -0.05) {
        detail = 'הירידה היא שומן, והשריר נשמר. זה בדיוק מה שצריך לקרות.';
      } else if (weight < -0.15 && muscle < -0.1) {
        detail = 'חלק מהירידה הוא שריר. שווה להעלות חלבון ולהוסיף התנגדות.';
      } else if (weight < -0.15 && Math.abs(fat) < 0.1) {
        detail = 'המשקל ירד אבל השומן כמעט לא. סביר שזה בעיקר נוזלים.';
      } else if (weight > 0.15 && fat > 0.1) {
        detail = 'העלייה כוללת שומן.';
      } else if (weight > 0.15 && muscle > 0.1) {
        detail = 'העלייה כוללת שריר, וזה שונה לגמרי מעלייה בשומן.';
      }
    }

    return '<p class="lead">לפי ' + best.days + ' ימים — החלון הארוך ביותר שיש ' +
      'לו שני סבבים מלאים — המשקל ' + direction +
      (Math.abs(weight) >= 0.15
        ? ', ' + Fmt.numHtml(Math.abs(weight), 2) + ' ק״ג בין הסבבים.'
        : '.') +
      (detail ? ' ' + detail : '') + '</p>';
  }

  function render(state) {
    var entries = Store.getEntries();
    var settings = Store.getSettings();
    var date = state.date;

    var d = Metrics.dashboard(entries, settings, { endDate: date });
    if (!d.ok) {
      return P.section('הרכב הגוף',
        P.card(null, null, P.empty('עוד אין מספיק שקילות.')));
    }

    var active = state.basis === 'adaptive' ? null : Number(state.basis);

    var head = P.card(null, null,
      verdict(entries, date) +
      P.tiles([
        P.tile('', 'משקל', Fmt.n(d.currentWeight, 1), 'ממוצע ולא שקילה'),
        P.tile('good', 'ירדת', Fmt.n(d.totalLoss, 1) + ' ק״ג', 'מתחילת המעקב'),
        P.tile('', 'ימים', d.spanDays, Dates.short(d.firstDate) + ' ואילך')
      ]));

    var rows = LENGTHS.map(function (days) {
      return row(entries, days, date, String(days) === String(active));
    }).join('');

    var table = P.card('לפי אורך חלון', 'כל סבב מול הסבב שלפניו',
      P.table(
        [{ label: 'ימים', n: true }, { label: 'תקופה', n: true },
          'משקל', 'שומן', 'שריר', 'אחוז שומן'],
        [rows],
        { hint: 'המספר הגדול הוא השינוי בין הסבבים, והקטן מתחתיו הוא הממוצע ' +
          'בסבב הנוכחי. ירוק הוא הכיוון הרצוי לכל עמודה — במשקל ובשומן ' +
          'ירידה, בשריר עלייה. ' +
          'אחוז השומן הוא העמודה שמבחינה בין ירידת שומן לירידת נוזלים.' }));

    return P.section('הרכב הגוף', head + table);
  }

  root.MainTab = { render: render, LENGTHS: LENGTHS };
})(typeof window !== 'undefined' ? window : globalThis);
