/**
 * 分类定义 —— 全项目唯一真源
 *
 * 之前分类数据散落在 add.js、app.js 和 index.wxml 的九层三元表达式里，
 * 新增一个分类要改三处。现在只改这里。
 *
 * 注意：收入与支出都有「其他」，所以内部索引用 `type + ':' + name`，
 * 不能用 name 单独做键。
 *
 * 替换图标：把 icon 换成 iconfont 字符或 svg 资源名即可，调用方无需改动。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Categories = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var EXPENSE = [
    { key: 'food', name: '餐饮', icon: '🍜' },
    { key: 'traffic', name: '交通', icon: '🚗' },
    { key: 'shopping', name: '购物', icon: '🛒' },
    { key: 'fun', name: '娱乐', icon: '🎮' },
    { key: 'home', name: '居家', icon: '🏠' },
    { key: 'study', name: '学习', icon: '📚' },
    { key: 'medical', name: '医疗', icon: '🏥' },
    { key: 'other', name: '其他', icon: '📝' }
  ];

  var INCOME = [
    { key: 'salary', name: '工资', icon: '💼' },
    { key: 'bonus', name: '奖金', icon: '🎁' },
    { key: 'invest', name: '理财', icon: '📈' },
    { key: 'parttime', name: '兼职', icon: '🧾' },
    { key: 'other', name: '其他', icon: '💰' }
  ];

  var INDEX = {};
  EXPENSE.forEach(function (item) {
    INDEX['expense:' + item.name] = item;
  });
  INCOME.forEach(function (item) {
    INDEX['income:' + item.name] = item;
  });

  function normalizeType(type) {
    return type === 'income' ? 'income' : 'expense';
  }

  function list(type) {
    return normalizeType(type) === 'income' ? INCOME : EXPENSE;
  }

  function find(type, name) {
    return INDEX[normalizeType(type) + ':' + name] || null;
  }

  /** 取图标，未知分类回退到兜底图标而不是渲染出 'undefined' */
  function iconFor(type, name) {
    var item = find(type, name);
    if (item) return item.icon;
    return normalizeType(type) === 'income' ? '💰' : '📝';
  }

  /** 校验一个分类名是否属于该类型，用于读取历史数据时纠正脏值 */
  function isValid(type, name) {
    return !!find(type, name);
  }

  function defaultOf(type) {
    return list(type)[0];
  }

  return {
    EXPENSE: EXPENSE,
    INCOME: INCOME,
    normalizeType: normalizeType,
    list: list,
    find: find,
    iconFor: iconFor,
    isValid: isValid,
    defaultOf: defaultOf
  };
});
