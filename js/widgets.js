/* ============================================================
   widgets.js — 九大面板 + 六张核心指标卡的渲染层
   所有数据均取自 engine.derive() / engine.history()，不自行造数
   ============================================================ */
(function () {
  'use strict';
  var MFG = window.MFG;
  var U = MFG.U, C = MFG.CONFIG, P = C.PALETTE, CH = MFG.Charts;
  var $ = U.$, esc = U.esc, fmtNum = U.fmtNum, fmtFixed = U.fmtFixed;
  var STATUS = C.STATUS;

  var KPI_DEFS = [
    { key: 'output',  label: '今日总产量', icon: '▤', color: P.cyan,   unit: '件', spark: 'output' },
    { key: 'attain',  label: '计划达成率', icon: '◎', color: P.green,  unit: '%',  spark: 'rate' },
    { key: 'yield',   label: '综合良率',   icon: '✓', color: P.blue,   unit: '%',  spark: 'yield' },
    { key: 'devrun',  label: '设备运行率', icon: '⚙', color: P.purple, unit: '%',  spark: 'devrun' },
    { key: 'orders',  label: '在制工单',   icon: '▦', color: P.amber,  unit: '单', spark: 'orders' },
    { key: 'alerts',  label: '活跃告警',   icon: '!', color: P.red,    unit: '条', spark: 'alerts' }
  ];

  function setText(sel, v) { var el = $(sel); if (el) el.textContent = v; }
  function setHTML(sel, html) { var el = $(sel); if (el) el.innerHTML = html; }

  function Widgets(engine) {
    this.engine = engine;
    this.range = 24;
    this.kpiBuilt = false;
    this.lastTopEventId = null;
    this.lastAlertSig = '';
  }

  // ---------------------------------------------------------- 总入口
  Widgets.prototype.renderAll = function () {
    var d = this.engine.derive();
    var h = this.engine.history(this.range);
    this.renderKPI(d, h);
    this.renderScopeNotes(d);
    this.renderOverview(d);
    this.renderLines(d);
    this.renderMaterial(d);
    this.renderOutput(d, h);
    this.renderQuality(d, h);
    this.renderOrders(d);
    this.renderDevices(d);
    this.renderAlerts(d);
    this.renderEvents(d);
    this.renderFooter(d);
    return d;
  };

  // ---------------------------------------------------------- 核心指标卡
  Widgets.prototype.renderKPI = function (d, h) {
    if (!this.kpiBuilt) {
      var html = KPI_DEFS.map(function (k) {
        return '<div class="kpi-card" data-k="' + k.key + '" style="--kc:' + k.color + '">' +
          '<div class="kpi-icon">' + k.icon + '</div>' +
          '<div class="kpi-main"><div class="kpi-label">' + k.label + '</div>' +
          '<div class="kpi-value"><b id="kpi-' + k.key + '">--</b><i>' + k.unit + '</i></div>' +
          '<div class="kpi-foot" id="kpi-foot-' + k.key + '">—</div></div>' +
          '<canvas class="kpi-spark" id="spark-' + k.key + '"></canvas></div>';
      }).join('');
      setHTML('#kpi-strip', html);
      this.kpiBuilt = true;
    }

    var diff = d.totalOutput - d.planToNow;
    var ppm = d.totalOutput ? d.totalDefect / d.totalOutput * 1000000 : 0;
    var values = {
      output:  { v: fmtNum(d.totalOutput), foot: '计划 ' + fmtNum(d.totalPlan) + ' 件 · 小时产能 ' + fmtNum(d.hourlyRate) },
      attain:  { v: fmtFixed(d.attainment, 1), foot: '较时间进度 ' + (diff >= 0 ? '+' : '') + fmtNum(diff) + ' 件' },
      yield:   { v: fmtFixed(d.yieldRate, 2), foot: '不良 ' + fmtNum(d.totalDefect) + ' 件 · PPM ' + fmtNum(ppm) },
      devrun:  { v: fmtFixed(d.deviceRunRate, 1), foot: d.onlineDevices + '/' + d.totalDevices + ' 台在线 · OEE ' + fmtFixed(d.oee, 1) + '%' },
      orders:  { v: fmtNum(d.activeOrders), foot: '已完工 ' + d.doneOrders + ' · 准时率 ' + fmtFixed(d.onTimeRate, 0) + '%' },
      alerts:  { v: fmtNum(d.activeAlerts), foot: '严重 ' + d.criticalCount + ' · 已恢复 ' + this.engine.state.alertsRecovered + ' 条' }
    };
    var dynamic = {
      attain: d.attainment >= 100 ? P.green : d.attainment >= 90 ? P.cyan : d.attainment >= 80 ? P.amber : P.red,
      yield:  d.yieldRate >= 97 ? P.green : d.yieldRate >= 95 ? P.amber : P.red,
      devrun: d.deviceRunRate >= 90 ? P.purple : d.deviceRunRate >= 80 ? P.amber : P.red,
      alerts: d.activeAlerts === 0 ? P.green : d.activeAlerts <= 3 ? P.amber : P.red
    };

    KPI_DEFS.forEach(function (k) {
      var info = values[k.key];
      setText('#kpi-' + k.key, info.v);
      setText('#kpi-foot-' + k.key, info.foot);
      var card = $('.kpi-card[data-k="' + k.key + '"]');
      if (card && dynamic[k.key]) card.style.setProperty('--kc', dynamic[k.key]);
      var src = h[k.spark] || [];
      var data = src.slice();
      if (k.spark === 'output') {
        var acc = 0;
        data = src.map(function (v) { acc += v; return acc; });
      }
      CH.sparkline($('#spark-' + k.key), { data: data, color: dynamic[k.key] || k.color });
    });
  };

  // ---------------------------------------------------------- 全局聚焦标注
  Widgets.prototype.renderScopeNotes = function (d) {
    var line = d.scopeLine ? MFG.LINES.filter(function (l) { return l.id === d.scopeLine; })[0] : null;
    var tag = line ? '聚焦 ' + line.id + ' · ' + line.name : '全厂口径';
    setText('#overview-note', tag);
    setText('#material-note', line ? line.id + ' BOM 用料' : '安全库存预警');
    setText('#quality-note', tag);
    setText('#orders-note', line ? line.id + ' 工单' : '按交期排序');
    setText('#device-note', line ? line.id + ' · ' + d.totalDevices + ' 台设备' : '全厂设备');
    setText('#alert-note', line ? line.id + ' 关联告警' : '实时告警池');
  };

  // ---------------------------------------------------------- 01 生产总览
  Widgets.prototype.renderOverview = function (d) {
    CH.progressRing($('#chart-overview-ring'), { value: d.attainment, max: 100, color: P.cyan });
    setText('#ov-rate', fmtFixed(d.attainment, 1) + '%');
    setText('#ov-plan', fmtNum(d.totalPlan));
    setText('#ov-output', fmtNum(d.totalOutput));
    setText('#ov-takt', d.avgTakt ? fmtFixed(d.avgTakt, 1) : '--');
    setText('#ov-running', d.runningLines + '/' + d.lines.length);
    setText('#ov-shift-pct', fmtFixed(d.shiftProgress * 100, 1) + '%');
    setText('#ov-simtime', d.simClock);
    var bar = $('#ov-shift-bar');
    if (bar) {
      bar.style.width = (d.shiftProgress * 100).toFixed(1) + '%';
      bar.className = d.shiftProgress > 0.85 ? 'warn' : '';
    }
    setText('#overview-foot',
      '数据时间 ' + d.simClock + ' · 第 ' + d.shiftDay + ' 个白班 · 平均节拍 ' +
      (d.avgTakt ? fmtFixed(d.avgTakt, 1) + 's' : '--') +
      ' · ' + (d.scopeLine ? '下钻 ' + d.scopeLine : '全厂汇总'));
  };

  // ---------------------------------------------------------- 02 产线运行状态
  Widgets.prototype.renderLines = function (d) {
    var all = this.engine.state.lines;
    var counts = { running: 0, idle: 0, fault: 0, maintenance: 0 };
    all.forEach(function (l) { counts[l.status]++; });
    var chips = [
      ['running', '运行', P.green], ['maintenance', '保养', P.amber],
      ['fault', '故障', P.red], ['idle', '待机', '#9fb9d6']
    ];
    setHTML('#lines-summary', chips.map(function (c) {
      return '<div class="status-chip" style="--sc:' + c[2] + '"><span>' + c[1] + '</span><b>' + counts[c[0]] + '</b></div>';
    }).join(''));

    var selected = this.engine.state.selectedLine;
    var shift = d.shiftProgress;
    setHTML('#lines-list', all.map(function (l) {
      var meta = STATUS[l.status] || STATUS.idle;
      var planToNow = Math.max(1, l.plan * shift);
      var rate = l.output / planToNow * 100;
      var cls = rate >= 100 ? '' : rate >= 85 ? 'warn' : 'danger';
      return '<div class="line-row' + (selected === l.id ? ' is-active' : '') + '" data-line="' + esc(l.id) + '" ' +
        'title="' + esc(l.name + ' · 节拍 ' + (l.takt ? fmtFixed(l.takt, 1) + 's' : '停机') + ' · 产出 ' + fmtNum(l.output) + ' 件 · 达成 ' + fmtFixed(rate, 1) + '%') + '">' +
        '<div class="line-top"><div class="line-id"><span class="line-code">' + esc(l.id) + '</span>' +
        '<span class="line-name">' + esc(l.name) + '</span></div>' +
        '<span class="badge st-' + l.status + '">' + meta.label + '</span></div>' +
        '<div class="line-meta"><span>' + (l.takt ? fmtFixed(l.takt, 1) + 's' : '停机') + '</span>' +
        '<span>' + fmtNum(l.output) + ' 件</span>' +
        '<span>' + fmtFixed(rate, 0) + '%</span></div>' +
        '<div class="line-bar"><i class="' + cls + '" style="width:' + U.clamp(rate, 0, 100).toFixed(1) + '%"></i></div>' +
        '</div>';
    }).join(''));
  };

  // ---------------------------------------------------------- 03 物料与库存概况
  Widgets.prototype.renderMaterial = function (d) {
    // 聚焦产线时保留全量物料，高亮该产线 BOM 用料，其余置灰（联动但不留白）
    var related = {};
    d.materials.forEach(function (m) { related[m.id] = true; });
    var scoped = !!d.scopeLine;
    setHTML('#material-list', this.engine.state.materials.map(function (m) {
      var pct = U.clamp(m.stock / m.capacity * 100, 0, 100);
      var safePct = U.clamp(m.safety / m.capacity * 100, 0, 100);
      var cls = m.stock < m.safety ? 'low' : m.stock < m.safety * 1.3 ? 'mid' : '';
      var rowCls = scoped ? (related[m.id] ? 'mat-row related' : 'mat-row dim') : 'mat-row';
      return '<div class="' + rowCls + '">' +
        '<span class="mat-name" title="' + esc(m.name) + '">' + esc(m.name) + '</span>' +
        '<div class="mat-track"><i class="mat-fill ' + cls + '" style="width:' + pct.toFixed(1) + '%"></i>' +
        '<i class="mat-safe" style="left:' + safePct.toFixed(1) + '%"></i></div>' +
        '<span class="mat-value ' + cls + '">' + fmtNum(m.stock) + '<small>' + esc(m.unit) + '</small></span>' +
        '</div>';
    }).join(''));
    var s = this.engine.state;
    setHTML('#material-stats', [
      ['本班消耗', fmtNum(s.totalConsumed), '', ''],
      ['补料入库', fmtNum(s.refillCount) + ' 次', 'cyan', ''],
      ['低于安全线', fmtNum(d.materialLowCount) + ' 项', d.materialLowCount ? 'red' : 'green']
    ].map(function (x) {
      return '<div class="ms-item"><span class="ms-label">' + x[0] + '</span>' +
        '<span class="ms-value ' + x[2] + '">' + x[1] + '</span></div>';
    }).join(''));
  };

  // ---------------------------------------------------------- 04 产量与达成率
  Widgets.prototype.renderOutput = function (d, h) {
    if (!this.outputLegendBuilt) {
      setHTML('#output-legend',
        '<span><i style="background:' + P.cyan + '"></i>实际产量（左轴 / 件）</span>' +
        '<span><i style="background:rgba(74,146,255,.5)"></i>计划产量（左轴 / 件）</span>' +
        '<span><i class="line" style="background:' + P.amber + '"></i>累计达成率（右轴 / %）</span>');
      this.outputLegendBuilt = true;
    }
    CH.combo($('#chart-output'), {
      labels: h.labels, bars: h.output, plan: h.plan, line: h.rate,
      rightMin: 60, rightMax: 140, hoverIdx: -1
    });
    var peak = h.output.length ? Math.max.apply(null, h.output) : 0;
    setHTML('#output-stats', [
      ['本周期产量', fmtNum(d.lastTickOutput) + ' 件', 'cyan'],
      ['采样峰值', fmtNum(peak) + ' 件', ''],
      ['平均节拍', d.avgTakt ? fmtFixed(d.avgTakt, 1) + ' s' : '--', 'green']
    ].map(function (x) {
      return '<div class="ms-item"><span class="ms-label">' + x[0] + '</span>' +
        '<span class="ms-value ' + x[2] + '">' + x[1] + '</span></div>';
    }).join(''));
  };

  // ---------------------------------------------------------- 05 质量指标
  Widgets.prototype.renderQuality = function (d, h) {
    var ys = h.yield || [];
    var yLo = ys.length ? Math.min.apply(null, ys) : 97;
    var yHi = ys.length ? Math.max.apply(null, ys) : 98;
    // 收紧纵轴区间，让 0.x% 级的过程波动清晰可见
    var axisMin = Math.max(85, Math.floor((yLo - 0.25) * 10) / 10);
    var axisMax = Math.min(100, Math.ceil((yHi + 0.25) * 10) / 10);
    if (axisMax - axisMin < 0.8) axisMax = Math.min(100, axisMin + 0.8);
    CH.line($('#chart-yield'), {
      data: ys, labels: h.labels, min: axisMin, max: axisMax, color: P.green,
      threshold: C.THRESHOLDS.yieldLow
    });
    if (!d.scopeLine) {
      var gap = d.yieldRate - C.THRESHOLDS.yieldLow;
      setText('#quality-note', gap >= 0
        ? '高于管控线 ' + fmtFixed(gap, 2) + ' pt'
        : '低于管控线 ' + fmtFixed(-gap, 2) + ' pt');
    }
    CH.hbar($('#chart-defects'), {
      items: MFG.DEFECT_TYPES.map(function (t) {
        return { label: t.name, value: d.defectByType[t.id] || 0, color: t.color };
      }), labelWidth: 62
    });
    var ppm = d.totalOutput ? d.totalDefect / d.totalOutput * 1000000 : 0;
    var top = MFG.DEFECT_TYPES.slice().sort(function (a, b) {
      return (d.defectByType[b.id] || 0) - (d.defectByType[a.id] || 0);
    })[0];
    setHTML('#quality-stats', [
      ['一次合格率', fmtFixed(d.yieldRate, 2) + '%', 'green'],
      ['不良品', fmtNum(d.totalDefect) + ' 件', ''],
      ['不良 PPM', fmtNum(ppm), 'amber'],
      ['主要缺陷', top ? top.name : '--', '']
    ].map(function (x) {
      return '<div class="ms-item"><span class="ms-label">' + x[0] + '</span>' +
        '<span class="ms-value ' + x[2] + '">' + esc(x[1]) + '</span></div>';
    }).join(''));
  };

  // ---------------------------------------------------------- 06 订单 / 工单进度
  Widgets.prototype.renderOrders = function (d) {
    setHTML('#orders-summary', [
      ['在制', fmtNum(d.activeOrders) + ' 单', 'cyan'],
      ['待排产', fmtNum(d.pendingOrders) + ' 单', ''],
      ['已完工', fmtNum(d.doneOrders) + ' 单', 'green'],
      ['准时率', fmtFixed(d.onTimeRate, 0) + '%', d.onTimeRate >= 90 ? 'green' : 'amber']
    ].map(function (x) {
      return '<div class="ms-item"><span class="ms-label">' + x[0] + '</span>' +
        '<span class="ms-value ' + x[2] + '">' + x[1] + '</span></div>';
    }).join(''));

    var orders = d.orders.slice().sort(function (a, b) {
      var rank = { running: 0, pending: 1, done: 2 };
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      return a.dueMinutes - b.dueMinutes;
    }).slice(0, 6);
    var shift = d.shiftProgress;
    var badges = {
      running: ['st-running', '生产中'], pending: ['st-pending', '待排产'], done: ['st-done', '已完工']
    };
    setHTML('#orders-list', orders.length ? orders.map(function (o) {
      var pct = o.target ? U.clamp(o.completed / o.target * 100, 0, 100) : 0;
      var cls = pct < (shift - 0.22) * 100 && o.status === 'running' ? 'danger'
              : pct < shift * 100 && o.status === 'running' ? 'warn' : '';
      var bd = badges[o.status] || badges.pending;
      return '<div class="order-row"><div class="order-top"><div>' +
        '<span class="order-code">' + esc(o.id) + '</span>' +
        '<span class="order-product">' + esc(o.product) + '</span>' +
        '<span class="order-line">' + esc(o.lineId) + '</span></div>' +
        '<span class="badge ' + bd[0] + '">' + bd[1] + '</span></div>' +
        '<div class="order-meta"><div class="progress-track"><i class="' + cls + '" style="width:' + pct.toFixed(1) + '%"></i></div>' +
        '<span class="order-num"><b>' + fmtNum(o.completed) + '</b> / ' + fmtNum(o.target) + ' 件 · ' + esc(o.due) + '</span>' +
        '</div></div>';
    }).join('') : '<div class="empty-hint"><b>◎</b><span>当前范围暂无工单</span></div>');
  };

  // ---------------------------------------------------------- 07 设备运行率
  Widgets.prototype.renderDevices = function (d) {
    CH.gauge($('#chart-gauge'), { value: d.deviceRunRate, max: 100, label: '设备运行率', color: P.cyan });
    var stat = { running: 0, maintenance: 0, fault: 0, idle: 0 };
    d.devices.forEach(function (dev) { stat[dev.status]++; });
    CH.donut($('#chart-device-donut'), {
      segments: [
        { value: stat.running, color: P.green },
        { value: stat.maintenance, color: P.amber },
        { value: stat.fault, color: P.red },
        { value: stat.idle, color: '#6f8fb0' }
      ], thickness: 14
    });
    setText('#dev-online', d.onlineDevices + '/' + d.totalDevices);
    var rankTitle = $('.rank-title span');
    if (rankTitle) rankTitle.textContent = '需关注 LOW ' + Math.min(5, d.devices.length);

    var ranked = d.devices.map(function (dev) {
      return {
        name: dev.name, status: dev.status,
        value: dev.totalTicks ? U.clamp(dev.runtimeTicks / dev.totalTicks * 100, 0, 100) : 100
      };
    }).sort(function (a, b) { return a.value - b.value; }).slice(0, 5);

    setHTML('#device-rank', ranked.map(function (r) {
      var cls = r.value >= 95 ? '' : r.value >= 85 ? 'warn' : 'danger';
      return '<div class="rank-row"><span class="rank-name" title="' + esc(r.name) + '">' + esc(r.name) + '</span>' +
        '<div class="rank-track"><i class="' + cls + '" style="width:' + r.value.toFixed(1) + '%"></i></div>' +
        '<span class="rank-value">' + fmtFixed(r.value, 1) + '%</span></div>';
    }).join(''));
  };

  // ---------------------------------------------------------- 08 异常告警
  Widgets.prototype.renderAlerts = function (d) {
    var s = this.engine.state;
    setHTML('#alert-stats', [
      ['活跃告警', fmtNum(d.activeAlerts) + ' 条', d.activeAlerts ? 'amber' : 'green'],
      ['严重级别', fmtNum(d.criticalCount) + ' 条', d.criticalCount ? 'red' : 'green'],
      ['累计告警', fmtNum(s.alertsTotal) + ' 条', ''],
      ['平均恢复', fmtFixed(d.avgRecoveryMin, 0) + ' min', 'cyan']
    ].map(function (x) {
      return '<div class="ms-item"><span class="ms-label">' + x[0] + '</span>' +
        '<span class="ms-value ' + x[2] + '">' + x[1] + '</span></div>';
    }).join(''));

    var active = d.alerts.filter(function (a) { return a.status === 'active'; }).slice(0, 9);
    var recovered = d.alerts.filter(function (a) { return a.status === 'recovered'; }).slice(0, 3);
    var rows = active.map(function (a) {
      var lv = MFG.ALERT_LEVELS[a.level] || MFG.ALERT_LEVELS.warning;
      return '<div class="alert-row ' + (a.level === 'critical' ? 'critical' : '') + '" style="--ac:' + lv.color + '">' +
        '<div class="alert-ico">!</div><div class="alert-main">' +
        '<div class="alert-msg">' + esc(a.message) + '</div>' +
        '<div class="alert-sub">' + esc(a.type) + ' · ' + esc(a.source) + ' · ' + esc(a.createdAt) + ' 触发</div>' +
        '</div><div class="alert-time">' + esc(a.createdAt) + '</div></div>';
    });
    rows = rows.concat(recovered.map(function (a) {
      return '<div class="alert-row" style="--ac:' + P.blue + ';opacity:.68">' +
        '<div class="alert-ico">✓</div><div class="alert-main">' +
        '<div class="alert-msg">' + esc(a.message) + '</div>' +
        '<div class="alert-sub">' + esc(a.type) + ' · 已恢复 ' + esc(a.recoveredAt || '--') + '</div>' +
        '</div><div class="alert-time">' + esc(a.createdAt) + '</div></div>';
    }));
    setHTML('#alert-list', rows.length ? rows.join('') :
      '<div class="empty-hint"><b>✓</b><span>当前无活跃告警，产线运行平稳</span></div>');
  };

  // ---------------------------------------------------------- 09 实时事件流
  Widgets.prototype.renderEvents = function (d) {
    var list = d.events.slice(0, 30);
    var topId = list.length ? list[0].id : null;
    var isNew = topId && topId !== this.lastTopEventId;
    this.lastTopEventId = topId;
    setHTML('#event-list', list.length ? list.map(function (e, i) {
      var tone = MFG.EVENT_TONES[e.tone] || MFG.EVENT_TONES.system;
      return '<div class="event-row' + (isNew && i === 0 ? ' is-new' : '') + '">' +
        '<span class="event-time">' + esc(e.at) + '</span>' +
        '<span class="event-dot" style="--ec:' + tone.color + '"></span>' +
        '<span class="event-text" title="' + esc(e.text) + '">' + esc(e.text) + '</span></div>';
    }).join('') : '<div class="empty-hint"><b>◎</b><span>等待实时事件…</span></div>');
  };

  // ---------------------------------------------------------- 底部状态条
  Widgets.prototype.renderFooter = function (d) {
    var fault = d.lines.filter(function (l) { return l.status === 'fault'; });
    var msg;
    if (fault.length) {
      msg = '⚠ ' + fault.map(function (l) { return l.name; }).join('、') + ' 故障停机中，设备告警已联动生成，请关注工单交期';
    } else if (d.criticalCount) {
      msg = '⚠ 当前存在 ' + d.criticalCount + ' 条严重告警，物料 / 质量 / 设备联动监控中';
    } else if (d.attainment >= 100) {
      msg = '✓ 全厂达成率 ' + fmtFixed(d.attainment, 1) + '%，综合良率 ' + fmtFixed(d.yieldRate, 2) + '%，生产节奏受控';
    } else {
      msg = '生产节拍 ' + (d.avgTakt ? fmtFixed(d.avgTakt, 1) + 's' : '--') + ' · 设备运行率 ' + fmtFixed(d.deviceRunRate, 1) + '% · 数据持续刷新中';
    }
    setText('#footer-marquee', msg);
    setText('#footer-meta', 'TICK ' + String(d.tick).padStart(4, '0') + ' · 第 ' + d.shiftDay + ' 班次 · 模拟时钟 ' +
      d.simClock + ' · 1920×1080 · v1.0.0');
  };

  MFG.createWidgets = function (engine) { return new Widgets(engine); };
})();
