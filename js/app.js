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
    // 版本对比
    comparisonMode: false,
    comparisonData: null
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
      // 版本对比
      compareBtn: document.getElementById('compareBtn'),
      comparisonModalOverlay: document.getElementById('comparisonModalOverlay'),
      comparisonModalClose: document.getElementById('comparisonModalClose'),
      comparisonOldFile: document.getElementById('comparisonOldFile'),
      comparisonNewFile: document.getElementById('comparisonNewFile'),
      oldFileName: document.getElementById('oldFileName'),
      newFileName: document.getElementById('newFileName'),
      startCompareBtn: document.getElementById('startCompareBtn'),
      cancelCompareBtn: document.getElementById('cancelCompareBtn'),
      comparisonView: document.getElementById('comparisonView')
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

    // 版本对比
    DOM.compareBtn.addEventListener('click', () => {
      DOM.comparisonModalOverlay.style.display = 'flex';
    });
    DOM.comparisonModalClose.addEventListener('click', () => {
      DOM.comparisonModalOverlay.style.display = 'none';
    });
    DOM.cancelCompareBtn.addEventListener('click', () => {
      DOM.comparisonModalOverlay.style.display = 'none';
    });
    DOM.comparisonModalOverlay.addEventListener('click', (e) => {
      if (e.target === DOM.comparisonModalOverlay) DOM.comparisonModalOverlay.style.display = 'none';
    });

    // 文件选择状态更新
    DOM.comparisonOldFile.addEventListener('change', updateCompareBtnState);
    DOM.comparisonNewFile.addEventListener('change', updateCompareBtnState);

    DOM.startCompareBtn.addEventListener('click', handleStartComparison);
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
      { num: stats.total, label: '有效批注', color: 'var(--primary)' },
      { num: stats.byLevel.high, label: '高风险', color: 'var(--level-high)' },
      { num: stats.byLevel.medium, label: '中风险', color: 'var(--level-medium)' },
      { num: stats.byLevel.low, label: '低风险', color: 'var(--level-low)' },
      { num: stats.byStatus.pending + stats.byStatus.reviewing, label: '待处理', color: 'var(--status-pending)' },
      { num: stats.byStatus.resolved, label: '已解决', color: 'var(--status-resolved)' }
    ];
    // 有失效批注时追加一张卡片
    if (stats.invalidatedCount > 0) {
      cards.push({ num: stats.invalidatedCount, label: '已失效', color: '#bdc3c7' });
    }

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
   * 版本对比：更新按钮状态
   */
  function updateCompareBtnState() {
    const hasOld = DOM.comparisonOldFile.files.length > 0;
    const hasNew = DOM.comparisonNewFile.files.length > 0;

    DOM.oldFileName.textContent = hasOld ? DOM.comparisonOldFile.files[0].name : '点击选择文件';
    DOM.newFileName.textContent = hasNew ? DOM.comparisonNewFile.files[0].name : '点击选择文件';
    DOM.startCompareBtn.disabled = !(hasOld && hasNew);
  }

  /**
   * 版本对比：开始对比
   */
  async function handleStartComparison() {
    const oldFile = DOM.comparisonOldFile.files[0];
    const newFile = DOM.comparisonNewFile.files[0];
    if (!oldFile || !newFile) {
      showToast('请选择两个合同文件', 'warning');
      return;
    }

    try {
      showToast('正在读取文件...', 'info');

      // 读取两个文件
      const oldResult = await FileReader.readFile(oldFile);
      const newResult = await FileReader.readFile(newFile);

      // 解析章节
      const oldSections = TextParser.parseSections(oldResult.content, oldResult.type);
      const newSections = TextParser.parseSections(newResult.content, newResult.type);

      showToast('正在分析变更...', 'info');

      // 快照当前批注
      const oldAnnotations = AnnotationManager.snapshotAnnotations();

      // 运行 diff 算法
      const diffResult = VersionComparator.compareSections(oldSections, newSections);
      diffResult.oldTitle = oldFile.name.replace(/\.\w+$/, '');
      diffResult.newTitle = newFile.name.replace(/\.\w+$/, '');

      // 迁移批注到新版（用于计算风险变化）
      let newAnnotations = [];
      let migrationStats = { total: 0, migrated: 0, invalidated: 0 };

      if (oldAnnotations.length > 0) {
        // 临时迁移
        const migrationResult = TextParser.migrateAnnotations(oldAnnotations, newSections, oldSections);
        newAnnotations = migrationResult.migrated || [];
        migrationStats = {
          total: oldAnnotations.length,
          migrated: (migrationResult.stats?.exactMatch || 0) + (migrationResult.stats?.corrected || 0),
          invalidated: migrationResult.stats?.invalidated || 0
        };
      }

      // 分析风险变化
      const riskDeltas = NegotiationAdvisor.getRiskDelta(diffResult, oldAnnotations, newAnnotations);

      // 生成谈判建议
      const suggestions = NegotiationAdvisor.analyzeChanges(diffResult, oldAnnotations, newAnnotations);

      // 存储对比数据
      state.comparisonData = {
        diffResult,
        oldSections,
        newSections,
        oldAnnotations,
        newAnnotations,
        suggestions,
        riskDeltas,
        migrationStats
      };
      state.comparisonMode = true;

      // 关闭模态
      DOM.comparisonModalOverlay.style.display = 'none';

      // 隐藏主布局，显示对比视图
      document.querySelector('.toolbar').style.display = 'none';
      document.querySelector('.main-layout').style.display = 'none';
      document.querySelector('.stats-panel').style.display = 'none';
      DOM.comparisonView.style.display = 'flex';

      // 初始化并渲染对比视图
      ComparisonRenderer.init(DOM.comparisonView);
      ComparisonRenderer.renderComparison(diffResult, suggestions, riskDeltas, migrationStats);

      // 绑定退出和导出事件
      setTimeout(() => {
        const exitBtn = DOM.comparisonView.querySelector('#exitCompareBtn');
        const exportBtn = DOM.comparisonView.querySelector('#exportCompareBtn');

        if (exitBtn) {
          exitBtn.addEventListener('click', exitComparisonMode);
        }
        if (exportBtn) {
          exportBtn.addEventListener('click', handleExportComparison);
        }
      }, 50);

      const summary = diffResult.summary;
      showToast(`对比完成：${summary.sectionsModified} 处修改，${suggestions.length} 条谈判建议`, 'success');

      // 重置文件输入
      DOM.comparisonOldFile.value = '';
      DOM.comparisonNewFile.value = '';
      updateCompareBtnState();

    } catch (err) {
      showToast('对比失败：' + err.message, 'error');
      console.error(err);
    }
  }

  /**
   * 版本对比：退出对比模式
   */
  function exitComparisonMode() {
    state.comparisonMode = false;
    state.comparisonData = null;

    // 隐藏对比视图
    DOM.comparisonView.style.display = 'none';
    ComparisonRenderer.destroy();

    // 恢复主布局
    document.querySelector('.toolbar').style.display = '';
    document.querySelector('.main-layout').style.display = '';
    document.querySelector('.stats-panel').style.display = '';
  }

  /**
   * 版本对比：导出对比报告
   */
  function handleExportComparison() {
    if (!state.comparisonData) {
      showToast('无对比数据', 'warning');
      return;
    }

    const { diffResult, suggestions, riskDeltas, migrationStats, oldAnnotations, newAnnotations } = state.comparisonData;
    ComparisonExporter.exportComparisonReport(diffResult, suggestions, riskDeltas, migrationStats, oldAnnotations, newAnnotations);
    showToast('对比报告导出成功', 'success');
  }

  /**
   * 启用/禁用控件
   */
  function enableControls(enabled) {
    DOM.searchInput.disabled = !enabled;
    DOM.saveBtn.disabled = !enabled;
    DOM.exportReportBtn.disabled = !enabled;
    DOM.exportProjectBtn.disabled = !enabled;
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

  return { init, showToast, getSections, exitComparisonMode };
})();
