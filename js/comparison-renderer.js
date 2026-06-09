/**
 * comparison-renderer.js - 对比视图渲染模块
 * 负责左右对照UI、同步滚动、变更详情面板、变更导航
 * 依赖：DiffEngine, ChangeAnalyzer, AnnotationManager, AnnotationRenderer
 */
const ComparisonRenderer = (() => {
  let DOM = {};
  let currentDiffResult = null;
  let currentAnalysis = null;
  let currentMigrationResults = null;
  let changeElements = [];  // {changeId, leftEl, rightEl}
  let activeChangeIndex = -1;
  let syncingScroll = false;

  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /**
   * 初始化：缓存DOM引用
   */
  function init() {
    DOM = {
      comparisonLayout: document.getElementById('comparisonLayout'),
      comparisonLeft: document.getElementById('comparisonLeft'),
      comparisonRight: document.getElementById('comparisonRight'),
      changeDetailPanel: document.getElementById('changeDetailPanel'),
      detailTitle: document.getElementById('detailTitle'),
      detailBody: document.getElementById('detailBody'),
      suggestionBody: document.getElementById('suggestionBody'),
      closeDetailBtn: document.getElementById('closeDetailBtn'),
      changeCounter: document.getElementById('changeCounter'),
      prevChangeBtn: document.getElementById('prevChangeBtn'),
      nextChangeBtn: document.getElementById('nextChangeBtn'),
      originalVersionLabel: document.getElementById('originalVersionLabel'),
      revisedVersionLabel: document.getElementById('revisedVersionLabel'),
      changesContent: document.getElementById('changesContent')
    };

    if (DOM.closeDetailBtn) {
      DOM.closeDetailBtn.addEventListener('click', hideChangeDetail);
    }
    if (DOM.prevChangeBtn) {
      DOM.prevChangeBtn.addEventListener('click', () => navigateChange(-1));
    }
    if (DOM.nextChangeBtn) {
      DOM.nextChangeBtn.addEventListener('click', () => navigateChange(1));
    }
  }

  /**
   * 渲染对比视图
   */
  function renderComparison(diffResult, analysisResult, origSections, revSections) {
    currentDiffResult = diffResult;
    currentAnalysis = analysisResult;
    changeElements = [];
    activeChangeIndex = -1;

    if (!DOM.comparisonLeft || !DOM.comparisonRight) init();

    let leftHTML = '';
    let rightHTML = '';
    let changeIdx = 0;

    diffResult.sectionMappings.forEach((mapping, mIdx) => {
      if (mapping.type === 'matched') {
        const lSection = renderMatchedSectionLeft(mapping, mIdx);
        const rSection = renderMatchedSectionRight(mapping, mIdx);
        leftHTML += lSection;
        rightHTML += rSection;
      } else if (mapping.type === 'deleted') {
        leftHTML += renderFullSection(mapping.originalSection, 'deleted', mIdx);
        rightHTML += renderGhostSection(mapping.originalSection.title, 'deleted');
      } else if (mapping.type === 'added') {
        leftHTML += renderGhostSection(mapping.revisedSection.title, 'added');
        rightHTML += renderFullSection(mapping.revisedSection, 'added', mIdx);
      }
    });

    DOM.comparisonLeft.innerHTML = leftHTML;
    DOM.comparisonRight.innerHTML = rightHTML;

    // 收集变更元素引用
    collectChangeElements();

    // 设置同步滚动
    setupSyncScroll();

    // 绑定变更点击
    bindChangeClicks();

    // 更新变更计数
    updateChangeCounter();

    // 渲染变更分析面板
    renderChangeSummaryPanel(analysisResult);
  }

  /**
   * 渲染匹配章节的左侧（原始版）
   */
  function renderMatchedSectionLeft(mapping, mIdx) {
    const section = mapping.originalSection;
    let titleBadge = '';
    if (mapping.titleChanged) {
      titleBadge = ` <span class="change-marker risk-none" title="标题已变更">改</span>`;
    }

    let html = `<div class="comp-section" data-mapping-idx="${mIdx}">`;
    html += `<div class="comp-section-title">${escapeHTML(section.title)}${titleBadge}</div>`;

    mapping.paragraphDiffs.forEach((pd, pdIdx) => {
      const changeId = `m${mIdx}_p${pdIdx}`;

      if (pd.type === 'unchanged') {
        html += `<div class="comp-paragraph">${escapeHTML(pd.originalParagraph.text)}</div>`;
      } else if (pd.type === 'modified') {
        // 显示删除的部分（原始文本中被修改的内容）
        const riskBadge = getRiskBadgeForChange(mIdx, pd);
        html += `<div class="comp-paragraph diff-line-modify" data-change-id="${changeId}">`
          + riskBadge
          + renderInlineDiffOriginal(pd.inlineDiffs)
          + `</div>`;
      } else if (pd.type === 'deleted') {
        const riskBadge = getRiskBadgeForChange(mIdx, pd);
        html += `<div class="comp-paragraph diff-line-delete" data-change-id="${changeId}">`
          + riskBadge
          + escapeHTML(pd.originalParagraph.text)
          + `</div>`;
      } else if (pd.type === 'added') {
        // 左侧空占位
        html += `<div class="comp-paragraph comp-spacer" data-change-id="${changeId}">&nbsp;</div>`;
      }
    });

    html += '</div>';
    return html;
  }

  /**
   * 渲染匹配章节的右侧（修订版）
   */
  function renderMatchedSectionRight(mapping, mIdx) {
    const section = mapping.revisedSection;
    let titleBadge = '';
    if (mapping.titleChanged) {
      titleBadge = ` <span class="change-marker risk-none" title="标题已变更">改</span>`;
    }

    let html = `<div class="comp-section" data-mapping-idx="${mIdx}">`;
    html += `<div class="comp-section-title">${escapeHTML(section.title)}${titleBadge}</div>`;

    mapping.paragraphDiffs.forEach((pd, pdIdx) => {
      const changeId = `m${mIdx}_p${pdIdx}`;

      if (pd.type === 'unchanged') {
        html += `<div class="comp-paragraph">${escapeHTML(pd.revisedParagraph.text)}</div>`;
      } else if (pd.type === 'modified') {
        const riskBadge = getRiskBadgeForChange(mIdx, pd);
        html += `<div class="comp-paragraph diff-line-modify" data-change-id="${changeId}">`
          + riskBadge
          + renderInlineDiffRevised(pd.inlineDiffs)
          + `</div>`;
      } else if (pd.type === 'added') {
        const riskBadge = getRiskBadgeForChange(mIdx, pd);
        html += `<div class="comp-paragraph diff-line-insert" data-change-id="${changeId}">`
          + riskBadge
          + escapeHTML(pd.revisedParagraph.text)
          + `</div>`;
      } else if (pd.type === 'deleted') {
        // 右侧空占位
        html += `<div class="comp-paragraph comp-spacer" data-change-id="${changeId}">&nbsp;</div>`;
      }
    });

    html += '</div>';
    return html;
  }

  /**
   * 渲染完整章节（用于added/deleted的那一侧）
   */
  function renderFullSection(section, type, mIdx) {
    const cssClass = type === 'added' ? 'diff-line-insert' : 'diff-line-delete';
    const changeId = `section_${mIdx}`;
    const riskBadge = getRiskBadgeForSectionChange(mIdx);

    let html = `<div class="comp-section ${cssClass}" data-mapping-idx="${mIdx}" data-change-id="${changeId}">`;
    html += `<div class="comp-section-title">${riskBadge}${escapeHTML(section.title)}</div>`;

    section.paragraphs.forEach(p => {
      html += `<div class="comp-paragraph">${escapeHTML(p.text)}</div>`;
    });

    html += '</div>';
    return html;
  }

  /**
   * 渲染ghost章节（对面板的占位）
   */
  function renderGhostSection(title, type) {
    const message = type === 'deleted'
      ? '此章节在修订版中已被删除'
      : '此章节为修订版新增';
    return `<div class="ghost-section">
      <div style="font-weight:600;margin-bottom:4px">${escapeHTML(title)}</div>
      <div>${message}</div>
    </div>`;
  }

  /**
   * 渲染行内diff（原始侧：显示equal+delete）
   */
  function renderInlineDiffOriginal(inlineDiffs) {
    let html = '';
    for (const seg of inlineDiffs) {
      if (seg.type === 'equal') {
        html += escapeHTML(seg.text);
      } else if (seg.type === 'delete') {
        html += `<span class="diff-char-delete">${escapeHTML(seg.text)}</span>`;
      }
      // skip 'insert' on original side
    }
    return html;
  }

  /**
   * 渲染行内diff（修订侧：显示equal+insert）
   */
  function renderInlineDiffRevised(inlineDiffs) {
    let html = '';
    for (const seg of inlineDiffs) {
      if (seg.type === 'equal') {
        html += escapeHTML(seg.text);
      } else if (seg.type === 'insert') {
        html += `<span class="diff-char-insert">${escapeHTML(seg.text)}</span>`;
      }
      // skip 'delete' on revised side
    }
    return html;
  }

  /**
   * 获取段落级变更的风险标记
   */
  function getRiskBadgeForChange(mIdx, paraDiff) {
    if (!currentAnalysis) return '';
    const change = currentAnalysis.changes.find(c =>
      c.sectionMappingIndex === mIdx &&
      ((paraDiff.originalParagraph && c.originalText === paraDiff.originalParagraph.text) ||
       (paraDiff.revisedParagraph && c.revisedText === paraDiff.revisedParagraph.text))
    );
    if (!change || !change.riskLevel) return '';

    const levelLabel = { high: '高', medium: '中', low: '低' };
    return `<span class="change-marker risk-${change.riskLevel}" title="${escapeHTML(change.summary)}">`
      + `${levelLabel[change.riskLevel]}风险</span> `;
  }

  /**
   * 获取章节级变更的风险标记
   */
  function getRiskBadgeForSectionChange(mIdx) {
    if (!currentAnalysis) return '';
    const change = currentAnalysis.changes.find(c => c.sectionMappingIndex === mIdx);
    if (!change || !change.riskLevel) return '';

    const levelLabel = { high: '高', medium: '中', low: '低' };
    return `<span class="change-marker risk-${change.riskLevel}" title="${escapeHTML(change.summary)}">`
      + `${levelLabel[change.riskLevel]}风险</span> `;
  }

  // ==================== 同步滚动 ====================

  function setupSyncScroll() {
    if (!DOM.comparisonLeft || !DOM.comparisonRight) return;

    // 移除旧监听器
    DOM.comparisonLeft.removeEventListener('scroll', onLeftScroll);
    DOM.comparisonRight.removeEventListener('scroll', onRightScroll);

    DOM.comparisonLeft.addEventListener('scroll', onLeftScroll);
    DOM.comparisonRight.addEventListener('scroll', onRightScroll);
  }

  function onLeftScroll() {
    syncScroll(DOM.comparisonLeft, DOM.comparisonRight);
  }

  function onRightScroll() {
    syncScroll(DOM.comparisonRight, DOM.comparisonLeft);
  }

  function syncScroll(source, target) {
    if (syncingScroll) return;
    syncingScroll = true;
    const maxScroll = source.scrollHeight - source.clientHeight;
    const ratio = maxScroll > 0 ? source.scrollTop / maxScroll : 0;
    const targetMax = target.scrollHeight - target.clientHeight;
    target.scrollTop = ratio * targetMax;
    requestAnimationFrame(() => { syncingScroll = false; });
  }

  // ==================== 变更交互 ====================

  /**
   * 收集所有变更元素引用
   */
  function collectChangeElements() {
    changeElements = [];
    const leftEls = DOM.comparisonLeft.querySelectorAll('[data-change-id]');
    const rightEls = DOM.comparisonRight.querySelectorAll('[data-change-id]');

    const rightMap = {};
    rightEls.forEach(el => { rightMap[el.dataset.changeId] = el; });

    leftEls.forEach(el => {
      const changeId = el.dataset.changeId;
      if (!el.classList.contains('comp-spacer')) {
        changeElements.push({
          changeId,
          leftEl: el,
          rightEl: rightMap[changeId] || null
        });
      } else if (rightMap[changeId] && !rightMap[changeId].classList.contains('comp-spacer')) {
        changeElements.push({
          changeId,
          leftEl: el,
          rightEl: rightMap[changeId]
        });
      }
    });
  }

  /**
   * 绑定变更点击事件
   */
  function bindChangeClicks() {
    [DOM.comparisonLeft, DOM.comparisonRight].forEach(panel => {
      panel.addEventListener('click', (e) => {
        const target = e.target.closest('[data-change-id]');
        if (!target) return;
        const changeId = target.dataset.changeId;
        const idx = changeElements.findIndex(ce => ce.changeId === changeId);
        if (idx !== -1) {
          activeChangeIndex = idx;
          showChangeDetailForElement(changeId);
          highlightActiveChange();
          updateChangeCounter();
        }
      });
    });
  }

  /**
   * 变更导航
   */
  function navigateChange(direction) {
    if (changeElements.length === 0) return;

    activeChangeIndex += direction;
    if (activeChangeIndex < 0) activeChangeIndex = changeElements.length - 1;
    if (activeChangeIndex >= changeElements.length) activeChangeIndex = 0;

    const ce = changeElements[activeChangeIndex];
    highlightActiveChange();
    scrollToChange(ce);
    showChangeDetailForElement(ce.changeId);
    updateChangeCounter();
  }

  /**
   * 高亮当前变更
   */
  function highlightActiveChange() {
    // 清除所有高亮
    DOM.comparisonLeft.querySelectorAll('.active-change').forEach(el => el.classList.remove('active-change'));
    DOM.comparisonRight.querySelectorAll('.active-change').forEach(el => el.classList.remove('active-change'));

    if (activeChangeIndex < 0 || activeChangeIndex >= changeElements.length) return;
    const ce = changeElements[activeChangeIndex];
    if (ce.leftEl) ce.leftEl.classList.add('active-change');
    if (ce.rightEl) ce.rightEl.classList.add('active-change');
  }

  /**
   * 滚动到变更位置
   */
  function scrollToChange(ce) {
    const target = ce.leftEl && !ce.leftEl.classList.contains('comp-spacer')
      ? ce.leftEl : ce.rightEl;
    if (!target) return;

    const panel = target.closest('.comparison-panel-left') || target.closest('.comparison-panel-right');
    if (panel) {
      const panelRect = panel.getBoundingClientRect();
      const elRect = target.getBoundingClientRect();
      const scrollTo = panel.scrollTop + elRect.top - panelRect.top - panelRect.height / 3;
      panel.scrollTo({ top: scrollTo, behavior: 'smooth' });
    }
  }

  /**
   * 更新变更计数器
   */
  function updateChangeCounter() {
    if (!DOM.changeCounter) return;
    const total = changeElements.length;
    const current = activeChangeIndex >= 0 ? activeChangeIndex + 1 : 0;
    DOM.changeCounter.textContent = `${current}/${total}`;
  }

  // ==================== 变更详情面板 ====================

  /**
   * 显示变更详情
   */
  function showChangeDetailForElement(changeId) {
    if (!currentAnalysis || !DOM.changeDetailPanel) return;

    // 从changeId解析出mapping和段落索引
    let change = null;
    let suggestion = null;

    if (changeId.startsWith('section_')) {
      const mIdx = parseInt(changeId.replace('section_', ''));
      change = currentAnalysis.changes.find(c => c.sectionMappingIndex === mIdx);
    } else {
      const match = changeId.match(/^m(\d+)_p(\d+)$/);
      if (match) {
        const mIdx = parseInt(match[1]);
        const pdIdx = parseInt(match[2]);
        const mapping = currentDiffResult.sectionMappings[mIdx];
        if (mapping && mapping.paragraphDiffs && mapping.paragraphDiffs[pdIdx]) {
          const pd = mapping.paragraphDiffs[pdIdx];
          if (pd) {
            change = currentAnalysis.changes.find(c =>
              c.sectionMappingIndex === mIdx &&
              ((pd.originalParagraph && c.originalText === pd.originalParagraph.text) ||
               (pd.revisedParagraph && c.revisedText === pd.revisedParagraph.text))
            );
          }
        }
      }
    }

    if (!change) {
      hideChangeDetail();
      return;
    }

    suggestion = currentAnalysis.suggestions.find(s => s.changeId === change.id);
    showChangeDetail(change, suggestion);
  }

  /**
   * 显示变更详情面板
   */
  function showChangeDetail(change, suggestion) {
    if (!DOM.changeDetailPanel) return;

    DOM.detailTitle.textContent = change.summary;

    // 变更文本对比
    let bodyHTML = '';
    if (change.originalText || change.revisedText) {
      bodyHTML += '<div class="change-texts">';
      bodyHTML += `<div>
        <div class="change-text-label">原始文本</div>
        <div class="change-text-box change-text-original">${escapeHTML(truncate(change.originalText, 200)) || '<em>无</em>'}</div>
      </div>`;
      bodyHTML += `<div>
        <div class="change-text-label">修订文本</div>
        <div class="change-text-box change-text-revised">${escapeHTML(truncate(change.revisedText, 200)) || '<em>无</em>'}</div>
      </div>`;
      bodyHTML += '</div>';
    }

    // 风险模式
    if (change.patterns.length > 0) {
      bodyHTML += '<div style="margin-top:8px">';
      change.patterns.forEach(p => {
        bodyHTML += `<span class="change-marker risk-${p.riskLevel}" style="margin-right:6px">`
          + `${p.patternLabel}</span>`;
      });
      bodyHTML += `<div style="margin-top:6px;font-size:12px;color:#666">`
        + escapeHTML(change.patterns[0].description)
        + `</div></div>`;
    }

    DOM.detailBody.innerHTML = bodyHTML;

    // 谈判建议
    if (suggestion) {
      DOM.suggestionBody.innerHTML = renderSuggestionCard(suggestion, change.riskLevel);
    } else {
      DOM.suggestionBody.innerHTML = '';
    }

    DOM.changeDetailPanel.style.display = 'block';
  }

  function hideChangeDetail() {
    if (DOM.changeDetailPanel) {
      DOM.changeDetailPanel.style.display = 'none';
    }
  }

  /**
   * 渲染谈判建议卡片
   */
  function renderSuggestionCard(suggestion, riskLevel) {
    let html = `<div class="suggestion-card">`;
    html += `<div class="suggestion-card-header risk-${riskLevel || 'medium'}">`;
    html += `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
    </svg>`;
    html += `谈判建议（优先级：${suggestion.priority === 1 ? '高' : '中'}）</div>`;
    html += '<div class="suggestion-card-body">';

    html += `<div class="suggestion-section">
      <div class="suggestion-label">变更内容</div>
      <div class="suggestion-text">${escapeHTML(suggestion.whatChanged)}</div>
    </div>`;

    html += `<div class="suggestion-section">
      <div class="suggestion-label">风险说明</div>
      <div class="suggestion-text">${escapeHTML(suggestion.whyRisky)}</div>
    </div>`;

    html += `<div class="suggestion-section">
      <div class="suggestion-label">建议方案</div>
      <div class="suggestion-text">${escapeHTML(suggestion.counterProposal)}</div>
    </div>`;

    if (suggestion.suggestedClause) {
      html += `<div class="suggested-clause">${escapeHTML(suggestion.suggestedClause)}</div>`;
    }

    html += '</div></div>';
    return html;
  }

  // ==================== 变更分析标签页 ====================

  /**
   * 渲染变更分析面板（底部统计标签页）
   */
  function renderChangeSummaryPanel(analysisResult) {
    if (!DOM.changesContent) return;

    const summary = analysisResult.riskSummary;
    const trendLabels = { increased: '上升', decreased: '下降', unchanged: '持平' };
    const trendClass = summary.riskTrend;

    let html = '<div class="changes-summary">';
    html += `<div class="change-stat-card">
      <div class="change-stat-num" style="color:var(--primary)">${summary.totalChanges}</div>
      <div class="change-stat-label">总变更数</div>
    </div>`;
    html += `<div class="change-stat-card">
      <div class="change-stat-num" style="color:var(--level-high)">${summary.highRiskChanges}</div>
      <div class="change-stat-label">高风险变更</div>
    </div>`;
    html += `<div class="change-stat-card">
      <div class="change-stat-num" style="color:var(--level-medium)">${summary.mediumRiskChanges}</div>
      <div class="change-stat-label">中风险变更</div>
    </div>`;
    html += `<div class="change-stat-card">
      <div class="change-stat-num">
        <span class="risk-trend-badge ${trendClass}">${summary.riskTrend === 'increased' ? '&uarr;' : summary.riskTrend === 'decreased' ? '&darr;' : '&ndash;'} ${trendLabels[summary.riskTrend]}</span>
      </div>
      <div class="change-stat-label">风险趋势</div>
    </div>`;
    html += '</div>';

    // 建议列表
    if (analysisResult.suggestions.length > 0) {
      html += `<h4 style="font-size:13px;margin-bottom:8px;color:var(--primary)">谈判建议（${analysisResult.suggestions.length}条）</h4>`;
      html += '<div class="changes-list">';
      analysisResult.suggestions.forEach((s, idx) => {
        const change = analysisResult.changes.find(c => c.id === s.changeId);
        const riskLevel = change ? change.riskLevel : 'medium';
        const typeTag = change ? getChangeTypeTag(change.changeType) : '';
        html += `<div class="change-list-item" data-suggestion-idx="${idx}" data-change-id="${s.changeId}">
          ${typeTag}
          <span class="change-marker risk-${riskLevel}" style="flex-shrink:0">${s.priority === 1 ? '高' : '中'}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(s.whatChanged)}</span>
        </div>`;
      });
      html += '</div>';
    } else {
      html += '<p style="font-size:13px;color:var(--text-light);text-align:center;margin-top:12px">未检测到需要谈判的高风险变更</p>';
    }

    DOM.changesContent.innerHTML = html;

    // 绑定建议条目点击
    DOM.changesContent.querySelectorAll('.change-list-item').forEach(item => {
      item.addEventListener('click', () => {
        const sIdx = parseInt(item.dataset.suggestionIdx);
        const suggestion = analysisResult.suggestions[sIdx];
        if (suggestion) {
          const change = analysisResult.changes.find(c => c.id === suggestion.changeId);
          if (change) showChangeDetail(change, suggestion);
        }
      });
    });
  }

  function getChangeTypeTag(changeType) {
    if (changeType.includes('added')) {
      return '<span class="change-type-tag added">新增</span>';
    } else if (changeType.includes('deleted')) {
      return '<span class="change-type-tag deleted">删除</span>';
    } else {
      return '<span class="change-type-tag modified">修改</span>';
    }
  }

  // ==================== 迁移状态 ====================

  /**
   * 渲染批注迁移状态
   */
  function renderMigrationStatus(migrationResults) {
    currentMigrationResults = migrationResults;
    if (!migrationResults || migrationResults.length === 0) return '';

    const migrated = migrationResults.filter(r => r.status === 'migrated').length;
    const adjusted = migrationResults.filter(r => r.status === 'adjusted').length;
    const invalidated = migrationResults.filter(r => r.status === 'invalidated').length;

    let html = '<div class="migration-summary">';
    html += '<h4 style="font-size:14px;margin-bottom:8px">批注迁移状态</h4>';
    html += `<div class="stat-row">
      <span class="stat-num" style="color:var(--level-low)">${migrated}</span>
      <span class="stat-label">精确迁移</span>
      <span class="stat-num" style="color:var(--level-medium)">${adjusted}</span>
      <span class="stat-label">位置调整</span>
      <span class="stat-num" style="color:var(--level-high)">${invalidated}</span>
      <span class="stat-label">已失效</span>
    </div>`;
    html += '</div>';

    // 详细表格
    if (migrationResults.length > 0) {
      html += '<table class="migration-table">';
      html += '<thead><tr><th>批注内容</th><th>风险类型</th><th>状态</th><th>说明</th></tr></thead>';
      html += '<tbody>';
      migrationResults.forEach(r => {
        const ann = r.annotation;
        const rt = AnnotationManager.RISK_TYPES[ann.riskType];
        html += '<tr>';
        html += `<td title="${escapeHTML(ann.anchorText)}">${escapeHTML(truncate(ann.anchorText, 25))}</td>`;
        html += `<td><span style="color:${rt ? rt.color : '#999'}">${rt ? rt.label : '未知'}</span></td>`;
        html += `<td><span class="migration-badge ${r.status}">${
          r.status === 'migrated' ? '已迁移' : r.status === 'adjusted' ? '已调整' : '已失效'
        }</span></td>`;
        html += `<td style="font-size:11px;color:var(--text-light)">${escapeHTML(r.reason)}</td>`;
        html += '</tr>';
      });
      html += '</tbody></table>';
    }

    return html;
  }

  // ==================== 工具函数 ====================

  function truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
  }

  /**
   * 清理销毁
   */
  function destroy() {
    if (DOM.comparisonLeft) {
      DOM.comparisonLeft.removeEventListener('scroll', onLeftScroll);
      DOM.comparisonLeft.innerHTML = '';
    }
    if (DOM.comparisonRight) {
      DOM.comparisonRight.removeEventListener('scroll', onRightScroll);
      DOM.comparisonRight.innerHTML = '';
    }
    hideChangeDetail();
    changeElements = [];
    activeChangeIndex = -1;
    currentDiffResult = null;
    currentAnalysis = null;
    currentMigrationResults = null;
  }

  function getActiveChangeId() {
    if (activeChangeIndex < 0 || activeChangeIndex >= changeElements.length) return null;
    return changeElements[activeChangeIndex].changeId;
  }

  return {
    init,
    renderComparison,
    showChangeDetail,
    hideChangeDetail,
    renderChangeSummaryPanel,
    renderMigrationStatus,
    destroy,
    getActiveChangeId,
    navigateChange
  };
})();
