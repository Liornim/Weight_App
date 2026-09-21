/**
 * Entry — טאב ההזנה.
 *
 * יום אחד נסגר בכל פעם: האוכל של יום מסוים, והשקילה של הבוקר
 * שאחריו. כך ההזנה נראית בדיוק כמו החישוב — המשקל של הבוקר סוגר
 * את היום שלפניו — ואין שני תאריכים שונים לחשוב עליהם.
 *
 * מתחת, רשימת הימים האחרונים: לחיצה על יום פותחת אותו לעריכה, וכל
 * יום מסומן לפי מה שידוע על שמירתו בגיליון.
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

  /**
   * היום שנסגר.
   *
   * בכל בוקר נסגר יום אחד: האוכל של אתמול, והשקילה של הבוקר שסוגרת
   * אותו. אלה נראו כשני תאריכים שונים בשני טפסים, וזה בלבל — אבל
   * זה יום אחד, וכך בדיוק החישוב כבר רואה אותו.
   *
   * ברירת המחדל היא אתמול, כי זה היום שנסגר הבוקר.
   */
  function closingDay(state) {
    var day = state.entryDay;
    var today = Dates.today();
    if (!day || day >= today) day = Dates.addDays(today, -1);
    return day;
  }

  var WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  function weekday(iso) {
    return WEEKDAYS[new Date(iso + 'T12:00:00Z').getUTCDay()];
  }


  function navigator(day) {
    var morning = Dates.addDays(day, 1);
    var canForward = morning < Dates.today();

    return '<div class="day-nav">' +
      '<button type="button" class="chip" data-shift="-1" aria-label="יום קודם">›</button>' +
      '<div class="day-title">' +
        '<strong>סוגר את יום ' + weekday(day) + ' ' + P.esc(Dates.short(day)) + '</strong>' +
        '<span class="sub">אוכל של ' + P.esc(Dates.short(day)) +
          ' · שקילת בוקר ' + P.esc(Dates.short(morning)) + '</span>' +
      '</div>' +
      '<button type="button" class="chip" data-shift="1" aria-label="יום הבא"' +
        (canForward ? '' : ' disabled') + '>‹</button>' +
    '</div>';
  }

  /**
   * מאקרו שלא קיים באף יום מדווח פעם אחת כאן, במקום להופיע כשדה
   * ריק בכל מסך. בדרך כלל זה אומר שהעמודה בגיליון לא נקלטה.
   */
  function missingMacroNote() {
    var entries = Store.getEntries();
    var withKcal = entries.filter(function (e) { return Fmt.isNum(e.kcal); });
    if (withKcal.length < 5) return '';

    var missing = FOOD.filter(function (field) {
      if (field.key === 'kcal') return false;
      return !entries.some(function (e) { return Fmt.isNum(e[field.key]); });
    });

    if (!missing.length) return '';

    return P.hint('אין אף רישום של ' +
      missing.map(function (f) { return f.label; }).join(', ') +
      ' בכל הנתונים, למרות שיש ' + withKcal.length + ' ימים עם קלוריות. ' +
      'אם הנתונים מגיעים מהגיליון, ייתכן שהעמודה לא נקלטה — ' +
      'כדאי למשוך שוב מההגדרות.');
  }

  /**
   * רשימה אחת של שדות, בסדר ההקלדה.
   *
   * ההזנה נעשית ממספר מסכים באפליקציית התזונה, ובכל מעבר בין
   * האפליקציות הדפדפן עלול לרענן את הלשונית ברקע. לכן כל ערך נשמר
   * במכשיר ברגע שיוצאים מהשדה, ו"הבא" במקלדת עובר לשדה הבא — בלי
   * לגעת במסך בין הקלדה להקלדה.
   */
  function field(f, entry, date, isLast) {
    return '<label class="quick-row" for="in-' + f.key + '">' +
      '<span class="quick-label">' + P.esc(f.label) +
        (f.unit ? ' <span class="unit">' + P.esc(f.unit) + '</span>' : '') + '</span>' +
      '<input id="in-' + f.key + '" class="quick-input num" data-field="' + f.key +
        '" data-date="' + date + '" type="text" inputmode="decimal" ' +
        'autocomplete="off" enterkeyhint="' + (isLast ? 'done' : 'next') + '" value="' +
        (Fmt.isNum(entry[f.key]) ? entry[f.key] : '') + '">' +
    '</label>';
  }

  function render(state) {
    var settings = Store.getSettings();
    var day = closingDay(state);
    var morning = Dates.addDays(day, 1);

    var food = Store.getEntry(day) || {};
    var body = Store.getEntry(morning) || {};
    var bodyOpen = morning <= Dates.today();

    var total = FOOD.length + (bodyOpen ? BODY.length : 0);
    var filled = filledCount(food, FOOD) + (bodyOpen ? filledCount(body, BODY) : 0);

    var sync = settings.sync || {};
    var toSheet = !!(sync.write && sync.url);

    var rows =
      '<div class="quick-group">אוכל של ' + P.esc(Dates.short(day)) + '</div>' +
      FOOD.map(function (f, i) {
        return field(f, food, day, !bodyOpen && i === FOOD.length - 1);
      }).join('') +
      (bodyOpen
        ? '<div class="quick-group">שקילת בוקר ' + P.esc(Dates.short(morning)) + '</div>' +
          BODY.map(function (f, i) {
            return field(f, body, morning, i === BODY.length - 1);
          }).join('')
        : '');

    return P.section('הזנה',
      P.card(null, null,
        navigator(day) +
        '<div class="quick-list">' + rows + '</div>' +
        '<div class="quick-foot">' +
          '<button type="button" class="btn btn--primary" data-save="day">' +
            (toSheet ? 'שלח לגיליון' : 'שמור') + '</button>' +
          '<span class="quick-count" id="quick-count">' + filled + ' מתוך ' + total + '</span>' +
        '</div>' +
        '<div id="save-status"></div>' +
        P.hint('כל ערך נשמר במכשיר כשיוצאים מהשדה, כך שאפשר לעבור ' +
          'לאפליקציית התזונה ולחזור בלי לאבד כלום.')));
  }

  root.EntryTab = {
    render: render, BODY: BODY, FOOD: FOOD, filledCount: filledCount,
    closingDay: closingDay
  };
})(typeof window !== 'undefined' ? window : globalThis);
