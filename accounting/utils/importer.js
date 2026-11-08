/**
 * 账单导入 —— 解析 CSV 文本
 *
 * 纯函数，不碰存储也不碰平台 API，小程序与网页共用。
 * 只认导出时产生的格式：日期,类型,分类,金额(元),备注
 * 但要能容忍用户在 Excel 里改过之后另存的文件：列顺序可以变，可以没有表头。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Importer = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_ERRORS = 5;

  /* ------------------------------------------------------------------ *
   * CSV 基础解析（状态机，正确处理引号内的逗号与换行）
   * ------------------------------------------------------------------ */

  function parseRows(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0;
    var len = text.length;

    function endField() {
      row.push(field);
      field = '';
    }

    function endRow() {
      endField();
      rows.push(row);
      row = [];
    }

    while (i < len) {
      var ch = text.charAt(i);

      if (inQuotes) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += ch;
        i++;
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
        i++;
        continue;
      }

      if (ch === ',') {
        endField();
        i++;
        continue;
      }

      if (ch === '\r') {
        // CRLF 只在这里跳过 CR，由后面的 LF 结束行；裸 CR 直接结束行
        if (text.charAt(i + 1) === '\n') {
          i++;
          continue;
        }
        endRow();
        i++;
        continue;
      }

      if (ch === '\n') {
        endRow();
        i++;
        continue;
      }

      field += ch;
      i++;
    }

    if (field !== '' || row.length > 0) endRow();

    return rows;
  }

  /* ------------------------------------------------------------------ *
   * 字段归一化
   * ------------------------------------------------------------------ */

  function normalizeHeader(cell) {
    // 「金额(元)」「金额（元）」都归一成「金额」
    return String(cell || '')
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/\s/g, '')
      .trim();
  }

  function isBlankRow(row) {
    return !row.some(function (cell) {
      return String(cell || '').trim() !== '';
    });
  }

  /** 2026-11-08 / 2026/11/8 / 2026.11.8 都归一成 2026-11-08 */
  function normalizeDate(value) {
    var text = String(value || '').trim();
    var matched = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (!matched) return '';
    var month = parseInt(matched[2], 10);
    var day = parseInt(matched[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return '';
    return matched[1] + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  function normalizeType(value) {
    var text = String(value || '').trim().toLowerCase();
    if (text === '收入' || text === 'income') return 'income';
    if (text === '支出' || text === 'expense') return 'expense';
    return '';
  }

  /** 解析成「分」。容忍千分位、货币符号和尾部空格 */
  function toCents(value) {
    var text = String(value === null || value === undefined ? '' : value)
      .replace(/[,\s¥￥]/g, '');
    if (!text) return NaN;

    var negative = text.charAt(0) === '-';
    if (negative) text = text.slice(1);

    var matched = text.match(/^(\d*)(?:\.(\d*))?$/);
    if (!matched) return NaN;

    var intPart = matched[1] || '';
    var decPart = matched[2] || '';
    if (!intPart && !decPart) return NaN;

    var cents = parseInt(intPart || '0', 10) * 100;
    cents += parseInt(decPart.charAt(0) || '0', 10) * 10;
    cents += parseInt(decPart.charAt(1) || '0', 10);
    if (parseInt(decPart.charAt(2) || '0', 10) >= 5) cents += 1;

    return negative ? -cents : cents;
  }

  /** 导出时给公式加过前导单引号，读回来要摘掉 */
  function stripFormulaGuard(text) {
    var value = String(text === null || text === undefined ? '' : text);
    return /^'.*/.test(value) ? value.slice(1) : value;
  }

  /* ------------------------------------------------------------------ *
   * 主流程
   * ------------------------------------------------------------------ */

  /**
   * 返回 { ok, records, skipped, errors }
   * records 里的 amount 单位是「分」，不含 id 与 createdAt，由 merge 分配。
   */
  function parseCsv(text) {
    var result = { ok: false, records: [], skipped: 0, errors: [] };

    if (typeof text !== 'string' || text.trim() === '') {
      result.errors.push('文件是空的');
      return result;
    }

    var content = text.replace(/^\uFEFF/, '');
    var rows = parseRows(content).filter(function (row) {
      return !isBlankRow(row);
    });

    if (rows.length === 0) {
      result.errors.push('没有可读取的内容');
      return result;
    }

    // 定位列。识别不到「日期」就按导出时的默认列序，并认为没有表头。
    var header = rows[0].map(normalizeHeader);
    var columns = {
      date: header.indexOf('日期'),
      type: header.indexOf('类型'),
      category: header.indexOf('分类'),
      amount: header.indexOf('金额'),
      note: header.indexOf('备注')
    };

    var hasHeader = columns.date !== -1;
    if (!hasHeader) {
      columns = { date: 0, type: 1, category: 2, amount: 3, note: 4 };
    }

    var start = hasHeader ? 1 : 0;

    for (var i = start; i < rows.length; i++) {
      var row = rows[i];
      var lineNo = i + 1;

      var date = normalizeDate(row[columns.date]);
      var type = normalizeType(row[columns.type]);
      var amount = toCents(row[columns.amount]);

      if (!date) {
        result.skipped++;
        if (result.errors.length < MAX_ERRORS) {
          result.errors.push('第 ' + lineNo + ' 行：日期无法识别');
        }
        continue;
      }

      if (!type) {
        result.skipped++;
        if (result.errors.length < MAX_ERRORS) {
          result.errors.push('第 ' + lineNo + ' 行：类型应为「收入」或「支出」');
        }
        continue;
      }

      if (!isFinite(amount) || amount <= 0) {
        result.skipped++;
        if (result.errors.length < MAX_ERRORS) {
          result.errors.push('第 ' + lineNo + ' 行：金额无法识别');
        }
        continue;
      }

      var category = String(row[columns.category] || '').trim() || '其他';

      result.records.push({
        date: date,
        type: type,
        category: category,
        amount: Math.round(amount),
        note: stripFormulaGuard(row[columns.note]).trim()
      });
    }

    result.ok = result.records.length > 0;
    if (!result.ok && result.errors.length === 0) {
      result.errors.push('没有解析出任何记录');
    }

    return result;
  }

  /* ------------------------------------------------------------------ *
   * 合并去重
   * ------------------------------------------------------------------ */

  function keyOf(record) {
    return [
      record.date,
      record.type,
      record.category,
      record.amount,
      record.note || ''
    ].join('\u0001');
  }

  function genId(index) {
    return Date.now().toString(36) + '-' + index + Math.random().toString(36).slice(2, 6);
  }

  /**
   * 把 incoming 合进 existing。
   * 内容完全相同的视为重复跳过 —— 同一个文件导入两次不会翻倍，
   * 代价是同一天同分类同金额同备注的真·两笔会被合成一笔，所以要把跳过数量报给用户。
   */
  function merge(existing, incoming) {
    var seen = {};
    (existing || []).forEach(function (record) {
      seen[keyOf(record)] = true;
    });

    var merged = (existing || []).slice();
    var added = 0;
    var duplicated = 0;

    (incoming || []).forEach(function (record, index) {
      var key = keyOf(record);
      if (seen[key]) {
        duplicated++;
        return;
      }
      seen[key] = true;
      merged.push({
        id: genId(index),
        amount: record.amount,
        type: record.type,
        category: record.category,
        note: record.note || '',
        date: record.date,
        createdAt: Date.now() + index
      });
      added++;
    });

    return { records: merged, added: added, duplicated: duplicated };
  }

  return {
    parseRows: parseRows,
    parseCsv: parseCsv,
    merge: merge,
    normalizeDate: normalizeDate,
    normalizeType: normalizeType,
    toCents: toCents
  };
});
