/**
 * H5 版记账 Demo
 *
 * 复用 miniprogram/utils 下同一套业务模块（UMD 写法，两端都能跑）。
 * 无框架、无构建，直接打开 index.html 或挂到任意站点下即可。
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 初始化数据
   * ------------------------------------------------------------------ */
  Store.migrate();
  Store.ensureSeeded();

  var UNDO_MS = 4000;

  var state = {
    view: 'home',
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,

    editingId: null,
    draft: null,

    showBudgetModal: false,
    showAboutModal: false,
    budgetInput: '',

    undoRecord: null
  };

  var undoTimer = null;
  var toastTimer = null;

  /* ------------------------------------------------------------------ *
   * 工具
   * ------------------------------------------------------------------ */

  function el(id) {
    return document.getElementById(id);
  }

  // 备注是用户输入，必须转义后再拼进 HTML
  function escapeHtml(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function today() {
    return Stats.dateToString(new Date());
  }

  function emptyDraft() {
    var first = Categories.defaultOf('expense');
    return {
      type: 'expense',
      amount: '',
      category: first.name,
      note: '',
      date: today()
    };
  }

  function toast(message) {
    var existing = document.querySelector('.toast');
    if (existing) existing.remove();
    if (toastTimer) clearTimeout(toastTimer);

    var node = document.createElement('div');
    node.className = 'toast';
    node.textContent = message;
    document.body.appendChild(node);

    toastTimer = setTimeout(function () {
      node.remove();
      toastTimer = null;
    }, 1800);
  }

  function isFutureMonth(year, month) {
    var now = new Date();
    return (
      year > now.getFullYear() ||
      (year === now.getFullYear() && month > now.getMonth() + 1)
    );
  }

  /* ------------------------------------------------------------------ *
   * 渲染 —— 首页
   * ------------------------------------------------------------------ */

  function chevron(direction) {
    return '<span class="chevron ' + direction + '"></span>';
  }

  function viewHome() {
    var year = state.year;
    var month = state.month;

    var all = Store.getRecords();
    var monthRecords = Stats.filterByMonth(all, year, month);
    var totals = Stats.totals(monthRecords);
    var budgetCents = Store.getBudget(year, month);
    var progress = Stats.budgetProgress(totals.expense, budgetCents);

    var groups = Stats.groupByDate(monthRecords).map(function (group) {
      var rows = group.records
        .map(function (record) {
          var sign = record.type === 'income' ? '+' : '-';
          var cls = record.type === 'income' ? 'text-income' : 'text-expense';
          var note = record.note
            ? '<span class="record-note">' + escapeHtml(record.note) + '</span>'
            : '';
          return (
            '<button class="record" type="button" data-action="edit" data-id="' +
            escapeHtml(record.id) +
            '">' +
            '<span class="record-icon">' +
            Categories.iconFor(record.type, record.category) +
            '</span>' +
            '<span class="record-main">' +
            '<span class="record-category">' +
            escapeHtml(record.category) +
            '</span>' +
            note +
            '</span>' +
            '<span class="record-amount num ' +
            cls +
            '">' +
            sign +
            Money.format(record.amount) +
            '</span>' +
            '</button>'
          );
        })
        .join('');

      var dayTotal = group.dayExpense > 0
        ? '<span class="day-total num">支出 ' + Money.format(group.dayExpense) + '</span>'
        : '';

      return (
        '<div class="day">' +
        '<div class="day-head"><span class="day-label">' +
        group.label +
        '</span>' +
        dayTotal +
        '</div>' +
        '<div class="day-card">' +
        rows +
        '</div>' +
        '</div>'
      );
    }).join('');

    var budgetBlock;
    if (progress.hasBudget) {
      var rightText = progress.overBudget
        ? '超支 ' + Money.format(Math.abs(progress.remaining))
        : '剩余 ' + Money.format(progress.remaining);
      budgetBlock =
        '<div class="budget-head">' +
        '<span class="budget-caption">本月预算 ' + Money.format(budgetCents) + '</span>' +
        '<span class="budget-caption' + (progress.overBudget ? ' is-over' : '') + '">' +
        rightText +
        '</span>' +
        '</div>' +
        '<div class="budget-track"><div class="budget-fill' +
        (progress.overBudget ? ' is-over' : '') +
        '" style="width:' + progress.percent + '%"></div></div>';
    } else {
      budgetBlock =
        '<div class="budget-empty">' +
        '<span class="budget-empty-text">设置本月预算</span>' +
        '<span class="budget-empty-hint">超支时会提醒你</span>' +
        '</div>';
    }

    var hasSample = all.some(function (r) {
      return r.sample;
    });

    var sampleTip = hasSample
      ? '<div class="sample-tip">' +
        '<span class="sample-text">下面是示例数据，随便点点看</span>' +
        '<button class="sample-action" type="button" data-action="dismiss-sample">清空</button>' +
        '</div>'
      : '';

    var listHtml;
    if (groups.length === 0) {
      listHtml =
        '<button class="empty" type="button" data-action="go-add">' +
        '<span class="empty-plus">+</span>' +
        '<span class="empty-title">还没有记录</span>' +
        '<span class="empty-hint">点这里记第一笔</span>' +
        '</button>';
    } else {
      listHtml =
        '<div class="list-head">' +
        '<span class="list-title">记账记录</span>' +
        '<span class="list-count">共 ' + monthRecords.length + ' 笔</span>' +
        '</div>' +
        groups +
        '<span class="list-footnote">点击一条记录可以修改</span>';
    }

    return (
      '<section class="hero">' +
      '<div class="hero-top">' +
      '<button class="month-nav" type="button" data-action="prev-month" aria-label="上个月">' +
      chevron('left') +
      '</button>' +
      '<span class="month-label">' + Stats.monthLabel(year, month) + '</span>' +
      '<button class="month-nav" type="button" data-action="next-month" aria-label="下个月"' +
      (isFutureMonth(year, month) ? ' disabled' : '') +
      '>' + chevron('right') + '</button>' +
      '</div>' +

      '<span class="balance-caption">结余</span>' +
      '<div class="balance num' + (totals.balance < 0 ? ' is-negative' : '') + '">' +
      Money.format(totals.balance) + '</div>' +

      '<div class="metrics">' +
      '<div class="metric">' +
      '<div class="metric-head"><span class="dot income"></span><span class="metric-label">收入</span></div>' +
      '<span class="metric-value num">' + Money.format(totals.income) + '</span>' +
      '</div>' +
      '<div class="metric">' +
      '<div class="metric-head"><span class="dot expense"></span><span class="metric-label">支出</span></div>' +
      '<span class="metric-value num">' + Money.format(totals.expense) + '</span>' +
      '</div>' +
      '</div>' +

      '<button class="budget" type="button" data-action="open-budget">' +
      budgetBlock +
      '</button>' +
      '</section>' +

      '<div class="shortcuts">' +
      '<button class="shortcut" type="button" data-action="go-view" data-view="report">' +
      '<span class="shortcut-icon">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18V10M12 18V6M18 18v-5"/></svg>' +
      '</span><span class="shortcut-label">报表</span></button>' +
      '<button class="shortcut" type="button" data-action="open-budget">' +
      '<span class="shortcut-icon">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.4"/></svg>' +
      '</span><span class="shortcut-label">预算</span></button>' +
      '<button class="shortcut" type="button" data-action="open-about">' +
      '<span class="shortcut-icon">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 11v5"/><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/></svg>' +
      '</span><span class="shortcut-label">关于</span></button>' +
      '</div>' +

      sampleTip +
      listHtml
    );
  }

  /* ------------------------------------------------------------------ *
   * 渲染 —— 记一笔
   * ------------------------------------------------------------------ */

  function viewAdd() {
    var draft = state.draft;
    var list = Categories.list(draft.type);
    var isEdit = !!state.editingId;

    var tabs = ['expense', 'income']
      .map(function (type) {
        var label = type === 'expense' ? '支出' : '收入';
        return (
          '<button class="segment' + (draft.type === type ? ' is-active' : '') +
          '" type="button" data-action="select-type" data-type="' + type + '">' +
          label + '</button>'
        );
      })
      .join('');

    var cats = list
      .map(function (item) {
        return (
          '<button class="category' + (draft.category === item.name ? ' is-selected' : '') +
          '" type="button" data-action="select-category" data-category="' +
          escapeHtml(item.name) + '">' +
          '<span class="category-icon">' + item.icon + '</span>' +
          '<span class="category-name">' + escapeHtml(item.name) + '</span>' +
          '</button>'
        );
      })
      .join('');

    var deleteLink = isEdit
      ? '<button class="sheet-link" type="button" data-action="delete-current">删除这笔记录</button>'
      : '';

    return (
      '<div class="segmented">' + tabs + '</div>' +

      '<div class="card">' +
      '<span class="field-label">金额</span>' +
      '<div class="amount-row">' +
      '<span class="amount-currency">¥</span>' +
      '<input class="amount-input num" id="amount-input" type="text" inputmode="decimal" ' +
      'placeholder="0.00" autocomplete="off" value="' + escapeHtml(draft.amount) + '">' +
      '</div>' +
      '</div>' +

      '<div class="card">' +
      '<span class="field-label">分类</span>' +
      '<div class="category-grid">' + cats + '</div>' +
      '</div>' +

      '<div class="card">' +
      '<div class="row">' +
      '<span class="row-label">日期</span>' +
      '<input class="date-input" id="date-input" type="date" max="' + today() + '" value="' + draft.date + '">' +
      '</div>' +
      '<div class="row-divider"></div>' +
      '<div class="row">' +
      '<span class="row-label">备注</span>' +
      '<input class="row-input" id="note-input" type="text" placeholder="选填" maxlength="40" ' +
      'autocomplete="off" value="' + escapeHtml(draft.note) + '">' +
      '</div>' +
      '</div>' +

      '<button class="save-btn" type="button" data-action="save">' +
      (isEdit ? '保存修改' : '记一笔') +
      '</button>' +
      deleteLink
    );
  }

  /* ------------------------------------------------------------------ *
   * 渲染 —— 报表
   * ------------------------------------------------------------------ */

  function categoryRows(items, typeClass) {
    return items
      .map(function (item) {
        return (
          '<div class="cat-row">' +
          '<div class="cat-head">' +
          '<div class="cat-name">' +
          '<span class="cat-icon">' + item.icon + '</span>' +
          '<span class="cat-text">' + escapeHtml(item.name) + '</span>' +
          '<span class="cat-count">' + item.count + ' 笔</span>' +
          '</div>' +
          '<div class="cat-figure">' +
          '<span class="cat-amount num">' + Money.format(item.amount) + '</span>' +
          '<span class="cat-percent num">' + item.percent + '%</span>' +
          '</div>' +
          '</div>' +
          '<div class="cat-track"><div class="cat-fill ' + typeClass + '" style="width:' +
          item.percent + '%"></div></div>' +
          '</div>'
        );
      })
      .join('');
  }

  function viewReport() {
    var year = state.year;
    var month = state.month;
    var all = Store.getRecords();
    var monthRecords = Stats.filterByMonth(all, year, month);
    var totals = Stats.totals(monthRecords);

    var summary =
      '<div class="card summary">' +
      '<div class="summary-item"><span class="summary-label">收入</span>' +
      '<span class="summary-value num text-income">' + Money.format(totals.income) + '</span></div>' +
      '<div class="summary-divider"></div>' +
      '<div class="summary-item"><span class="summary-label">支出</span>' +
      '<span class="summary-value num text-expense">' + Money.format(totals.expense) + '</span></div>' +
      '<div class="summary-divider"></div>' +
      '<div class="summary-item"><span class="summary-label">结余</span>' +
      '<span class="summary-value num' + (totals.balance < 0 ? ' text-expense' : '') + '">' +
      Money.format(totals.balance) + '</span></div>' +
      '</div>';

    var monthBar =
      '<div class="month-bar">' +
      '<button class="month-nav" type="button" data-action="prev-month" aria-label="上个月">' +
      chevron('left') + '</button>' +
      '<span class="month-text">' + Stats.monthLabel(year, month) + '</span>' +
      '<button class="month-nav" type="button" data-action="next-month" aria-label="下个月"' +
      (isFutureMonth(year, month) ? ' disabled' : '') +
      '>' + chevron('right') + '</button>' +
      '</div>';

    if (monthRecords.length === 0) {
      return (
        monthBar +
        summary +
        '<div class="empty" style="border-style:solid">' +
        '<span class="empty-title">' + Stats.monthLabel(year, month) + '还没有记录</span>' +
        '<span class="empty-hint">记几笔之后这里会显示构成和趋势</span>' +
        '</div>'
      );
    }

    var expenseCats = Stats.byCategory(monthRecords, 'expense', Categories.iconFor);
    var incomeCats = Stats.byCategory(monthRecords, 'income', Categories.iconFor);

    var expenseCard = expenseCats.length
      ? '<div class="card"><span class="card-title">支出构成</span>' +
        '<div class="cat-list">' + categoryRows(expenseCats, 'expense') + '</div></div>'
      : '';

    var incomeCard = incomeCats.length
      ? '<div class="card"><span class="card-title">收入构成</span>' +
        '<div class="cat-list">' + categoryRows(incomeCats, 'income') + '</div></div>'
      : '';

    var months = Stats.recentMonths(all, 6, year, month);
    var maxValue = 0;
    months.forEach(function (m) {
      if (m.income > maxValue) maxValue = m.income;
      if (m.expense > maxValue) maxValue = m.expense;
    });

    var cols = months
      .map(function (m) {
        function height(value) {
          if (value <= 0 || maxValue <= 0) return 0;
          return Math.max(6, Math.round((value / maxValue) * 100));
        }
        var active = m.year === year && m.month === month;
        return (
          '<div class="chart-col' + (active ? ' is-active' : '') + '">' +
          '<div class="chart-bars">' +
          '<div class="chart-bar income" style="height:' + height(m.income) + '%"></div>' +
          '<div class="chart-bar expense" style="height:' + height(m.expense) + '%"></div>' +
          '</div>' +
          '<span class="chart-label">' + m.label + '</span>' +
          '</div>'
        );
      })
      .join('');

    return (
      monthBar +
      summary +
      expenseCard +
      incomeCard +
      '<div class="card">' +
      '<div class="card-head"><span class="card-title">近 6 个月</span>' +
      '<div class="legend">' +
      '<span class="legend-item"><span class="legend-dot income"></span><span class="legend-text">收入</span></span>' +
      '<span class="legend-item"><span class="legend-dot expense"></span><span class="legend-text">支出</span></span>' +
      '</div></div>' +
      '<div class="chart">' + cols + '</div>' +
      '</div>' +
      '<button class="export-btn" type="button" data-action="export-csv">下载本月账单</button>' +
      '<p class="export-hint">CSV 格式，可用 Excel 或 Numbers 打开</p>'
    );
  }

  /* ------------------------------------------------------------------ *
   * 弹层
   * ------------------------------------------------------------------ */

  function overlayHtml() {
    var html = '';

    if (state.showBudgetModal) {
      var hasBudget = Store.getBudget(state.year, state.month) > 0;
      html +=
        '<div class="mask" data-action="close-budget">' +
        '<div class="sheet" data-stop="1">' +
        '<span class="sheet-title">' + Stats.monthLabel(state.year, state.month) + '预算</span>' +
        '<div class="sheet-input-row">' +
        '<span class="sheet-currency">¥</span>' +
        '<input class="sheet-input num" id="budget-input" type="text" inputmode="decimal" ' +
        'placeholder="0.00" autocomplete="off" value="' + escapeHtml(state.budgetInput) + '">' +
        '</div>' +
        '<div class="sheet-actions">' +
        '<button class="sheet-btn ghost" type="button" data-action="close-budget">取消</button>' +
        '<button class="sheet-btn primary" type="button" data-action="confirm-budget">保存</button>' +
        '</div>' +
        (hasBudget
          ? '<button class="sheet-link" type="button" data-action="clear-budget">取消本月预算</button>'
          : '') +
        '</div></div>';
    }

    if (state.showAboutModal) {
      html +=
        '<div class="mask" data-action="close-about">' +
        '<div class="sheet" data-stop="1">' +
        '<span class="sheet-title">关于这个小账本</span>' +
        '<div class="about-body">' +
        '<span class="about-line">数据只存在你自己的浏览器里，不上传服务器。换设备或清缓存会丢失。</span>' +
        '<span class="about-line">点一条记录可以修改金额、分类、日期和备注。</span>' +
        '<span class="about-line">预算按月生效，可以随时取消；删除后有 4 秒撤销。</span>' +
        '</div>' +
        '<div class="sheet-actions">' +
        '<button class="sheet-btn primary" type="button" data-action="close-about">知道了</button>' +
        '</div>' +
        '</div></div>';
    }

    if (state.undoRecord) {
      html +=
        '<div class="undo">' +
        '<span class="undo-text">已删除 ' + escapeHtml(state.undoRecord.category) + ' ' +
        Money.format(state.undoRecord.amount) + '</span>' +
        '<button class="undo-action" type="button" data-action="undo-delete">撤销</button>' +
        '</div>';
    }

    return html;
  }

  /* ------------------------------------------------------------------ *
   * 主渲染
   * ------------------------------------------------------------------ */

  function render() {
    var container = el('view');
    var scrollTop = container.scrollTop;
    var body;

    if (state.view === 'add') body = viewAdd();
    else if (state.view === 'report') body = viewReport();
    else body = viewHome();

    container.innerHTML = body + overlayHtml();
    container.scrollTop = scrollTop;

    // 同步底部导航选中态
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      var active = tab.dataset.view === state.view;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-current', active ? 'page' : 'false');
    });
  }

  /* ------------------------------------------------------------------ *
   * 交互
   * ------------------------------------------------------------------ */

  function switchView(view) {
    if (view === 'add') {
      state.editingId = null;
      state.draft = emptyDraft();
    }
    state.view = view;
    state.showBudgetModal = false;
    state.showAboutModal = false;
    // 同步 hash，方便名片站直接链到某个视图
    if (history.replaceState) {
      history.replaceState(null, '', view === 'home' ? '#' : '#' + view);
    }
    render();
  }

  function openEdit(id) {
    var record = Store.getRecord(id);
    if (!record) {
      toast('记录不存在');
      return;
    }
    state.editingId = record.id;
    state.draft = {
      type: record.type,
      amount: (record.amount / 100).toFixed(2),
      category: record.category,
      note: record.note || '',
      date: record.date
    };
    state.view = 'add';
    render();
  }

  function saveRecord() {
    var draft = state.draft;
    var parsed = Money.parseInput(draft.amount);
    if (!parsed.ok) {
      toast(Money.errorText(parsed.reason));
      return;
    }

    var payload = {
      amount: parsed.cents,
      type: draft.type,
      category: draft.category,
      note: (draft.note || '').trim(),
      date: draft.date || today()
    };

    var ok = state.editingId
      ? Store.updateRecord(state.editingId, payload)
      : Store.addRecord(payload);

    if (!ok) {
      toast('保存失败，存储空间可能已满');
      return;
    }

    var wasEdit = !!state.editingId;
    state.editingId = null;
    state.draft = null;
    state.view = 'home';
    render();
    toast(wasEdit ? '已修改' : '已记录');
  }

  function deleteCurrent() {
    if (!state.editingId) return;
    var record = Store.getRecord(state.editingId);
    if (!record) return;
    if (!window.confirm('删除「' + record.category + ' ' + Money.format(record.amount) + '」？')) {
      return;
    }
    var removed = Store.deleteRecord(record.id);
    state.editingId = null;
    state.draft = null;
    state.view = 'home';
    if (removed) setUndo(removed);
    render();
  }

  function exportCsv() {
    var records = Stats.filterByMonth(Store.getRecords(), state.year, state.month);
    if (!records.length) {
      toast('本月还没有记录');
      return;
    }

    var csv = Exporter.toCsv(records);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');

    link.href = url;
    link.download = Exporter.fileName(state.year, state.month);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // 下载已触发，延迟释放，避免部分浏览器还没取到数据就被回收
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);

    toast('已导出 ' + records.length + ' 条记录');
  }

  function setUndo(record) {
    state.undoRecord = record;
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(function () {
      state.undoRecord = null;
      undoTimer = null;
      render();
    }, UNDO_MS);
  }

  function undoDelete() {
    if (state.undoRecord) {
      Store.restoreRecord(state.undoRecord);
      state.undoRecord = null;
    }
    if (undoTimer) {
      clearTimeout(undoTimer);
      undoTimer = null;
    }
    render();
  }

  /* ------------------------------------------------------------------ *
   * 事件绑定
   * ------------------------------------------------------------------ */

  document.addEventListener('click', function (event) {
    // 点击弹层内容区不关闭
    var sheet = event.target.closest('[data-stop]');
    if (sheet && !event.target.closest('[data-action]')) return;

    var tab = event.target.closest('.tab');
    if (tab) {
      switchView(tab.dataset.view);
      return;
    }

    var trigger = event.target.closest('[data-action]');
    if (!trigger) return;

    var action = trigger.dataset.action;

    switch (action) {
      case 'prev-month': {
        var prev = Stats.shiftMonth(state.year, state.month, -1);
        state.year = prev.year;
        state.month = prev.month;
        render();
        break;
      }
      case 'next-month': {
        var next = Stats.shiftMonth(state.year, state.month, 1);
        if (isFutureMonth(next.year, next.month)) break;
        state.year = next.year;
        state.month = next.month;
        render();
        break;
      }
      case 'go-view':
        switchView(trigger.dataset.view);
        break;
      case 'go-add':
        switchView('add');
        break;
      case 'edit':
        openEdit(trigger.dataset.id);
        break;
      case 'select-type': {
        var type = trigger.dataset.type;
        if (state.draft.type === type) break;
        var list = Categories.list(type);
        state.draft.type = type;
        state.draft.category = list[0].name;
        render();
        break;
      }
      case 'select-category':
        state.draft.category = trigger.dataset.category;
        render();
        break;
      case 'save':
        saveRecord();
        break;
      case 'delete-current':
        deleteCurrent();
        break;
      case 'open-budget': {
        var cents = Store.getBudget(state.year, state.month);
        state.budgetInput = cents > 0 ? String(cents / 100) : '';
        state.showBudgetModal = true;
        render();
        var budgetField = el('budget-input');
        if (budgetField) budgetField.focus();
        break;
      }
      case 'close-budget':
        state.showBudgetModal = false;
        render();
        break;
      case 'confirm-budget': {
        var field = el('budget-input');
        var parsed = Money.parseInput(field ? field.value : state.budgetInput);
        if (!parsed.ok) {
          toast(Money.errorText(parsed.reason));
          break;
        }
        Store.setBudget(state.year, state.month, parsed.cents);
        state.showBudgetModal = false;
        render();
        toast('预算已设置');
        break;
      }
      case 'clear-budget':
        Store.clearBudget(state.year, state.month);
        state.showBudgetModal = false;
        render();
        toast('已取消本月预算');
        break;
      case 'open-about':
        state.showAboutModal = true;
        render();
        break;
      case 'close-about':
        state.showAboutModal = false;
        render();
        break;
      case 'undo-delete':
        undoDelete();
        break;
      case 'export-csv':
        exportCsv();
        break;
      case 'dismiss-sample':
        if (window.confirm('清空这几条示例记录？')) {
          Store.removeSampleData();
          render();
          toast('已清空');
        }
        break;
    }
  });

  // 输入框只更新 state，不重渲染，避免丢焦点
  document.addEventListener('input', function (event) {
    var target = event.target;
    if (target.id === 'amount-input' && state.draft) {
      state.draft.amount = target.value;
    } else if (target.id === 'note-input' && state.draft) {
      state.draft.note = target.value;
    } else if (target.id === 'budget-input') {
      state.budgetInput = target.value;
    }
  });

  document.addEventListener('change', function (event) {
    var target = event.target;
    if (target.id === 'date-input' && state.draft) {
      state.draft.date = target.value;
    }
  });

  // 回车即保存，桌面上更顺手
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter') return;
    if (event.target.id === 'amount-input' || event.target.id === 'note-input') {
      event.preventDefault();
      saveRecord();
    } else if (event.target.id === 'budget-input') {
      event.preventDefault();
      var field = el('budget-input');
      var parsed = Money.parseInput(field ? field.value : '');
      if (!parsed.ok) {
        toast(Money.errorText(parsed.reason));
        return;
      }
      Store.setBudget(state.year, state.month, parsed.cents);
      state.showBudgetModal = false;
      render();
      toast('预算已设置');
    }
  });

  /* ------------------------------------------------------------------ *
   * 启动
   * ------------------------------------------------------------------ */

  state.draft = emptyDraft();

  var initialView = (location.hash || '').replace('#', '');
  if (initialView === 'add' || initialView === 'report') {
    state.view = initialView;
  }

  render();
})();
