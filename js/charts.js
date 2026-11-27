/* ============================================================
   charts.js — 零依赖原生 Canvas 可视化模块
   提供：组合柱线图 / 折线面积图 / 进度环 / 环形分布 / 半圆仪表 /
        横向条形 / 迷你趋势线。全部支持高分屏与大屏整体缩放。
   ============================================================ */
(function () {
  'use strict';
  var MFG = window.MFG;
  var U = MFG.U, P = MFG.CONFIG.PALETTE;
  var FONT = '"Segoe UI","Microsoft YaHei",sans-serif';
  var scaleFactor = 1;

  function setScale(s) { scaleFactor = s || 1; }

  function fit(canvas) {
    if (!canvas) return null;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) {
      var p = canvas.parentElement;
      w = p ? p.clientWidth : 0; h = p ? p.clientHeight : 0;
    }
    if (w < 12 || h < 12) return null;
    var dpr = Math.min(2.5, (window.devicePixelRatio || 1) * scaleFactor);
    var pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function txt(ctx, s, x, y, color, size, align, bold) {
    ctx.fillStyle = color || P.text;
    ctx.font = (bold ? '600 ' : '') + (size || 11) + 'px ' + FONT;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(s), x, y);
  }
  function roundRect(ctx, x, y, w, h, r) {
    if (h <= 0 || w <= 0) return;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  function dashLine(ctx, x1, y1, x2, y2, color, width, dash) {
    ctx.save(); ctx.setLineDash(dash || [4, 4]);
    ctx.strokeStyle = color; ctx.lineWidth = width || 1;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }
  function maxOf(arr) { return arr.length ? Math.max.apply(null, arr) : 0; }
  function grad(ctx, x0, y0, x1, y1, c0, c1) {
    var g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, c0); g.addColorStop(1, c1); return g;
  }
  function hexA(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  // ---------------------------------------------------------- Tooltip
  function showTip(html, ev) {
    var tip = document.getElementById('chart-tooltip');
    if (!tip) return;
    tip.innerHTML = html;
    tip.style.display = 'block';
    var x = ev.clientX + 16, y = ev.clientY - 8;
    if (x + 190 > window.innerWidth) x = ev.clientX - 190;
    if (y + 110 > window.innerHeight) y = window.innerHeight - 116;
    tip.style.left = Math.max(6, x) + 'px';
    tip.style.top = Math.max(6, y) + 'px';
  }
  function hideTip() {
    var tip = document.getElementById('chart-tooltip');
    if (tip) tip.style.display = 'none';
  }

  // 通用 hover 命中：把鼠标位置换算为设计坐标，再定位数据点
  function bindHover(canvas, meta, cb) {
    if (canvas._hoverBound) return;
    canvas._hoverBound = true;
    canvas.addEventListener('mousemove', function (ev) {
      var m = canvas._chartMeta;
      if (!m || !m.n) return;
      var rect = canvas.getBoundingClientRect();
      var k = rect.width / m.w;
      var x = (ev.clientX - rect.left) / (k || 1);
      var idx = Math.floor((x - m.pad.l) / m.slot);
      if (idx < 0 || idx >= m.n) { hideTip(); cb(-1, ev); return; }
      cb(idx, ev);
    });
    canvas.addEventListener('mouseleave', function (ev) { hideTip(); cb(-1, ev); });
  }

  // ============================================================ 组合图（柱 + 折线双轴）
  function combo(canvas, o) {
    var f = fit(canvas); if (!f) return;
    var ctx = f.ctx, W = f.w, H = f.h;
    var pad = { l: 44, r: 42, t: 16, b: 24 };
    var pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    if (pw < 60 || ph < 30) return;
    var labels = o.labels || [], bars = o.bars || [], plans = o.plan || [], rate = o.line || [];
    var n = labels.length; if (!n) return;
    var leftMax = U.niceCeil(Math.max(1, maxOf(bars.concat(plans)) * 1.15));
    var rMin = o.rightMin === undefined ? 60 : o.rightMin;
    var rMax = o.rightMax === undefined ? 130 : o.rightMax;
    var slot = pw / n;

    // 网格与左右轴
    for (var g = 0; g <= 4; g++) {
      var gy = pad.t + ph * g / 4;
      dashLine(ctx, pad.l, gy, pad.l + pw, gy, P.grid, 1, [3, 4]);
      txt(ctx, Math.round(leftMax * (1 - g / 4)), pad.l - 8, gy, P.text, 10, 'right');
      txt(ctx, Math.round(rMax - (rMax - rMin) * g / 4) + '%', pad.l + pw + 8, gy, P.text, 10, 'left');
    }
    // 100% 达成基准线
    if (100 > rMin && 100 < rMax) {
      var y100 = pad.t + ph - (100 - rMin) / (rMax - rMin) * ph;
      dashLine(ctx, pad.l, y100, pad.l + pw, y100, hexA(P.green, .55), 1.2, [6, 5]);
      txt(ctx, '目标 100%', pad.l + pw - 4, y100 - 8, hexA(P.green, .8), 9.5, 'right');
    }

    // 柱：计划（半透明） / 实际（高亮渐变）
    var bw = Math.max(2, Math.min(15, slot * 0.32));
    for (var i = 0; i < n; i++) {
      var cx = pad.l + slot * i + slot / 2;
      var ph1 = Math.max(1, (plans[i] || 0) / leftMax * ph);
      var bh = Math.max(1, (bars[i] || 0) / leftMax * ph);
      ctx.fillStyle = hexA(P.blue, .26);
      roundRect(ctx, cx - bw - 1, pad.t + ph - ph1, bw, ph1, 2); ctx.fill();
      ctx.fillStyle = grad(ctx, 0, pad.t + ph - bh, 0, pad.t + ph, hexA(P.cyan, .45), P.cyan);
      roundRect(ctx, cx + 1, pad.t + ph - bh, bw, bh, 2); ctx.fill();
      ctx.fillStyle = hexA('#ffffff', .55);
      ctx.fillRect(cx + 1, pad.t + ph - bh, bw, 1.4);
    }

    // 折线：累计达成率
    ctx.save();
    ctx.strokeStyle = P.amber; ctx.lineWidth = 2.2;
    ctx.shadowColor = hexA(P.amber, .55); ctx.shadowBlur = 8;
    ctx.beginPath();
    for (var j = 0; j < rate.length; j++) {
      var v = U.clamp(rate[j] || 0, rMin, rMax);
      var px = pad.l + slot * j + slot / 2;
      var py = pad.t + ph - (v - rMin) / (rMax - rMin) * ph;
      if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke(); ctx.restore();
    if (rate.length) {
      var lastV = U.clamp(rate[rate.length - 1] || 0, rMin, rMax);
      var lx = pad.l + slot * (rate.length - 1) + slot / 2;
      var ly = pad.t + ph - (lastV - rMin) / (rMax - rMin) * ph;
      ctx.fillStyle = P.amber; ctx.beginPath(); ctx.arc(lx, ly, 3.6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = hexA(P.amber, .35); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(lx, ly, 7, 0, Math.PI * 2); ctx.stroke();
    }

    // X 轴时间标签
    var labelStep = Math.max(1, Math.ceil(n / 9));
    for (var k = 0; k < n; k += labelStep) {
      txt(ctx, labels[k], pad.l + slot * k + slot / 2, H - 9, P.text, 10, 'center');
    }

    // 悬浮高亮
    if (o.hoverIdx >= 0 && o.hoverIdx < n) {
      var hx = pad.l + slot * o.hoverIdx + slot / 2;
      dashLine(ctx, hx, pad.t, hx, pad.t + ph, hexA(P.cyan, .45), 1, [3, 3]);
      ctx.fillStyle = hexA(P.cyan, .07);
      ctx.fillRect(pad.l + slot * o.hoverIdx, pad.t, slot, ph);
    }

    canvas._chartMeta = { pad: pad, slot: slot, n: n, w: W, h: H };
    bindHover(canvas, null, function (idx, ev) {
      if (idx < 0) { if (canvas._chartOpts) combo(canvas, Object.assign({}, canvas._chartOpts, { hoverIdx: -1 })); return; }
      showTip(
        '<div class="tt-title">' + U.esc(labels[idx]) + ' · 采样点 ' + (idx + 1) + '</div>' +
        '<div class="tt-row"><span><i style="background:' + P.cyan + '"></i>实际产量</span><b>' + U.fmtNum(bars[idx] || 0) + ' 件</b></div>' +
        '<div class="tt-row"><span><i style="background:' + hexA(P.blue, .6) + '"></i>计划产量</span><b>' + U.fmtNum(plans[idx] || 0) + ' 件</b></div>' +
        '<div class="tt-row"><span><i style="background:' + P.amber + '"></i>累计达成</span><b>' + U.fmtFixed(rate[idx] || 0, 1) + '%</b></div>', ev);
      if (canvas._chartOpts) combo(canvas, Object.assign({}, canvas._chartOpts, { hoverIdx: idx }));
    });
    canvas._chartOpts = o;
  }

  // ============================================================ 折线面积图（良率趋势）
  function line(canvas, o) {
    var f = fit(canvas); if (!f) return;
    var ctx = f.ctx, W = f.w, H = f.h;
    var pad = { l: 38, r: 10, t: 14, b: 20 };
    var pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    if (pw < 30 || ph < 24) return;
    var data = o.data || [], labels = o.labels || [], n = data.length;
    if (!n) return;
    var lo = o.min === undefined ? Math.max(0, Math.floor(Math.min.apply(null, data) - 1.5)) : o.min;
    var hi = o.max === undefined ? Math.min(100, Math.ceil(Math.max.apply(null, data) + 1.5)) : o.max;
    if (hi <= lo) hi = lo + 1;
    var color = o.color || P.green;
    var X = function (i) { return pad.l + (n === 1 ? pw / 2 : pw * i / (n - 1)); };
    var Y = function (v) { return pad.t + ph - (U.clamp(v, lo, hi) - lo) / (hi - lo) * ph; };

    for (var g = 0; g <= 3; g++) {
      var gy = pad.t + ph * g / 3;
      dashLine(ctx, pad.l, gy, pad.l + pw, gy, P.grid, 1, [3, 4]);
      txt(ctx, U.fmtFixed(hi - (hi - lo) * g / 3, 1), pad.l - 6, gy, P.text, 9.5, 'right');
    }
    if (o.threshold !== undefined && o.threshold > lo && o.threshold < hi) {
      var ty = Y(o.threshold);
      dashLine(ctx, pad.l, ty, pad.l + pw, ty, hexA(P.amber, .55), 1.1, [5, 4]);
      txt(ctx, '管控线 ' + o.threshold, pad.l + pw - 2, ty - 8, hexA(P.amber, .85), 9, 'right');
    }
    // 面积
    ctx.beginPath(); ctx.moveTo(X(0), pad.t + ph);
    for (var a = 0; a < n; a++) ctx.lineTo(X(a), Y(data[a]));
    ctx.lineTo(X(n - 1), pad.t + ph); ctx.closePath();
    ctx.fillStyle = grad(ctx, 0, pad.t, 0, pad.t + ph, hexA(color, .30), hexA(color, .01));
    ctx.fill();
    // 折线
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.shadowColor = hexA(color, .5); ctx.shadowBlur = 7;
    ctx.beginPath();
    for (var b = 0; b < n; b++) { if (b === 0) ctx.moveTo(X(b), Y(data[b])); else ctx.lineTo(X(b), Y(data[b])); }
    ctx.stroke(); ctx.restore();
    // 末点
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(n - 1), Y(data[n - 1]), 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = hexA(color, .35); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(X(n - 1), Y(data[n - 1]), 7, 0, Math.PI * 2); ctx.stroke();
    var step = Math.max(1, Math.ceil(n / 4));
    for (var k = 0; k < n; k += step) txt(ctx, labels[k] || '', X(k), H - 8, P.text, 9.5, 'center');
  }

  // ============================================================ 进度环（生产总览）
  function progressRing(canvas, o) {
    var f = fit(canvas); if (!f) return;
    var ctx = f.ctx, W = f.w, H = f.h;
    var cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 16;
    if (r < 12) return;
    var value = U.clamp((o.value || 0) / (o.max || 100), 0, 1);
    var color = o.color || P.cyan;
    // 外圈刻度
    for (var i = 0; i < 60; i++) {
      var ang = -Math.PI / 2 + i * Math.PI * 2 / 60;
      var r1 = r + 6, r2 = r + (i % 5 === 0 ? 12 : 9);
      ctx.strokeStyle = i / 60 <= value ? hexA(color, .75) : 'rgba(90,150,200,.22)';
      ctx.lineWidth = i % 5 === 0 ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
      ctx.stroke();
    }
    // 轨道
    ctx.lineWidth = 13; ctx.strokeStyle = 'rgba(61,220,255,.10)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    // 进度
    if (value > 0.001) {
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineWidth = 13;
      ctx.strokeStyle = grad(ctx, 0, 0, W, H, P.blue, color);
      ctx.shadowColor = hexA(color, .6); ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * value); ctx.stroke();
      ctx.restore();
    }
    // 内圈装饰
    ctx.strokeStyle = 'rgba(61,220,255,.12)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r - 15, 0, Math.PI * 2); ctx.stroke();
  }

  // ============================================================ 环形状态分布
  function donut(canvas, o) {
    var f = fit(canvas); if (!f) return;
    var ctx = f.ctx, W = f.w, H = f.h;
    var cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 12;
    if (r < 12) return;
    var segs = (o.segments || []).filter(function (s) { return s.value > 0; });
    var total = segs.reduce(function (a, s) { return a + s.value; }, 0);
    var thickness = o.thickness || Math.max(8, r * 0.30);
    ctx.lineWidth = thickness; ctx.strokeStyle = 'rgba(61,220,255,.08)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    if (!total) return;
    var start = -Math.PI / 2;
    segs.forEach(function (s) {
      var sweep = s.value / total * Math.PI * 2;
      var gap = Math.min(0.045, sweep * 0.12);
      ctx.save();
      ctx.lineCap = 'butt'; ctx.lineWidth = thickness;
      ctx.strokeStyle = s.color;
      ctx.shadowColor = hexA(s.color, .45); ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(cx, cy, r, start + gap, start + sweep - gap); ctx.stroke();
      ctx.restore();
      start += sweep;
    });
    // 内圈细环
    ctx.strokeStyle = 'rgba(61,220,255,.14)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r - thickness / 2 - 5, 0, Math.PI * 2); ctx.stroke();
  }

  // ============================================================ 半圆仪表盘
  function gauge(canvas, o) {
    var f = fit(canvas); if (!f) return;
    var ctx = f.ctx, W = f.w, H = f.h;
    var cx = W / 2, cy = H * 0.74, r = Math.min(W / 2 - 14, H * 0.70) - 8;
    if (r < 20) return;
    var A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;
    var value = U.clamp(o.value || 0, 0, o.max || 100);
    var ratio = value / (o.max || 100);
    var color = o.color || P.cyan;
    // 刻度
    for (var i = 0; i <= 10; i++) {
      var a = A0 + (A1 - A0) * i / 10;
      var r1 = r + 9, r2 = r + (i % 5 === 0 ? 16 : 13);
      ctx.strokeStyle = a <= A0 + (A1 - A0) * ratio ? hexA(color, .7) : 'rgba(110,160,205,.28)';
      ctx.lineWidth = i % 5 === 0 ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
    }
    // 底弧
    ctx.lineCap = 'round'; ctx.lineWidth = 13;
    ctx.strokeStyle = 'rgba(61,220,255,.11)';
    ctx.beginPath(); ctx.arc(cx, cy, r, A0, A1); ctx.stroke();
    // 进度弧
    if (ratio > 0.001) {
      ctx.save();
      ctx.shadowColor = hexA(color, .6); ctx.shadowBlur = 12;
      ctx.strokeStyle = grad(ctx, cx - r, cy, cx + r, cy, P.blue, color);
      ctx.beginPath(); ctx.arc(cx, cy, r, A0, A0 + (A1 - A0) * ratio); ctx.stroke();
      ctx.restore();
    }
    // 中心数值
    txt(ctx, U.fmtFixed(value, 1), cx, cy - r * 0.32, color, Math.max(20, Math.min(34, W * 0.16)), 'center', true);
    txt(ctx, '%', cx + W * 0.095, cy - r * 0.32 + 8, P.text, 12, 'left');
    txt(ctx, o.label || '设备运行率', cx, cy + r * 0.20, P.text, 11, 'center');
    txt(ctx, '0', cx - r * 0.92, cy + 3, P.text, 9.5, 'center');
    txt(ctx, '100', cx + r * 0.92, cy + 3, P.text, 9.5, 'center');
  }

  // ============================================================ 横向条形（不良分类）
  function hbar(canvas, o) {
    var f = fit(canvas); if (!f) return;
    var ctx = f.ctx, W = f.w, H = f.h;
    var items = o.items || [], n = items.length; if (!n) return;
    var max = Math.max(1, maxOf(items.map(function (i) { return i.value; })));
    var labelW = o.labelWidth || 58, valueW = 34;
    var rowH = H / n, barH = Math.min(11, rowH * 0.42);
    items.forEach(function (it, i) {
      var cy = rowH * i + rowH / 2;
      txt(ctx, it.label, 0, cy, P.text, 10.5, 'left');
      var bw = W - labelW - valueW;
      ctx.fillStyle = 'rgba(61,220,255,.08)';
      roundRect(ctx, labelW, cy - barH / 2, bw, barH, 3); ctx.fill();
      var w = Math.max(2, (it.value / max) * bw);
      ctx.fillStyle = grad(ctx, labelW, 0, labelW + bw, 0, hexA(it.color, .45), it.color);
      roundRect(ctx, labelW, cy - barH / 2, w, barH, 3); ctx.fill();
      txt(ctx, U.fmtNum(it.value), W, cy, it.color, 10.5, 'right', true);
    });
  }

  // ============================================================ KPI 迷你趋势线
  function sparkline(canvas, o) {
    var f = fit(canvas); if (!f) return;
    var ctx = f.ctx, W = f.w, H = f.h;
    var data = (o.data || []).slice(-24), n = data.length; if (n < 2) return;
    var lo = Math.min.apply(null, data), hi = Math.max.apply(null, data);
    if (hi - lo < 1e-6) { hi = lo + 1; lo -= 1; }
    var pad = 3;
    var X = function (i) { return pad + (W - pad * 2) * i / (n - 1); };
    var Y = function (v) { return H - pad - (v - lo) / (hi - lo) * (H - pad * 2); };
    var color = o.color || P.cyan;
    ctx.beginPath(); ctx.moveTo(X(0), H);
    for (var i = 0; i < n; i++) ctx.lineTo(X(i), Y(data[i]));
    ctx.lineTo(X(n - 1), H); ctx.closePath();
    ctx.fillStyle = grad(ctx, 0, 0, 0, H, hexA(color, .32), hexA(color, 0)); ctx.fill();
    ctx.beginPath();
    for (var j = 0; j < n; j++) { if (!j) ctx.moveTo(X(j), Y(data[j])); else ctx.lineTo(X(j), Y(data[j])); }
    ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(X(n - 1), Y(data[n - 1]), 2.4, 0, Math.PI * 2); ctx.fill();
  }

  MFG.Charts = {
    setScale: setScale, fit: fit, combo: combo, line: line, progressRing: progressRing,
    donut: donut, gauge: gauge, hbar: hbar, sparkline: sparkline, hideTip: hideTip
  };
})();
