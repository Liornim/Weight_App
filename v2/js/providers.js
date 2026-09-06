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
      test: function (key) { return /^AIza/.test(key); },
      defaultModel: 'gemini-2.0-flash',
      free: true,
      keyHint: 'aistudio.google.com/apikey'
    },
    openrouter: {
      label: 'OpenRouter',
      test: function (key) { return /^sk-or-/.test(key); },
      defaultModel: 'meta-llama/llama-3.2-90b-vision-instruct:free',
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

  function callGemini(key, model, system, image, text) {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);

    var parts = [];
    if (image) parts.push({ inline_data: { mime_type: image.mediaType, data: image.base64 } });
    parts.push({ text: text });

    return root.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: parts }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1400 }
      })
    }).then(function (response) {
      return response.text().then(function (body) {
        if (!response.ok) throw fail(response, body);
        var data = JSON.parse(body);
        var candidate = data.candidates && data.candidates[0];
        if (!candidate) throw new Error('לא חזרה תשובה מ-Gemini');
        return (candidate.content.parts || [])
          .map(function (part) { return part.text || ''; })
          .join('\n');
      });
    });
  }

  // --- OpenRouter ---

  function callOpenRouter(key, model, system, image, text) {
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
        return choice.message.content || '';
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
    return CALLS[name](request.key, model, request.system, request.image, request.text);
  }

  root.Providers = {
    ask: ask,
    detect: detect,
    label: label,
    options: options,
    PROVIDERS: PROVIDERS
  };
})(typeof window !== 'undefined' ? window : globalThis);
