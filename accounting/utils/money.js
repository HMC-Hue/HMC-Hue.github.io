/**
 * 金额工具
 *
 * 统一约定：金额一律以「分」为整数存储和计算，只在展示时才转成元。
 * 这样能彻底避免 0.1 + 0.2 = 0.30000000000000004 这类浮点误差累积。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Money = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 上限一千万元，超出视为误输入
  var MAX_CENTS = 1000000000;

  /**
   * 元 -> 分。
   *
   * 数字类型的入参本来就是浮点，直接乘 100 取整即可。
   * 字符串类型的入参走逐位解析 —— 因为 Math.round(1.005 * 100) 会得到 100
   * （1.005 在二进制里实际是 1.00499999...），只有按字符处理才能正确进位到 101。
   */
  function toCents(value) {
    if (value === null || value === undefined || value === '') return NaN;

    if (typeof value === 'number') {
      if (!isFinite(value)) return NaN;
      return Math.round(value * 100);
    }

    var text = String(value).trim();
    var matched = text.match(/^(-)?(\d*)(?:\.(\d*))?$/);
    if (!matched) return NaN;

    var intPart = matched[2] || '';
    var decPart = matched[3] || '';
    if (!intPart && !decPart) return NaN;

    var sign = matched[1] ? -1 : 1;
    var cents = parseInt(intPart || '0', 10) * 100;
    cents += parseInt(decPart.charAt(0) || '0', 10) * 10;
    cents += parseInt(decPart.charAt(1) || '0', 10);
    // 第三位小数决定是否进位，实现四舍五入到分
    if (parseInt(decPart.charAt(2) || '0', 10) >= 5) cents += 1;

    return sign * cents;
  }

  /**
   * 校验并解析输入框里的金额文本。
   * 返回 { ok, cents, reason }，reason 用于给出具体错误文案。
   */
  function parseInput(text) {
    var raw = String(text === null || text === undefined ? '' : text).trim();
    // 「12.」这种正在输入中的状态，按「12」处理
    raw = raw.replace(/\.$/, '');
    if (!raw) return { ok: false, cents: 0, reason: 'empty' };
    if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(raw)) {
      return { ok: false, cents: 0, reason: 'format' };
    }
    var cents = toCents(raw);
    if (!isFinite(cents) || cents <= 0) return { ok: false, cents: 0, reason: 'positive' };
    if (cents > MAX_CENTS) return { ok: false, cents: 0, reason: 'tooLarge' };
    return { ok: true, cents: cents, reason: '' };
  }

  /**
   * 输入时实时清洗：只留数字和一个小数点，小数最多两位，整数最多八位。
   *
   * 微信的 digit 键盘在部分安卓机型上能敲出多个小数点（1.2.3），
   * 不拦的话要等到点保存才报错，体验很差。
   */
  function sanitizeInput(text) {
    var raw = String(text === null || text === undefined ? '' : text).replace(/[^\d.]/g, '');
    var dot = raw.indexOf('.');

    if (dot === -1) return raw.slice(0, 8);

    var intPart = raw.slice(0, dot).slice(0, 8);
    var decPart = raw.slice(dot + 1).replace(/\./g, '').slice(0, 2);
    return intPart + '.' + decPart;
  }

  /**
   * 分 -> 展示文本，带千分位。
   * format(123456)              => "1,234.56"
   * format(123456, {sign:true}) => "+1,234.56"
   * format(-123456)             => "-1,234.56"
   */
  function format(cents, options) {
    var opts = options || {};
    var value = Number(cents);
    if (!isFinite(value)) value = 0;
    var negative = value < 0;
    var text = (Math.abs(value) / 100).toFixed(2);

    var parts = text.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    text = parts.join('.');

    if (opts.sign) {
      if (value > 0) return '+' + text;
      if (value < 0) return '-' + text;
      return text;
    }
    return (negative ? '-' : '') + text;
  }

  /** 只格式化绝对值，用于前后缀分开渲染的场景 */
  function formatAbs(cents) {
    return format(Math.abs(Number(cents) || 0));
  }

  var ERROR_TEXT = {
    empty: '请输入金额',
    format: '金额最多两位小数',
    positive: '金额需大于 0',
    tooLarge: '金额过大'
  };

  function errorText(reason) {
    return ERROR_TEXT[reason] || '金额有误';
  }

  return {
    MAX_CENTS: MAX_CENTS,
    toCents: toCents,
    parseInput: parseInput,
    sanitizeInput: sanitizeInput,
    format: format,
    formatAbs: formatAbs,
    errorText: errorText
  };
});
