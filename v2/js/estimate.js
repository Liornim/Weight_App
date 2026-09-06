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
    'ענה ב-JSON בלבד, בלי טקסט לפני או אחרי ובלי סימני קוד.\n' +
    'המבנה:\n' +
    '{"items":[{"name":"","grams":0,"basis":"","kcal":0,"protein":0,"carbs":0,' +
    '"fat":0,"saturated":0,"fiber":0,"per100":{"kcal":0,"protein":0,"carbs":0,' +
    '"fat":0,"saturated":0,"fiber":0},"confidence":"high|medium|low"}],' +
    '"grams":0,"kcal":0,"protein":0,"carbs":0,"fat":0,"saturated":0,"fiber":0,' +
    '"reasoning":""}\n' +
    'לכל פריט: grams הוא המשקל שאתה מעריך בגרמים, per100 הם הערכים ל-100 גרם ' +
    'של אותו מאכל, ו-basis הוא משפט קצר שמסביר על סמך מה הערכת את המשקל — ' +
    'למשל השוואה לצלחת, לכף או ליד. ' +
    'saturated הוא שומן רווי מתוך השומן הכולל.\n' +
    'שדות הסיכום הם הסכום על כל הפריטים, כולל grams שהוא המשקל הכולל של המנה. ' +
    'ב-reasoning כתוב בעברית שתי שורות: על מה התבססת בהערכת הכמות, ומה לא ברור בתמונה.';

  var LEAN = BASE + '\n\nהעמדה שלך: מנות נראות גדולות יותר משהן במציאות. ' +
    'הנח מנות בגודל סטנדרטי ושמן מועט בבישול, ואל תוסיף קלוריות שאינך רואה. ' +
    'בהתלבטות בין שתי כמויות — בחר בנמוכה.';

  var RICH = BASE + '\n\nהעמדה שלך: הקלוריות הנסתרות הן העיקר. ' +
    'שמן בישול, רטבים, חמאה וסוכר מוסף כמעט תמיד נשכחים, וכף שמן אחת היא 120 קלוריות. ' +
    'בהתלבטות בין שתי כמויות — בחר בגבוהה.';

  var SUM_FIELDS = ['kcal', 'protein', 'carbs', 'fat', 'saturated', 'fiber', 'grams'];

  // גבולות שפויים לארוחה בודדת. מודל שמחזיר אפס או מספר אבסורדי
  // כנראה לא באמת ניתח את התמונה — למשל מודל לקריאת מסמכים
  // שנבחר אוטומטית מרשימת המודלים החינמיים.
  var MIN_KCAL = 20;
  var MAX_KCAL = 6000;

  function plausible(parsed) {
    if (!parsed) return false;
    var kcal = num(parsed.kcal);
    return kcal !== null && kcal >= MIN_KCAL && kcal <= MAX_KCAL;
  }

  /**
   * חילוץ המספרים מהתשובה.
   *
   * מודלים חינמיים לא תמיד מכבדים בקשה ל-JSON: הם עוטפים בסימני קוד,
   * מוסיפים הסבר לפני ואחרי, או כותבים טבלה בעברית. לכן שלוש שכבות:
   * JSON תקין, JSON שמוטמע בתוך טקסט, ואם שתיהן נכשלות — חילוץ לפי
   * תוויות מהטקסט עצמו. עדיף לקלוט מספרים נכונים מטקסט חופשי מאשר
   * להיכשל על הפורמט.
   */
  // הסדר קובע: "שומן רווי" חייב להיבדק לפני "שומן", אחרת הוא
  // ייבלע לתוכו וערך אחד יגיע לשני השדות
  var LABELS = {
    kcal: ['קלוריות', 'קלוריה', 'קק"ל', 'קק״ל', 'calories', 'kcal', 'energy'],
    protein: ['חלבון', 'חלבונים', 'protein'],
    carbs: ['פחמימות', 'פחמימה', 'carbohydrates', 'carbs', 'carb'],
    saturated: ['שומן רווי', 'רווי', 'saturated fat', 'saturated'],
    fat: ['שומן כולל', 'שומנים', 'שומן', 'total fat', 'fat'],
    fiber: ['סיבים תזונתיים', 'סיבים', 'סיב', 'dietary fiber', 'fiber', 'fibre'],
    grams: ['משקל כולל', 'משקל', 'weight']
  };

  function fromTextField(clean, field, taken) {
    var hit = null;

    LABELS[field].some(function (word) {
      // כל המופעים ולא רק הראשון: ב"שומן רווי 4, שומן 22" המופע
      // הראשון של "שומן" נמצא בתוך "שומן רווי" וכבר נתפס, והערך
      // הנכון נמצא רק במופע הבא
      var at = clean.indexOf(word);

      while (at !== -1) {
        if (!taken[at]) {
          var after = clean.slice(at + word.length, at + word.length + 40);
          var match = after.match(/[\s:=־|-]*(-?[\d,]+(?:\.\d+)?)/);
          if (match) {
            var value = num(match[1].replace(/,/g, ''));
            if (value !== null) {
              for (var i = at; i < at + word.length; i++) taken[i] = true;
              hit = value;
              return true;
            }
          }
        }
        at = clean.indexOf(word, at + 1);
      }
      return false;
    });

    return hit;
  }

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
    var taken = {};

    Object.keys(LABELS).forEach(function (field) {
      var value = fromTextField(clean, field, taken);
      if (value !== null) found[field] = value;
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

  // מילים שמופיעות בשמות פריטים ואינן מזהות אותם
  var NOISE = ['מבושל', 'מבושלת', 'קלוי', 'צלוי', 'טרי', 'טרייה', 'עם', 'ללא',
    'גדול', 'קטן', 'בינוני', 'שני', 'שתי', 'קלחים', 'קלח', 'יחידות', 'פרוסות'];

  function nameTokens(name) {
    return String(name || '')
      .replace(/\([^)]*\)/g, ' ')       // הערות בסוגריים אינן חלק מהשם
      .replace(/[^\u0590-\u05FFa-zA-Z ]/g, ' ')
      .split(/\s+/)
      .map(function (word) { return word.trim(); })
      .filter(function (word) {
        return word.length > 1 && NOISE.indexOf(word) === -1;
      });
  }

  /**
   * האם שני שמות מתארים את אותו מאכל.
   *
   * השוואת מחרוזות שלמות נכשלה: "תירס מבושל (שני קלחים)" ו"תירס בקלח"
   * הם אותו דבר, ואף אחד מהם אינו מוכל בשני. לכן ההשוואה היא על
   * מילות התוכן — די במילה משמעותית משותפת אחת.
   */
  function sameFood(a, b) {
    var first = nameTokens(a);
    var second = nameTokens(b);
    if (!first.length || !second.length) return false;
    return first.some(function (word) {
      return second.some(function (other) {
        return word === other || word.indexOf(other) === 0 || other.indexOf(word) === 0;
      });
    });
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

    return {
      onlyLean: first.filter(function (name) {
        return !second.some(function (other) { return sameFood(name, other); });
      }),
      onlyRich: second.filter(function (name) {
        return !first.some(function (other) { return sameFood(name, other); });
      })
    };
  }

  /** פריטים ששניהם ראו, עם הפער בכמות — שם נמצא רוב ההבדל */
  function sharedItems(a, b) {
    var itemsOf = function (data) { return (data && data.items) || []; };
    var pairs = [];

    itemsOf(a).forEach(function (mine) {
      var match = itemsOf(b).find(function (theirs) {
        return sameFood(mine.name, theirs.name);
      });
      if (!match) return;
      pairs.push({
        name: mine.name,
        leanGrams: num(mine.grams),
        richGrams: num(match.grams),
        leanKcal: num(mine.kcal),
        richKcal: num(match.kcal)
      });
    });

    return pairs;
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
        project: account.project,
        system: system,
        image: image,
        text: extra || 'הערך את הארוחה בתמונה.',
        onModelPicked: function (name) {
          if (name !== account.model) picked[account.key] = name;
        },
        // מודל שמחזיר תשובה לא שפויה נחשב כלא מתאים, והמערכת
        // ממשיכה למודל הבא ברשימה במקום להציג אפסים
        validate: function (answer) { return plausible(parseAnswer(answer)); }
      });
    };

    var ask = function (account, system) {
      var describe = function (error) {
        if (!error.provider) {
          error.provider = root.Providers.label(account.key, account.provider);
          error.model = account.model || '(ברירת מחדל)';
        }
        throw error;
      };

      return request(account, system).then(function (text) {
        var parsed = parseAnswer(text);
        if (plausible(parsed)) return parsed;

        // ניסיון שני, עם בקשה חד־משמעית יותר
        return request(account, system,
          'הערך את הארוחה בתמונה. חשוב: החזר אך ורק אובייקט JSON, ' +
          'שמתחיל ב-{ ומסתיים ב-}, בלי מילה אחת לפניו או אחריו ובלי סימני קוד.'
        ).then(function (second) {
          var retry = parseAnswer(second);
          if (plausible(retry)) {
            retry.neededRetry = true;
            return retry;
          }

          var zeroed = retry && num(retry.kcal) !== null && num(retry.kcal) < MIN_KCAL;
          var raw = String(second || text || '').trim();
          var error = new Error(zeroed
            ? 'המודל החזיר אפס קלוריות — כנראה אינו מתאים להערכת מזון'
            : 'התשובה חזרה בפורמט שלא ניתן לקרוא' + (raw ? '' : ' (והיא ריקה)'));
          error.raw = raw ? raw.slice(0, 500) : '(המודל לא החזיר טקסט בכלל)';
          error.provider = root.Providers.label(account.key, account.provider);
          error.model = account.model || '(ברירת מחדל)';
          throw error;
        });
      }).catch(describe);
    };

    // כששני המעריכים חולקים מפתח, הרצה במקביל מכפילה את העומס על
    // אותו מודל חינמי וגוררת 429. במקרה כזה הם רצים בזה אחר זה.
    var shared = leanAccount.key === richAccount.key;

    var both = shared
      ? ask(leanAccount, LEAN).then(function (lean) {
          return ask(richAccount, RICH).then(function (rich) { return [lean, rich]; });
        })
      : Promise.all([ask(leanAccount, LEAN), ask(richAccount, RICH)]);

    /**
     * סיבוב תגובה: כל צד רואה את הערכת השני ומגיב.
     *
     * זה הלב של הרעיון. הערכה ראשונה היא ניחוש; אחרי שרואים מספר
     * אחר צריך להצדיק את הפער או להודות בו, וזה מוציא החוצה את
     * ההנחה שגרמה לו — בדרך כלל הכמות או השמן.
     */
    var rebut = function (account, system, mine, theirs) {
      var text = 'זו ההערכה שלך על התמונה:\n' + JSON.stringify(mine) +
        '\n\nמעריך אחר בחן את אותה תמונה והגיע למספרים אחרים:\n' +
        JSON.stringify(theirs) +
        '\n\nהפער ביניכם הוא בעיקר בכמות. בדוק שוב את התמונה: ' +
        'היכן הוא מדויק ממך, והיכן אתה ממנו? ' +
        'אם השתכנעת — עדכן את המספרים. אם לא — השאר אותם. ' +
        'ב-reasoning כתוב בעברית משפט אחד: מה שינית ולמה, או למה לא שינית. ' +
        'ענה באותו מבנה JSON בדיוק.';

      return request(account, system, text).then(function (answer) {
        var parsed = parseAnswer(answer);
        return plausible(parsed) ? parsed : mine;
      }).catch(function () { return mine; });
    };

    return both.then(function (answers) {
      var lean = answers[0];
      var rich = answers[1];

      var gap = Math.abs(num(lean.kcal) - num(rich.kcal));
      var mean = (num(lean.kcal) + num(rich.kcal)) / 2;
      var share = mean ? gap / mean : 0;

      // כששניהם כבר מסכימים אין על מה להתווכח
      if (share < 0.12) {
        stage('שני המעריכים קרובים; אין צורך בוויכוח');
        return { lean: lean, rich: rich, first: null };
      }

      stage('הפער ' + Math.round(share * 100) + '% — כל מעריך רואה את השני ומגיב');

      var rebuttals = shared
        ? rebut(leanAccount, LEAN, lean, rich).then(function (l) {
            return rebut(richAccount, RICH, rich, lean).then(function (r) { return [l, r]; });
          })
        : Promise.all([
            rebut(leanAccount, LEAN, lean, rich),
            rebut(richAccount, RICH, rich, lean)
          ]);

      return rebuttals.then(function (revised) {
        return { lean: revised[0], rich: revised[1], first: { lean: lean, rich: rich } };
      });
    }).then(function (state) {
      stage('משווה בין ההערכות');
      var lean = state.lean;
      var rich = state.rich;

      // כמה כל צד זז אחרי ששמע את השני
      var movement = state.first ? {
        lean: num(lean.kcal) - num(state.first.lean.kcal),
        rich: num(rich.kcal) - num(state.first.rich.kcal)
      } : null;

      return {
        lean: lean,
        rich: rich,
        firstRound: state.first,
        movement: movement,
        shared: sharedItems(lean, rich),
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
    plausible: plausible,
    sameFood: sameFood,
    sharedItems: sharedItems,
    readImage: readImage,
    parseAnswer: parseAnswer,
    reconcile: reconcile,
    itemDifferences: itemDifferences,
    SUM_FIELDS: SUM_FIELDS
  };
})(typeof window !== 'undefined' ? window : globalThis);
