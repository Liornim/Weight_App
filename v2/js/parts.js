/**
 * Parts — לבני הבניין של הלוח.
 * רק הרכבת HTML. כל חישוב מגיע מ-Metrics, שמשותף עם האפליקציה הראשית.
 */
(function (root) {
  'use strict';

  var Fmt = root.Fmt;

  function esc(value) { return Fmt.esc(String(value === undefined ? '' : value)); }

  /** כרטיס עם כותרת אופציונלית */
  function card(title, note, body) {
    return '<div class="card">' +
      (title ? '<h3>' + esc(title) + '</h3>' : '') +
      (note ? '<p class="note">' + esc(note) + '</p>' : '') +
      body +
    '</div>';
  }

  function section(title, body) {
    return '<section class="section"><h2>' + esc(title) + '</h2>' + body + '</section>';
  }

  /** אריח מספר. tone קובע את הצבע, ולכן הוא נושא משמעות ולא קישוט. */
  function tile(tone, label, value, sub) {
    return '<div class="tile' + (tone ? ' tile--' + tone : '') + '">' +
      '<span class="k">' + esc(label) + '</span>' +
      '<span class="v">' + value + '</span>' +
      (sub ? '<span class="s">' + esc(sub) + '</span>' : '') +
    '</div>';
  }

  function tiles(items) {
    return '<div class="tiles">' + items.join('') + '</div>';
  }

  function rows(items) {
    return '<div class="rows">' + items.map(function (item) {
      return '<div class="row"><span class="k">' + esc(item.k) + '</span>' +
        '<span class="v">' + item.v + '</span></div>';
    }).join('') + '</div>';
  }

  function chips(options, active, attr) {
    return '<div class="chips">' + options.map(function (o) {
      return '<button type="button" class="chip" ' + attr + '="' + esc(o.value) + '"' +
        (o.disabled ? ' disabled' : '') +
        (o.title ? ' title="' + esc(o.title) + '"' : '') +
        ' aria-pressed="' + (String(o.value) === String(active)) + '">' +
        esc(o.label) + '</button>';
    }).join('') + '</div>';
  }

  function table(headers, bodyRows, options) {
    var opts = options || {};
    return '<div class="table-wrap"><table class="t"><thead><tr>' +
      headers.map(function (h) {
        var numeric = typeof h === 'object' ? h.n : true;
        var label = typeof h === 'object' ? h.label : h;
        return '<th' + (numeric ? ' class="n"' : '') + '>' + esc(label) + '</th>';
      }).join('') +
      '</tr></thead><tbody>' + bodyRows.join('') + '</tbody></table></div>' +
      (opts.hint ? hint(opts.hint) : '');
  }

  function hint(text) {
    return '<p class="hint">' + esc(text) + '</p>';
  }

  function empty(text) {
    return '<div class="empty">' + esc(text) + '</div>';
  }

  /** ערך שינוי, צבוע לפי הכיוון הרצוי */
  function delta(value, digits, goodDirection) {
    if (!Fmt.isNum(value)) return '<span class="flat">—</span>';
    var cls = 'flat';
    if (Math.abs(value) >= Math.pow(10, -digits) / 2) {
      var good = goodDirection === 'up' ? value > 0 : value < 0;
      cls = good ? 'down' : 'up';
    }
    return '<span class="' + cls + '">' + Fmt.signed(value, digits) + '</span>';
  }

  function keys(items) {
    return '<div class="keys">' + items.map(function (i) {
      var shape = i.shape || 'line';
      var style = shape === 'dash'
        ? 'background:repeating-linear-gradient(90deg,' + i.color + ' 0 5px,transparent 5px 9px)'
        : 'background:' + i.color;
      return '<span><i class="k-' + shape + '" style="' + style + '"></i>' + esc(i.label) + '</span>';
    }).join('') + '</div>';
  }

  function chart(id, height) {
    return '<div class="chart" id="' + id + '" style="min-height:' + (height || 190) + 'px"></div>' +
      '<div class="chart-caption" id="' + id + '-caption"></div>' +
      '<div id="' + id + '-keys"></div>';
  }

  function fold(title, body, open) {
    return '<details class="fold"' + (open ? ' open' : '') + '>' +
      '<summary>' + esc(title) + '</summary>' +
      '<div class="body">' + body + '</div></details>';
  }

  root.Parts = {
    card: card, section: section, tile: tile, tiles: tiles, rows: rows,
    chips: chips, table: table, hint: hint, empty: empty, delta: delta,
    keys: keys, chart: chart, fold: fold, esc: esc
  };
})(typeof window !== 'undefined' ? window : globalThis);
