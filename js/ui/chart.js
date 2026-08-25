/**
 * Chart — מנוע גרפים קטן מבוסס SVG, בלי ספריות חיצוניות.
 * נתמכים: קו, נקודות, עמודות, ורצועת אי־ודאות.
 * הגרפים נמדדים מחדש כשגודל החלון משתנה.
 */
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var mounted = [];

  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  function extent(values) {
    var lo = Infinity, hi = -Infinity;
    values.forEach(function (v) {
      if (typeof v !== 'number' || !isFinite(v)) return;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    });
    return isFinite(lo) ? [lo, hi] : null;
  }

  function niceTicks(lo, hi, count) {
    if (lo === hi) { lo -= 1; hi += 1; }
    var raw = (hi - lo) / Math.max(count, 1);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
    var ticks = [];
    for (var t = Math.ceil(lo / step) * step; t <= hi + step * 0.001; t += step) {
      ticks.push(Math.round(t / step) * step);
    }
    return ticks;
  }

  function draw(container, config) {
    var width = Math.max(container.clientWidth || 0, 260);
    var height = config.height || 190;
    // left מספיק רחב כדי שתווית התאריך הראשונה לא תיחתך בקצה
    var pad = { top: 12, right: 46, bottom: 22, left: 18 };
    var innerW = width - pad.left - pad.right;
    var innerH = height - pad.top - pad.bottom;

    var allX = [], allY = [];
    (config.series || []).forEach(function (s) {
      (s.points || []).forEach(function (p) {
        allX.push(p.x);
        if (s.type === 'band') { allY.push(p.lo); allY.push(p.hi); }
        else allY.push(p.y);
      });
    });

    var xEx = extent(allX);
    var yEx = extent(allY);
    container.innerHTML = '';
    if (!xEx || !yEx) return;

    if (config.yDomain) yEx = config.yDomain.slice();
    var yPadding = (yEx[1] - yEx[0]) * 0.12 || 1;
    var yLo = config.yDomain ? yEx[0] : yEx[0] - yPadding;
    var yHi = config.yDomain ? yEx[1] : yEx[1] + yPadding;
    if (yLo === yHi) { yLo -= 1; yHi += 1; }

    var xSpan = xEx[1] - xEx[0] || 1;
    function sx(x) { return pad.left + ((x - xEx[0]) / xSpan) * innerW; }
    function sy(y) { return pad.top + innerH - ((y - yLo) / (yHi - yLo)) * innerH; }

    var svg = el('svg', {
      viewBox: '0 0 ' + width + ' ' + height,
      width: width,
      height: height,
      role: 'img',
      'aria-label': config.label || 'גרף'
    });

    // רשת וסימוני ציר Y (בצד ימין, בהתאם לכיוון הקריאה)
    niceTicks(yLo, yHi, config.yTicks || 4).forEach(function (t) {
      if (t < yLo || t > yHi) return;
      var y = sy(t);
      svg.appendChild(el('line', { x1: pad.left, x2: pad.left + innerW, y1: y, y2: y, class: 'grid-line' }));
      var label = el('text', { x: pad.left + innerW + 6, y: y + 3.5, class: 'axis-label' });
      label.textContent = config.formatTick ? config.formatTick(t) : String(Math.round(t * 100) / 100);
      svg.appendChild(label);
    });

    (config.series || []).forEach(function (s) {
      var points = (s.points || []).filter(function (p) {
        return isFinite(p.x) && (s.type === 'band' ? isFinite(p.lo) && isFinite(p.hi) : isFinite(p.y));
      });
      if (!points.length) return;

      if (s.type === 'band') {
        var top = points.map(function (p) { return sx(p.x) + ',' + sy(p.hi); });
        var bottom = points.slice().reverse().map(function (p) { return sx(p.x) + ',' + sy(p.lo); });
        svg.appendChild(el('polygon', {
          points: top.concat(bottom).join(' '),
          fill: s.color,
          stroke: 'none'
        }));
        return;
      }

      if (s.type === 'bars') {
        var slot = innerW / Math.max(points.length, 1);
        var barWidth = Math.max(Math.min(slot * 0.66, 22), 2);
        var baseline = sy(Math.max(yLo, 0));
        points.forEach(function (p) {
          var y = sy(p.y);
          svg.appendChild(el('rect', {
            x: sx(p.x) - barWidth / 2,
            y: Math.min(y, baseline),
            width: barWidth,
            height: Math.max(Math.abs(baseline - y), 1),
            fill: p.color || s.color,
            opacity: s.opacity || 1,
            rx: 1
          }));
        });
        return;
      }

      if (s.type === 'dots') {
        points.forEach(function (p) {
          svg.appendChild(el('circle', {
            cx: sx(p.x), cy: sy(p.y), r: s.radius || 2.5,
            fill: s.color, opacity: s.opacity === undefined ? 0.75 : s.opacity
          }));
        });
        return;
      }

      // ברירת מחדל: קו. פערים בנתונים שוברים את הקו במקום לגשר עליהם.
      var d = '';
      var pen = false;
      points.forEach(function (p) {
        if (p.y === null || !isFinite(p.y)) { pen = false; return; }
        d += (pen ? 'L' : 'M') + sx(p.x) + ' ' + sy(p.y) + ' ';
        pen = true;
      });
      svg.appendChild(el('path', {
        d: d.trim(),
        fill: 'none',
        stroke: s.color,
        'stroke-width': s.width || 2,
        'stroke-dasharray': s.dash || 'none',
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
        opacity: s.opacity === undefined ? 1 : s.opacity
      }));
    });

    // סימוני ציר X: התחלה, אמצע וסוף בלבד — יותר מזה רק מרעיש
    if (config.formatX) {
      [xEx[0], Math.round((xEx[0] + xEx[1]) / 2), xEx[1]].forEach(function (x, i) {
        var label = el('text', {
          x: sx(x),
          y: height - 6,
          class: 'axis-label',
          'text-anchor': i === 0 ? 'start' : i === 2 ? 'end' : 'middle'
        });
        label.textContent = config.formatX(x);
        svg.appendChild(label);
      });
    }

    var cursor = el('line', { class: 'cursor-line', y1: pad.top, y2: pad.top + innerH, x1: -10, x2: -10 });
    svg.appendChild(cursor);
    container.appendChild(svg);

    // קריאה בהצבעה: מעדכן כיתוב מתחת לגרף במקום בועית מרחפת,
    // שנוטה להישבר במגע במסכי טלפון.
    if (config.onHover && config.captionEl) {
      var caption = config.captionEl;
      var idle = config.idleCaption || '';
      caption.textContent = idle;

      var handle = function (event) {
        // מונע גלילה, בחירת טקסט ותפריט הקשר בזמן מעבר על הגרף
        if (event.cancelable) event.preventDefault();
        var rect = svg.getBoundingClientRect();
        var ratio = width / rect.width;
        var point = event.touches && event.touches.length ? event.touches[0] : event;
        if (point.clientX === undefined) return;
        var localX = (point.clientX - rect.left) * ratio;
        var value = xEx[0] + ((localX - pad.left) / innerW) * xSpan;
        var x = Math.round(Math.min(Math.max(value, xEx[0]), xEx[1]));
        cursor.setAttribute('x1', sx(x));
        cursor.setAttribute('x2', sx(x));
        caption.textContent = config.onHover(x) || idle;
      };

      svg.addEventListener('pointermove', handle, { passive: false });
      svg.addEventListener('pointerdown', handle, { passive: false });
      svg.addEventListener('touchstart', handle, { passive: false });
      svg.addEventListener('touchmove', handle, { passive: false });
      svg.addEventListener('contextmenu', function (event) { event.preventDefault(); });
      svg.addEventListener('pointerleave', function () {
        cursor.setAttribute('x1', -10);
        cursor.setAttribute('x2', -10);
        caption.textContent = idle;
      });
    }
  }

  function render(container, config) {
    if (!container) return;
    var record = mounted.find(function (m) { return m.container === container; });
    if (record) record.config = config;
    else mounted.push({ container: container, config: config });
    draw(container, config);
  }

  /** מנקה גרפים שכבר לא נמצאים ב-DOM, כדי שלא ייווצר דלף */
  function sweep() {
    mounted = mounted.filter(function (m) { return document.body.contains(m.container); });
  }

  var resizeTimer = null;
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        sweep();
        mounted.forEach(function (m) { draw(m.container, m.config); });
      }, 150);
    });
  }

  root.Chart = { render: render, sweep: sweep };
})(typeof window !== 'undefined' ? window : globalThis);
