/**
 * Estimate — הערכת ארוחה בוויכוח בין שני מודלים.
 *
 * למה שניים ולא אחד: השגיאה הגדולה בהערכה מתמונה היא הכמות, לא
 * הזיהוי. מודל יחיד נועל את עצמו על הניחוש הראשון. שניים עם הטיות
 * מנוגדות — אחד שמניח מנות סטנדרטיות ומעט שמן, אחד שמניח שהקלוריות
 * הנסתרות הן העיקר — חושפים בדיוק את ההנחה שהיא מקור השגיאה.
 *
 * ההכרעה נעשית בקוד ולא במודל שלישי. הכלל גלוי, אין לו עלות,
 * והוא לא יכול "להשתכנע" משכנוע רטורי במקום מראיות.
 */
(function (root) {
  'use strict';

  var BASE = 'אתה מעריך תזונה. מולך תמונה של ארוחה. ' +
    'ענה ב-JSON בלבד, בלי טקסט לפני או אחרי ובלי סימני קוד. ' +
    'המבנה: {"items":[{"name":"","grams":0,"kcal":0,"confidence":"high|medium|low"}],' +
    '"kcal":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"reasoning":""}. ' +
    'שדות הסיכום הם הסכום על כל הפריטים. ' +
    'ב-reasoning כתוב בעברית שתי שורות: על מה התבססת בהערכת הכמות, ומה לא ברור בתמונה.';

  var LEAN = BASE + '\n\nהעמדה שלך: מנות נראות גדולות יותר משהן במציאות. ' +
    'הנח מנות בגודל סטנדרטי ושמן מועט בבישול, ואל תוסיף קלוריות שאינך רואה. ' +
    'בהתלבטות בין שתי כמויות — בחר בנמוכה.';

  var RICH = BASE + '\n\nהעמדה שלך: הקלוריות הנסתרות הן העיקר. ' +
    'שמן בישול, רטבים, חמאה וסוכר מוסף כמעט תמיד נשכחים, וכף שמן אחת היא 120 קלוריות. ' +
    'בהתלבטות בין שתי כמויות — בחר בגבוהה.';

  var SUM_FIELDS = ['kcal', 'protein', 'carbs', 'fat', 'fiber'];

  /**
   * חילוץ המספרים מהתשובה.
   *
   * מודלים חינמיים לא תמיד מכבדים בקשה ל-JSON: הם עוטפים בסימני קוד,
   * מוסיפים הסבר לפני ואחרי, או כותבים טבלה בעברית. לכן שלוש שכבות:
   * JSON תקין, JSON שמוטמע בתוך טקסט, ואם שתיהן נכשלות — חילוץ לפי
   * תוויות מהטקסט עצמו. עדיף לקלוט מספרים נכונים מטקסט חופשי מאשר
   * להיכשל על הפורמט.
   */
  var LABELS = {
    kcal: ['קלוריות', 'קלוריה', 'קק"ל', 'קק״ל', 'calories', 'kcal', 'energy'],
    protein: ['חלבון', 'חלבונים', 'protein'],
    carbs: ['פחמימות', 'פחמימה', 'carbohydrates', 'carbs', 'carb'],
    fat: ['שומן', 'שומנים', 'fat'],
    fiber: ['סיבים', 'סיב', 'fiber', 'fibre']
  };

  function fromJson(text) {
    var clean = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
    var start = clean.indexOf('{');
    var end = clean.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      var parsed = JSON.parse(clean.slice(start, end + 1));
      return (parsed && typeof parsed === 'object' && num(parsed.kcal) !== null) ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function fromText(text) {
    var clean = String(text);
    var found = {};

    Object.keys(LABELS).forEach(function (field) {
      LABELS[field].some(function (word) {
        var at = clean.indexOf(word);
        if (at === -1) return false;
        // המספר הקרוב אחרי המילה, גם אם ביניהם נקודתיים או מקף
        var after = clean.slice(at + word.length, at + word.length + 40);
        var match = after.match(/[\s:=־|-]*(-?[\d,]+(?:\.\d+)?)/);
        if (!match) return false;
        var value = num(match[1].replace(/,/g, ''));
        if (value === null) return false;
        found[field] = value;
        return true;
      });
    });

    if (num(found.kcal) === null) return null;
    found.items = [];
    found.reasoning = 'המספרים חולצו מטקסט חופשי, כי התשובה לא חזרה כ-JSON.';
    found.recovered = true;
    return found;
  }

  function parseAnswer(text) {
    if (!text) return null;
    return fromJson(text) || fromText(text);
  }

  function num(value) {
    var n = Number(value);
    return isFinite(n) ? n : null;
  }

  /**
   * ההכרעה: כלל גלוי במקום שופט נוסף.
   *
   * כשהשניים קרובים, הממוצע אמין והפער עצמו קטן ממילא. ככל שהם
   * מתרחקים, הממוצע נשאר המספר הסביר ביותר — אבל הביטחון בו יורד,
   * וזה נאמר במפורש במקום להיבלע. פער גדול אינו כישלון של השיטה:
   * הוא הממצא, ואומר שהתמונה לא מספיקה.
   */
  function reconcile(a, b) {
    var result = { fields: {}, agreement: null, confidence: 'low', notes: [] };

    SUM_FIELDS.forEach(function (field) {
      var x = num(a && a[field]);
      var y = num(b && b[field]);
      if (x === null && y === null) return;
      if (x === null) { result.fields[field] = y; return; }
      if (y === null) { result.fields[field] = x; return; }
      result.fields[field] = (x + y) / 2;
    });

    var low = num(a && a.kcal);
    var high = num(b && b.kcal);
    if (low === null || high === null) {
      result.notes.push('אחד המעריכים לא החזיר קלוריות.');
      return result;
    }

    var gap = Math.abs(high - low);
    var mean = (high + low) / 2;
    var share = mean ? gap / mean : 0;

    result.gap = gap;
    result.gapShare = share;
    result.range = { low: Math.min(low, high), high: Math.max(low, high) };

    if (share < 0.12) {
      result.confidence = 'high';
      result.agreement = 'שני המעריכים הגיעו לאותו טווח, והפער ביניהם קטן.';
    } else if (share < 0.3) {
      result.confidence = 'medium';
      result.agreement = 'יש פער בינוני ביניהם, בעיקר בהערכת הכמות או השמן.';
    } else {
      result.confidence = 'low';
      result.agreement = 'הפער ביניהם גדול. התמונה כנראה לא מספיקה כדי להעריך כמות.';
      result.notes.push('שווה לשקול את המרכיב העיקרי במקום להסתמך על המספר.');
    }

    return result;
  }

  /** מוצא פריטים שרק אחד מהמעריכים ראה — שם בדרך כלל מקור הפער */
  function itemDifferences(a, b) {
    var namesOf = function (data) {
      return ((data && data.items) || []).map(function (item) {
        return String(item.name || '').trim();
      }).filter(Boolean);
    };
    var first = namesOf(a);
    var second = namesOf(b);
    var has = function (list, name) {
      return list.some(function (other) {
        return other === name || other.indexOf(name) !== -1 || name.indexOf(other) !== -1;
      });
    };

    return {
      onlyLean: first.filter(function (name) { return !has(second, name); }),
      onlyRich: second.filter(function (name) { return !has(first, name); })
    };
  }

  /**
   * מריץ את שני המעריכים במקביל ומחזיר את שתי ההערכות וההכרעה.
   * accounts הוא [{key, model}] — שניים או אחד. עם אחד, שתי
   * ההערכות ירוצו על אותו ספק עם ההטיות המנוגדות.
   */
  function run(accounts, image, onStage) {
    var stage = onStage || function () {};
    var list = (accounts || []).filter(function (a) { return a && a.key; });
    if (!list.length) return Promise.reject(new Error('לא הוגדר אף מפתח'));

    var leanAccount = list[0];
    var richAccount = list[1] || list[0];

    stage('שולח את התמונה לשני המעריכים');

    var picked = {};

    var request = function (account, system, extra) {
      return root.Providers.ask({
        key: account.key,
        model: account.model,
        provider: account.provider,
        system: system,
        image: image,
        text: extra || 'הערך את הארוחה בתמונה.',
        onModelPicked: function (name) {
          if (name !== account.model) picked[account.key] = name;
        }
      });
    };

    var ask = function (account, system) {
      return request(account, system).then(function (text) {
        var parsed = parseAnswer(text);
        if (parsed) return parsed;

        // ניסיון שני, עם בקשה חד־משמעית יותר
        return request(account, system,
          'הערך את הארוחה בתמונה. חשוב: החזר אך ורק אובייקט JSON, ' +
          'שמתחיל ב-{ ומסתיים ב-}, בלי מילה אחת לפניו או אחריו ובלי סימני קוד.'
        ).then(function (second) {
          var retry = parseAnswer(second);
          if (retry) {
            retry.neededRetry = true;
            return retry;
          }
          var error = new Error('התשובה חזרה בפורמט שלא ניתן לקרוא');
          error.raw = String(second || text || '').slice(0, 400);
          throw error;
        });
      });
    };

    return Promise.all([
      ask(leanAccount, LEAN),
      ask(richAccount, RICH)
    ]).then(function (answers) {
      stage('משווה בין ההערכות');
      var lean = answers[0];
      var rich = answers[1];

      return {
        lean: lean,
        rich: rich,
        // מודל שנבחר אוטומטית אחרי שהמקורי לא היה זמין
        pickedModel: picked[richAccount.key] || picked[leanAccount.key] || null,
        leanProvider: root.Providers.label(leanAccount.key, leanAccount.provider),
        richProvider: root.Providers.label(richAccount.key, richAccount.provider),
        sameProvider: leanAccount.key === richAccount.key,
        verdict: reconcile(lean, rich),
        differences: itemDifferences(lean, rich)
      };
    });
  }

  function readImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var value = String(reader.result);
        resolve({
          base64: value.slice(value.indexOf(',') + 1),
          mediaType: file.type || 'image/jpeg'
        });
      };
      reader.onerror = function () { reject(new Error('לא הצלחתי לקרוא את הקובץ')); };
      reader.readAsDataURL(file);
    });
  }

  root.Estimate = {
    run: run,
    readImage: readImage,
    parseAnswer: parseAnswer,
    reconcile: reconcile,
    itemDifferences: itemDifferences,
    SUM_FIELDS: SUM_FIELDS
  };
})(typeof window !== 'undefined' ? window : globalThis);
