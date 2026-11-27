/* ============================================================
   mock-engine.js — 动态数据模拟引擎（单一状态源 / 全模块业务联动）
   ------------------------------------------------------------
   联动链路：
     设备状态 → 产线状态 → 节拍/产出 → 工单进度 / 物料消耗
     产出 × 不良率 → 良率 → 质量指标与告警
     库存 / 良率 / 节拍 / 工单进度 / 设备故障 → 告警生成与自动恢复
     所有指标卡、趋势、排名、事件均由同一 state 派生，绝不各自造数
   ============================================================ */
(function () {
  'use strict';
  var MFG = window.MFG;
  var U = MFG.U, C = MFG.CONFIG;
  var clamp = U.clamp, chance = U.chance, rand = U.rand, gauss = U.gauss, pick = U.pick;
  var fmtClock = U.fmtClock, fmtNum = U.fmtNum;

  function byId(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i]; return null; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  function createEngine() {
    var bus = U.makeEmitter();
    var state = null;

    // ---------------------------------------------------------- 初始状态
    function initialState() {
      var s = {
        tick: 0,
        simMinutes: C.SHIFT_START_MIN,
        shiftDay: 1,
        lines: [], devices: [], orders: [], materials: [],
        alerts: [], events: [],
        history: { labels: [], output: [], plan: [], rate: [], yield: [], takt: [], devrun: [], alerts: [], orders: [] },
        defectByType: {},
        totalConsumed: 0, refillCount: 0, ordersDone: 0,
        alertsTotal: 0, alertsRecovered: 0, recoveryMinutesTotal: 0,
        connection: 'online', paused: false, speed: 1, selectedLine: null,
        counters: { order: 11 },
        lastTickOutput: 0
      };

      MFG.LINES.forEach(function (def, i) {
        var line = copy(def);
        Object.assign(line, {
          status: i === 5 ? 'idle' : 'running',
          holdUntil: i === 5 ? 12 : 0,
          output: 0, good: 0, defect: 0, defectAcc: 0, defectByType: {},
          takt: def.takt, orderId: null,
          runtimeTicks: 0, totalTicks: 0, lastInc: 0,
          hist: { labels: [], output: [], plan: [], rate: [], yield: [], takt: [], devrun: [], alerts: [], orders: [] }
        });
        MFG.DEFECT_TYPES.forEach(function (t) { line.defectByType[t.id] = 0; });
        s.lines.push(line);
      });

      MFG.DEVICES.forEach(function (def, i) {
        var d = copy(def);
        Object.assign(d, {
          // 预置一台保养设备，使初始状态分布更完整
          status: i === 10 ? 'maintenance' : 'running',
          runtimeTicks: 0, totalTicks: 0, lastChangeTick: 0,
          load: rand(62, 84), temperature: rand(38, 56)
        });
        s.devices.push(d);
      });

      MFG.ORDERS.forEach(function (def) {
        var o = copy(def);
        Object.assign(o, {
          status: 'pending', completed: 0, startTick: null, doneTick: null,
          dueMinutes: (function () { var p = def.due.split(':'); return +p[0] * 60 + +p[1]; })()
        });
        s.orders.push(o);
      });

      // 每条产线排入首个工单（L06 先待机，稍后自动接单）
      var assigned = {};
      s.orders.forEach(function (o) {
        if (o.lineId === 'L06' || assigned[o.lineId]) return;
        assigned[o.lineId] = true;
        o.status = 'running'; o.startTick = 0;
        var line = byId(s.lines, o.lineId);
        if (line) line.orderId = o.id;
      });

      MFG.MATERIALS.forEach(function (def) {
        var m = copy(def);
        Object.assign(m, { consumed: 0, lastRefillTick: -999, initialStock: def.stock });
        s.materials.push(m);
      });
      MFG.DEFECT_TYPES.forEach(function (t) { s.defectByType[t.id] = 0; });
      return s;
    }

    // ---------------------------------------------------------- 事件 / 告警
    function pushEvent(s, tone, text, lineId, silent) {
      if (silent) return;
      var e = {
        id: U.uuid('EV'), tone: tone, text: text,
        lineId: lineId || null, at: fmtClock(s.simMinutes), tick: s.tick
      };
      s.events.unshift(e);
      if (s.events.length > C.EVENT_MAX) s.events.length = C.EVENT_MAX;
    }

    function activeAlerts(s) { return s.alerts.filter(function (a) { return a.status === 'active'; }); }

    function openAlert(s, key, cfg, silent) {
      var act = activeAlerts(s);
      for (var i = 0; i < act.length; i++) if (act[i].key === key) return null;
      if (act.length >= 14 && cfg.level !== 'critical') return null;
      var lv = MFG.ALERT_LEVELS[cfg.level] || MFG.ALERT_LEVELS.warning;
      var a = {
        id: U.uuid('AL'), key: key, level: cfg.level, type: cfg.type,
        source: cfg.source, message: cfg.message, lineId: cfg.lineId || null,
        status: 'active', createdTick: s.tick, createdAt: fmtClock(s.simMinutes),
        recoveredTick: null, recoveredAt: null
      };
      s.alerts.unshift(a);
      s.alertsTotal++;
      if (s.alerts.length > C.ALERT_MAX) s.alerts.length = C.ALERT_MAX;
      if (!silent) pushEvent(s, 'alert', '【' + lv.label + '】' + a.message, a.lineId, false);
      return a;
    }

    function closeAlert(s, a, silent) {
      if (!a || a.status !== 'active') return;
      a.status = 'recovered';
      a.recoveredTick = s.tick;
      a.recoveredAt = fmtClock(s.simMinutes);
      s.alertsRecovered++;
      s.recoveryMinutesTotal += Math.max(1, (a.recoveredTick - a.createdTick) * C.SIM_MINUTES_PER_TICK);
      if (!silent) pushEvent(s, 'recover', '告警恢复：' + a.message, a.lineId, false);
    }
    function closeByKey(s, key, silent) {
      activeAlerts(s).forEach(function (a) { if (a.key === key) closeAlert(s, a, silent); });
    }

    // ---------------------------------------------------------- 设备状态机
    function devicesOf(s, lineId) { return s.devices.filter(function (d) { return d.lineId === lineId; }); }

    function setDevice(s, d, next, silent) {
      var prev = d.status;
      if (prev === next) return;
      d.status = next;
      d.lastChangeTick = s.tick;
      var C1 = MFG.CONFIG.STATUS;
      if (!silent) {
        pushEvent(s, next === 'running' ? 'recover' : 'device',
          d.name + ' ' + C1[prev].label + ' → ' + C1[next].label, d.lineId, false);
      }
      var key = 'DEVICE_FAULT:' + d.id;
      if (next === 'fault') {
        openAlert(s, key, {
          level: 'critical', type: '设备故障', source: d.id,
          message: d.name + '（' + d.model + '）发生故障，产线已联锁停机',
          lineId: d.lineId
        }, silent);
      } else if (prev === 'fault') {
        closeByKey(s, key, silent);
      }
    }

    function stepDevices(s, silent) {
      s.devices.forEach(function (d) {
        d.totalTicks++;
        if (d.status === 'running') {
          if (chance(0.0062)) setDevice(s, d, 'fault', silent);
          else if (chance(0.0038)) setDevice(s, d, 'maintenance', silent);
        } else if (d.status === 'fault') {
          if (chance(0.15)) setDevice(s, d, 'running', silent);
        } else if (d.status === 'maintenance') {
          if (chance(0.11)) setDevice(s, d, 'running', silent);
        }
        // 有效运行工时：运行按 100%、保养降速按 45% 折算、故障停机按 0%
        if (d.status === 'running') d.runtimeTicks += 1;
        else if (d.status === 'maintenance') d.runtimeTicks += 0.45;
        var target = d.status === 'running' ? 78 : d.status === 'maintenance' ? 26 : 0;
        d.load = clamp(d.load + (target - d.load) * 0.14 + gauss(0, 2.2), 0, 99);
        d.temperature = clamp(d.temperature + (d.status === 'running' ? 0.12 : -0.4) + gauss(0, 0.35), 24, 92);
      });
    }

    // ---------------------------------------------------------- 工单排产
    function assignOrder(s, line, silent) {
      var pending = s.orders.filter(function (o) { return o.lineId === line.id && o.status === 'pending'; });
      var o = pending[0];
      if (o) {
        o.status = 'running'; o.startTick = s.tick; o.completed = 0;
      } else {
        var seq = s.counters.order++;
        var dueMin = Math.min(1200, s.simMinutes + U.randInt(150, 300));
        o = {
          id: 'WO-2411' + String(seq).padStart(3, '0'),
          product: pick(['伺服端盖', '传动支架', '控制盒体', '驱动总成', '连接法兰', '成品组件']),
          lineId: line.id, target: U.randInt(680, 1150),
          due: fmtClock(dueMin),
          priority: chance(0.25) ? '高' : '普通',
          status: 'running', completed: 0, startTick: s.tick, doneTick: null,
          dueMinutes: dueMin
        };
        s.orders.push(o);
        if (s.orders.length > 22) s.orders.shift();
      }
      line.orderId = o.id;
      if (!silent) pushEvent(s, 'order', line.name + ' 接单 ' + o.id + ' / ' + o.product + ' ' + fmtNum(o.target) + ' 件', line.id, false);
      return o;
    }

    // ---------------------------------------------------------- 单个 tick
    function advance(s, silent) {
      s.tick++;
      var stepMin = C.SIM_MINUTES_PER_TICK * s.speed;
      s.simMinutes += stepMin;

      // 班次循环：到达 20:00 后自动开启新的白班
      if (s.simMinutes >= C.SHIFT_END_MIN) {
        s.simMinutes = C.SHIFT_START_MIN + (s.simMinutes - C.SHIFT_END_MIN);
        s.shiftDay++;
        s.lines.forEach(function (l) {
          l.output = 0; l.good = 0; l.defect = 0; l.defectAcc = 0;
          l.runtimeTicks = 0; l.totalTicks = 0;
        });
        s.devices.forEach(function (d) { d.runtimeTicks = 0; d.totalTicks = 0; });
        pushEvent(s, 'system', '班次切换完成，第 ' + s.shiftDay + ' 个白班开始，班次日累计已归零', null, silent);
      }

      stepDevices(s, silent);

      // 待机产线到点自动接单
      s.lines.forEach(function (line) {
        if (line.status === 'idle' && s.tick >= line.holdUntil) {
          line.status = 'running';
          assignOrder(s, line, silent);
        }
      });

      var shiftProgress = clamp((s.simMinutes - C.SHIFT_START_MIN) / (C.SHIFT_END_MIN - C.SHIFT_START_MIN), 0.001, 1);
      var tickOutput = 0, taktSum = 0, taktCount = 0;

      s.lines.forEach(function (line) {
        // 1) 产线状态完全由所属设备状态 + 是否有在制工单推导
        var devs = devicesOf(s, line.id);
        var hasFault = devs.some(function (d) { return d.status === 'fault'; });
        var hasMaint = devs.some(function (d) { return d.status === 'maintenance'; });
        var nextStatus = !line.orderId ? 'idle' : hasFault ? 'fault' : hasMaint ? 'maintenance' : 'running';
        if (nextStatus !== line.status && line.status !== 'idle') {
          if (!silent) {
            pushEvent(s, hasFault ? 'device' : 'line',
              line.name + ' 状态切换为「' + C.STATUS[nextStatus].label + '」', line.id, false);
          }
        }
        line.status = nextStatus;

        // 2) 生产节拍：正弦波动 + 随机噪声；保养降速、故障停机
        if (nextStatus === 'fault') {
          line.takt = null;
        } else {
          var wave = 1 + 0.052 * Math.sin(s.tick / 9 + line.phase)
                       + 0.022 * Math.sin(s.tick / 23 + line.phase * 2) + gauss(0, 0.011);
          line.takt = baseTakt(line) * wave * (nextStatus === 'maintenance' ? 1.32 : 1);
          if (nextStatus === 'running') { taktSum += line.takt; taktCount++; }
        }

        // 3) 产出 = 有效工时 / 节拍 × 状态系数
        var effTakt = line.takt || baseTakt(line);
        var capacity = (stepMin * 60) / effTakt;
        var factor = nextStatus === 'running' ? 1 : nextStatus === 'maintenance' ? 0.42 : 0;
        var inc = Math.max(0, Math.round(capacity * factor * rand(0.94, 1.07)));
        line.lastInc = inc;
        line.totalTicks++;
        if (nextStatus === 'running' || nextStatus === 'maintenance') line.runtimeTicks++;

        // 4) 良率：基础不良率 + 保养劣化 + 周期性波动；浮点累计避免小样本阶梯化
        var dr = baseDefect(line) + (nextStatus === 'maintenance' ? 0.014 : 0)
               + 0.006 * Math.sin(s.tick / 13 + line.phase) + gauss(0, 0.0045);
        dr = clamp(dr, 0.004, 0.09);
        line.defectAcc += inc * dr;
        var bad = Math.floor(line.defectAcc);
        line.defectAcc -= bad;
        var good = inc - bad;
        line.output += inc; line.good += good; line.defect += bad;
        if (bad > 0) {
          var t = pick(MFG.DEFECT_TYPES);
          s.defectByType[t.id] += bad;
          line.defectByType[t.id] = (line.defectByType[t.id] || 0) + bad;
        }
        tickOutput += inc;

        // 5) 工单推进（产出驱动）
        if (inc > 0 && line.orderId) {
          var o = byId(s.orders, line.orderId);
          if (o && o.status === 'running') {
            o.completed = Math.min(o.target, o.completed + inc);
            if (o.completed >= o.target) {
              o.status = 'done'; o.doneTick = s.tick;
              s.ordersDone++;
              if (!silent) pushEvent(s, 'order', o.id + ' / ' + o.product + ' 完工，共 ' + fmtNum(o.target) + ' 件', line.id, false);
              line.orderId = null;
              assignOrder(s, line, silent);
            }
          }
        }

        // 6) 物料消耗（产出驱动 BOM）
        line.bills.forEach(function (b) {
          var m = byId(s.materials, b.id);
          if (!m) return;
          var used = inc * b.per * (1 + gauss(0, 0.02));
          m.stock = Math.max(0, m.stock - used);
          m.consumed += used;
          s.totalConsumed += used;
        });

        // 7) 该产线的历史采样（供全局联动下钻使用）
        var linePlanToNow = Math.max(1, line.plan * shiftProgress);
        var lDevs = devs;
        var lRun = lDevs.filter(function (dd) { return dd.status === 'running'; }).length;
        pushLineHistory(line, {
          label: fmtClock(s.simMinutes), output: inc,
          plan: line.plan * stepMin / (C.SHIFT_END_MIN - C.SHIFT_START_MIN),
          rate: clamp(line.output / linePlanToNow * 100, 0, 190),
          yield: line.output > 0 ? line.good / line.output * 100 : 100,
          takt: line.takt || 0,
          devrun: lDevs.length ? lRun / lDevs.length * 100 : 100,
          alerts: activeAlerts(s).filter(function (a) { return a.lineId === line.id; }).length,
          orders: s.orders.filter(function (o) { return o.lineId === line.id && o.status === 'running'; }).length
        });
      });

      // 8) 定时补料入库
      if (chance(0.05)) {
        var low = s.materials.filter(function (m) { return m.stock < m.capacity * 0.66; });
        if (low.length) {
          var m2 = pick(low);
          var before = m2.stock;
          m2.stock = Math.min(m2.capacity, m2.stock + m2.refill);
          m2.lastRefillTick = s.tick;
          s.refillCount++;
          if (!silent) pushEvent(s, 'material', m2.name + ' 补料入库 +' + fmtNum(m2.stock - before) + m2.unit, null, false);
        }
      }

      // 9) 全局历史采样
      var d0 = derive(s, null);
      pushHistory(s.history, {
        label: fmtClock(s.simMinutes),
        output: tickOutput,
        plan: d0.totalPlan * stepMin / (C.SHIFT_END_MIN - C.SHIFT_START_MIN),
        rate: d0.attainment,
        yield: d0.yieldRate,
        takt: taktCount ? taktSum / taktCount : 0,
        devrun: d0.deviceRunRate,
        alerts: d0.activeAlerts,
        orders: d0.activeOrders
      });
      s.lastTickOutput = tickOutput;

      // 10) 告警条件复检：生成 / 自动恢复（预热静默期不对外广播）
      if (!silent) {
        evaluateAlerts(s, shiftProgress, false);
        bus.emit('tick', s);
      }
    }

    // 兼容辅助：节拍与不良率基准来自配置主数据
    function baseTakt(line) { return (MFG.LINES.filter(function (l) { return l.id === line.id; })[0] || {}).takt || 32; }
    function baseDefect(line) { return (MFG.LINES.filter(function (l) { return l.id === line.id; })[0] || {}).baseDefect || 0.02; }

    function pushHistory(h, p) {
      h.labels.push(p.label); h.output.push(p.output); h.plan.push(p.plan);
      h.rate.push(p.rate); h.yield.push(p.yield); h.takt.push(p.takt);
      h.devrun.push(p.devrun || 0); h.alerts.push(p.alerts || 0); h.orders.push(p.orders || 0);
      Object.keys(h).forEach(function (k) {
        if (h[k].length > C.HISTORY_MAX) h[k].shift();
      });
    }
    function pushLineHistory(line, p) {
      var h = line.hist;
      h.labels.push(p.label); h.output.push(p.output); h.plan.push(p.plan);
      h.rate.push(p.rate); h.yield.push(p.yield); h.takt.push(p.takt);
      h.devrun.push(p.devrun || 0); h.alerts.push(p.alerts || 0); h.orders.push(p.orders || 0);
      Object.keys(h).forEach(function (k) { if (h[k].length > C.HISTORY_MAX) h[k].shift(); });
    }

    // ---------------------------------------------------------- 告警条件复检
    function evaluateAlerts(s, shiftProgress, silent) {
      var d = derive(s, null);

      // 设备故障
      s.devices.forEach(function (dev) {
        var key = 'DEVICE_FAULT:' + dev.id;
        if (dev.status === 'fault') {
          openAlert(s, key, {
            level: 'critical', type: '设备故障', source: dev.id,
            message: dev.name + '（' + dev.model + '）故障，产线联锁停机', lineId: dev.lineId
          }, silent);
        } else closeByKey(s, key, silent);
      });

      // 综合良率
      var yKey = 'QUALITY:YIELD_LOW';
      if (d.yieldRate < C.THRESHOLDS.yieldLow) {
        openAlert(s, yKey, {
          level: 'warning', type: '质量异常', source: 'QMS',
          message: '综合良率 ' + U.fmtFixed(d.yieldRate, 2) + '% 低于管控线 ' + C.THRESHOLDS.yieldLow + '%'
        }, silent);
      } else closeByKey(s, yKey, silent);

      // 库存低于安全线
      s.materials.forEach(function (m) {
        var key = 'MATERIAL:LOW:' + m.id;
        if (m.stock < m.safety * C.THRESHOLDS.stockSafetyRatio) {
          openAlert(s, key, {
            level: m.stock < m.safety * 0.7 ? 'critical' : 'warning', type: '库存预警',
            source: m.id, message: m.name + ' 库存 ' + fmtNum(m.stock) + m.unit + ' 低于安全线 ' + fmtNum(m.safety) + m.unit
          }, silent);
        } else closeByKey(s, key, silent);
      });

      // 节拍异常
      s.lines.forEach(function (line) {
        var key = 'LINE:TAKT:' + line.id;
        if (line.takt && line.takt > baseTakt(line) * C.THRESHOLDS.taktSlowRatio && line.orderId) {
          openAlert(s, key, {
            level: 'warning', type: '节拍超时', source: line.id,
            message: line.name + ' 节拍 ' + U.fmtFixed(line.takt, 1) + 's 超基准 16%，产能受损', lineId: line.id
          }, silent);
        } else closeByKey(s, key, silent);
      });

      // 工单交期风险：交期前 3 小时内且进度落后班次进度 22%
      s.orders.forEach(function (o) {
        if (o.status !== 'running') return;
        var key = 'ORDER:LAG:' + o.id;
        var progress = o.target ? o.completed / o.target : 1;
        var nearDue = o.dueMinutes - s.simMinutes < 180;
        if (nearDue && progress < shiftProgress - C.THRESHOLDS.orderLagRatio) {
          openAlert(s, key, {
            level: 'warning', type: '交期风险', source: o.id,
            message: o.id + ' 进度 ' + U.fmtFixed(progress * 100, 0) + '%，存在交期延误风险', lineId: o.lineId
          }, silent);
        } else closeByKey(s, key, silent);
      });
    }

    // ---------------------------------------------------------- 派生指标（唯一计算出口）
    function derive(s, lineId) {
      s = s || state;
      var lines = lineId ? s.lines.filter(function (l) { return l.id === lineId; }) : s.lines.slice();
      var devices = lineId ? s.devices.filter(function (d) { return d.lineId === lineId; }) : s.devices.slice();
      var orders = lineId ? s.orders.filter(function (o) { return o.lineId === lineId; }) : s.orders.slice();
      var alerts = lineId
        ? s.alerts.filter(function (a) { return a.lineId === lineId || !a.lineId; })
        : s.alerts.slice();
      var events = lineId
        ? s.events.filter(function (e) { return e.lineId === lineId || !e.lineId; })
        : s.events.slice();

      var billIds = [];
      lines.forEach(function (l) { l.bills.forEach(function (b) { if (billIds.indexOf(b.id) < 0) billIds.push(b.id); }); });
      var materials = lineId
        ? s.materials.filter(function (m) { return billIds.indexOf(m.id) >= 0; })
        : s.materials.slice();

      var output = 0, good = 0, defect = 0, plan = 0, taktSum = 0, taktN = 0;
      var counts = { running: 0, idle: 0, fault: 0, maintenance: 0 };
      var defectByType = {};
      MFG.DEFECT_TYPES.forEach(function (t) { defectByType[t.id] = 0; });
      lines.forEach(function (l) {
        output += l.output; good += l.good; defect += l.defect; plan += l.plan;
        counts[l.status]++;
        if (l.takt && l.status === 'running') { taktSum += l.takt; taktN++; }
        MFG.DEFECT_TYPES.forEach(function (t) { defectByType[t.id] += l.defectByType[t.id] || 0; });
      });
      var devRun = devices.filter(function (d) { return d.status === 'running'; }).length;
      var devTotal = devices.length || 1;
      var runtime = 0, devTicks = 0;
      devices.forEach(function (d) { runtime += d.runtimeTicks; devTicks += d.totalTicks; });
      var availability = devTicks ? runtime / devTicks : 1;

      var shiftProgress = clamp((s.simMinutes - C.SHIFT_START_MIN) / (C.SHIFT_END_MIN - C.SHIFT_START_MIN), 0, 1);
      var planToNow = Math.max(1, plan * shiftProgress);
      var yieldRate = output > 0 ? good / output * 100 : 100;
      var avgTakt = taktN ? taktSum / taktN : 0;
      var performance = 0, perfN = 0;
      lines.forEach(function (l) { if (l.takt && l.status === 'running') { performance += Math.min(1.1, baseTakt(l) / l.takt); perfN++; } });
      performance = perfN ? performance / perfN : 1;
      var oee = availability * clamp(performance, 0, 1.1) * (yieldRate / 100) * 100;

      var active = alerts.filter(function (a) { return a.status === 'active'; });
      var runningOrders = orders.filter(function (o) { return o.status === 'running'; });
      var doneOrders = orders.filter(function (o) { return o.status === 'done'; });
      var pendingOrders = orders.filter(function (o) { return o.status === 'pending'; });
      var elapsedHours = Math.max(0.2, (s.simMinutes - C.SHIFT_START_MIN) / 60);

      return {
        scopeLine: lineId || null,
        lines: lines, devices: devices, orders: orders, materials: materials,
        alerts: alerts, events: events,
        counts: counts,
        totalOutput: output, totalGood: good, totalDefect: defect,
        totalPlan: plan, planToNow: planToNow,
        attainment: clamp(output / planToNow * 100, 0, 220),
        shiftProgress: shiftProgress,
        yieldRate: yieldRate, defectRate: 100 - yieldRate,
        avgTakt: avgTakt, hourlyRate: output / elapsedHours,
        deviceRunRate: devRun / devTotal * 100,
        deviceUtilization: availability * 100,
        onlineDevices: devRun, totalDevices: devTotal,
        oee: oee,
        runningLines: counts.running, faultLines: counts.fault,
        activeOrders: runningOrders.length, doneOrders: doneOrders.length,
        pendingOrders: pendingOrders.length,
        onTimeRate: (function () {
          var all = runningOrders.length + doneOrders.length;
          if (!all) return 100;
          var ok = doneOrders.length + runningOrders.filter(function (o) {
            return (o.target ? o.completed / o.target : 0) >= shiftProgress - 0.12;
          }).length;
          return ok / all * 100;
        })(),
        activeAlerts: active.length,
        criticalCount: active.filter(function (a) { return a.level === 'critical'; }).length,
        warningCount: active.filter(function (a) { return a.level === 'warning'; }).length,
        avgRecoveryMin: s.alertsRecovered ? s.recoveryMinutesTotal / s.alertsRecovered : 0,
        materialLowCount: materials.filter(function (m) { return m.stock < m.safety; }).length,
        defectByType: defectByType,
        simClock: fmtClock(s.simMinutes),
        shiftDay: s.shiftDay,
        tick: s.tick,
        lastTickOutput: lineId ? (lines[0] ? lines[0].lastInc : 0) : s.lastTickOutput
      };
    }

    // ---------------------------------------------------------- 对外接口
    function warmup() {
      for (var i = 0; i < C.WARMUP_TICKS; i++) advance(state, i < C.WARMUP_SILENT_UNTIL);
      // 首屏业务场景：两种物料低于安全库存、一种接近警戒线。
      // 随后的自动补料会消除告警，形成「生成 → 处置 → 自动恢复」的完整闭环。
      [['M03', 0.62], ['M05', 0.78], ['M04', 1.12]].forEach(function (p) {
        var m = byId(state.materials, p[0]);
        if (m) m.stock = Math.round(m.safety * p[1]);
      });
      evaluateAlerts(state, clamp((state.simMinutes - C.SHIFT_START_MIN) / 720, 0, 1), false);
      var d = derive(state, null);
      // 注入若干合理的历史快照，保证首屏事件流有内容
      [
        ['order', 'L05 驱动单元总装 进度已达 ' + U.fmtFixed((function () { var o = byId(state.orders, 'WO-2411096'); return o ? o.completed / o.target * 100 : 70; })(), 0) + '%', 'L05'],
        ['quality', '全厂综合良率 ' + U.fmtFixed(d.yieldRate, 2) + '%，过程能力受控', null],
        ['material', '物料齐套校验完成，标准紧固件已配送至总装工位', null],
        ['system', '设备点检完成，' + d.onlineDevices + '/' + d.totalDevices + ' 台设备在线运行', null]
      ].forEach(function (e) { pushEvent(state, e[0], e[1], e[2], false); });
      pushEvent(state, 'system', '监控引擎已启动，实时数据链路建立', null, false);
    }

    var api = {
      bus: bus,
      get state() { return state; },
      init: function () { state = initialState(); warmup(); bus.emit('ready', state); return api; },
      reset: function () { state = initialState(); warmup(); bus.emit('reset', state); return api; },
      tick: function () {
        if (!state || state.paused || state.connection !== 'online') return state;
        try { advance(state, false); }
        catch (err) { bus.emit('error', err); console.error('[mock-engine] tick failed', err); }
        return state;
      },
      derive: function (lineId) { return derive(state, lineId || state.selectedLine); },
      history: function (range, lineId) {
        var scope = lineId || state.selectedLine;
        var src = scope ? (byId(state.lines, scope) || {}).hist : state.history;
        src = src || state.history;
        var n = range || 24;
        return {
          labels: U.tail(src.labels, n), output: U.tail(src.output, n),
          plan: U.tail(src.plan, n), rate: U.tail(src.rate, n),
          yield: U.tail(src.yield, n), takt: U.tail(src.takt || [], n),
          devrun: U.tail(src.devrun || [], n), alerts: U.tail(src.alerts || [], n),
          orders: U.tail(src.orders || [], n)
        };
      },
      selectLine: function (id) {
        state.selectedLine = state.selectedLine === id ? null : id;
        bus.emit('scope', state.selectedLine);
        return state.selectedLine;
      },
      setPaused: function (v) { state.paused = !!v; bus.emit('pause', state.paused); },
      setSpeed: function (v) { state.speed = v; bus.emit('speed', v); },
      setConnection: function (v) { state.connection = v; bus.emit('connection', v); }
    };
    return api;
  }

  MFG.createEngine = createEngine;
})();
