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

      '<div class="section-label">מעקב</div>' +
      coverageCard(entries, date);

    wire(container, date);
  }

  function wire(container, date) {
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
