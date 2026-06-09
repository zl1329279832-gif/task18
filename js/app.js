/**
 * app.js - 主控制器
 * 负责模块编排、事件绑定、状态同步
 * 重新解析时批注迁移、筛选联动高亮
 */
const App = (() => {
  // 应用状态
  let state = {
    sections: [],
    contractTitle: '',
    fileLoaded: false
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
      editModalClose: document.getElementById('editModalClose')
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

    // 筛选（联动高亮）
    DOM.filterRiskType.addEventListener('change', handleFilterChange);
    DOM.filterStatus.addEventListener('change', handleFilterChange);

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

    // 清单区域的stale删除按钮代理
    DOM.checklistContent.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-delete-stale');
      if (btn) {
        const id = btn.dataset.id;
        try {
          AnnotationManager.deleteAnnotation(id);
          showToast('已删除失效批注', 'success');
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
    });
  }

  /**
   * 处理文件导入（支持迁移）
   */
  async function handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      showToast('正在读取文件...', 'info');
      const result = await FileReader.readFile(file);

      // 解析新章节
      const newSections = TextParser.parseSections(result.content, result.type);
      const existingAnnotations = AnnotationManager.getAllAnnotations();

      // 如果已有批注，走迁移流程
      if (existingAnnotations.length > 0 && state.fileLoaded) {
        const oldSections = state.sections;
        state.sections = newSections;
        state.contractTitle = file.name.replace(/\.\w+$/, '');

        // 执行批注迁移
        const migrationResult = TextParser.migrateAnnotations(existingAnnotations, oldSections, newSections);
        AnnotationManager.applyMigrationResult(migrationResult);

        // 渲染
        renderContract();

        // 显示迁移报告
        const msg = buildMigrationMessage(migrationResult);
        showToast(msg, migrationResult.stale.length > 0 ? 'warning' : 'success');

        // 如果有失效批注，弹窗详细说明
        if (migrationResult.stale.length > 0) {
          showMigrationReport(migrationResult);
        }
      } else {
        // 首次导入，正常流程
        state.sections = newSections;
        state.contractTitle = file.name.replace(/\.\w+$/, '');
        state.fileLoaded = true;
        AnnotationManager.clearAll();
        renderContract();
        enableControls(true);
        showToast(`成功导入：${file.name}（识别到 ${state.sections.length} 个章节）`, 'success');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }

    // 重置input（允许重新选择同一文件）
    e.target.value = '';
  }

  /**
   * 处理拖拽导入（支持迁移）
   */
  async function handleDrop(e) {
    e.preventDefault();
    DOM.dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file) return;

    try {
      showToast('正在读取文件...', 'info');
      const result = await FileReader.readFile(file);
      const newSections = TextParser.parseSections(result.content, result.type);
      const existingAnnotations = AnnotationManager.getAllAnnotations();

      if (existingAnnotations.length > 0 && state.fileLoaded) {
        const oldSections = state.sections;
        state.sections = newSections;
        state.contractTitle = file.name.replace(/\.\w+$/, '');

        const migrationResult = TextParser.migrateAnnotations(existingAnnotations, oldSections, newSections);
        AnnotationManager.applyMigrationResult(migrationResult);

        renderContract();

        const msg = buildMigrationMessage(migrationResult);
        showToast(msg, migrationResult.stale.length > 0 ? 'warning' : 'success');

        if (migrationResult.stale.length > 0) {
          showMigrationReport(migrationResult);
        }
      } else {
        state.sections = newSections;
        state.contractTitle = file.name.replace(/\.\w+$/, '');
        state.fileLoaded = true;
        AnnotationManager.clearAll();
        renderContract();
        enableControls(true);
        showToast(`成功导入：${file.name}`, 'success');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  /**
   * 构建迁移结果消息
   */
  function buildMigrationMessage(migrationResult) {
    const parts = [];
    if (migrationResult.unchanged.length > 0) {
      parts.push(`${migrationResult.unchanged.length} 条不变`);
    }
    if (migrationResult.migrated.length > 0) {
      parts.push(`${migrationResult.migrated.length} 条已迁移`);
    }
    if (migrationResult.stale.length > 0) {
      parts.push(`${migrationResult.stale.length} 条失效`);
    }
    return `批注迁移完成：${parts.join('，')}`;
  }

  /**
   * 显示迁移详细报告（模态框）
   */
  function showMigrationReport(migrationResult) {
    DOM.modalTitle.textContent = '批注迁移报告';

    let bodyHTML = '<div style="font-size:13px">';

    if (migrationResult.unchanged.length > 0) {
      bodyHTML += `<p style="color:#27ae60"><strong>${migrationResult.unchanged.length} 条批注位置未变</strong></p>`;
    }

    if (migrationResult.migrated.length > 0) {
      bodyHTML += `<p style="color:#3498db;margin-top:8px"><strong>${migrationResult.migrated.length} 条批注已自动迁移到新位置</strong></p>`;
    }

    if (migrationResult.stale.length > 0) {
      bodyHTML += `<div style="margin-top:8px;padding:10px;background:#fdf2f2;border-radius:4px;border-left:3px solid #e74c3c">
        <strong style="color:#e74c3c">${migrationResult.stale.length} 条批注迁移失败（已标记为失效）：</strong>
        <ul style="margin-top:6px;padding-left:20px">`;
      migrationResult.stale.forEach(item => {
        const rt = AnnotationManager.RISK_TYPES[item.annotation.riskType];
        const label = rt ? rt.label : '';
        const text = item.annotation.anchorText.length > 40
          ? item.annotation.anchorText.substring(0, 40) + '...'
          : item.annotation.anchorText;
        bodyHTML += `<li style="margin:4px 0"><span style="color:${rt ? rt.color : '#999'}">[${label}]</span> ${AnnotationRenderer.escapeHTML(text)} <span style="color:#999">- ${item.reason}</span></li>`;
      });
      bodyHTML += '</ul><p style="margin-top:8px;color:#666;font-size:12px">失效批注可在评审清单中查看和删除。</p></div>';
    }

    bodyHTML += '</div>';
    DOM.modalBody.innerHTML = bodyHTML;

    DOM.modalFooter.innerHTML = '';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-primary';
    closeBtn.textContent = '知道了';
    closeBtn.onclick = () => { DOM.modalOverlay.style.display = 'none'; };
    DOM.modalFooter.appendChild(closeBtn);

    DOM.modalOverlay.style.display = 'flex';
  }

  /**
   * 处理项目文件导入
   */
  async function handleProjectImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      showToast('正在加载项目...', 'info');
      const projectState = await ReportExporter.importProjectFile(file);
      state.sections = projectState.sections;
      state.contractTitle = projectState.contractTitle;
      state.fileLoaded = true;

      AnnotationManager.importAnnotations(projectState.annotations);

      // 验证批注位置并自动修正/标记stale
      validateAnnotationPositions();

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
    const staleCounts = {};
    annotations.forEach(a => {
      if (a.stale) {
        staleCounts[a.sectionId] = (staleCounts[a.sectionId] || 0) + 1;
      } else {
        counts[a.sectionId] = (counts[a.sectionId] || 0) + 1;
      }
    });

    let html = '';
    state.sections.forEach(section => {
      const count = counts[section.id] || 0;
      const staleCount = staleCounts[section.id] || 0;
      let badge = '';
      if (count > 0) badge += `<span class="nav-badge">${count}</span>`;
      if (staleCount > 0) badge += `<span class="nav-badge stale-badge">${staleCount}</span>`;
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
   * 添加批注（包含上下文提取）
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

    // 提取上下文信息
    const ctx = TextParser.extractContext(
      state.sections,
      currentSelection.sectionId,
      currentSelection.paragraphIndex,
      currentSelection.startOffset,
      currentSelection.endOffset
    );

    // 计算段落指纹
    let paragraphFingerprint = '';
    const section = state.sections.find(s => s.id === currentSelection.sectionId);
    if (section) {
      const para = section.paragraphs.find(p => p.index === currentSelection.paragraphIndex);
      if (para) {
        paragraphFingerprint = para.fingerprint || TextParser.computeParagraphFingerprint(para.text);
      }
    }

    const result = AnnotationManager.addAnnotation({
      sectionId: currentSelection.sectionId,
      paragraphIndex: currentSelection.paragraphIndex,
      startOffset: currentSelection.startOffset,
      endOffset: currentSelection.endOffset,
      anchorText: currentSelection.anchorText,
      riskType,
      riskLevel,
      comment,
      contextBefore: ctx.before,
      contextAfter: ctx.after,
      paragraphFingerprint
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
        // 提取上下文
        const ctx = TextParser.extractContext(
          state.sections,
          currentSelection.sectionId,
          currentSelection.paragraphIndex,
          currentSelection.startOffset,
          currentSelection.endOffset
        );
        let paragraphFingerprint = '';
        const section = state.sections.find(s => s.id === currentSelection.sectionId);
        if (section) {
          const para = section.paragraphs.find(p => p.index === currentSelection.paragraphIndex);
          if (para) {
            paragraphFingerprint = para.fingerprint || TextParser.computeParagraphFingerprint(para.text);
          }
        }

        const ann = {
          id: 'ann_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2,5),
          sectionId: currentSelection.sectionId,
          paragraphIndex: currentSelection.paragraphIndex,
          startOffset: currentSelection.startOffset,
          endOffset: currentSelection.endOffset,
          anchorText: currentSelection.anchorText,
          riskType: DOM.riskTypeSelector.querySelector('.risk-btn.active').dataset.type,
          riskLevel: DOM.riskLevelSelector.querySelector('.level-btn.active')?.dataset.level || 'medium',
          comment: DOM.annotationComment.value.trim(),
          status: 'pending',
          contextBefore: ctx.before,
          contextAfter: ctx.after,
          paragraphFingerprint: paragraphFingerprint,
          stale: false,
          staleSince: null,
          staleReason: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          history: [{ action: 'created', time: new Date().toISOString(), status: 'pending' }]
        };
        AnnotationManager.importAnnotations([...AnnotationManager.getAllAnnotations(), ann]);
        showToast('已强制添加批注', 'success');
        hideAnnotationForm();
      }
    };

    DOM.modalFooter.appendChild(cancelBtn);
    DOM.modalFooter.appendChild(forceBtn);
    DOM.modalOverlay.style.display = 'flex';
  }

  /**
   * 筛选变化处理（联动高亮）
   */
  function handleFilterChange() {
    const filterType = DOM.filterRiskType.value;
    const filterStatus = DOM.filterStatus.value;

    // 同步高亮筛选
    AnnotationRenderer.setHighlightFilter(filterType, filterStatus);

    // 刷新列表
    renderAnnotationList();
  }

  /**
   * 渲染批注列表
   */
  function renderAnnotationList() {
    let annotations = AnnotationManager.getAllAnnotations();
    const filterType = DOM.filterRiskType.value;
    const filterStatus = DOM.filterStatus.value;

    if (filterType) annotations = annotations.filter(a => a.riskType === filterType);
    if (filterStatus) annotations = annotations.filter(a => a.status === filterStatus);

    // 更新总数（显示活跃/失效计数）
    const allAnns = AnnotationManager.getAllAnnotations();
    const staleCount = allAnns.filter(a => a.stale).length;
    const activeCount = allAnns.length - staleCount;
    DOM.annotationTotal.textContent = staleCount > 0
      ? `${activeCount} 条有效 / ${staleCount} 条失效`
      : `${activeCount} 条`;

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
      const isStale = ann.stale;

      // 获取可用的下一步状态
      const nextStatuses = st.next || [];

      html += `<div class="annotation-item${isStale ? ' stale' : ''}" data-annotation-id="${ann.id}">
        <div class="annotation-item-header">
          <span class="risk-badge" style="background:${isStale ? '#95a5a6' : rt.color}">${rt.icon} ${rt.label}</span>
          <span class="status-badge" style="background:${st.color}">${st.label}</span>
          <span class="risk-badge" style="background:${rl.color}">${rl.label}</span>
          ${isStale ? '<span class="stale-tag">已失效</span>' : ''}
        </div>
        <div class="anchor-text" title="${AnnotationRenderer.escapeHTML(ann.anchorText)}">${AnnotationRenderer.escapeHTML(ann.anchorText)}</div>
        ${isStale ? `<div class="stale-info">${AnnotationRenderer.escapeHTML(ann.staleReason || '锚点定位失效')}</div>` : ''}
        ${ann.comment ? `<div class="comment">${AnnotationRenderer.escapeHTML(ann.comment)}</div>` : ''}
        <div class="item-actions">
          ${isStale ? '' : `<button data-action="locate" data-id="${ann.id}" title="定位到原文">定位</button>`}
          ${isStale ? '' : `<button data-action="edit" data-id="${ann.id}" title="编辑批注">编辑</button>`}
          ${isStale ? '' : nextStatuses.map(ns => {
            const nsInfo = AnnotationManager.STATUS_FLOW[ns];
            return `<button data-action="status" data-id="${ann.id}" data-status="${ns}" style="color:${nsInfo.color}" title="转为${nsInfo.label}">→ ${nsInfo.label}</button>`;
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
      { num: stats.active, label: '有效批注', color: 'var(--primary)' },
      { num: stats.byLevel.high, label: '高风险', color: 'var(--level-high)' },
      { num: stats.byLevel.medium, label: '中风险', color: 'var(--level-medium)' },
      { num: stats.byLevel.low, label: '低风险', color: 'var(--level-low)' },
      { num: stats.byStatus.pending + stats.byStatus.reviewing, label: '待处理', color: 'var(--status-pending)' },
      { num: stats.byStatus.resolved, label: '已解决', color: 'var(--status-resolved)' }
    ];

    if (stats.stale > 0) {
      cards.push({ num: stats.stale, label: '已失效', color: '#95a5a6' });
    }

    DOM.summaryCards.innerHTML = cards.map(card =>
      `<div class="summary-card">
        <div class="card-num" style="color:${card.color}">${card.num}</div>
        <div class="card-label">${card.label}</div>
      </div>`
    ).join('');
  }

  /**
   * 验证批注定位（自动修正和标记stale）
   */
  function validateAnnotationPositions() {
    if (!state.fileLoaded) return;

    const annotations = AnnotationManager.getAllAnnotations();
    if (annotations.length === 0) {
      DOM.validationContent.innerHTML = '<p class="empty-hint">暂无批注需要验证</p>';
      return;
    }

    const results = RiskStatistics.validateAnnotations(annotations, state.sections, true);
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
        AnnotationManager.importAnnotations(projectState.annotations);
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

  return { init, showToast };
})();
