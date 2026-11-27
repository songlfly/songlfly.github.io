/* ============================================================
   config.js — 全局配置与基础主数据（产线 / 设备 / 物料 / 工单）
   所有业务模块的元数据中心，模拟引擎与渲染层共用
   ============================================================ */
(function () {
  'use strict';
  var MFG = (window.MFG = window.MFG || {});

  var CONFIG = {
    SCREEN_W: 1920,
    SCREEN_H: 1080,
    TICK_MS: 2000,               // 真实刷新周期
    SIM_MINUTES_PER_TICK: 5,     // 每个 tick 代表的模拟分钟数
    SHIFT_START_MIN: 8 * 60,     // 08:00
    SHIFT_END_MIN: 20 * 60,      // 20:00
    WARMUP_TICKS: 72,            // 预跑 6 小时，使图表与指标一开始就有真实历史
    WARMUP_SILENT_UNTIL: 64,     // 前 64 tick 不生成事件/告警，避免历史事件刷屏
    HISTORY_MAX: 240,            // 历史采样点上限
    EVENT_MAX: 90,
    ALERT_MAX: 70,
    THRESHOLDS: {
      yieldLow: 96.0,            // 综合良率低于该值触发告警（%）
      taktSlowRatio: 1.16,       // 节拍超过基准 16% 触发告警
      orderLagRatio: 0.22,       // 工单进度落后班次进度 22% 触发告警
      stockSafetyRatio: 1.0      // 库存 / 安全库存 低于 1 触发告警
    },
    STATUS: {
      running:     { label: '运行中', en: 'RUNNING',     color: '#2fe3a7' },
      idle:        { label: '待机',   en: 'IDLE',        color: '#9fb9d6' },
      fault:       { label: '故障',   en: 'FAULT',       color: '#ff5f73' },
      maintenance: { label: '保养',   en: 'MAINTENANCE', color: '#ffb648' }
    },
    PALETTE: {
      cyan: '#3ddcff', blue: '#4a92ff', green: '#2fe3a7', amber: '#ffb648',
      red: '#ff5f73', purple: '#a486ff', grid: 'rgba(90, 160, 220, 0.13)',
      axis: 'rgba(150, 190, 225, 0.55)', text: '#7f9cbb'
    }
  };

  // ---------------- 产线主数据 ----------------
  // plan: 班次计划产量(件) / takt: 标准节拍(秒/件) / baseDefect: 基础不良率
  var LINES = [
    { id: 'L01', name: '精密冲压线', workshop: '一车间', plan: 1180, takt: 30, baseDefect: 0.019, phase: 0.4,
      bills: [{ id: 'M01', per: 1.8 }, { id: 'M05', per: 0.55 }] },
    { id: 'L02', name: 'CNC 加工线', workshop: '一车间', plan: 1100, takt: 32, baseDefect: 0.023, phase: 1.3,
      bills: [{ id: 'M02', per: 1.4 }] },
    { id: 'L03', name: '自动焊装线', workshop: '二车间', plan: 1040, takt: 34, baseDefect: 0.028, phase: 2.1,
      bills: [{ id: 'M03', per: 0.35 }, { id: 'M05', per: 1.1 }] },
    { id: 'L04', name: '表面处理线', workshop: '二车间', plan: 1000, takt: 35, baseDefect: 0.025, phase: 3.0,
      bills: [{ id: 'M04', per: 0.5 }, { id: 'M05', per: 0.35 }] },
    { id: 'L05', name: '总装一线',   workshop: '三车间', plan: 1200, takt: 29, baseDefect: 0.017, phase: 4.2,
      bills: [{ id: 'M05', per: 2.3 }] },
    { id: 'L06', name: '总装二线',   workshop: '三车间', plan: 1080, takt: 33, baseDefect: 0.021, phase: 5.1,
      bills: [{ id: 'M06', per: 1.6 }, { id: 'M05', per: 0.45 }] }
  ];

  // ---------------- 设备主数据 ----------------
  var DEVICES = [
    { id: 'D0101', lineId: 'L01', name: '伺服冲压机 A',  model: 'SP-800' },
    { id: 'D0102', lineId: 'L01', name: '自动送料机',    model: 'AF-210' },
    { id: 'D0103', lineId: 'L01', name: '视觉检测台',    model: 'VI-30'  },
    { id: 'D0201', lineId: 'L02', name: 'CNC 加工中心 A', model: 'CNC-640' },
    { id: 'D0202', lineId: 'L02', name: 'CNC 加工中心 B', model: 'CNC-640' },
    { id: 'D0203', lineId: 'L02', name: '自动刀库',      model: 'TC-120' },
    { id: 'D0301', lineId: 'L03', name: '焊接机器人 A',  model: 'RB-06'  },
    { id: 'D0302', lineId: 'L03', name: '焊接机器人 B',  model: 'RB-06'  },
    { id: 'D0303', lineId: 'L03', name: '输送链系统',    model: 'CV-400' },
    { id: 'D0401', lineId: 'L04', name: '静电喷涂机',    model: 'PT-90'  },
    { id: 'D0402', lineId: 'L04', name: '固化烘干炉',    model: 'OV-12'  },
    { id: 'D0403', lineId: 'L04', name: '超声波清洗槽',  model: 'UC-55'  },
    { id: 'D0501', lineId: 'L05', name: '装配工位 A',    model: 'AS-01'  },
    { id: 'D0502', lineId: 'L05', name: '自动拧紧机',    model: 'TT-70'  },
    { id: 'D0503', lineId: 'L05', name: '终检测试台',    model: 'FT-22'  },
    { id: 'D0601', lineId: 'L06', name: '装配工位 B',    model: 'AS-02'  },
    { id: 'D0602', lineId: 'L06', name: '自动拧紧机 B',  model: 'TT-70'  },
    { id: 'D0603', lineId: 'L06', name: '自动包装机',    model: 'PK-18'  }
  ];

  // ---------------- 物料主数据 ----------------
  // stock: 初始库存 / capacity: 库容 / safety: 安全库存 / refill: 单次补料量
  var MATERIALS = [
    { id: 'M01', name: '冷轧钢板',     unit: 'kg', capacity: 4200, stock: 2680, safety: 1700, refill: 1700 },
    { id: 'M02', name: '铝合金型材',   unit: 'kg', capacity: 3600, stock: 2280, safety: 1450, refill: 1500 },
    { id: 'M03', name: '焊丝',         unit: 'kg', capacity: 900,  stock: 420,  safety: 360,  refill: 520  },
    { id: 'M04', name: '涂装涂料',     unit: 'L',  capacity: 1400, stock: 760,  safety: 560,  refill: 620  },
    { id: 'M05', name: '标准紧固件',   unit: '套', capacity: 9000, stock: 5120, safety: 3800, refill: 3600 },
    { id: 'M06', name: '包装耗材',     unit: '套', capacity: 6000, stock: 3480, safety: 2500, refill: 2400 }
  ];

  // ---------------- 工单主数据 ----------------
  var ORDERS = [
    { id: 'WO-2411087', product: '电机端盖组件',   lineId: 'L01', target: 980,  due: '16:30', priority: '高' },
    { id: 'WO-2411088', product: '精密齿轮箱壳体', lineId: 'L02', target: 860,  due: '17:00', priority: '普通' },
    { id: 'WO-2411091', product: '底盘焊接总成',   lineId: 'L03', target: 920,  due: '17:20', priority: '高' },
    { id: 'WO-2411093', product: '喷涂外壳 A 型',  lineId: 'L04', target: 780,  due: '18:00', priority: '普通' },
    { id: 'WO-2411096', product: '驱动单元总装',   lineId: 'L05', target: 1120, due: '18:40', priority: '高' },
    { id: 'WO-2411099', product: '控制面板总成',   lineId: 'L06', target: 840,  due: '19:10', priority: '普通' },
    { id: 'WO-2411102', product: '伺服电机装配',   lineId: 'L02', target: 760,  due: '19:30', priority: '普通' },
    { id: 'WO-2411105', product: '传动轴套件',     lineId: 'L01', target: 890,  due: '19:50', priority: '普通' },
    { id: 'WO-2411108', product: '支架焊接件',     lineId: 'L03', target: 700,  due: '20:00', priority: '普通' },
    { id: 'WO-2411110', product: '成品包装批次 A', lineId: 'L06', target: 920,  due: '20:00', priority: '普通' }
  ];

  var DEFECT_TYPES = [
    { id: 'dimension', name: '尺寸超差', color: '#4a92ff' },
    { id: 'surface',   name: '表面缺陷', color: '#a486ff' },
    { id: 'weld',      name: '焊接不良', color: '#ffb648' },
    { id: 'assembly',  name: '装配偏差', color: '#ff5f73' },
    { id: 'other',     name: '其他',     color: '#3ddcff' }
  ];

  var ALERT_LEVELS = {
    critical: { label: '严重', color: '#ff5f73' },
    warning:  { label: '警告', color: '#ffb648' },
    info:     { label: '提示', color: '#4a92ff' }
  };

  var EVENT_TONES = {
    device:   { color: '#ff5f73', label: '设备' },
    line:     { color: '#4a92ff', label: '产线' },
    order:    { color: '#2fe3a7', label: '工单' },
    material: { color: '#ffb648', label: '物料' },
    quality:  { color: '#a486ff', label: '质量' },
    alert:    { color: '#ff5f73', label: '告警' },
    recover:  { color: '#2fe3a7', label: '恢复' },
    system:   { color: '#3ddcff', label: '系统' }
  };

  MFG.CONFIG = CONFIG;
  MFG.LINES = LINES;
  MFG.DEVICES = DEVICES;
  MFG.MATERIALS = MATERIALS;
  MFG.ORDERS = ORDERS;
  MFG.DEFECT_TYPES = DEFECT_TYPES;
  MFG.ALERT_LEVELS = ALERT_LEVELS;
  MFG.EVENT_TONES = EVENT_TONES;
})();
