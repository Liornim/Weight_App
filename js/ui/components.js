/** UI — רכיבים משותפים. כל פונקציה מחזירה HTML כמחרוזת. */
(function (root) {
  'use strict';

  var Fmt = root.Fmt;
  var Dates = root.Dates;
  var Metrics = root.Metrics;

  /**
   * הקריאה המרכזית: מספר גדול, יחידה, ושולי אי־ודאות.
   * אם אין מרווח סמך פשוט לא מוצג ± — לא ממציאים ביטחון.
   */
  function readout(options) {
    var tone = options.tone ? ' value--' + options.tone : ' value--measured';
    var value = Fmt.isNum(options.value) ? Fmt.n(options.value, options.digits) : Fmt.EMPTY;
    if (options.signed && Fmt.isNum(options.value)) value = Fmt.signed(options.value, options.digits);
    return '' +
      '<div class="readout">' +
        '<span class="value' + (Fmt.isNum(options.value) ? tone : ' value--muted') + '">' + Fmt.esc(value) + '</span>' +
        (options.unit ? '<span class="unit">' + Fmt.esc(options.unit) + '</span>' : '') +
        (Fmt.isNum(options.margin) ? '<span class="margin">' + Fmt.esc(Fmt.pm(options.margin, options.digits)) + '</span>' : '') +
      '</div>';
  }

  /** רצועת השנתות: אילו מהימים האחרונים באמת דווחו */
  function coverageStrip(entries, options) {
    var opts = options || {};
    var cov = Metrics.coverage(entries, opts);
    var today = Dates.today();
    var ticks = cov.days.map(function (d) {
      return '<span class="tick' + (d.has ? ' on' : '') + (d.date === today ? ' today' : '') +
             '" title="' + Fmt.esc(Dates.long(d.date)) + '"></span>';
    }).join('');
    return '' +
      '<div class="coverage">' +
        '<span class="ticks">' + ticks + '</span>' +
        '<span class="caption">' + cov.count + '/' + cov.total + ' ' + Fmt.esc(opts.caption || 'ימים דווחו') + '</span>' +
      '</div>';
  }

  /** מד עמידה ביעד: מילוי לפי הממוצע, וסימון של היעד עצמו */
  function gauge(options) {
    var value = options.value, target = options.target;
    if (!Fmt.isNum(value) || !Fmt.isNum(target) || target <= 0) {
      return '' +
        '<div class="gauge">' +
          '<div class="gauge-head"><span>' + Fmt.esc(options.label) + '</span>' +
          '<span class="amount">' + (Fmt.isNum(value) ? Fmt.n(value, options.digits) : Fmt.EMPTY) +
          (Fmt.isNum(target) ? '' : ' · אין יעד') + '</span></div>' +
        '</div>';
    }
    var ratio = value / target;
    var fill = Math.min(ratio, 1.35) / 1.35 * 100;
    var markAt = (1 / 1.35) * 100;
    var over = ratio > 1 + (options.tolerance || 0.1);
    return '' +
      '<div class="gauge">' +
        '<div class="gauge-head">' +
          '<span>' + Fmt.esc(options.label) + '</span>' +
          '<span class="amount">' + Fmt.n(value, options.digits) + ' / ' + Fmt.n(target, options.digits) +
          '  (' + Fmt.signed(value - target, options.digits) + ')</span>' +
        '</div>' +
        '<div class="gauge-track">' +
          '<div class="gauge-fill' + (over ? ' over' : '') + '" style="width:' + fill.toFixed(1) + '%"></div>' +
          '<div class="gauge-mark" style="inset-inline-start:' + markAt.toFixed(1) + '%"></div>' +
        '</div>' +
      '</div>';
  }

  /**
   * מקטע מתקפל. קיים כדי שמסך יוכל לענות תשובה אחת קצרה למעלה,
   * ולהחזיק מתחתיה את כל הפירוט למי שרוצה אותו.
   */
  function details(title, body, note) {
    return '' +
      '<details class="fold">' +
        '<summary>' + Fmt.esc(title) + '</summary>' +
        '<div class="fold-body">' +
          (note ? '<p class="card-note">' + Fmt.esc(note) + '</p>' : '') +
          body +
        '</div>' +
      '</details>';
  }

  /** התשובה הראשית של מסך: מספר גדול, משפט אחד, ושורת הקשר */
  function hero(options) {
    var facts = (options.facts || []).map(function (f) {
      return '<div class="hero-fact"><span class="k">' + Fmt.esc(f.label) + '</span>' +
        '<span class="v num">' + Fmt.esc(f.value) + '</span></div>';
    }).join('');

    return '' +
      '<section class="hero">' +
        '<p class="hero-label">' + Fmt.esc(options.label) + '</p>' +
        '<div class="hero-value num' + (options.tone ? ' value--' + options.tone : '') + '">' +
          Fmt.esc(options.value) + '</div>' +
        (options.unit ? '<p class="hero-unit">' + Fmt.esc(options.unit) + '</p>' : '') +
        (options.sentence ? '<p class="hero-sentence">' + options.sentence + '</p>' : '') +
        (facts ? '<div class="hero-facts">' + facts + '</div>' : '') +
      '</section>';
  }

  function empty(title, body) {
    return '<div class="empty"><strong>' + Fmt.esc(title) + '</strong>' + Fmt.esc(body || '') + '</div>';
  }

  function basis(text) {
    return '<p class="basis">' + Fmt.esc(text) + '</p>';
  }

  function card(title, note, body) {
    return '' +
      '<section class="card">' +
        (title ? '<h2>' + Fmt.esc(title) + '</h2>' : '') +
        (note ? '<p class="card-note">' + Fmt.esc(note) + '</p>' : '') +
        body +
      '</section>';
  }

  function chips(options, activeValue, dataAttr) {
    return '<div class="chips">' + options.map(function (o) {
      return '<button type="button" class="chip" ' + dataAttr + '="' + Fmt.esc(o.value) + '"' +
        (o.disabled ? ' disabled' : '') +
        (o.title ? ' title="' + Fmt.esc(o.title) + '"' : '') +
        ' aria-pressed="' + (String(o.value) === String(activeValue)) + '">' + Fmt.esc(o.label) + '</button>';
    }).join('') + '</div>';
  }

  root.UI = {
    readout: readout,
    coverageStrip: coverageStrip,
    gauge: gauge,
    details: details,
    hero: hero,
    empty: empty,
    basis: basis,
    card: card,
    chips: chips
  };
})(typeof window !== 'undefined' ? window : globalThis);
