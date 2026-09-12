/**
 * Entry — טאב ההזנה.
 *
 * שתי קבוצות נפרדות, כי הן נמדדות אחרת ולרוב גם ברגעים אחרים:
 * המשקל נשקל בבוקר פעם אחת, והתזונה מצטברת לאורך היום. ערבוב
 * שלהן בטופס אחד גורם לחשוב שצריך למלא את הכל בבת אחת.
 *
 * בחירת התאריך היא שדה תאריך ולא ניווט יום־יום: למלא יום מלפני
 * שבוע דרש שבע לחיצות.
 */
(function (root) {
  'use strict';

  var Fmt = root.Fmt, Dates = root.Dates, Store = root.Store, P = root.Parts;

  var BODY = [
    { key: 'weightKg', label: 'משקל', unit: 'ק״ג', step: '0.1' },
    { key: 'bodyFatKg', label: 'שומן', unit: 'ק״ג', step: '0.1' },
    { key: 'muscleKg', label: 'שריר', unit: 'ק״ג', step: '0.1' },
    { key: 'waterKg', label: 'נוזלים', unit: 'ק״ג', step: '0.1' }
  ];

  var FOOD = [
    { key: 'kcal', label: 'קלוריות', unit: '', step: '10' },
    { key: 'proteinG', label: 'חלבון', unit: 'גר׳', step: '1' },
    { key: 'carbG', label: 'פחמימות', unit: 'גר׳', step: '1' },
    { key: 'fatG', label: 'שומן', unit: 'גר׳', step: '1' },
    { key: 'fiberG', label: 'סיבים', unit: 'גר׳', step: '1' },
    { key: 'steps', label: 'צעדים', unit: '', step: '100' }
  ];

  function fields(list, entry) {
    return '<div class="field-grid">' + list.map(function (f) {
      return '<div class="field"><label for="in-' + f.key + '">' + P.esc(f.label) +
        (f.unit ? ' <span class="unit">' + P.esc(f.unit) + '</span>' : '') + '</label>' +
        '<input id="in-' + f.key + '" data-field="' + f.key + '" type="number" ' +
        'inputmode="decimal" step="' + f.step + '" value="' +
        (Fmt.isNum(entry[f.key]) ? entry[f.key] : '') + '"></div>';
    }).join('') + '</div>';
  }

  /** כמה כבר מולא באותו יום, כדי לדעת מיד מה חסר */
  function filledCount(entry, list) {
    return list.filter(function (f) { return Fmt.isNum(entry[f.key]); }).length;
  }

  function datePicker(state) {
    var entry = Store.getEntry(state.date) || {};
    var body = filledCount(entry, BODY);
    var food = filledCount(entry, FOOD);

    return P.card(null, null,
      '<div class="field"><label for="entry-date">תאריך</label>' +
        '<input id="entry-date" type="date" value="' + P.esc(state.date) + '" max="' +
        P.esc(Dates.today()) + '"></div>' +
      '<div class="chips" style="margin-bottom:0">' +
        '<button type="button" class="chip" data-jump="0">היום</button>' +
        '<button type="button" class="chip" data-jump="1">אתמול</button>' +
        '<button type="button" class="chip" data-jump="2">שלשום</button>' +
      '</div>' +
      P.hint(Dates.long(state.date) + ' · ' +
        (body ? 'מדדי גוף: ' + body + ' מתוך ' + BODY.length : 'אין מדדי גוף') + ' · ' +
        (food ? 'תזונה: ' + food + ' מתוך ' + FOOD.length : 'אין תזונה')));
  }

  function render(state) {
    var entry = Store.getEntry(state.date) || {};

    return P.section('הזנה',
      datePicker(state) +

      P.card('מדדי גוף', 'מהמשקל בבוקר',
        fields(BODY, entry) +
        '<button type="button" class="btn btn--primary" data-save="body">' +
          'שמירת מדדי הגוף</button>') +

      P.card('תזונה', 'מה שאכלת באותו יום',
        fields(FOOD, entry) +
        '<button type="button" class="btn btn--primary" data-save="food">' +
          'שמירת התזונה</button>') +

      root.Dash.photoCard(state));
  }

  root.EntryTab = { render: render, BODY: BODY, FOOD: FOOD, filledCount: filledCount };
})(typeof window !== 'undefined' ? window : globalThis);
