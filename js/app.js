/**
 * app.js - 主应用逻辑
 * 整合所有模块，事件绑定，状态管理
 */
(function () {
  'use strict';

  // === 应用状态 ===
  const state = {
    loaded: false,
    fileName: '',
    contractData: null,
    sections: [],
    editingAnnotationId: null,
  };

  // === DOM 引用 ===
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {};

  function cacheElements() {
    els.fileInput = $('#file-input');
    els.projectInput = $('#project-input');
    els.btnImport = $('#btn-import');
    els.btnLoadProject = $('#btn-load-project');
    els.btnSave = $('#btn-save');
    els.btnChecklist = $('#btn-checklist');
    els.btnExport = $('#btn-export');
    els.searchInput = $('#search-input');
    els.searchCount = $('#search-count');
    els.btnSearchPrev = $('#btn-search-prev');
    els.btnSearchNext = $('#btn-search-next');
    els.btnSearchClear = $('#btn-search-clear');
    els.welcomeScreen = $('#welcome-screen');
    els.contractContent = $('#contract-content');
    els.contractBody = $('#contract-body');
    els.contractView = $('#contract-view');
    els.sectionNav = $('#section-nav');
    els.commentList = $('#comment-list');
    els.historyList = $('#history-list');
    els.dialogOverlay = $('#dialog-overlay');
    els.dialogTitle = $('#dialog-title');
    els.dialogSelectedText = $('#dialog-selected-text');
    els.dialogRiskType = $('#dialog-risk-type');
    els.dialogRiskLevel = $('#dialog-risk-level');
    els.dialogComment = $('#dialog-comment');
    els.dialogStatus = $('#dialog-status');
    els.btnDialogSave = $('#btn-dialog-save');
    els.btnDialogCancel = $('#btn-dialog-cancel');
    els.btnDialogClose = $('#btn-dialog-close');
    els.btnDialogDelete = $('#btn-dialog-delete');
    els.checklistOverlay = $('#checklist-overlay');
    els.checklistContent = $('#checklist-content');
    els.btnChecklistClose = $('#btn-checklist-close');
    els.btnChecklistExport = $('#btn-checklist-export');
    els.filterStatus = $('#filter-status');
    els.filterRisk = $('#filter-risk');
    els.sidebarLeft = $('#sidebar-left');
    els.sidebarRight = $('#sidebar-right');
    els.btnToggleLeft = $('#btn-toggle-left');
    els.btnToggleRight = $('#btn-toggle-right');
  }

  // === 初始化 ===
  function init() {
    cacheElements();
    AnnotationRenderer.init(els.contractBody);
    bindEvents();
    CommentManager.onChange(onDataChange);
  }

  // === 事件绑定 ===
  function bindEvents() {
    // 文件导入
    els.btnImport.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', handleFileImport);
    els.btnLoadProject.addEventListener('click', () => els.projectInput.click());
    els.projectInput.addEventListener('change', handleProjectLoad);

    // 拖拽导入
    els.contractView.addEventListener('dragover', (e) => {
      e.preventDefault();
      els.contractView.classList.add('drag-over');
    });
    els.contractView.addEventListener('dragleave', () => {
      els.contractView.classList.remove('drag-over');
    });
    els.contractView.addEventListener('drop', handleDrop);

    // 搜索
    els.searchInput.addEventListener('input', debounce(handleSearch, 300));
    els.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) AnnotationRenderer.prevSearchMatch();
        else AnnotationRenderer.nextSearchMatch();
        updateSearchCounter();
      }
      if (e.key === 'Escape') clearSearch();
    });
    els.btnSearchPrev.addEventListener('click', () => { AnnotationRenderer.prevSearchMatch(); updateSearchCounter(); });
    els.btnSearchNext.addEventListener('click', () => { AnnotationRenderer.nextSearchMatch(); updateSearchCounter(); });
    els.btnSearchClear.addEventListener('click', clearSearch);

    // 工具栏按钮
    els.btnSave.addEventListener('click', handleSaveProject);
    els.btnChecklist.addEventListener('click', handleShowChecklist);
    els.btnExport.addEventListener('click', handleExportReport);

    // 批注对话框
    els.btnDialogSave.addEventListener('click', handleDialogSave);
    els.btnDialogCancel.addEventListener('click', closeDialog);
    els.btnDialogClose.addEventListener('click', closeDialog);
    els.btnDialogDelete.addEventListener('click', handleDialogDelete);
    els.dialogOverlay.addEventListener('click', (e) => {
      if (e.target === els.dialogOverlay) closeDialog();
    });

    // 评审清单对话框
    els.btnChecklistClose.addEventListener('click', () => {
      els.checklistOverlay.hidden = true;
    });
    els.btnChecklistExport.addEventListener('click', handleExportChecklist);
    els.checklistOverlay.addEventListener('click', (e) => {
      if (e.target === els.checklistOverlay) els.checklistOverlay.hidden = true;
    });

    // Tab 切换
    $$('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.tab-btn').forEach(b => b.classList.remove('active'));
        $$('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const panel = $('#' + btn.dataset.tab);
        if (panel) panel.classList.add('active');
      });
    });

    // 过滤
    els.filterStatus.addEventListener('change', renderCommentList);
    els.filterRisk.addEventListener('change', renderCommentList);

    // 侧边栏折叠
    els.btnToggleLeft.addEventListener('click', () => {
      els.sidebarLeft.classList.toggle('collapsed');
      els.btnToggleLeft.innerHTML = els.sidebarLeft.classList.contains('collapsed') ? '&#9654;' : '&#9664;';
    });
    els.btnToggleRight.addEventListener('click', () => {
      els.sidebarRight.classList.toggle('collapsed');
      els.btnToggleRight.innerHTML = els.sidebarRight.classList.contains('collapsed') ? '&#9664;' : '&#9654;';
    });

    // 全局回调：选中文本添加批注
    window.onAddAnnotation = (selection) => {
      openDialog(null, selection);
    };

    // 全局回调：点击已有标注编辑
    window.onAnnotationClick = (annotationId) => {
      const annotation = CommentManager.getAnnotation(annotationId);
      if (annotation) openDialog(annotation);
    };

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        els.searchInput.focus();
      }
      if (e.key === 'Escape') {
        if (!els.dialogOverlay.hidden) closeDialog();
        if (!els.checklistOverlay.hidden) els.checklistOverlay.hidden = true;
      }
    });
  }

  // === 文件导入处理 ===
  async function handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const result = await ContractFileReader.readFile(file);
      loadContract(result);
      toast('合同导入成功', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }

    e.target.value = '';
  }

  function handleDrop(e) {
    e.preventDefault();
    els.contractView.classList.remove('drag-over');

    const file = e.dataTransfer.files[0];
    if (!file) return;

    ContractFileReader.readFile(file)
      .then(result => { loadContract(result); toast('合同导入成功', 'success'); })
      .catch(err => toast(err.message, 'error'));
  }

  // === 加载合同 ===
  function loadContract(fileData) {
    state.contractData = fileData;
    state.fileName = fileData.fileName;

    // 解析章节
    const parsed = ContractTextParser.parse(fileData.content);
    state.sections = parsed.sections;

    // 初始化批注管理器
    const hash = ContractTextParser.hashText(fileData.content);
    CommentManager.init(String(hash));

    // 渲染
    state.loaded = true;
    els.welcomeScreen.hidden = true;
    els.contractContent.hidden = false;

    // 启用工具栏
    els.searchInput.disabled = false;
    els.btnSave.disabled = false;
    els.btnChecklist.disabled = false;
    els.btnExport.disabled = false;

    // 渲染合同内容
    const annotations = CommentManager.getAnnotations();
    AnnotationRenderer.renderContract(state.sections, annotations);

    // 渲染章节导航
    renderSectionNav();

    // 更新右侧面板
    renderCommentList();
    renderHistory();
    RiskAnalytics.updateDashboard(annotations);

    // 滚动监听 - 更新章节导航高亮
    els.contractView.addEventListener('scroll', debounce(updateActiveSection, 100));
  }

  // === 恢复项目 ===
  async function handleProjectLoad(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const project = await ReportExporter.loadProject(file);
      restoreProject(project);
      toast('项目恢复成功', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }

    e.target.value = '';
  }

  function restoreProject(project) {
    state.contractData = {
      content: project.contract.rawText,
      format: project.contract.format,
      fileName: project.fileName,
    };
    state.fileName = project.fileName;
    state.sections = project.sections;

    // 恢复批注数据
    CommentManager.importData({
      annotations: project.annotations || [],
      history: project.history || [],
      contractHash: project.contractHash || '',
    });

    // 渲染
    state.loaded = true;
    els.welcomeScreen.hidden = true;
    els.contractContent.hidden = false;
    els.searchInput.disabled = false;
    els.btnSave.disabled = false;
    els.btnChecklist.disabled = false;
    els.btnExport.disabled = false;

    AnnotationRenderer.renderContract(state.sections, CommentManager.getAnnotations());
    renderSectionNav();
    renderCommentList();
    renderHistory();
    RiskAnalytics.updateDashboard(CommentManager.getAnnotations());

    els.contractView.addEventListener('scroll', debounce(updateActiveSection, 100));
  }

  // === 章节导航 ===
  function renderSectionNav() {
    const annotations = CommentManager.getAnnotations();

    els.sectionNav.innerHTML = state.sections.map(section => {
      const count = annotations.filter(a => a.sectionId === section.id).length;
      const badge = count > 0 ? `<span class="badge">${count}</span>` : '';
      return `<button class="section-nav-item depth-${section.depth}" data-section-id="${section.id}">
        ${escapeHtml(section.title)}${badge}
      </button>`;
    }).join('');

    // 绑定点击
    els.sectionNav.querySelectorAll('.section-nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        AnnotationRenderer.scrollToSection(btn.dataset.sectionId);
        els.sectionNav.querySelectorAll('.section-nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  function updateActiveSection() {
    const sections = els.contractBody.querySelectorAll('.contract-section');
    const viewTop = els.contractView.scrollTop + 60;

    let activeId = '';
    sections.forEach(el => {
      if (el.offsetTop <= viewTop) {
        activeId = el.dataset.sectionId;
      }
    });

    if (activeId) {
      els.sectionNav.querySelectorAll('.section-nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sectionId === activeId);
      });
    }
  }

  // === 搜索 ===
  function handleSearch() {
    const keyword = els.searchInput.value.trim();
    if (!keyword) { clearSearch(); return; }

    const matches = AnnotationRenderer.highlightSearch(keyword);
    els.searchCount.textContent = matches.length > 0 ? `1/${matches.length}` : '0';
    els.searchCount.hidden = false;
    els.btnSearchPrev.hidden = false;
    els.btnSearchNext.hidden = false;
    els.btnSearchClear.hidden = false;
  }

  function updateSearchCounter() {
    // 通过 active 元素推断当前位置
    const active = document.querySelector('.search-highlight.active');
    if (active) {
      const idx = parseInt(active.dataset.searchIdx, 10);
      const total = document.querySelectorAll('.search-highlight').length;
      els.searchCount.textContent = `${idx + 1}/${total}`;
    }
  }

  function clearSearch() {
    AnnotationRenderer.clearSearch();
    els.searchInput.value = '';
    els.searchCount.hidden = true;
    els.btnSearchPrev.hidden = true;
    els.btnSearchNext.hidden = true;
    els.btnSearchClear.hidden = true;
  }

  // === 批注对话框 ===
  function openDialog(annotation, selection) {
    state.editingAnnotationId = annotation ? annotation.id : null;

    if (annotation) {
      // 编辑模式
      els.dialogTitle.textContent = '编辑批注';
      els.dialogSelectedText.textContent = annotation.selectedText || annotation.textSnippet;
      els.dialogRiskType.value = annotation.riskType;
      els.dialogRiskLevel.value = annotation.riskLevel;
      els.dialogComment.value = annotation.comment || '';
      els.dialogStatus.value = annotation.status;
      els.btnDialogDelete.hidden = false;
    } else if (selection) {
      // 新增模式
      els.dialogTitle.textContent = '添加批注';
      els.dialogSelectedText.textContent = selection.text;
      els.dialogRiskType.value = 'payment';
      els.dialogRiskLevel.value = 'medium';
      els.dialogComment.value = '';
      els.dialogStatus.value = 'pending';
      els.btnDialogDelete.hidden = true;

      // 暂存选区信息
      state._pendingSelection = selection;
    }

    els.dialogOverlay.hidden = false;
    els.dialogComment.focus();
  }

  function closeDialog() {
    els.dialogOverlay.hidden = true;
    state.editingAnnotationId = null;
    state._pendingSelection = null;
  }

  function handleDialogSave() {
    if (state.editingAnnotationId) {
      // 更新
      const result = CommentManager.updateAnnotation(state.editingAnnotationId, {
        riskType: els.dialogRiskType.value,
        riskLevel: els.dialogRiskLevel.value,
        comment: els.dialogComment.value,
        status: els.dialogStatus.value,
      });

      if (!result.success) {
        toast(result.error, 'error');
        return;
      }
      toast('批注已更新', 'success');
    } else if (state._pendingSelection) {
      // 新增
      const sel = state._pendingSelection;
      const result = CommentManager.addAnnotation({
        paragraphId: sel.paragraphId,
        sectionId: sel.sectionId,
        startOffset: sel.startOffset,
        endOffset: sel.endOffset,
        selectedText: sel.text,
        riskType: els.dialogRiskType.value,
        riskLevel: els.dialogRiskLevel.value,
        comment: els.dialogComment.value,
        status: els.dialogStatus.value,
      });

      if (!result.success) {
        toast(result.error, 'warning');
        return;
      }
      toast('批注已添加', 'success');
    }

    closeDialog();
  }

  function handleDialogDelete() {
    if (!state.editingAnnotationId) return;
    CommentManager.deleteAnnotation(state.editingAnnotationId);
    toast('批注已删除', 'success');
    closeDialog();
  }

  // === 批注列表渲染 ===
  function renderCommentList() {
    const statusFilter = els.filterStatus ? els.filterStatus.value : 'all';
    const riskFilter = els.filterRisk ? els.filterRisk.value : 'all';

    const annotations = CommentManager.getFiltered({
      status: statusFilter,
      riskType: riskFilter,
    });

    if (annotations.length === 0) {
      els.commentList.innerHTML = '<p class="placeholder-text">暂无批注</p>';
      return;
    }

    els.commentList.innerHTML = annotations.map(a => {
      const riskLabel = CommentManager.RISK_TYPE_LABELS[a.riskType] || a.riskType;
      const statusLabel = CommentManager.STATUS_LABELS[a.status] || a.status;
      const time = formatTime(a.updatedAt || a.createdAt);

      return `<div class="comment-card" data-annotation-id="${a.id}">
        <div class="comment-card-header">
          <span class="comment-risk-tag" data-risk="${a.riskType}">${riskLabel}</span>
          <span class="comment-status-tag status-${a.status}">${statusLabel}</span>
        </div>
        <div class="comment-excerpt">"${escapeHtml(a.textSnippet)}"</div>
        ${a.comment ? `<div class="comment-text">${escapeHtml(a.comment)}</div>` : ''}
        <div class="comment-meta">${time}</div>
      </div>`;
    }).join('');

    // 绑定点击
    els.commentList.querySelectorAll('.comment-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.annotationId;
        // 滚动到标注位置
        AnnotationRenderer.scrollToAnnotation(id);
        // 高亮当前卡片
        els.commentList.querySelectorAll('.comment-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
      });

      card.addEventListener('dblclick', () => {
        const annotation = CommentManager.getAnnotation(card.dataset.annotationId);
        if (annotation) openDialog(annotation);
      });
    });
  }

  // === 评审记录渲染 ===
  function renderHistory() {
    const history = CommentManager.getHistory();

    if (history.length === 0) {
      els.historyList.innerHTML = '<p class="placeholder-text">暂无评审记录</p>';
      return;
    }

    els.historyList.innerHTML = history.map(h => {
      return `<div class="history-item">
        <div class="history-time">${formatTime(h.timestamp)}</div>
        <div class="history-action">
          <strong>${h.actionLabel}</strong> · ${h.riskTypeLabel || ''}
          ${h.detail ? ' · ' + escapeHtml(h.detail) : ''}
          ${h.textSnippet ? ` · "${escapeHtml(h.textSnippet)}"` : ''}
        </div>
      </div>`;
    }).join('');
  }

  // === 数据变更回调 ===
  function onDataChange(annotations) {
    AnnotationRenderer.refreshAll(annotations);
    renderCommentList();
    renderHistory();
    renderSectionNav();
    RiskAnalytics.updateDashboard(annotations);
  }

  // === 保存/导出 ===
  function handleSaveProject() {
    if (!state.loaded) return;
    ReportExporter.saveProject(
      state.contractData,
      state.sections,
      CommentManager.exportData(),
      state.fileName
    );
    toast('项目已保存', 'success');
  }

  function handleExportReport() {
    if (!state.loaded) return;
    ReportExporter.exportHtmlReport(
      state.sections,
      CommentManager.getAnnotations(),
      state.fileName
    );
    toast('报告已导出', 'success');
  }

  function handleShowChecklist() {
    if (!state.loaded) return;
    const checklist = RiskAnalytics.generateChecklist(
      CommentManager.getAnnotations(),
      state.sections
    );
    els.checklistContent.innerHTML = RiskAnalytics.renderChecklistHtml(checklist);
    els.checklistOverlay.hidden = false;
  }

  function handleExportChecklist() {
    const html = els.checklistContent.innerHTML;
    ReportExporter.exportChecklist(html, state.fileName);
    toast('清单已导出', 'success');
  }

  // === 工具函数 ===
  function toast(msg, type) {
    const container = $('#toast-container');
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function debounce(fn, ms) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // === 启动 ===
  document.addEventListener('DOMContentLoaded', init);
})();
