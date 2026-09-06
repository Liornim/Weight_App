/**
 * Estimate — הערכת ארוחה מתמונה, בוויכוח בין שני מעריכים.
 *
 * למה ויכוח ולא הערכה אחת: השגיאה הגדולה בהערכת ארוחה מתמונה היא
 * הכמות, לא הזיהוי. מעריך יחיד נועל את עצמו על ניחוש ראשון ומצדיק
 * אותו. שני מעריכים עם הטיות מנוגדות — אחד שמניח מנות קטנות ומעט
 * שמן, אחד שמניח את ההפך — חושפים בדיוק את ההנחות שהן מקור השגיאה,
 * ואז סיבוב שלישי מכריע ביניהם.
 *
 * המפתח נשמר במכשיר בלבד ואינו נשלח לשום מקום מלבד ה-API.
 */
(function (root) {
  'use strict';

  var MODEL = 'claude-sonnet-4-6';
  var API = 'https://api.anthropic.com/v1/messages';

  var SHARED = 'אתה מעריך תזונה. מולך תמונה של ארוחה. ' +
    'ענה בעברית ובפורמט JSON בלבד, בלי טקסט לפני או אחרי ובלי סימני קוד. ' +
    'המבנה: {"items":[{"name":"","grams":0,"kcal":0,"protein":0,"carbs":0,"fat":0,' +
    '"confidence":"high|medium|low","note":""}],' +
    '"kcal":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"reasoning":""}. ' +
    'שדות הסיכום הם הסכום של הפריטים. ' +
    'ב-reasoning כתוב שתיים־שלוש שורות: על מה התבססת בהערכת הכמות, ומה לא ברור.';

  var LEAN = SHARED + '\n\nהעמדה שלך: מנות נראות גדולות יותר משהן. ' +
    'הנח מנות בגודל סטנדרטי, שמן מועט בבישול, ואל תוסיף קלוריות שאינך רואה. ' +
    'אם אתה מתלבט בין שתי כמויות, בחר בנמוכה.';

  var RICH = SHARED + '\n\nהעמדה שלך: הקלוריות הנסתרות הן העיקר. ' +
    'שמן בישול, רטבים, חמאה וסוכר מוסף כמעט תמיד נשכחים, וכף שמן אחת היא 120 קלוריות. ' +
    'אם אתה מתלבט בין שתי כמויות, בחר בגבוהה.';

  var JUDGE = 'שני מעריכים בחנו את אותה תמונה והגיעו למספרים שונים. ' +
    'תפקידך להכריע. אל תיקח ממוצע אוטומטי — בדוק היכן כל אחד מהם מדויק יותר, ' +
    'והסבר במפורש איזו הנחה הכריעה. ' +
    'ענה באותו מבנה JSON, והוסף שדה "range":{"low":0,"high":0} עם טווח הקלוריות הסביר, ' +
    'ושדה "verdict" בעברית: משפט אחד שאומר במה הם נחלקו ומה הכרעת.';

  /** מוציא JSON מתשובה שעשויה לכלול טקסט או סימני קוד */
  function parseAnswer(text) {
    if (!text) return null;
    var clean = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
    var start = clean.indexOf('{');
    var end = clean.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(clean.slice(start, end + 1));
    } catch (error) {
      return null;
    }
  }

  /** מאחד את בלוקי הטקסט שהמודל מחזיר */
  function textOf(payload) {
    if (!payload || !payload.content) return '';
    return payload.content
      .filter(function (block) { return block.type === 'text'; })
      .map(function (block) { return block.text; })
      .join('\n');
  }

  function call(key, messages, system) {
    // דרך root ולא כמשתנה חופשי, כדי שאפשר יהיה להחליף אותו בבדיקות
    return root.fetch(API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1400,
        system: system,
        messages: messages
      })
    }).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (body) {
          throw new Error('שגיאה מהשרת (' + response.status + '): ' + body.slice(0, 160));
        });
      }
      return response.json();
    });
  }

  function imageMessage(base64, mediaType, extra) {
    return {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: extra || 'הערך את הארוחה בתמונה.' }
      ]
    };
  }

  /**
   * שלושה סיבובים: שתי הערכות עצמאיות, סיבוב תגובה שבו כל צד רואה
   * את השני, והכרעה. onStage מדווח על ההתקדמות כדי שהמסך יראה מה קורה.
   */
  function debate(key, base64, mediaType, onStage) {
    var stage = onStage || function () {};
    var result = { rounds: [] };

    stage('שולח את התמונה לשני המעריכים');

    return Promise.all([
      call(key, [imageMessage(base64, mediaType)], LEAN),
      call(key, [imageMessage(base64, mediaType)], RICH)
    ]).then(function (answers) {
      var lean = parseAnswer(textOf(answers[0]));
      var rich = parseAnswer(textOf(answers[1]));
      if (!lean || !rich) throw new Error('אחד המעריכים החזיר תשובה שלא ניתן לקרוא');

      result.rounds.push({ name: 'מעריך א׳ — שמרן', data: lean });
      result.rounds.push({ name: 'מעריך ב׳ — מחמיר', data: rich });

      var gap = Math.abs(lean.kcal - rich.kcal);
      var mean = (lean.kcal + rich.kcal) / 2;
      result.initialGap = gap;
      result.initialGapShare = mean ? gap / mean : 0;

      // כשהשניים כבר מסכימים, סיבוב תגובה לא יוסיף מידע
      if (result.initialGapShare < 0.12) {
        stage('שני המעריכים כבר קרובים; עובר להכרעה');
        return { lean: lean, rich: rich, rebuttals: null };
      }

      stage('כל מעריך רואה את הערכת השני ומגיב');
      var confront = function (mine, theirs, system) {
        return call(key, [
          imageMessage(base64, mediaType),
          { role: 'assistant', content: JSON.stringify(mine) },
          { role: 'user', content: 'מעריך אחר קיבל מספרים אחרים על אותה תמונה:\n' +
            JSON.stringify(theirs) +
            '\n\nהיכן הוא צודק יותר ממך, והיכן אתה? ' +
            'עדכן את ההערכה שלך אם השתכנעת, והשאר אותה אם לא. ' +
            'ענה באותו מבנה JSON, ובשדה reasoning כתוב מה שינית ולמה.' }
        ], system);
      };

      return Promise.all([
        confront(lean, rich, LEAN),
        confront(rich, lean, RICH)
      ]).then(function (replies) {
        var leanTwo = parseAnswer(textOf(replies[0])) || lean;
        var richTwo = parseAnswer(textOf(replies[1])) || rich;
        result.rounds.push({ name: 'מעריך א׳ — אחרי התגובה', data: leanTwo });
        result.rounds.push({ name: 'מעריך ב׳ — אחרי התגובה', data: richTwo });
        return { lean: leanTwo, rich: richTwo, rebuttals: true };
      });
    }).then(function (state) {
      stage('מכריע בין השניים');
      return call(key, [
        imageMessage(base64, mediaType, 'הכרע בין שתי ההערכות הבאות.'),
        { role: 'user', content: 'מעריך א׳ (נוטה להערכה נמוכה):\n' + JSON.stringify(state.lean) +
          '\n\nמעריך ב׳ (נוטה להערכה גבוהה):\n' + JSON.stringify(state.rich) }
      ], JUDGE).then(function (answer) {
        var final = parseAnswer(textOf(answer));
        if (!final) throw new Error('ההכרעה חזרה בפורמט שלא ניתן לקרוא');
        result.final = final;
        result.rounds.push({ name: 'הכרעה', data: final });
        return result;
      });
    });
  }

  /** קורא קובץ תמונה ומחזיר base64 בלי הקידומת */
  function readImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var value = String(reader.result);
        var comma = value.indexOf(',');
        resolve({ base64: value.slice(comma + 1), mediaType: file.type || 'image/jpeg' });
      };
      reader.onerror = function () { reject(new Error('לא הצלחתי לקרוא את הקובץ')); };
      reader.readAsDataURL(file);
    });
  }

  root.Estimate = {
    debate: debate,
    readImage: readImage,
    parseAnswer: parseAnswer,
    textOf: textOf,
    MODEL: MODEL
  };
})(typeof window !== 'undefined' ? window : globalThis);
