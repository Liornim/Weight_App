/**
 * Providers — שכבה אחת מול כמה ספקי AI.
 *
 * לכל ספק פורמט בקשה משלו, אבל מבחינת האפליקציה כולם עושים אותו
 * דבר: מקבלים תמונה והוראה, ומחזירים טקסט. ההפרדה הזו היא שמאפשרת
 * להריץ ויכוח בין מודלים ממשפחות שונות בלי לשכפל קוד.
 *
 * הספק מזוהה מצורת המפתח, כדי שלא יהיה עוד שדה למלא.
 */
(function (root) {
  'use strict';

  var PROVIDERS = {
    gemini: {
      label: 'Gemini',
      // גוגל מנפיקה שני פורמטים: AIza הישן ו-AQ. החדש מ-AI Studio.
      // שניהם תקפים, ושניהם נשלחים באותה דרך.
      test: function (key) { return /^AIza/.test(key) || /^AQ\./.test(key); },
      defaultModel: 'gemini-2.0-flash',
      free: true,
      keyHint: 'aistudio.google.com/apikey'
    },
    openrouter: {
      label: 'OpenRouter',
      test: function (key) { return /^sk-or-/.test(key); },
      // שמות המודלים ב-OpenRouter משתנים תדיר, ולכן הרשימה נמשכת
      // בזמן אמת במקום להיקבע כאן. זו רק נקודת התחלה.
      defaultModel: 'google/gemini-2.0-flash-exp:free',
      free: true,
      keyHint: 'openrouter.ai/keys'
    },
    anthropic: {
      label: 'Anthropic',
      test: function (key) { return /^sk-ant-/.test(key); },
      defaultModel: 'claude-sonnet-4-6',
      free: false,
      keyHint: 'console.anthropic.com'
    }
  };

  /**
   * זיהוי לפי צורת המפתח, עם אפשרות לעקוף.
   *
   * הצורות משתנות מדי פעם, ומפתח תקין לגמרי עלול לא להתאים לתבנית.
   * לכן אפשר לציין ספק במפורש, ואז הזיהוי לא מנסה לנחש.
   */
  function detect(key, override) {
    if (override && PROVIDERS[override]) return override;
    var clean = String(key || '').trim();
    if (!clean) return null;
    var names = Object.keys(PROVIDERS);
    for (var i = 0; i < names.length; i++) {
      if (PROVIDERS[names[i]].test(clean)) return names[i];
    }
    return null;
  }

  function label(key, override) {
    var name = detect(key, override);
    return name ? PROVIDERS[name].label : 'לא מזוהה';
  }

  /** רשימת הספקים לבחירה ידנית */
  function options() {
    return Object.keys(PROVIDERS).map(function (name) {
      return { value: name, label: PROVIDERS[name].label, free: PROVIDERS[name].free };
    });
  }

  function fail(response, body) {
    var short = String(body || '').slice(0, 200);
    return new Error('שגיאה ' + response.status + ': ' + short);
  }

  // --- Gemini ---

  /**
   * ל-Gemini יש שלוש דרכים מתועדות להעביר מפתח, וההודעה
   * "Expected OAuth 2 access token" חוזרת כשהדרך שנבחרה לא מתאימה
   * לסוג המפתח. המפתחות הישנים (AIza) עובדים עם פרמטר בכתובת;
   * החדשים (AQ.) הם auth keys ונשלחים ככותרת Bearer.
   *
   * במקום להמר, כל דרך מנוסה בתורה עד שאחת מצליחה. הסדר נקבע לפי
   * צורת המפתח, כדי שהמקרה הנפוץ יעבוד בניסיון הראשון.
   */
  function geminiAttempts(key) {
    var viaQuery = { name: 'query', url: '?key=' + encodeURIComponent(key), headers: {} };
    var viaHeader = { name: 'x-goog-api-key', url: '', headers: { 'x-goog-api-key': key } };
    var viaBearer = { name: 'bearer', url: '', headers: { Authorization: 'Bearer ' + key } };

    return /^AQ\./.test(key)
      ? [viaBearer, viaHeader, viaQuery]
      : [viaQuery, viaHeader, viaBearer];
  }

  function isAuthProblem(error) {
    var text = String(error && error.message || '');
    return text.indexOf('401') !== -1 || text.indexOf('403') !== -1;
  }

  function callGemini(key, model, system, image, text) {
    var base = 'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) + ':generateContent';

    var parts = [];
    if (image) parts.push({ inline_data: { mime_type: image.mediaType, data: image.base64 } });
    parts.push({ text: text });

    var body = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: parts }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1400 }
    });

    var attempts = geminiAttempts(key);

    var tryAt = function (index, lastError) {
      if (index >= attempts.length) {
        throw lastError || new Error('כל דרכי ההזדהות מול Gemini נכשלו');
      }
      var attempt = attempts[index];
      var headers = { 'Content-Type': 'application/json' };
      Object.keys(attempt.headers).forEach(function (name) {
        headers[name] = attempt.headers[name];
      });

      return root.fetch(base + attempt.url, { method: 'POST', headers: headers, body: body })
        .then(function (response) {
          return response.text().then(function (raw) {
            if (!response.ok) throw fail(response, raw);
            var data = JSON.parse(raw);
            var candidate = data.candidates && data.candidates[0];
            if (!candidate) throw new Error('לא חזרה תשובה מ-Gemini');
            var answer = ((candidate.content && candidate.content.parts) || [])
              .map(function (part) { return part.text || ''; })
              .join('\n').trim();
            if (!answer) {
              throw new Error('Gemini החזיר תשובה ריקה' +
                (candidate.finishReason ? ' (סיבה: ' + candidate.finishReason + ')' : ''));
            }
            return answer;
          });
        })
        .catch(function (error) {
          // רק בעיית הזדהות מצדיקה ניסיון בדרך אחרת
          if (!isAuthProblem(error)) throw error;
          return tryAt(index + 1, error);
        });
    };

    return tryAt(0, null);
  }

  // --- OpenRouter ---

  /** האם השגיאה אומרת שהמודל עצמו לא קיים או לא זמין */
  function isMissingModel(error) {
    var text = String(error && error.message || '');
    return text.indexOf('404') !== -1 ||
      text.indexOf('No endpoints found') !== -1 ||
      text.indexOf('not a valid model') !== -1;
  }

  function callOpenRouterOnce(key, model, system, image, text) {
    var content = [];
    if (image) {
      content.push({
        type: 'image_url',
        image_url: { url: 'data:' + image.mediaType + ';base64,' + image.base64 }
      });
    }
    content.push({ type: 'text', text: text });

    return root.fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key
      },
      body: JSON.stringify({
        model: model,
        temperature: 0.2,
        max_tokens: 1400,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: content }
        ]
      })
    }).then(function (response) {
      return response.text().then(function (body) {
        if (!response.ok) throw fail(response, body);
        var data = JSON.parse(body);
        var choice = data.choices && data.choices[0];
        if (!choice) throw new Error('לא חזרה תשובה מ-OpenRouter');

        // התוכן מגיע לפעמים כמחרוזת, לפעמים כמערך בלוקים, ולפעמים
        // המודל שם את התשובה בשדה reasoning במקום ב-content
        var message = choice.message || {};
        var content = message.content;

        if (Array.isArray(content)) {
          content = content.map(function (block) {
            return typeof block === 'string' ? block : (block.text || '');
          }).join('\n');
        }

        var answer = String(content || '').trim() || String(message.reasoning || '').trim();

        if (!answer) {
          throw new Error('המודל החזיר תשובה ריקה' +
            (choice.finish_reason ? ' (סיבה: ' + choice.finish_reason + ')' : '') +
            '. מודל חינמי עמוס או שאינו קורא תמונות מחזיר לרוב תשובה ריקה.');
        }
        return answer;
      });
    });
  }

  // --- Anthropic ---

  function callAnthropic(key, model, system, image, text) {
    var content = [];
    if (image) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: image.mediaType, data: image.base64 }
      });
    }
    content.push({ type: 'text', text: text });

    return root.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 1400,
        system: system,
        messages: [{ role: 'user', content: content }]
      })
    }).then(function (response) {
      return response.text().then(function (body) {
        if (!response.ok) throw fail(response, body);
        var data = JSON.parse(body);
        return (data.content || [])
          .filter(function (block) { return block.type === 'text'; })
          .map(function (block) { return block.text; })
          .join('\n');
      });
    });
  }

  /**
   * OpenRouter עם ריפוי עצמי.
   *
   * שמות המודלים שם משתנים ונעלמים, ולכן מודל שנשמר אתמול עלול
   * להחזיר 404 היום. במקום להעיף שגיאה למשתמש, המערכת מושכת את
   * רשימת המודלים החינמיים שקוראים תמונות ומנסה שוב עם הראשון
   * שעובד. המודל שנבחר מוחזר, כדי שאפשר יהיה לשמור אותו.
   */
  function callOpenRouter(key, model, system, image, text, onModelPicked, validate) {
    var attempt = function (name) {
      return callOpenRouterOnce(key, name, system, image, text)
        .then(function (answer) {
          // מודל שעונה אבל התשובה שלו חסרת ערך נחשב לא מתאים,
          // בדיוק כמו מודל שלא קיים
          if (validate && !validate(answer)) {
            var error = new Error('המודל ' + name + ' החזיר תשובה שאינה שמישה');
            error.unusable = true;
            throw error;
          }
          if (onModelPicked) onModelPicked(name);
          return answer;
        });
    };

    return attempt(model).catch(function (error) {
      if (!isMissingModel(error) && !error.unusable) throw error;

      return freeVisionModels().then(function (models) {
        if (!models.length) {
          throw new Error('המודל שנבחר אינו זמין, ולא נמצא מודל חינמי חלופי ' +
            'שקורא תמונות. אפשר להמשיך עם מפתח אחד בלבד.');
        }

        // מנסים אחד אחרי השני; חלקם מדווחים כזמינים ובכל זאת נופלים
        var tryNext = function (index) {
          if (index >= models.length) {
            throw new Error('אף אחד מהמודלים החינמיים לא הצליח להעריך את התמונה. ' +
              'אפשר למחוק את מפתח OpenRouter ולהמשיך עם מפתח אחד בלבד.');
          }
          if (models[index].id === model) return tryNext(index + 1);
          return attempt(models[index].id).catch(function (nextError) {
            if (!isMissingModel(nextError) && !nextError.unusable) throw nextError;
            return tryNext(index + 1);
          });
        };

        return tryNext(0);
      });
    });
  }

  var CALLS = {
    gemini: callGemini,
    openrouter: callOpenRouter,
    anthropic: callAnthropic
  };

  /**
   * ask({key, model, system, image, text}) -> Promise<string>
   * image הוא {base64, mediaType} או null.
   */
  function ask(request) {
    var name = detect(request.key, request.provider);
    if (!name) {
      return Promise.reject(new Error(
        'המפתח לא מזוהה. אפשר לבחור את הספק ידנית בהגדרות.'));
    }

    var model = request.model || PROVIDERS[name].defaultModel;
    return CALLS[name](request.key, model, request.system, request.image,
      request.text, request.onModelPicked, request.validate);
  }

  /**
   * רשימת המודלים החינמיים שקוראים תמונות, ישירות מ-OpenRouter.
   *
   * שמות המודלים שם משתנים ונעלמים, וברירת מחדל קבועה בקוד מתיישנת
   * ונותנת 404. עדיף למשוך את הרשימה ולתת לבחור ממנה.
   */
  function freeVisionModels() {
    return root.fetch('https://openrouter.ai/api/v1/models')
      .then(function (response) {
        return response.text().then(function (body) {
          if (!response.ok) throw fail(response, body);
          var data = JSON.parse(body);
          var models = (data && data.data) || [];

          return models.filter(function (model) {
            var pricing = model.pricing || {};
            var isFree = Number(pricing.prompt) === 0 && Number(pricing.completion) === 0;
            var input = (model.architecture && model.architecture.input_modalities) || [];
            var readsImages = input.indexOf('image') !== -1;
            return isFree && readsImages;
          }).map(function (model) {
            return { id: model.id, name: model.name || model.id };
          }).sort(function (a, b) { return a.name.localeCompare(b.name); });
        });
      });
  }

  root.Providers = {
    ask: ask,
    freeVisionModels: freeVisionModels,
    detect: detect,
    label: label,
    options: options,
    PROVIDERS: PROVIDERS
  };
})(typeof window !== 'undefined' ? window : globalThis);
