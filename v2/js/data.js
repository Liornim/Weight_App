/**
 * Data — טאב הנתונים.
 *
 * מה יש במכשיר, ממתי, ומה חסר. השאלה "עד מתי הנתונים עדכניים" חזרה
 * כי שום מסך לא ענה עליה: כל טאב הציג חישובים, ואף אחד לא הציג את
 * החומר עצמו.
 *
 * הטבלה מציגה כל יום כפי שנמשך, בלי עיבוד — כדי שאפשר יהיה להשוות
 * מול הגיליון ולראות מיד אם משהו לא הגיע.
 */
(function (root) {
  'use strict';

  var Fmt = root.Fmt, Dates = root.Dates, Store = root.Store, P = root.Parts;

  var PAGE = 30;

  /** מה יש, ממתי, ומה חסר */
  function summary(entries, settings, state) {
    if (!entries.length) {
      return P.card('הנתונים', null, P.empty('אין עדיין נתונים במכשיר.'));
    }

    var weighed = entries.filter(function (e) { return Fmt.isNum(e.weightKg); });
    var eaten = entries.filter(function (e) { return Fmt.isNum(e.kcal); });

    var first = entries[0].date;
    var last = entries[entries.length - 1].date;
    var span = Dates.diffDays(first, last) + 1;

    var lastWeighed = weighed.length ? weighed[weighed.length - 1].date : null;
    var lastEaten = eaten.length ? eaten[eaten.length - 1].date : null;

    // ימים בתוך הטווח שאין בהם כלום
    var have = {};
    entries.forEach(function (e) { have[e.date] = true; });
    var gaps = [];
    for (var d = first; d <= last; d = Dates.addDays(d, 1)) {
      if (!have[d]) gaps.push(d);
    }

    var sync = settings.sync || {};
    var stale = function (date) {
      if (!date) return null;
      return Dates.diffDays(date, state.date);
    };

    var ageLine = function (label, date) {
      var age = stale(date);
      if (date === null) return label + ': אין';
      return label + ': ' + Dates.short(date) +
        (age === 0 ? ' (היום)' : age === 1 ? ' (אתמול)' : ' (לפני ' + age + ' ימים)');
    };

    var weighAge = stale(lastWeighed);
    var eatAge = stale(lastEaten);
    var behind = Math.max(weighAge === null ? 0 : weighAge, eatAge === null ? 0 : eatAge);

    return P.card('הנתונים', Dates.short(first) + '–' + Dates.short(last),
      P.tiles([
        P.tile(behind > 2 ? 'warn' : 'good', 'עדכני עד',
          Dates.short(lastEaten && lastWeighed
            ? (lastEaten < lastWeighed ? lastEaten : lastWeighed)
            : (lastWeighed || lastEaten)),
          behind === 0 ? 'היום' : 'לפני ' + behind + ' ימים'),
        P.tile('', 'שקילות', weighed.length, 'מתוך ' + span + ' ימים'),
        P.tile('', 'ימי אוכל', eaten.length, 'מתוך ' + span + ' ימים')
      ]) +

      '<div class="calc num">' +
        ageLine('שקילה אחרונה', lastWeighed) + '\n' +
        ageLine('רישום אוכל אחרון', lastEaten) + '\n' +
        (sync.lastSyncAt
          ? 'משיכה אחרונה מהגיליון: ' + Dates.short(sync.lastSyncAt.slice(0, 10))
          : 'טרם נמשך מהגיליון במכשיר הזה') +
      '</div>' +

      (gaps.length
        ? P.hint(gaps.length + ' ימים בתוך הטווח בלי שום רישום: ' +
          P.esc(gaps.slice(0, 8).map(Dates.short).join(', ')) +
          (gaps.length > 8 ? ' ועוד ' + (gaps.length - 8) : '') + '.')
        : P.hint('אין ימים חסרים בתוך הטווח.')));
  }

  /** הטבלה הגולמית, כפי שנמשכה */
  function table(entries, state) {
    var shown = entries.slice().reverse();
    var limit = state.dataAll ? shown.length : PAGE;
    var page = shown.slice(0, limit);

    var cell = function (value, digits) {
      return Fmt.isNum(value)
        ? '<td class="n">' + Fmt.n(value, digits) + '</td>'
        : '<td class="n flat">—</td>';
    };

    var rows = page.map(function (e) {
      // יום שחסר בו אחד מהשניים מסומן, כי הוא זה שמפיל חישובים
      var partial = !Fmt.isNum(e.weightKg) || !Fmt.isNum(e.kcal);

      return '<tr' + (partial ? ' class="within-noise"' : '') + '>' +
        '<td class="date-cell">' + P.esc(Dates.short(e.date)) + '</td>' +
        cell(e.weightKg, 1) + cell(e.bodyFatKg, 1) + cell(e.muscleKg, 1) +
        cell(e.waterKg, 1) +
        cell(e.kcal, 0) + cell(e.proteinG, 0) + cell(e.carbG, 0) +
        cell(e.fatG, 0) + cell(e.fiberG, 0) + cell(e.steps, 0) +
      '</tr>';
    }).join('');

    var more = shown.length > limit
      ? '<button type="button" class="btn" id="data-all">' +
        'להציג את כל ' + shown.length + ' הימים</button>'
      : '';

    return P.card('כל הימים', 'מהחדש לישן, בלי עיבוד',
      P.table(
        ['תאריך', 'משקל', 'שומן', 'שריר', 'נוזלים',
          'קלוריות', 'חלבון', 'פחמ׳', 'שומן', 'סיבים', 'צעדים'],
        [rows],
        { hint: 'שורה בהירה היא יום שחסר בו משקל או אוכל. אלה הימים ' +
          'שמפילים חישובים, כי חלון שכולל אותם נשען על פחות נתונים ' +
          'ממה שאורכו מבטיח.' }) +
      more);
  }

  function render(state) {
    var entries = Store.getEntries();
    var settings = Store.getSettings();

    return P.section('נתונים',
      summary(entries, settings, state) +
      (entries.length ? table(entries, state) : ''));
  }

  root.DataTab = { render: render, PAGE: PAGE };
})(typeof window !== 'undefined' ? window : globalThis);
