/**
 * 账单导出 —— 生成 CSV 文本
 *
 * 纯函数，不碰存储也不碰平台 API，小程序与网页共用。
 * 编码上照顾 Excel：带 BOM 头 + CRLF 换行，中文双击打开不乱码。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Exporter = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var BOM = '\uFEFF';
  var EOL = '\r\n';
  var HEADER = ['日期', '类型', '分类', '金额(元)', '备注'];

  /**
   * CSV 单元格转义。
   * 逗号、双引号、换行都会破坏列结构，所以整体加引号，内部引号翻倍。
   * 以 = + - @ 开头的文本还要防公式注入 —— 表格软件会把它当公式执行。
   */
  function escapeCell(value) {
    var text = value === null || value === undefined ? '' : String(value);

    if (/^[=+\-@\t\r]/.test(text)) {
      text = "'" + text;
    }

    if (/[",\r\n]/.test(text)) {
      text = '"' + text.replace(/"/g, '""') + '"';
    }

    return text;
  }

  function sortRecords(records) {
    return records.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  /**
   * records: [{ date, type, category, amount(分), note, createdAt }]
   * 返回带 BOM 的 CSV 字符串
   */
  function toCsv(records, options) {
    var opts = options || {};
    var rows = [];

    if (opts.header !== false) {
      rows.push(HEADER.map(escapeCell).join(','));
    }

    sortRecords(records || []).forEach(function (record) {
      rows.push(
        [
          escapeCell(record.date),
          escapeCell(record.type === 'income' ? '收入' : '支出'),
          escapeCell(record.category),
          escapeCell((record.amount / 100).toFixed(2)),
          escapeCell(record.note || '')
        ].join(',')
      );
    });

    return BOM + rows.join(EOL);
  }

  /** 账本-2026-11.csv */
  function fileName(year, month) {
    return '账本-' + year + '-' + String(month).padStart(2, '0') + '.csv';
  }

  return {
    BOM: BOM,
    HEADER: HEADER,
    escapeCell: escapeCell,
    toCsv: toCsv,
    fileName: fileName
  };
});
