/**
 * Recipes — טאב המתכונים.
 *
 * המתכונים יושבים ב-data/recipes.json, כמו coach.json: Claude מוסיף
 * מתכון לקובץ בריפו, והדף קורא אותו. אין כאן כתיבה למאגר או לגיליון.
 */
(function (root) {
  'use strict';

  var P = root.Parts;
  var URL_PATH = 'data/recipes.json';

  var list = null;     // null = עוד לא נטען
  var failed = false;

  function load() {
    if (!root.fetch) return;
    root.fetch(URL_PATH + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('recipes ' + response.status);
        return response.json();
      })
      .then(function (data) {
        list = (data && data.recipes) || [];
        failed = false;
      })
      .catch(function () { failed = true; })
      .then(function () {
        var app = root.App;
        if (app && app.state && app.state.tab === 'recipes' && app.setState) app.setState({});
      });
  }

  function bullets(items, ordered) {
    if (!items || !items.length) return '';
    var tag = ordered ? 'ol' : 'ul';
    return '<' + tag + ' class="rx-list">' + items.map(function (item) {
      return '<li>' + P.esc(item) + '</li>';
    }).join('') + '</' + tag + '>';
  }

  function nutrition(n) {
    if (!n) return '';
    return P.tiles([
      P.tile(null, 'קק״ל', P.esc(n.kcal || '—'), n.per ? 'ל' + n.per : ''),
      P.tile(null, 'חלבון', P.esc((n.proteinG || '—') + ' ג׳'), '')
    ]) + (n.note ? P.hint(n.note) : '');
  }

  function one(r) {
    var meta = [r.yield, r.source].filter(Boolean).join(' · ');
    var body =
      (meta ? '<p class="note">' + P.esc(meta) + '</p>' : '') +
      nutrition(r.nutrition) +
      '<h4 class="rx-h">מצרכים</h4>' + bullets(r.ingredients) +
      '<h4 class="rx-h">הכנה</h4>' + bullets(r.steps, true) +
      (r.tips && r.tips.length ? '<h4 class="rx-h">טיפים</h4>' + bullets(r.tips) : '');

    var kcal = r.nutrition && r.nutrition.kcal ? ' · ' + r.nutrition.kcal + ' קק״ל' : '';
    // לא details.fold: app.js מחבר את הראשון מהם למצב פתיחת ההגדרות
    return '<details class="rx"><summary>' + P.esc(r.title) +
      '<span class="rx-kcal">' + P.esc(kcal.replace(/^ · /, '')) + '</span></summary>' +
      '<div class="body">' + body + '</div></details>';
  }

  function render() {
    if (list === null && !failed) {
      load();
      return P.section('מתכונים', P.card(null, null, P.empty('טוען מתכונים…')));
    }
    if (failed) {
      return P.section('מתכונים', P.card(null, null, P.empty('לא הצלחתי לטעון את המתכונים.')));
    }
    if (!list.length) {
      return P.section('מתכונים', P.card(null, null, P.empty('עוד אין מתכונים.')));
    }
    return P.section('מתכונים · ' + list.length, list.map(one).join(''));
  }

  root.RecipesTab = { render: render, load: load };
})(typeof window !== 'undefined' ? window : globalThis);
