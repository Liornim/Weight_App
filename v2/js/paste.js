/**
 * Paste — קליטת שורה אחת והפיכתה לשדות.
 *
 * הרעיון: ניתוח התמונה נעשה בשיחה, וחוזרת שורה קצרה בפורמט קבוע.
 * הדבקה אחת ממלאת את כל הטופס, במקום תשע הקלדות.
 *
 * שני פורמטים נתמכים:
 *   מקוצר   1671 118 126 24 12 9500
 *            קלוריות, חלבון, פחמימות, שומן, סיבים, צעדים
 *   מסומן   קלוריות 1671, חלבון 118, שומן 24
 *
 * הפורמט המסומן עדיף כשמדביקים חלק מהשדות או בסדר אחר, והוא זה
 * שנקרא קודם — שורה שיש בה תוויות לא תיקרא בטעות כרצף מספרים.
 */
(function (root) {
  'use strict';

  // כל שדה והמילים שמזהות אותו. הסדר חשוב: "שומן באוכל" לפני "שומן",
  // אחרת "שומן" היה תופס גם את מדידת השומן בגוף.
  var FIELDS = [
    { key: 'kcal', words: ['קלוריות', 'קלוריה', 'קק"ל', 'קק״ל', 'kcal', 'cal'] },
    { key: 'proteinG', words: ['חלבון', 'חלבונים', 'protein'] },
    { key: 'carbG', words: ['פחמימות', 'פחמימה', 'carbs', 'carb'] },
    { key: 'fatG', words: ['שומן באוכל', 'שומנים', 'שומן', 'fat'] },
    { key: 'fiberG', words: ['סיבים', 'סיב', 'fiber', 'fibre'] },
    { key: 'steps', words: ['צעדים', 'steps'] },
    { key: 'weightKg', words: ['משקל', 'weight'] },
    { key: 'muscleKg', words: ['שריר', 'muscle'] },
    { key: 'bodyFatKg', words: ['שומן בגוף', 'אחוז שומן', 'bodyfat'] },
    { key: 'waterKg', words: ['נוזלים', 'מים', 'water'] }
  ];

  var SHORT_ORDER = ['kcal', 'proteinG', 'carbG', 'fatG', 'fiberG', 'steps'];

  function toNumber(raw) {
    if (raw === null || raw === undefined) return null;
    var clean = String(raw).replace(/,/g, '').trim();
    if (!clean) return null;
    var value = Number(clean);
    return isFinite(value) ? value : null;
  }

  /** האם בשורה יש בכלל תוויות מילוליות */
  function hasLabels(text) {
    return FIELDS.some(function (field) {
      return field.words.some(function (word) { return text.indexOf(word) !== -1; });
    });
  }

  function parseLabelled(text) {
    var found = {};
    var used = {};

    FIELDS.forEach(function (field) {
      field.words.forEach(function (word) {
        if (found[field.key] !== undefined) return;
        var at = text.indexOf(word);
        if (at === -1 || used[at]) return;

        // המספר שאחרי המילה, עם או בלי נקודתיים
        var after = text.slice(at + word.length);
        var match = after.match(/^[\s:=־-]*(-?[\d,]+(?:\.\d+)?)/);
        if (!match) return;

        var value = toNumber(match[1]);
        if (value === null) return;
        found[field.key] = value;
        used[at] = true;
      });
    });

    return found;
  }

  function parseShort(text) {
    var numbers = (text.match(/-?[\d,]+(?:\.\d+)?/g) || [])
      .map(toNumber)
      .filter(function (value) { return value !== null; });

    var found = {};
    numbers.slice(0, SHORT_ORDER.length).forEach(function (value, index) {
      found[SHORT_ORDER[index]] = value;
    });
    return found;
  }

  /**
   * מחזיר {ok, fields, format, missing}.
   * missing הוא רשימת השדות שלא נמצאו, כדי שהמסך יוכל לומר
   * מה נקלט ומה לא במקום להשאיר את המשתמש לנחש.
   */
  function parse(text) {
    var clean = String(text || '').trim();
    if (!clean) return { ok: false, reason: 'empty', fields: {} };

    var labelled = hasLabels(clean);
    var fields = labelled ? parseLabelled(clean) : parseShort(clean);
    var keys = Object.keys(fields);

    if (!keys.length) return { ok: false, reason: 'no-numbers', fields: {} };

    return {
      ok: true,
      format: labelled ? 'labelled' : 'short',
      fields: fields,
      found: keys,
      missing: SHORT_ORDER.filter(function (key) { return fields[key] === undefined; })
    };
  }

  /** הפרומפט שמועתק לשיחה, כדי שהתשובה תחזור בפורמט שנקלט כאן */
  function promptText() {
    return 'הערך את הארוחה בתמונה. ' +
      'תן שתי הערכות — אחת שמרנית (מנות סטנדרטיות, מעט שמן) ואחת מחמירה ' +
      '(שמן בישול, רטבים וסוכר מוסף) — ואז הכרע ביניהן והסבר איזו הנחה הכריעה. ' +
      'בסוף התשובה כתוב שורה אחת בלבד בפורמט הזה, בלי מילים:\n' +
      'קלוריות חלבון פחמימות שומן סיבים\n' +
      'לדוגמה: 1671 118 126 24 12';
  }

  root.Paste = {
    parse: parse,
    promptText: promptText,
    FIELDS: FIELDS,
    SHORT_ORDER: SHORT_ORDER
  };
})(typeof window !== 'undefined' ? window : globalThis);
