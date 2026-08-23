/** Fmt — הצגת מספרים. כל ערך חסר מוצג כמקף, לא כאפס. */
(function (root) {
  'use strict';

  var EMPTY = '—';

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function n(value, digits) {
    if (!isNum(value)) return EMPTY;
    var d = digits === undefined ? 1 : digits;
    return value.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  /** מספר עם סימן מפורש — לשינויים ולפערים */
  function signed(value, digits) {
    if (!isNum(value)) return EMPTY;
    var d = digits === undefined ? 1 : digits;
    var body = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    if (Math.abs(value) < Math.pow(10, -d) / 2) return '0' + (d ? '.' + '0'.repeat(d) : '');
    return (value > 0 ? '+' : '\u2212') + body;
  }

  function pct(value, digits) {
    return isNum(value) ? n(value * 100, digits === undefined ? 0 : digits) + '%' : EMPTY;
  }

  /** שולי אי־ודאות: "± 0.18" */
  function pm(value, digits) {
    return isNum(value) ? '\u00B1 ' + n(Math.abs(value), digits === undefined ? 1 : digits) : '';
  }

  /** עוטף מספר ב-span שמכריח כיווניות שמאל־ימין בתוך טקסט עברי */
  function numHtml(value, digits, className) {
    return '<span class="num' + (className ? ' ' + className : '') + '">' + esc(n(value, digits)) + '</span>';
  }

  function signedHtml(value, digits, className) {
    return '<span class="num' + (className ? ' ' + className : '') + '">' + esc(signed(value, digits)) + '</span>';
  }

  /** מחלקת צבע לדלתא, כאשר deltaGoodDirection הוא 'down' או 'up' */
  function deltaClass(value, goodDirection) {
    if (!isNum(value) || Math.abs(value) < 1e-9) return 'delta-flat';
    var good = goodDirection === 'down' ? value < 0 : value > 0;
    return good ? 'delta-down' : 'delta-up';
  }

  root.Fmt = {
    EMPTY: EMPTY,
    isNum: isNum,
    esc: esc,
    n: n,
    signed: signed,
    pct: pct,
    pm: pm,
    numHtml: numHtml,
    signedHtml: signedHtml,
    deltaClass: deltaClass
  };
})(typeof window !== 'undefined' ? window : globalThis);
