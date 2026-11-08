/**
 * 统计与分组 —— 纯函数，不碰存储，方便单测和跨端复用
 *
 * 所有金额参数与返回值都是「分」（整数），格式化交给 money.js。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Stats = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  /** (2026, 11) -> "2026-11" */
  function monthKey(year, month) {
    return year + '-' + pad2(month);
  }

  /** "2026-11-08" -> "2026-11" */
  function monthOf(dateStr) {
    return String(dateStr || '').slice(0, 7);
  }

  /** "2026-11-08" -> "2026-11-08"，容错处理非标准输入 */
  function normalizeDate(dateStr) {
    var s = String(dateStr || '');
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return '';
    return m[1] + '-' + pad2(m[2]) + '-' + pad2(m[3]);
  }

  /**
   * 月份平移，delta 可正可负。
   * shiftMonth(2026, 1, -1) => { year: 2025, month: 12 }
   */
  function shiftMonth(year, month, delta) {
    var idx = year * 12 + (month - 1) + delta;
    return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
  }

  function monthLabel(year, month) {
    return year + '年' + month + '月';
  }

  function filterByMonth(records, year, month) {
    var key = monthKey(year, month);
    return (records || []).filter(function (r) {
      return monthOf(r.date) === key;
    });
  }

  /** 收支合计（分） */
  function totals(records) {
    var income = 0;
    var expense = 0;
    (records || []).forEach(function (r) {
      if (r.type === 'income') income += r.amount;
      else expense += r.amount;
    });
    return { income: income, expense: expense, balance: income - expense };
  }

  /**
   * 按日期分组，日期倒序；同一天内按创建时间倒序。
   * 返回 [{ date, label, records, dayIncome, dayExpense }]
   */
  function groupByDate(records, refDate) {
    var groups = {};
    var order = [];

    (records || []).forEach(function (r) {
      var date = normalizeDate(r.date);
      if (!date) return;
      if (!groups[date]) {
        groups[date] = [];
        order.push(date);
      }
      groups[date].push(r);
    });

    // 日期是 YYYY-MM-DD 定长格式，直接字符串比较即可，比 new Date() 更稳更快
    order.sort(function (a, b) {
      return b < a ? -1 : b > a ? 1 : 0;
    });

    return order.map(function (date) {
      var dayRecords = groups[date].slice().sort(function (a, b) {
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
      var dayTotals = totals(dayRecords);
      return {
        date: date,
        label: dateLabel(date, refDate),
        records: dayRecords,
        dayIncome: dayTotals.income,
        dayExpense: dayTotals.expense
      };
    });
  }

  /** 今天 / 昨天 / M月D日 / YYYY年M月D日（跨年时补年份） */
  function dateLabel(dateStr, refDate) {
    var target = normalizeDate(dateStr);
    if (!target) return '';

    var now = refDate ? new Date(refDate) : new Date();
    var todayStr = dateToString(now);

    var yesterday = new Date(now.getTime());
    yesterday.setDate(yesterday.getDate() - 1);
    var yesterdayStr = dateToString(yesterday);

    if (target === todayStr) return '今天';
    if (target === yesterdayStr) return '昨天';

    var parts = target.split('-');
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var d = parseInt(parts[2], 10);

    if (y !== now.getFullYear()) return y + '年' + m + '月' + d + '日';
    return m + '月' + d + '日';
  }

  function dateToString(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  /**
   * 按分类汇总，金额降序。
   * 返回 [{ name, icon, amount, percent, count }]，percent 是 0-100 的整数
   */
  function byCategory(records, type, iconResolver) {
    var map = {};
    var sum = 0;

    (records || []).forEach(function (r) {
      if (r.type !== type) return;
      var name = r.category || '其他';
      if (!map[name]) map[name] = { name: name, amount: 0, count: 0 };
      map[name].amount += r.amount;
      map[name].count += 1;
      sum += r.amount;
    });

    var list = Object.keys(map).map(function (name) {
      var item = map[name];
      return {
        name: name,
        icon: iconResolver ? iconResolver(type, name) : '',
        amount: item.amount,
        count: item.count,
        percent: sum > 0 ? Math.round((item.amount / sum) * 100) : 0
      };
    });

    list.sort(function (a, b) {
      return b.amount - a.amount;
    });

    // 修正四舍五入后百分比总和不等于 100 的问题：差量补到占比最大的那项
    if (list.length > 0 && sum > 0) {
      var total = list.reduce(function (acc, item) {
        return acc + item.percent;
      }, 0);
      if (total !== 100) {
        list[0].percent += 100 - total;
      }
    }

    return list;
  }

  /**
   * 最近 count 个月（含当前月）的收支，按时间正序返回，用于柱状图。
   * 返回 [{ year, month, label, income, expense }]
   */
  function recentMonths(records, count, refYear, refMonth) {
    var out = [];
    for (var i = count - 1; i >= 0; i--) {
      var ym = shiftMonth(refYear, refMonth, -i);
      var monthRecords = filterByMonth(records, ym.year, ym.month);
      var t = totals(monthRecords);
      out.push({
        year: ym.year,
        month: ym.month,
        label: ym.month + '月',
        income: t.income,
        expense: t.expense
      });
    }
    return out;
  }

  /**
   * 预算进度。
   * 返回 { hasBudget, percent, overflowPercent, remaining, overBudget }
   */
  function budgetProgress(expense, budget) {
    var hasBudget = budget > 0;
    if (!hasBudget) {
      return { hasBudget: false, percent: 0, overflowPercent: 0, remaining: 0, overBudget: false };
    }
    var remaining = budget - expense;
    return {
      hasBudget: true,
      percent: Math.min(100, Math.round((expense / budget) * 100)),
      // 超支时进度条需要冲出 100%，这里给出封顶后的额外比例，由样式层限制最大宽度
      overflowPercent: expense > budget ? Math.round((expense / budget) * 100) : 0,
      remaining: remaining,
      overBudget: expense > budget
    };
  }

  return {
    pad2: pad2,
    monthKey: monthKey,
    monthOf: monthOf,
    normalizeDate: normalizeDate,
    dateToString: dateToString,
    shiftMonth: shiftMonth,
    monthLabel: monthLabel,
    filterByMonth: filterByMonth,
    totals: totals,
    groupByDate: groupByDate,
    dateLabel: dateLabel,
    byCategory: byCategory,
    recentMonths: recentMonths,
    budgetProgress: budgetProgress
  };
});
