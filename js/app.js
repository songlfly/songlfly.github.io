/* ============================================================
   app.js — 应用主控：加载态、大屏缩放、定时调度、交互、异常态与兜底
   ============================================================ */
(function () {
  'use strict';
  var MFG = window.MFG;
  var U = MFG.U, C = MFG.CONFIG, CH = MFG.Charts;
  var $ = U.$;

  var engine = null, widgets = null;
  var loopStarted = false, bootDone = false, assetsReady = false, bootProgressDone = false;
  var outageTimer = null, renderErrors = 0, errorStateShown = false, scale = 1;
  var SPEEDS = [1, 2, 4];

  // ---------------------------------------------------------- 通用提示
  function toast(msg, kind) {
    var stack = $('#toast-stack');
    if (!stack) return;
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
    }, 2600);
  }

  // ---------------------------------------------------------- 大屏等比缩放
  function layout() {
    var s = Math.min(window.innerWidth / C.SCREEN_W, window.innerHeight / C.SCREEN_H);
    scale = Math.max(0.2, s);
    var screen = $('#screen');
    // 先以容器中心定位画布，再以画布自身中心缩放，避免固定画布撑开布局导致偏移
    if (screen) screen.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
    CH.setScale(scale);
  }

  // ---------------------------------------------------------- 渲染兜底
  function safeRender() {
    if (!engine || !widgets) return;
    try {
      widgets.renderAll();
      renderErrors = 0;
      if (errorStateShown && engine.state.connection === 'online') {
        errorStateShown = false;
        $('#screen').classList.remove('is-stale');
      }
    } catch (err) {
      renderErrors++;
      console.error('[dashboard] render failed', err);
      toast('图表渲染异常：' + (err && err.message ? err.message : '未知错误'), 'error');
      if (renderErrors >= 3) {
        var t = $('#conn-banner-text');
        if (t) t.textContent = '可视化渲染连续异常，请查看控制台日志';
        $('#screen').classList.add('is-stale');
        errorStateShown = true;
      }
    }
  }

  // ---------------------------------------------------------- 连接状态 UI
  function updateConnUI() {
    var st = engine.state;
    var pill = $('#conn-pill'), text = $('#conn-text');
    if (!pill || !text) return;
    pill.className = 'conn-pill';
    if (st.connection === 'offline') {
      pill.classList.add('is-down'); text.textContent = '数据中断';
    } else if (st.paused) {
      pill.classList.add('is-bad'); text.textContent = '已暂停';
    } else {
      text.textContent = '数据正常';
    }
  }

  // ---------------------------------------------------------- 控制动作
  function togglePause() {
    var next = !engine.state.paused;
    engine.setPaused(next);
    var btn = $('#btn-pause');
    btn.textContent = next ? '继续' : '暂停';
    btn.classList.toggle('is-on', next);
    updateConnUI();
    toast(next ? '数据刷新已暂停' : '数据刷新已继续');
    safeRender();
  }

  function cycleSpeed() {
    var i = SPEEDS.indexOf(engine.state.speed);
    var next = SPEEDS[(i + 1) % SPEEDS.length];
    engine.setSpeed(next);
    $('#btn-speed').textContent = next + '×';
    $('#btn-speed').classList.toggle('is-on', next !== 1);
    toast('模拟倍速已切换为 ' + next + '×');
  }

  function triggerOutage() {
    if (engine.state.connection === 'offline') return;
    engine.setConnection('offline');
    $('#screen').classList.add('is-stale');
    $('#conn-banner-text').textContent = '数据源连接中断，正在尝试重连…（模拟数据暂停推送）';
    updateConnUI();
    toast('已注入数据源断流，正在演示异常态', 'warn');
    clearTimeout(outageTimer);
    outageTimer = setTimeout(function () {
      engine.setConnection('online');
      $('#screen').classList.remove('is-stale');
      updateConnUI();
      toast('数据链路已恢复，实时刷新继续');
      safeRender();
    }, 5200);
  }

  function resetAll() {
    clearTimeout(outageTimer);
    engine.reset();
    $('#screen').classList.remove('is-stale');
    var btn = $('#btn-pause');
    btn.textContent = '暂停'; btn.classList.remove('is-on');
    $('#btn-speed').textContent = '1×'; $('#btn-speed').classList.remove('is-on');
    updateConnUI();
    CH.hideTip();
    safeRender();
    toast('模拟数据已重置，班次历史重新回放');
  }

  function toggleHelp(force) {
    var m = $('#help-modal');
    var open = force === undefined ? !m.classList.contains('is-open') : force;
    m.classList.toggle('is-open', open);
  }

  // ---------------------------------------------------------- 交互绑定
  function bindEvents() {
    $('#btn-pause').addEventListener('click', togglePause);
    $('#btn-speed').addEventListener('click', cycleSpeed);
    $('#btn-outage').addEventListener('click', triggerOutage);
    $('#btn-reset').addEventListener('click', resetAll);
    $('#btn-help').addEventListener('click', function () { toggleHelp(true); });
    $('#btn-help-close').addEventListener('click', function () { toggleHelp(false); });
    $('#help-modal').addEventListener('click', function (e) {
      if (e.target === this) toggleHelp(false);
    });

    // 产线全局联动下钻（事件委托，列表每次重绘仍有效）
    $('#lines-list').addEventListener('click', function (e) {
      var row = e.target.closest ? e.target.closest('.line-row') : null;
      if (!row) return;
      var id = row.getAttribute('data-line');
      if (!id) return;
      var selected = engine.selectLine(id);
      safeRender();
      toast(selected ? '已聚焦 ' + id + '，全屏指标联动切换' : '已恢复全厂汇总视图');
    });

    // 趋势时间范围
    $('#output-range').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('button[data-range]') : null;
      if (!btn) return;
      U.$$('#output-range button').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      widgets.range = parseInt(btn.getAttribute('data-range'), 10) || 24;
      CH.hideTip();
      safeRender();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { toggleHelp(false); return; }
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); togglePause(); }
      else if (e.key === 'r' || e.key === 'R') resetAll();
      else if (e.key === 'h' || e.key === 'H' || e.key === '?') toggleHelp(true);
    });

    window.addEventListener('resize', U.rafThrottle(function () {
      layout();
      safeRender();
    }));
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) safeRender();
    });
    window.addEventListener('error', function (ev) {
      console.error('[dashboard] uncaught', ev.error || ev.message);
    });
  }

  // ---------------------------------------------------------- 真实时钟
  function updateClock() {
    var n = new Date();
    var week = ['日', '一', '二', '三', '四', '五', '六'][n.getDay()];
    var el = $('#clock-time'), dt = $('#clock-date');
    if (el) el.textContent = U.pad2(n.getHours()) + ':' + U.pad2(n.getMinutes()) + ':' + U.pad2(n.getSeconds());
    if (dt) dt.textContent = n.getFullYear() + '年' + U.pad2(n.getMonth() + 1) + '月' + U.pad2(n.getDate()) + '日  星期' + week;
  }

  // ---------------------------------------------------------- 定时调度
  function startLoop() {
    if (loopStarted) return;
    loopStarted = true;
    setInterval(function () {
      if (document.hidden) return;
      var st = engine.state;
      if (st.connection !== 'online' || st.paused) return;
      engine.tick();
      safeRender();
    }, C.TICK_MS);
    setInterval(updateClock, 1000);
    updateClock();
  }

  // ---------------------------------------------------------- 启动加载态
  function bootStep(p) {
    var msg = p < 22 ? '正在初始化数据模拟引擎…'
      : p < 46 ? '正在装载产线 / 设备 / 工单主数据…'
      : p < 70 ? '正在回放班次历史与联动状态…'
      : p < 92 ? '正在绘制可视化图表…'
      : '数据链路建立完成，即将进入大屏';
    var el = $('#boot-step');
    if (el) el.textContent = msg;
  }

  function maybeStart() {
    if (bootDone || !assetsReady || !bootProgressDone) return;
    bootDone = true;
    var loader = $('#boot-loader');
    if (loader) loader.classList.add('is-hidden');
    setTimeout(function () { if (loader && loader.parentNode) loader.parentNode.removeChild(loader); }, 700);
    bindEvents();
    updateConnUI();
    startLoop();
    toast('监控大屏已就绪，数据每 2 秒刷新');
  }

  function boot() {
    var p = 0;
    var bar = $('#boot-progress');
    var timer = setInterval(function () {
      p = Math.min(100, p + U.rand(7, 15));
      if (bar) bar.style.width = p + '%';
      bootStep(p);
      if (p >= 100) {
        clearInterval(timer);
        bootProgressDone = true;
        maybeStart();
      }
    }, 75);

    // 分步完成初始化，避免加载动画与计算互相阻塞
    setTimeout(function () {
      try {
        engine = MFG.createEngine();
        engine.init();
      } catch (err) {
        console.error('[dashboard] engine init failed', err);
        var el = $('#boot-step');
        if (el) el.textContent = '数据引擎初始化失败：' + err.message;
        toast('数据引擎初始化失败', 'error');
      }
    }, 120);

    setTimeout(function () {
      try {
        if (!engine) return;
        widgets = MFG.createWidgets(engine);
        layout();
        safeRender();
        assetsReady = true;
        maybeStart();
      } catch (err) {
        console.error('[dashboard] widgets init failed', err);
        toast('可视化模块初始化失败：' + err.message, 'error');
      }
    }, 320);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
