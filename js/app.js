/**
 * app.js - 主控制器
 * 负责模块编排、事件绑定、状态同步
 * 集成批注迁移（re-parse/project-import）、失效批注处理
 */
const App = (() => {
  // 应用状态
  let state = {
    sections: [],
    contractTitle: '',
    fileLoaded: false,
    // 对比模式状态
    comparisonMode: false,
    revisedSections: null,
    revisedTitle: '',
    diffResult: null,
    analysisResult: null,
    migrationResults: null
  };

  // DOM引用缓存
  let DOM = {};

  /**
   * 初始化应用
   */
  function init() {
    cacheDOM();
    bindEvents();
    AnnotationRenderer.init(DOM.contractContent);

    // 搜索完成回调
    AnnotationRenderer.onSearchComplete((matches) => {
      const term = DOM.searchInput.value.trim();
      DOM.searchCount.textContent = term ? `${matches.length} 处` : '';
    });

    // 监听批注变化 → 刷新UI
    AnnotationManager.onChange((event) => {
      onAnnotationsChanged(event);
    });

    // 尝试自动加载 localStorage 数据
    tryAutoLoad();
  }

  /**
   * 暴露章节数据（供 AnnotationManager 计算 rangeId）
   */
  function getSections() {
    return state.sections;
  }

  /**
   * 缓存DOM元素引用
   */
  function cacheDOM() {
    DOM = {
      fileInput: document.getElementById('fileInput'),
      projectFileInput: document.getElementById('projectFileInput'),
      searchInput: document.getElementById('searchInput'),
      searchCount: document.getElementById('searchCount'),
      searchClear: document.getElementById('searchClear'),
      importBtn: document.getElementById('importBtn'),
      importProjectBtn: document.getElementById('importProjectBtn'),
      saveBtn: document.getElementById('saveBtn'),
      exportReportBtn: document.getElementById('exportReportBtn'),
      exportProjectBtn: document.getElementById('exportProjectBtn'),
      contractTitle: document.getElementById('contractTitle'),
      chapterNav: document.getElementById('chapterNav'),
      contentArea: document.getElementById('contentArea'),
      contentPlaceholder: document.getElementById('contentPlaceholder'),
      contractContent: document.getElementById('contractContent'),
      dropZone: document.getElementById('dropZone'),
      annotationForm: document.getElementById('annotationForm'),
      selectedText: document.getElementById('selectedText'),
      riskTypeSelector: document.getElementById('riskTypeSelector'),
      riskLevelSelector: document.getElementById('riskLevelSelector'),
      annotationComment: document.getElementById('annotationComment'),
      addAnnotationBtn: document.getElementById('addAnnotationBtn'),
      cancelAnnotationBtn: document.getElementById('cancelAnnotationBtn'),
      annotationList: document.getElementById('annotationList'),
      annotationTotal: document.getElementById('annotationTotal'),
      filterRiskType: document.getElementById('filterRiskType'),
      filterStatus: document.getElementById('filterStatus'),
      barChart: document.getElementById('barChart'),
      pieChart: document.getElementById('pieChart'),
      summaryCards: document.getElementById('summaryCards'),
      checklistContent: document.getElementById('checklistContent'),
      validationContent: document.getElementById('validationContent'),
      toastContainer: document.getElementById('toastContainer'),
      modalOverlay: document.getElementById('modalOverlay'),
      modal: document.getElementById('modal'),
      modalTitle: document.getElementById('modalTitle'),
      modalBody: document.getElementById('modalBody'),
      modalFooter: document.getElementById('modalFooter'),
      modalClose: document.getElementById('modalClose'),
      editModalOverlay: document.getElementById('editModalOverlay'),
      editRiskType: document.getElementById('editRiskType'),
      editRiskLevel: document.getElementById('editRiskLevel'),
      editComment: document.getElementById('editComment'),
      editSaveBtn: document.getElementById('editSaveBtn'),
      editCancelBtn: document.getElementById('editCancelBtn'),
      editModalClose: document.getElementById('editModalClose'),
      // 对比模式 DOM
      compareBtn: document.getElementById('compareBtn'),
      comparisonLayout: document.getElementById('comparisonLayout'),
      mainLayout: document.querySelector('.main-layout'),
      compareModalOverlay: document.getElementById('compareModalOverlay'),
      compareModalClose: document.getElementById('compareModalClose'),
      compareModalCancel: document.getElementById('compareModalCancel'),
      compareUploadArea: document.getElementById('compareUploadArea'),
      revisedFileInput: document.getElementById('revisedFileInput'),
      compareStatus: document.getElementById('compareStatus'),
      exitCompareBtn: document.getElementById('exitCompareBtn'),
      applyMigrationBtn: document.getElementById('applyMigrationBtn'),
      exportComparisonBtn: document.getElementById('exportComparisonBtn'),
      tabBtnChanges: document.getElementById('tabBtnChanges'),
      changesContent: document.getElementById('changesContent')
    };
  }

  /**
   * 绑定所有事件
   */
  function bindEvents() {
    // 文件导入
    DOM.fileInput.addEventListener('change', handleFileImport);
    DOM.projectFileInput.addEventListener('change', handleProjectImport);

    // 拖拽导入
    DOM.contentArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      DOM.dropZone.classList.add('drag-over');
    });
    DOM.contentArea.addEventListener('dragleave', () => {
      DOM.dropZone.classList.remove('drag-over');
    });
    DOM.contentArea.addEventListener('drop', handleDrop);

    // 搜索
    DOM.searchInput.addEventListener('input', handleSearch);
    DOM.searchClear.addEventListener('click', () => {
      DOM.searchInput.value = '';
      DOM.searchClear.style.display = 'none';
      DOM.searchCount.textContent = '';
      AnnotationRenderer.search('');
    });

    // 保存/导出
    DOM.saveBtn.addEventListener('click', handleSave);
    DOM.exportReportBtn.addEventListener('click', handleExportReport);
    DOM.exportProjectBtn.addEventListener('click', handleExportProject);

    // 文本选择 → 显示批注表单
    document.addEventListener('mouseup', handleTextSelection);

    // 批注表单
    DOM.addAnnotationBtn.addEventListener('click', handleAddAnnotation);
    DOM.cancelAnnotationBtn.addEventListener('click', hideAnnotationForm);

    // 风险类型选择
    DOM.riskTypeSelector.addEventListener('click', (e) => {
      const btn = e.target.closest('.risk-btn');
      if (!btn) return;
      DOM.riskTypeSelector.querySelectorAll('.risk-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });

    // 风险等级选择
    DOM.riskLevelSelector.addEventListener('click', (e) => {
      const btn = e.target.closest('.level-btn');
      if (!btn) return;
      DOM.riskLevelSelector.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });

    // 筛选（类型和状态变化都要刷新列表+高亮）
    DOM.filterRiskType.addEventListener('change', () => {
      renderAnnotationList();
      AnnotationRenderer.refreshHighlights();
    });
    DOM.filterStatus.addEventListener('change', () => {
      renderAnnotationList();
      AnnotationRenderer.refreshHighlights();
    });

    // 统计标签页
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab' + capitalize(btn.dataset.tab)).classList.add('active');
      });
    });

    // 批注点击事件代理
    DOM.annotationList.addEventListener('click', handleAnnotationListClick);

    // 合同内容点击 - 高亮点击
    DOM.contractContent.addEventListener('click', handleContentClick);

    // 编辑对话框
    DOM.editSaveBtn.addEventListener('click', handleEditSave);
    DOM.editCancelBtn.addEventListener('click', () => DOM.editModalOverlay.style.display = 'none');
    DOM.editModalClose.addEventListener('click', () => DOM.editModalOverlay.style.display = 'none');

    // 关闭模态
    DOM.modalClose.addEventListener('click', () => DOM.modalOverlay.style.display = 'none');
    DOM.modalOverlay.addEventListener('click', (e) => {
      if (e.target === DOM.modalOverlay) DOM.modalOverlay.style.display = 'none';
    });
    DOM.editModalOverlay.addEventListener('click', (e) => {
      if (e.target === DOM.editModalOverlay) DOM.editModalOverlay.style.display = 'none';
    });

    // 对比模式事件
    DOM.compareBtn.addEventListener('click', handleCompareClick);
    DOM.revisedFileInput.addEventListener('change', handleRevisedFileImport);
    DOM.compareModalClose.addEventListener('click', () => { DOM.compareModalOverlay.style.display = 'none'; });
    DOM.compareModalCancel.addEventListener('click', () => { DOM.compareModalOverlay.style.display = 'none'; });
    DOM.compareModalOverlay.addEventListener('click', (e) => {
      if (e.target === DOM.compareModalOverlay) DOM.compareModalOverlay.style.display = 'none';
    });
    DOM.exitCompareBtn.addEventListener('click', exitComparisonMode);
    DOM.applyMigrationBtn.addEventListener('click', handleApplyMigration);
    DOM.exportComparisonBtn.addEventListener('click', handleExportComparison);
  }

  /**
   * 执行批注迁移并展示结果
   * @param {Section[]} newSections - 新解析的章节
   * @param {Section[]} oldSections - 旧章节
   * @returns {boolean} 是否有批注需要迁移
   */
  function performMigration(newSections, oldSections) {
    const existingAnnotations = AnnotationManager.getAllAnnotations();
    if (existingAnnotations.length === 0) return false;

    const result = AnnotationManager.migrateToNewSections(newSections, oldSections);
    const stats = result.stats;

    // 构建迁移结果提示
    let message = '';
    if (stats.total === 0) {
      return false;
    }

    const parts = [];
    if (stats.exactMatch > 0) parts.push(`${stats.exactMatch} 条精确匹配`);
    if (stats.corrected > 0) parts.push(`${stats.corrected} 条已修正`);
    if (stats.invalidated > 0) parts.push(`${stats.invalidated} 条已失效`);

    if (parts.length > 0) {
      message = `批注迁移完成：${parts.join('，')}`;
      showToast(message, stats.invalidated > 0 ? 'warning' : 'success');
    }

    return true;
  }

  /**
   * 处理文件导入（支持批注迁移）
   */
  async function handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      showToast('正在读取文件...', 'info');
      const result = await FileReader.readFile(file);

      // 保存旧章节数据（用于迁移）
      const oldSections = state.sections.length > 0 ? [...state.sections] : null;
      const hasExistingAnnotations = AnnotationManager.getAllAnnotations().length > 0;

      // 解析新章节
      state.sections = TextParser.parseSections(result.content, result.type);
      state.contractTitle = file.name.replace(/\.\w+$/, '');
      state.fileLoaded = true;

      // 如果已有批注，尝试迁移；否则清空
      if (hasExistingAnnotations && oldSections) {
        performMigration(state.sections, oldSections);
      } else {
        AnnotationManager.clearAll();
      }

      // 渲染
      renderContract();

      // 启用功能按钮
      enableControls(true);

      showToast(`成功导入：${file.name}（识别到 ${state.sections.length} 个章节）`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }

    // 重置input（允许重新选择同一文件）
    e.target.value = '';
  }

  /**
   * 处理拖拽导入（支持批注迁移）
   */
  async function handleDrop(e) {
    e.preventDefault();
    DOM.dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file) return;

    try {
      showToast('正在读取文件...', 'info');
      const result = await FileReader.readFile(file);

      // 保存旧章节数据
      const oldSections = state.sections.length > 0 ? [...state.sections] : null;
      const hasExistingAnnotations = AnnotationManager.getAllAnnotations().length > 0;

      state.sections = TextParser.parseSections(result.content, result.type);
      state.contractTitle = file.name.replace(/\.\w+$/, '');
      state.fileLoaded = true;

      // 迁移或清空
      if (hasExistingAnnotations && oldSections) {
        performMigration(state.sections, oldSections);
      } else {
        AnnotationManager.clearAll();
      }

      renderContract();
      enableControls(true);
      showToast(`成功导入：${file.name}`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  /**
   * 处理项目文件导入（含迁移验证）
   */
  async function handleProjectImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      showToast('正在加载项目...', 'info');
      const projectState = await ReportExporter.importProjectFile(file);

      // 保存旧章节数据
      const oldSections = state.sections.length > 0 ? [...state.sections] : null;
      const hasExistingAnnotations = AnnotationManager.getAllAnnotations().length > 0;

      state.sections = projectState.sections;
      state.contractTitle = projectState.contractTitle;
      state.fileLoaded = true;

      // 导入项目批注
      AnnotationManager.importAnnotations(projectState.annotations, state.sections);

      // 如果本地已有旧批注（与导入的不同），尝试迁移
      // 这里直接导入项目的批注即可，因为它们与项目的 sections 匹配
      renderContract();
      enableControls(true);

      showToast(`项目加载成功：${projectState.contractTitle}（${projectState.annotations.length} 条批注）`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
    e.target.value = '';
  }

  /**
   * 渲染合同内容
   */
  function renderContract() {
    // 隐藏占位，显示内容
    DOM.contentPlaceholder.style.display = 'none';
    DOM.contractContent.style.display = 'block';

    // 渲染章节
    AnnotationRenderer.renderSections(state.sections, AnnotationManager.getAllAnnotations());

    // 渲染导航
    renderChapterNav();

    // 更新标题
    DOM.contractTitle.textContent = state.contractTitle;

    // 渲染批注列表
    renderAnnotationList();

    // 更新统计
    updateStatistics();

    // 验证批注定位
    validateAnnotationPositions();
  }

  /**
   * 渲染章节导航
   */
  function renderChapterNav() {
    const annotations = AnnotationManager.getAllAnnotations();
    const counts = {};
    annotations.forEach(a => {
      if (a.status !== 'invalidated') {
        counts[a.sectionId] = (counts[a.sectionId] || 0) + 1;
      }
    });

    let html = '';
    state.sections.forEach(section => {
      const count = counts[section.id] || 0;
      const badge = count > 0 ? `<span class="nav-badge">${count}</span>` : '';
      html += `<div class="nav-item level-${section.level}" data-section-id="${section.id}">
        ${AnnotationRenderer.escapeHTML(section.title)}${badge}
      </div>`;
    });

    DOM.chapterNav.innerHTML = html || '<p class="empty-hint">暂无章节</p>';

    // 绑定导航点击
    DOM.chapterNav.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const sectionId = item.dataset.sectionId;
        AnnotationRenderer.ensureSectionRendered(sectionId);
        const el = DOM.contractContent.querySelector(`.section-wrapper[data-section-id="${sectionId}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // 更新active状态
        DOM.chapterNav.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
      });
    });
  }

  /**
   * 处理文本选择
   */
  let currentSelection = null;

  function handleTextSelection(e) {
    // 忽略表单区域和侧栏的选择
    if (e.target.closest('.sidebar-right') || e.target.closest('.annotation-form') ||
        e.target.closest('.modal') || e.target.closest('.toolbar')) {
      return;
    }

    setTimeout(() => {
      const selection = AnnotationRenderer.getSelection();
      if (selection && selection.anchorText.length > 0) {
        currentSelection = selection;
        showAnnotationForm(selection);
      }
    }, 10);
  }

  /**
   * 显示批注表单
   */
  function showAnnotationForm(selection) {
    DOM.annotationForm.style.display = 'block';
    DOM.selectedText.textContent = selection.anchorText.length > 80
      ? selection.anchorText.substring(0, 80) + '...'
      : selection.anchorText;

    // 重置选择
    DOM.riskTypeSelector.querySelectorAll('.risk-btn').forEach(b => b.classList.remove('active'));
    DOM.riskLevelSelector.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
    DOM.riskLevelSelector.querySelector('[data-level="medium"]').classList.add('active');
    DOM.annotationComment.value = '';
  }

  /**
   * 隐藏批注表单
   */
  function hideAnnotationForm() {
    DOM.annotationForm.style.display = 'none';
    currentSelection = null;
    window.getSelection().removeAllRanges();
  }

  /**
   * 添加批注
   */
  function handleAddAnnotation() {
    if (!currentSelection) {
      showToast('请先在合同中选中文本', 'warning');
      return;
    }

    const activeRiskBtn = DOM.riskTypeSelector.querySelector('.risk-btn.active');
    if (!activeRiskBtn) {
      showToast('请选择风险类型', 'warning');
      return;
    }

    const activeLevelBtn = DOM.riskLevelSelector.querySelector('.level-btn.active');
    const riskType = activeRiskBtn.dataset.type;
    const riskLevel = activeLevelBtn ? activeLevelBtn.dataset.level : 'medium';
    const comment = DOM.annotationComment.value.trim();

    const result = AnnotationManager.addAnnotation({
      sectionId: currentSelection.sectionId,
      paragraphIndex: currentSelection.paragraphIndex,
      startOffset: currentSelection.startOffset,
      endOffset: currentSelection.endOffset,
      anchorText: currentSelection.anchorText,
      riskType,
      riskLevel,
      comment
    });

    if (result.error === 'duplicate') {
      showDuplicateModal(result.existing);
      return;
    }

    if (result.success) {
      showToast('批注添加成功', 'success');
      hideAnnotationForm();
    }
  }

  /**
   * 显示重复标注确认
   */
  function showDuplicateModal(existing) {
    const rt = AnnotationManager.RISK_TYPES[existing.riskType];
    DOM.modalTitle.textContent = '重复标注检测';
    DOM.modalBody.innerHTML = `
      <p>检测到该区域已有相似标注：</p>
      <div style="margin:12px 0;padding:10px;background:#f8f9fa;border-radius:4px;font-size:13px">
        <div><strong>风险类型：</strong>${rt.icon} ${rt.label}</div>
        <div><strong>条款内容：</strong>${AnnotationRenderer.escapeHTML(existing.anchorText.substring(0, 60))}...</div>
        <div><strong>批注：</strong>${AnnotationRenderer.escapeHTML(existing.comment || '无')}</div>
      </div>
      <p>是否仍然添加新标注？</p>
    `;
    DOM.modalFooter.innerHTML = '';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.textContent = '取消';
    cancelBtn.onclick = () => { DOM.modalOverlay.style.display = 'none'; };

    const forceBtn = document.createElement('button');
    forceBtn.className = 'btn btn-primary';
    forceBtn.textContent = '强制添加';
    forceBtn.onclick = () => {
      DOM.modalOverlay.style.display = 'none';
      if (currentSelection) {
        // 直接添加到数组（绕过检测）
        const section = state.sections.find(s => s.id === currentSelection.sectionId);
        const para = section ? section.paragraphs.find(p => p.index === currentSelection.paragraphIndex) : null;
        const rangeId = section && para
          ? TextParser.computeRangeId(section.title, para.text, currentSelection.anchorText)
          : `rng_${currentSelection.sectionId}_${currentSelection.paragraphIndex}`;
        const context = section && para
          ? TextParser.computeAnchorContext(para.text, currentSelection.startOffset, currentSelection.endOffset)
          : { before: '', after: '' };

        const ann = {
          id: 'ann_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2,5),
          rangeId,
          sectionId: currentSelection.sectionId,
          paragraphIndex: currentSelection.paragraphIndex,
          startOffset: currentSelection.startOffset,
          endOffset: currentSelection.endOffset,
          anchorText: currentSelection.anchorText,
          riskType: DOM.riskTypeSelector.querySelector('.risk-btn.active').dataset.type,
          riskLevel: DOM.riskLevelSelector.querySelector('.level-btn.active')?.dataset.level || 'medium',
          comment: DOM.annotationComment.value.trim(),
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          history: [{ action: 'created', time: new Date().toISOString(), status: 'pending' }],
          _sectionTitle: section ? section.title : '',
          _context: context
        };
        AnnotationManager.importAnnotations([...AnnotationManager.getAllAnnotations(), ann], state.sections);
        showToast('已强制添加批注', 'success');
        hideAnnotationForm();
      }
    };

    DOM.modalFooter.appendChild(cancelBtn);
    DOM.modalFooter.appendChild(forceBtn);
    DOM.modalOverlay.style.display = 'flex';
  }

  /**
   * 渲染批注列表（增强：支持已失效批注的视觉标记）
   */
  function renderAnnotationList() {
    let annotations = AnnotationManager.getAllAnnotations();
    const filterType = DOM.filterRiskType.value;
    const filterStatus = DOM.filterStatus.value;

    if (filterType) annotations = annotations.filter(a => a.riskType === filterType);
    if (filterStatus) annotations = annotations.filter(a => a.status === filterStatus);

    // 更新总数（区分有效/失效）
    const allAnns = AnnotationManager.getAllAnnotations();
    const activeCount = allAnns.filter(a => a.status !== 'invalidated').length;
    const invalidatedCount = allAnns.filter(a => a.status === 'invalidated').length;
    let totalText = `${activeCount} 条`;
    if (invalidatedCount > 0) totalText += ` (${invalidatedCount} 条失效)`;
    DOM.annotationTotal.textContent = totalText;

    if (annotations.length === 0) {
      DOM.annotationList.innerHTML = '<p class="empty-hint">暂无批注</p>';
      return;
    }

    let html = '';
    annotations.forEach(ann => {
      const rt = AnnotationManager.RISK_TYPES[ann.riskType];
      const rl = AnnotationManager.RISK_LEVELS[ann.riskLevel];
      const st = AnnotationManager.STATUS_FLOW[ann.status];
      const section = state.sections.find(s => s.id === ann.sectionId);
      const isInvalidated = ann.status === 'invalidated';

      // 获取可用的下一步状态
      const nextStatuses = st ? (st.next || []) : [];

      // 已失效批注使用特殊样式
      const invalidatedClass = isInvalidated ? ' annotation-invalidated' : '';
      const invalidatedStyle = isInvalidated ? 'opacity:0.6;border-left:3px solid #bdc3c7;' : '';

      html += `<div class="annotation-item${invalidatedClass}" data-annotation-id="${ann.id}" style="${invalidatedStyle}">
        <div class="annotation-item-header">
          <span class="risk-badge" style="background:${rt ? rt.color : '#999'}">${rt ? rt.icon : '?'} ${rt ? rt.label : '未知'}</span>
          <span class="status-badge" style="background:${st ? st.color : '#999'}">${st ? st.label : '未知'}</span>
          <span class="risk-badge" style="background:${rl ? rl.color : '#999'}">${rl ? rl.label : '未知'}</span>
        </div>
        <div class="anchor-text" title="${AnnotationRenderer.escapeHTML(ann.anchorText)}"
          ${isInvalidated ? 'style="text-decoration:line-through;color:#999"' : ''}>
          ${AnnotationRenderer.escapeHTML(ann.anchorText)}
        </div>
        ${isInvalidated && ann._invalidReason ? `<div class="invalidated-reason" style="color:#e74c3c;font-size:12px;margin-top:4px">⚠ ${AnnotationRenderer.escapeHTML(ann._invalidReason)}</div>` : ''}
        ${ann.comment ? `<div class="comment">${AnnotationRenderer.escapeHTML(ann.comment)}</div>` : ''}
        <div class="item-actions">
          ${!isInvalidated ? `<button data-action="locate" data-id="${ann.id}" title="定位到原文">定位</button>` : ''}
          <button data-action="edit" data-id="${ann.id}" title="编辑批注">编辑</button>
          ${nextStatuses.map(ns => {
            const nsInfo = AnnotationManager.STATUS_FLOW[ns];
            return nsInfo ? `<button data-action="status" data-id="${ann.id}" data-status="${ns}" style="color:${nsInfo.color}" title="转为${nsInfo.label}">→ ${nsInfo.label}</button>` : '';
          }).join('')}
          <button data-action="delete" data-id="${ann.id}" style="color:#e74c3c" title="删除">删除</button>
        </div>
      </div>`;
    });

    DOM.annotationList.innerHTML = html;
  }

  /**
   * 批注列表点击事件处理
   */
  function handleAnnotationListClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;

    switch (action) {
      case 'locate':
        AnnotationRenderer.scrollToAnnotation(id);
        break;

      case 'edit':
        openEditModal(id);
        break;

      case 'status':
        try {
          AnnotationManager.changeStatus(id, btn.dataset.status);
          showToast('状态已更新', 'success');
        } catch (err) {
          showToast(err.message, 'error');
        }
        break;

      case 'delete':
        showDeleteConfirm(id);
        break;
    }
  }

  /**
   * 打开编辑对话框
   */
  function openEditModal(id) {
    const ann = AnnotationManager.getAllAnnotations().find(a => a.id === id);
    if (!ann) return;

    DOM.editRiskType.value = ann.riskType;
    DOM.editRiskLevel.value = ann.riskLevel;
    DOM.editComment.value = ann.comment || '';
    DOM.editSaveBtn.dataset.annotationId = id;
    DOM.editModalOverlay.style.display = 'flex';
  }

  /**
   * 保存编辑
   */
  function handleEditSave() {
    const id = DOM.editSaveBtn.dataset.annotationId;
    if (!id) return;

    try {
      AnnotationManager.updateAnnotation(id, {
        riskType: DOM.editRiskType.value,
        riskLevel: DOM.editRiskLevel.value,
        comment: DOM.editComment.value.trim()
      });
      DOM.editModalOverlay.style.display = 'none';
      showToast('批注已更新', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  /**
   * 删除确认
   */
  function showDeleteConfirm(id) {
    DOM.modalTitle.textContent = '确认删除';
    DOM.modalBody.innerHTML = '<p>确定要删除这条批注吗？此操作无法撤销。</p>';
    DOM.modalFooter.innerHTML = '';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.textContent = '取消';
    cancelBtn.onclick = () => { DOM.modalOverlay.style.display = 'none'; };

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.textContent = '删除';
    deleteBtn.onclick = () => {
      try {
        AnnotationManager.deleteAnnotation(id);
        DOM.modalOverlay.style.display = 'none';
        showToast('批注已删除', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    };

    DOM.modalFooter.appendChild(cancelBtn);
    DOM.modalFooter.appendChild(deleteBtn);
    DOM.modalOverlay.style.display = 'flex';
  }

  /**
   * 合同内容区域点击处理
   */
  function handleContentClick(e) {
    const mark = e.target.closest('.annotation-highlight');
    if (mark) {
      const annId = mark.dataset.annotationId;
      if (annId) {
        // 在右侧列表中滚动到对应批注
        const listItem = DOM.annotationList.querySelector(`[data-annotation-id="${annId}"]`);
        if (listItem) {
          listItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
          listItem.style.background = '#ebf5fb';
          setTimeout(() => { listItem.style.background = ''; }, 1500);
        }
      }
    }
  }

  /**
   * 搜索处理
   */
  function handleSearch() {
    const term = DOM.searchInput.value.trim();
    DOM.searchClear.style.display = term ? 'block' : 'none';
    AnnotationRenderer.search(term);
    // 搜索计数由 onSearchComplete 回调更新
  }

  /**
   * 保存项目
   */
  function handleSave() {
    const data = ReportExporter.exportProjectState(
      state.sections,
      AnnotationManager.getAllAnnotations(),
      state.contractTitle
    );

    const result = ReportExporter.saveToLocal(data);
    if (result.success) {
      showToast(`保存成功 (${(result.size / 1024).toFixed(1)}KB)`, 'success');
    } else {
      showToast(result.error, 'error');
    }
  }

  /**
   * 导出评审报告
   */
  function handleExportReport() {
    const annotations = AnnotationManager.getAllAnnotations();
    const stats = RiskStatistics.computeStats(annotations);
    ReportExporter.exportReport(state.sections, annotations, stats);
    showToast('报告导出成功', 'success');
  }

  /**
   * 导出项目文件
   */
  function handleExportProject() {
    ReportExporter.exportProjectFile(
      state.sections,
      AnnotationManager.getAllAnnotations(),
      state.contractTitle
    );
    showToast('项目文件导出成功', 'success');
  }

  /**
   * 批注变化回调
   */
  function onAnnotationsChanged(event) {
    // 刷新高亮
    AnnotationRenderer.refreshHighlights();

    // 刷新列表
    renderAnnotationList();

    // 刷新导航计数
    renderChapterNav();

    // 更新统计
    updateStatistics();
  }

  /**
   * 更新统计面板
   */
  function updateStatistics() {
    const annotations = AnnotationManager.getAllAnnotations();
    const stats = RiskStatistics.computeStats(annotations);

    // 柱状图
    RiskStatistics.renderBarChart(stats, DOM.barChart);

    // 饼图
    RiskStatistics.renderPieChart(stats, DOM.pieChart);

    // 摘要卡片
    renderSummaryCards(stats);

    // 评审清单
    DOM.checklistContent.innerHTML = RiskStatistics.generateChecklist(annotations, state.sections);
  }

  /**
   * 渲染摘要卡片
   */
  function renderSummaryCards(stats) {
    const cards = [
      { num: stats.total, label: '总批注', color: 'var(--primary)' },
      { num: stats.byLevel.high, label: '高风险', color: 'var(--level-high)' },
      { num: stats.byLevel.medium, label: '中风险', color: 'var(--level-medium)' },
      { num: stats.byLevel.low, label: '低风险', color: 'var(--level-low)' },
      { num: stats.byStatus.pending + stats.byStatus.reviewing, label: '待处理', color: 'var(--status-pending)' },
      { num: stats.byStatus.resolved, label: '已解决', color: 'var(--status-resolved)' }
    ];

    DOM.summaryCards.innerHTML = cards.map(card =>
      `<div class="summary-card">
        <div class="card-num" style="color:${card.color}">${card.num}</div>
        <div class="card-label">${card.label}</div>
      </div>`
    ).join('');
  }

  /**
   * 验证批注定位
   */
  function validateAnnotationPositions() {
    if (!state.fileLoaded) return;

    const annotations = AnnotationManager.getAllAnnotations();
    if (annotations.length === 0) {
      DOM.validationContent.innerHTML = '<p class="empty-hint">暂无批注需要验证</p>';
      return;
    }

    const results = RiskStatistics.validateAnnotations(annotations, state.sections);
    RiskStatistics.renderValidationResults(results, DOM.validationContent);
  }

  // ==================== 版本对比功能 ====================

  /**
   * 点击"版本对比"按钮
   */
  function handleCompareClick() {
    if (!state.fileLoaded) {
      showToast('请先导入合同文件', 'warning');
      return;
    }
    DOM.compareStatus.textContent = '';
    DOM.compareStatus.className = '';
    DOM.compareModalOverlay.style.display = 'flex';
  }

  /**
   * 处理修订版文件上传
   */
  async function handleRevisedFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      DOM.compareStatus.textContent = '正在读取修订版文件...';
      DOM.compareStatus.className = 'loading';

      const result = await FileReader.readFile(file);
      DOM.compareStatus.textContent = '正在解析并分析变更...';

      // 解析修订版
      state.revisedSections = TextParser.parseSections(result.content, result.type);
      state.revisedTitle = file.name.replace(/\.\w+$/, '');

      // 执行diff
      state.diffResult = DiffEngine.compare(state.sections, state.revisedSections);

      // 执行变更分析
      state.analysisResult = ChangeAnalyzer.analyze(
        state.diffResult, state.sections, state.revisedSections
      );

      // 批注迁移预览
      const annotations = AnnotationManager.getAllAnnotations();
      if (annotations.length > 0) {
        state.migrationResults = ChangeAnalyzer.migrateAnnotationsForComparison(
          annotations, state.sections, state.revisedSections
        );
      } else {
        state.migrationResults = [];
      }

      DOM.compareStatus.textContent = `分析完成：检测到 ${state.analysisResult.riskSummary.totalChanges} 处变更，${state.analysisResult.suggestions.length} 条谈判建议`;
      DOM.compareStatus.className = 'success';

      // 关闭弹窗，进入对比模式
      setTimeout(() => {
        DOM.compareModalOverlay.style.display = 'none';
        enterComparisonMode();
      }, 800);

    } catch (err) {
      DOM.compareStatus.textContent = '文件解析失败: ' + err.message;
      DOM.compareStatus.className = 'error';
    }

    e.target.value = '';
  }

  /**
   * 进入对比模式
   */
  function enterComparisonMode() {
    state.comparisonMode = true;

    // 隐藏标准布局，显示对比布局
    DOM.mainLayout.style.display = 'none';
    DOM.comparisonLayout.style.display = 'flex';

    // 初始化对比渲染器
    ComparisonRenderer.init();

    // 设置版本标签
    document.getElementById('originalVersionLabel').textContent = state.contractTitle || '原始版本';
    document.getElementById('revisedVersionLabel').textContent = state.revisedTitle || '修订版本';

    // 渲染对比视图
    ComparisonRenderer.renderComparison(
      state.diffResult, state.analysisResult,
      state.sections, state.revisedSections
    );

    // 显示变更分析标签页
    DOM.tabBtnChanges.style.display = '';

    // 如果有迁移结果，渲染迁移状态
    if (state.migrationResults && state.migrationResults.length > 0) {
      const migrationHTML = ComparisonRenderer.renderMigrationStatus(state.migrationResults);
      // 追加到变更分析面板
      if (DOM.changesContent) {
        DOM.changesContent.insertAdjacentHTML('beforeend', migrationHTML);
      }
    }

    showToast(`已进入对比模式：${state.analysisResult.riskSummary.totalChanges} 处变更`, 'info');
  }

  /**
   * 退出对比模式
   */
  function exitComparisonMode() {
    state.comparisonMode = false;

    // 清理对比渲染器
    ComparisonRenderer.destroy();

    // 恢复标准布局
    DOM.comparisonLayout.style.display = 'none';
    DOM.mainLayout.style.display = '';

    // 隐藏变更分析标签页
    DOM.tabBtnChanges.style.display = 'none';

    // 如果变更分析标签页是激活的，切回图表
    if (DOM.tabBtnChanges.classList.contains('active')) {
      DOM.tabBtnChanges.classList.remove('active');
      document.getElementById('tabChanges').classList.remove('active');
      document.querySelector('.tab-btn[data-tab="chart"]').classList.add('active');
      document.getElementById('tabChart').classList.add('active');
    }

    // 清理对比状态（保留数据以支持重新进入）
    showToast('已退出对比模式', 'info');
  }

  /**
   * 应用批注迁移到修订版
   */
  function handleApplyMigration() {
    if (!state.revisedSections || !state.migrationResults) {
      showToast('暂无可迁移的批注', 'warning');
      return;
    }

    // 显示确认对话框
    DOM.modalTitle.textContent = '应用批注迁移';

    const migrated = state.migrationResults.filter(r => r.status === 'migrated').length;
    const adjusted = state.migrationResults.filter(r => r.status === 'adjusted').length;
    const invalidated = state.migrationResults.filter(r => r.status === 'invalidated').length;

    DOM.modalBody.innerHTML = `
      <p>将批注迁移到修订版本，并以修订版本替换当前合同：</p>
      <div style="margin:12px 0;padding:10px;background:#f8f9fa;border-radius:4px;font-size:13px">
        <div>精确迁移：<strong style="color:#27ae60">${migrated}</strong> 条</div>
        <div>位置调整：<strong style="color:#f39c12">${adjusted}</strong> 条</div>
        <div>已失效：<strong style="color:#e74c3c">${invalidated}</strong> 条</div>
      </div>
      <p style="color:#e67e22;font-size:12px">注意：此操作将用修订版替换当前合同，失效的批注将被标记。</p>
    `;
    DOM.modalFooter.innerHTML = '';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.textContent = '取消';
    cancelBtn.onclick = () => { DOM.modalOverlay.style.display = 'none'; };

    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn btn-primary';
    applyBtn.textContent = '确认迁移';
    applyBtn.onclick = () => {
      DOM.modalOverlay.style.display = 'none';
      doApplyMigration();
    };

    DOM.modalFooter.appendChild(cancelBtn);
    DOM.modalFooter.appendChild(applyBtn);
    DOM.modalOverlay.style.display = 'flex';
  }

  /**
   * 执行迁移
   */
  function doApplyMigration() {
    // 用修订版替换当前合同
    const oldSections = state.sections;
    state.sections = state.revisedSections;
    state.contractTitle = state.revisedTitle;

    // 执行批注迁移
    AnnotationManager.migrateToNewSections(state.sections, oldSections);

    // 退出对比模式
    exitComparisonMode();

    // 重新渲染
    renderContract();

    showToast('批注迁移完成，当前合同已更新为修订版本', 'success');
  }

  /**
   * 导出对比报告
   */
  function handleExportComparison() {
    if (!state.diffResult || !state.analysisResult) {
      showToast('暂无对比数据', 'warning');
      return;
    }

    ComparisonReporter.exportComparisonReport(
      state.diffResult,
      state.analysisResult,
      state.migrationResults || [],
      state.contractTitle,
      state.revisedTitle
    );
    showToast('对比报告导出成功', 'success');
  }

  /**
   * 尝试自动加载
   */
  function tryAutoLoad() {
    const saved = ReportExporter.loadFromLocal();
    if (saved && saved.data) {
      try {
        const projectState = ReportExporter.importProjectState(saved.data);
        state.sections = projectState.sections;
        state.contractTitle = projectState.contractTitle;
        state.fileLoaded = true;
        AnnotationManager.importAnnotations(projectState.annotations, state.sections);
        renderContract();
        enableControls(true);

        const savedTime = saved.savedTime ? new Date(saved.savedTime).toLocaleString('zh-CN') : '未知';
        showToast(`已恢复上次保存的数据 (${savedTime})`, 'info');
      } catch (err) {
        console.warn('自动加载失败:', err);
      }
    }
  }

  /**
   * 启用/禁用控件
   */
  function enableControls(enabled) {
    DOM.searchInput.disabled = !enabled;
    DOM.saveBtn.disabled = !enabled;
    DOM.exportReportBtn.disabled = !enabled;
    DOM.exportProjectBtn.disabled = !enabled;
    DOM.compareBtn.disabled = !enabled;
  }

  /**
   * Toast通知
   */
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    DOM.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /**
   * 工具函数
   */
  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // 页面加载完成后初始化
  document.addEventListener('DOMContentLoaded', init);

  return { init, showToast, getSections };
})();
