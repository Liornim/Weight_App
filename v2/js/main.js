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

  function cell(entry, digits, good, sig) {
    if (!entry || !Fmt.isNum(entry.change)) {
      return '<td class="n flat">—</td>';
    }

    // שינוי שאינו עובר את רעש המדידה מוצג מוחלש, כדי שלא ייקרא
    // כתוצאה
    var real = !sig || sig.real;

    return '<td class="n' + (real ? '' : ' within-noise') + '">' +
      P.delta(entry.change, digits, good) +
      '<span class="sub">' + Fmt.n(entry.mean, 1) + '</span></td>';
  }

  function row(entries, days, endDate, active) {
    var r = Metrics.compositionWindow(entries, { days: days, endDate: endDate });

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
      cell(f.weightKg, 2, 'down', r.significance.weightKg) +
      cell(f.bodyFatKg, 2, 'down', r.significance.bodyFatKg) +
      cell(f.muscleKg, 2, 'up', r.significance.muscleKg) +
      (share && Fmt.isNum(share.change)
        ? '<td class="n">' + P.delta(share.change, 2, 'down') +
          '<span class="sub">' + Fmt.n(share.now, 1) + '%</span></td>'
        : '<td class="n flat">—</td>') +
    '</tr>';
  }

  /**
   * קריאת המגמה.
   *
   * המשקל לבדו אינו התשובה: משקל יציב עם שומן יורד ושריר עולה הוא
   * התקדמות טובה יותר מירידה במשקל, והוא נראה בדיוק כמו כלום.
   *
   * כל אמירה נשענת על מה שעבר את סף הרעש של אותו שדה. שומן ושריר
   * נמדדים בביו־אימפדנס, שמסיק אותם מהתנגדות חשמלית ולכן מושפע
   * ממאזן הנוזלים — הרעש בהם גדול מזה של המשקל.
   */
  function verdict(entries, endDate) {
    var best = null;
    LENGTHS.forEach(function (days) {
      var r = Metrics.compositionWindow(entries, { days: days, endDate: endDate });
      if (r.ok) best = r;
    });

    if (!best) return '';

    var f = best.fields;
    var sig = best.significance;

    var moved = function (field) {
      return sig[field] && sig[field].real ? f[field].change : 0;
    };

    var weight = moved('weightKg');
    var fat = moved('bodyFatKg');
    var muscle = moved('muscleKg');

    var hasBody = Fmt.isNum(f.bodyFatKg.change) && Fmt.isNum(f.muscleKg.change);

    var headline;
    if (!hasBody) {
      headline = weight < 0 ? 'המשקל יורד.'
        : weight > 0 ? 'המשקל עולה.'
        : 'המשקל יציב.';
    } else if (weight === 0 && fat < 0 && muscle > 0) {
      headline = 'המשקל לא זז, אבל השומן יורד והשריר עולה — ' +
        'הגוף מחליף הרכב. זו התקדמות טובה יותר מירידה במשקל, ' +
        'והמשקל לבדו מסתיר אותה לגמרי.';
    } else if (weight === 0 && fat < 0) {
      headline = 'המשקל לא זז אבל השומן יורד. זו התקדמות שהמשקל אינו מראה.';
    } else if (weight < 0 && fat < 0 && muscle >= 0) {
      headline = 'הירידה היא שומן, והשריר נשמר. זה בדיוק מה שצריך לקרות.';
    } else if (weight < 0 && muscle < 0) {
      headline = 'חלק מהירידה הוא שריר. שווה להעלות חלבון ולהוסיף אימוני התנגדות.';
    } else if (weight < 0 && fat === 0) {
      headline = 'המשקל ירד אבל השומן לא זז מעבר לרעש המדידה. ' +
        'סביר שזה בעיקר נוזלים.';
    } else if (weight > 0 && muscle > 0 && fat <= 0) {
      headline = 'העלייה היא שריר, לא שומן. זה שונה לגמרי מעלייה במשקל.';
    } else if (weight > 0 && fat > 0) {
      headline = 'העלייה כוללת שומן.';
    } else {
      headline = 'שום שינוי אינו גדול מספיק כדי להבדיל אותו מרעש המדידה.';
    }

    // מה בדיוק זז, ומה נשאר בתוך הרעש
    var labels = { weightKg: 'משקל', bodyFatKg: 'שומן', muscleKg: 'שריר' };
    var real = [];
    var quiet = [];

    ['weightKg', 'bodyFatKg', 'muscleKg'].forEach(function (field) {
      if (!Fmt.isNum(f[field].change)) return;
      var text = labels[field] + ' ' + Fmt.n(f[field].change, 2);
      if (sig[field] && sig[field].real) real.push(text);
      else quiet.push(labels[field]);
    });

    return '<p class="lead">' + headline + '</p>' +
      P.hint('לפי ' + best.days + ' ימים, ' +
        P.esc(Dates.short(best.from) + '–' + Dates.short(best.to)) +
        ' מול הסבב שלפניו. ' +
        (real.length ? 'מעל רעש המדידה: ' + P.esc(real.join(' · ')) + '. ' : '') +
        (quiet.length ? 'בתוך הרעש: ' + P.esc(quiet.join(', ')) + '. ' : '') +
        'שומן ושריר נמדדים בביו־אימפדנס ומושפעים ממאזן נוזלים, ' +
        'ולכן הסף שלהם גבוה יותר.');
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
          'אחוז השומן הוא העמודה שמבחינה בין ירידת שומן לירידת נוזלים. ' +
          'מספר בהיר הוא שינוי שאינו גדול מרעש המדידה של אותו שדה, ' +
          'ולכן אי אפשר להסיק ממנו.' }));

    return P.section('הרכב הגוף', head + table);
  }

  root.MainTab = { render: render, LENGTHS: LENGTHS };
})(typeof window !== 'undefined' ? window : globalThis);
