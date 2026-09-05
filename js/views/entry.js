/**
 * מסך הרישום. רק הזנת נתונים — כל החישובים נמצאים במסך הבית.
 * ההפרדה מכוונת: רישום יומי הוא פעולה של חצי דקה, ואין סיבה
 * לגלול דרך טבלאות כדי להגיע אליה.
 */
(function (root) {
  'use strict';

  var Views = root.Views = root.Views || {};
  var Fmt = root.Fmt, Dates = root.Dates, Metrics = root.Metrics, Store = root.Store, UI = root.UI;

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

  var COMPARE_DAYS = [
    { value: 3, label: '3 ימים' },
    { value: 5, label: '5 ימים' },
    { value: 7, label: '7 ימים' }
  ];

  var FIELD_LABELS = {
    weightKg: 'משקל', muscleKg: 'שריר', bodyFatKg: 'שומן', waterKg: 'נוזלים'
  };

  /** היום הנבחר מול הממוצעים סביבו, לכל ארבעת המדדים */
  function comparisonCard(entries, date, days) {
    var r = Metrics.dayComparison(entries, { date: date, days: days });
    var fields = ['weightKg', 'muscleKg', 'bodyFatKg', 'waterKg'];

    var cell = function (value, digits, signed) {
      if (!Fmt.isNum(value)) return '<td class="n"><span class="missing">—</span></td>';
      return '<td class="n">' + (signed ? Fmt.signed(value, digits) : Fmt.n(value, digits)) + '</td>';
    };

    var row = function (label, note, pick, signed) {
      return '<tr><td>' + Fmt.esc(label) +
        (note ? '<br><span class="basis">' + Fmt.esc(note) + '</span>' : '') + '</td>' +
        fields.map(function (f) { return cell(pick(r.fields[f]), 2, signed); }).join('') + '</tr>';
    };

    return UI.card('היום מול הממוצע', 'כל המדדים, בקילוגרמים',
      '<div class="table-scroll"><table class="data"><thead><tr>' +
        '<th></th>' + fields.map(function (f) {
          return '<th class="n">' + Fmt.esc(FIELD_LABELS[f]) + '</th>';
        }).join('') +
      '</tr></thead><tbody>' +
        row('המדידה של היום', Dates.short(date), function (f) { return f.value; }) +
        row('ממוצע ' + days + ' ימים לפני',
          Dates.short(r.before.from) + '–' + Dates.short(r.before.to),
          function (f) { return f.beforeMean; }) +
        row('הפרש', 'היום פחות הממוצע שלפניו', function (f) { return f.vsBefore; }, true) +
        row('ממוצע ' + days + ' ימים כולל היום',
          Dates.short(r.including.from) + '–' + Dates.short(r.including.to),
          function (f) { return f.includingMean; }) +
        row('כמה היום הזיז', 'ההפרש בין שני הממוצעים', function (f) { return f.shift; }, true) +
      '</tbody></table></div>' +
      UI.basis('השורה האחרונה היא המדד השימושי: היא אומרת כמה השקילה של היום ' +
        'הזיזה את הממוצע, ולכן היא רועשת פחות מההפרש הישיר.'));
  }

  /** מה כבר נרשם בשבוע האחרון — כדי לראות מיד איזה יום חסר */
  function coverageCard(entries, date) {
    return UI.card('השבוע האחרון', null,
      UI.coverageStrip(entries, { windowDays: 7, endDate: date, field: 'weightKg', caption: 'ימים נשקלו' }) +
      UI.coverageStrip(entries, { windowDays: 7, endDate: date, field: 'kcal', caption: 'ימים עם תזונה' }) +
      UI.basis('לחיצה על תאריך במסך הנתונים פותחת אותו לעריכה.'));
  }

  function render(container) {
    var state = root.App.state;
    var date = state.date > Dates.today() ? Dates.today() : state.date;
    var entries = Store.getEntries();
    var entry = Store.getEntry(date) || {};
    var isToday = date === Dates.today();

    container.innerHTML =
      '<div class="date-nav">' +
        '<button class="step" data-step="-1" aria-label="יום קודם">›</button>' +
        '<input type="date" id="entry-date" value="' + Fmt.esc(date) + '" max="' + Dates.today() + '">' +
        '<button class="step" data-step="1" aria-label="יום הבא"' + (isToday ? ' disabled' : '') + '>‹</button>' +
        '<span class="day-badge">' + Fmt.esc('יום ' + Dates.dayName(date)) + '</span>' +
      '</div>' +

      '<form id="entry-form" novalidate>' +
        '<div class="section-label">שקילת הבוקר</div>' +
        '<div class="field-grid">' + BODY.map(function (k) { return fieldHtml(k, entry[k]); }).join('') + '</div>' +
        UI.basis('שקילת הבוקר של היום משקפת את מה שאכלת אתמול. החישוב כבר מביא את זה בחשבון.') +

        '<div class="section-label">מה אכלת</div>' +
        '<div class="field-grid">' +
          NUTRITION.map(function (k) { return fieldHtml(k, entry[k]); }).join('') +
        '</div>' +

        '<div class="section-label">צעדים והערות</div>' +
        '<div class="field-grid">' +
          fieldHtml('steps', entry.steps) +
          '<div class="field field-wide"><label for="f-note">הערה</label>' +
            '<textarea id="f-note" name="note" placeholder="חוץ, מחלה, אימון כבד">' +
            Fmt.esc(entry.note || '') + '</textarea></div>' +
        '</div>' +

        '<div id="entry-warnings"></div>' +
        '<div class="btn-row" style="margin-top:18px">' +
          '<button type="submit" class="btn btn--primary">שמירה</button>' +
        '</div>' +
      '</form>' +

      '<div class="section-label">השוואה</div>' +
      UI.chips(COMPARE_DAYS, root.App.state.compareDays || 3, 'data-compare') +
      comparisonCard(entries, date, root.App.state.compareDays || 3) +

      '<div class="section-label">מעקב</div>' +
      coverageCard(entries, date);

    wire(container, date);
  }

  function wire(container, date) {
    container.querySelectorAll('[data-compare]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        root.App.setState({ compareDays: Number(chip.dataset.compare) });
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

  Views.entry = { id: 'entry', label: 'רישום', glyph: '+', render: render };
})(typeof window !== 'undefined' ? window : globalThis);
