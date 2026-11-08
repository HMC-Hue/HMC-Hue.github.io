/**
 * 存储适配层 —— 小程序与浏览器共用同一份代码
 *
 * 对外只暴露业务语义（getRecords / addRecord / setBudget ...），
 * 内部根据运行环境自动选择 wx.setStorageSync 还是 localStorage。
 * 以后要加云同步，只改这个文件里的 adapter 即可，页面完全不用动。
 *
 * 数据格式 v2：
 *   acct.v2.records  [{ id, amount(分), type, category, note, date, createdAt, sample? }]
 *   acct.v2.budget   { "2026-11": 300000 }   按月存，单位分
 *   acct.v2.meta     { schema: 2, seeded: true }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Store = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SCHEMA = 2;
  var KEY_RECORDS = 'acct.v2.records';
  var KEY_BUDGET = 'acct.v2.budget';
  var KEY_META = 'acct.v2.meta';

  // v1 的历史键，仅用于迁移
  var LEGACY_RECORDS = 'records';
  var LEGACY_BUDGET = 'budget';

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function monthKey(year, month) {
    return year + '-' + pad2(month);
  }

  /* ------------------------------------------------------------------ *
   * 环境适配
   * ------------------------------------------------------------------ */

  function createWxAdapter() {
    return {
      name: 'wx',
      read: function (key, fallback) {
        try {
          var value = wx.getStorageSync(key);
          if (value === '' || value === undefined || value === null) return fallback;
          return value;
        } catch (e) {
          return fallback;
        }
      },
      write: function (key, value) {
        try {
          wx.setStorageSync(key, value);
          return true;
        } catch (e) {
          // 存储超限等异常不应让页面白屏
          return false;
        }
      }
    };
  }

  function createBrowserAdapter() {
    return {
      name: 'localStorage',
      read: function (key, fallback) {
        try {
          var raw = window.localStorage.getItem(key);
          if (raw === null) return fallback;
          return JSON.parse(raw);
        } catch (e) {
          return fallback;
        }
      },
      write: function (key, value) {
        try {
          window.localStorage.setItem(key, JSON.stringify(value));
          return true;
        } catch (e) {
          // 隐私模式或配额用尽
          return false;
        }
      }
    };
  }

  function createMemoryAdapter() {
    var mem = {};
    return {
      name: 'memory',
      read: function (key, fallback) {
        return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : fallback;
      },
      write: function (key, value) {
        mem[key] = value;
        return true;
      }
    };
  }

  function detectAdapter() {
    if (typeof wx !== 'undefined' && wx && typeof wx.getStorageSync === 'function') {
      return createWxAdapter();
    }
    if (typeof window !== 'undefined' && window.localStorage) {
      return createBrowserAdapter();
    }
    return createMemoryAdapter();
  }

  var adapter = detectAdapter();

  /* ------------------------------------------------------------------ *
   * 基础读写
   * ------------------------------------------------------------------ */

  function readMeta() {
    var meta = adapter.read(KEY_META, null);
    return meta && typeof meta === 'object' ? meta : {};
  }

  function writeMeta(meta) {
    return adapter.write(KEY_META, meta);
  }

  function getRecords() {
    var records = adapter.read(KEY_RECORDS, []);
    return Array.isArray(records) ? records : [];
  }

  function persistRecords(records) {
    return adapter.write(KEY_RECORDS, records);
  }

  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ------------------------------------------------------------------ *
   * 迁移：v1（金额单位元、无 schema）-> v2（金额单位分）
   * ------------------------------------------------------------------ */

  function migrate() {
    var meta = readMeta();
    if (meta.schema >= SCHEMA) return;

    var legacyRecords = adapter.read(LEGACY_RECORDS, null);
    var migratedCount = 0;

    if (Array.isArray(legacyRecords) && legacyRecords.length > 0) {
      var converted = legacyRecords.map(function (r, index) {
        var amount = Number(r.amount);
        if (!isFinite(amount)) amount = 0;
        return {
          id: String(r.id || genId()),
          // v1 的 amount 单位是元，迁移时转成分
          amount: Math.round(amount * 100),
          type: r.type === 'income' ? 'income' : 'expense',
          category: r.category || '其他',
          note: r.note || '',
          date: r.date || '',
          createdAt: Number(r.id) || Date.now() + index
        };
      });
      persistRecords(converted);
      migratedCount = converted.length;
    }

    var legacyBudget = adapter.read(LEGACY_BUDGET, null);
    if (legacyBudget && typeof legacyBudget === 'object') {
      var budgets = {};
      Object.keys(legacyBudget).forEach(function (key) {
        var amount = Number(legacyBudget[key]);
        if (isFinite(amount) && amount > 0) {
          budgets[key] = Math.round(amount * 100);
        }
      });
      adapter.write(KEY_BUDGET, budgets);
    }

    writeMeta({
      schema: SCHEMA,
      // 已有历史数据就视为「用户已经在用了」，不要再塞示例数据
      seeded: migratedCount > 0
    });
  }

  /* ------------------------------------------------------------------ *
   * 示例数据
   * ------------------------------------------------------------------ */

  function buildSampleRecords(now) {
    var base = now || new Date();
    var year = base.getFullYear();
    var month = base.getMonth() + 1;
    var today = base.getDate();

    // 本月内的日期不能超过今天，历史月份则不需要限制
    function makeRecord(monthsAgo, day, hour, amount, type, category, note, index) {
      var d = new Date(year, month - 1 - monthsAgo, day, hour || 12, 0, 0);
      return {
        id: 'sample-' + index,
        amount: amount,
        type: type,
        category: category,
        note: note,
        date: d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()),
        createdAt: d.getTime(),
        sample: true
      };
    }

    var todayDay = function (offset) {
      return Math.max(1, today - offset);
    };

    var specs = [
      // 本月
      { ago: 0, day: todayDay(1), hour: 9, amount: 1000000, type: 'income', category: '工资', note: '本月工资' },
      { ago: 0, day: todayDay(0), hour: 10, amount: 3200, type: 'expense', category: '餐饮', note: '咖啡' },
      { ago: 0, day: todayDay(1), hour: 15, amount: 19800, type: 'expense', category: '购物', note: '日用品' },
      { ago: 0, day: todayDay(0), hour: 8, amount: 600, type: 'expense', category: '交通', note: '地铁' },
      // 上月
      { ago: 1, day: 5, hour: 9, amount: 1000000, type: 'income', category: '工资', note: '工资' },
      { ago: 1, day: 8, hour: 19, amount: 68000, type: 'expense', category: '餐饮', note: '和朋友吃饭' },
      { ago: 1, day: 15, hour: 14, amount: 129900, type: 'expense', category: '购物', note: '换季衣服' },
      { ago: 1, day: 2, hour: 10, amount: 250000, type: 'expense', category: '居家', note: '房租水电' },
      // 两个月前
      { ago: 2, day: 5, hour: 9, amount: 1000000, type: 'income', category: '工资', note: '工资' },
      { ago: 2, day: 12, hour: 20, amount: 42000, type: 'expense', category: '餐饮', note: '聚餐' },
      { ago: 2, day: 18, hour: 16, amount: 8600, type: 'expense', category: '交通', note: '打车' },
      // 三个月前
      { ago: 3, day: 5, hour: 9, amount: 1000000, type: 'income', category: '工资', note: '工资' },
      { ago: 3, day: 20, hour: 21, amount: 32000, type: 'expense', category: '娱乐', note: '电影和游戏' }
    ];

    return specs.map(function (spec, index) {
      return makeRecord(
        spec.ago,
        spec.day,
        spec.hour,
        spec.amount,
        spec.type,
        spec.category,
        spec.note,
        index
      );
    });
  }

  /**
   * 只播种一次。
   * 关键修复：用独立 seeded 标记，而不是判断 records.length === 0，
   * 否则用户把记录删光后重启，示例数据会「复活」。
   */
  function ensureSeeded(options) {
    var opts = options || {};
    var meta = readMeta();
    if (meta.seeded) return false;

    if (opts.enabled !== false && getRecords().length === 0) {
      persistRecords(buildSampleRecords());
    }

    writeMeta({ schema: SCHEMA, seeded: true });
    return true;
  }

  function hasSampleData() {
    return getRecords().some(function (r) {
      return !!r.sample;
    });
  }

  /** 一键清掉示例数据，让访客从空账本开始 */
  function removeSampleData() {
    var kept = getRecords().filter(function (r) {
      return !r.sample;
    });
    persistRecords(kept);
    return kept;
  }

  /* ------------------------------------------------------------------ *
   * 记录增删改
   * ------------------------------------------------------------------ */

  function getRecord(id) {
    var target = String(id);
    var found = null;
    getRecords().forEach(function (r) {
      if (String(r.id) === target) found = r;
    });
    return found;
  }

  function addRecord(payload) {
    var records = getRecords();
    var record = {
      id: genId(),
      amount: Math.round(Number(payload.amount) || 0),
      type: payload.type === 'income' ? 'income' : 'expense',
      category: payload.category || '其他',
      note: payload.note || '',
      date: payload.date || '',
      createdAt: Date.now()
    };
    records.push(record);
    var ok = persistRecords(records);
    return ok ? record : null;
  }

  function updateRecord(id, patch) {
    var target = String(id);
    var records = getRecords();
    var index = -1;
    for (var i = 0; i < records.length; i++) {
      if (String(records[i].id) === target) {
        index = i;
        break;
      }
    }
    if (index === -1) return null;

    var next = Object.assign({}, records[index], patch, {
      amount: Math.round(Number(patch.amount !== undefined ? patch.amount : records[index].amount) || 0)
    });
    records[index] = next;
    persistRecords(records);
    return next;
  }

  /** 返回被删除的记录，供撤销使用 */
  function deleteRecord(id) {
    var target = String(id);
    var records = getRecords();
    var removed = null;
    var kept = [];

    records.forEach(function (r) {
      if (!removed && String(r.id) === target) {
        removed = r;
        return;
      }
      kept.push(r);
    });

    if (!removed) return null;
    persistRecords(kept);
    return removed;
  }

  function restoreRecord(record) {
    if (!record) return false;
    var records = getRecords();
    records.push(record);
    return persistRecords(records);
  }

  function clearAll() {
    persistRecords([]);
    adapter.write(KEY_BUDGET, {});
    writeMeta({ schema: SCHEMA, seeded: true });
  }

  /* ------------------------------------------------------------------ *
   * 预算（按月，单位分）
   * ------------------------------------------------------------------ */

  function getBudgetMap() {
    var map = adapter.read(KEY_BUDGET, {});
    return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  }

  function getBudget(year, month) {
    var value = getBudgetMap()[monthKey(year, month)];
    var n = Number(value);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function setBudget(year, month, cents) {
    var map = getBudgetMap();
    var key = monthKey(year, month);
    var n = Math.round(Number(cents) || 0);
    if (n > 0) map[key] = n;
    else delete map[key];
    return adapter.write(KEY_BUDGET, map);
  }

  function clearBudget(year, month) {
    return setBudget(year, month, 0);
  }

  return {
    SCHEMA: SCHEMA,
    adapterName: function () {
      return adapter.name;
    },
    migrate: migrate,
    ensureSeeded: ensureSeeded,
    hasSampleData: hasSampleData,
    removeSampleData: removeSampleData,
    getRecords: getRecords,
    getRecord: getRecord,
    addRecord: addRecord,
    updateRecord: updateRecord,
    deleteRecord: deleteRecord,
    restoreRecord: restoreRecord,
    clearAll: clearAll,
    getBudget: getBudget,
    setBudget: setBudget,
    clearBudget: clearBudget
  };
});
