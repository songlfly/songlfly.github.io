/* ============================================================
   utils.js — 通用工具函数（数值、格式化、DOM、事件总线）
   ============================================================ */
(function () {
  'use strict';
  var MFG = (window.MFG = window.MFG || {});

  function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
  function chance(p) { return Math.random() < p; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function gauss(mean, sd) {
    var u = 1 - Math.random(), v = Math.random();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtNum(n, digits) {
    if (!isFinite(n)) return '--';
    var d = digits === undefined ? 0 : digits;
    return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtPct(n, digits) { return (isFinite(n) ? n.toFixed(digits === undefined ? 1 : digits) : '--') + '%'; }
  function fmtFixed(n, d) { return isFinite(n) ? n.toFixed(d === undefined ? 1 : d) : '--'; }
  function fmtClock(minutesFromMidnight) {
    var m = ((Math.round(minutesFromMidnight) % 1440) + 1440) % 1440;
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }
  function shortNum(n) {
    if (!isFinite(n)) return '--';
    if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + '万';
    if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(Math.round(n));
  }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function niceCeil(v) {
    if (!isFinite(v) || v <= 0) return 10;
    var exp = Math.pow(10, Math.floor(Math.log10(v)));
    var f = v / exp;
    var step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return step * exp;
  }
  function sum(arr) { var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i] || 0; return s; }
  function avg(arr) { return arr.length ? sum(arr) / arr.length : 0; }
  function tail(arr, n) { return arr.slice(Math.max(0, arr.length - n)); }
  function makeEmitter() {
    var map = {};
    return {
      on: function (name, fn) { (map[name] = map[name] || []).push(fn); return this; },
      emit: function (name, payload) {
        var list = map[name] || [];
        for (var i = 0; i < list.length; i++) {
          try { list[i](payload); } catch (e) { console.error('[emitter] ' + name, e); }
        }
      }
    };
  }
  function uuid(prefix) {
    var seq = uuid._seq = (uuid._seq || 0) + 1;
    return (prefix || 'id') + '-' + String(seq).padStart(5, '0');
  }
  function rafThrottle(fn) {
    var pending = false, lastArgs = null;
    return function () {
      lastArgs = arguments;
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; fn.apply(null, lastArgs); });
    };
  }

  MFG.U = {
    clamp: clamp, lerp: lerp, rand: rand, randInt: randInt, chance: chance, pick: pick,
    gauss: gauss, pad2: pad2, fmtNum: fmtNum, fmtPct: fmtPct, fmtFixed: fmtFixed,
    fmtClock: fmtClock, shortNum: shortNum, esc: esc, $: $, $$: $$, niceCeil: niceCeil,
    sum: sum, avg: avg, tail: tail, makeEmitter: makeEmitter, uuid: uuid, rafThrottle: rafThrottle
  };
})();
