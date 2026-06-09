/**
 * comparison-renderer.js - 合同版本对比视图渲染器
 * 负责左右对照、变更高亮、风险等级变化标记、导航、建议侧边栏
 */
const ComparisonRenderer = (() => {
  let container = null;
  let diffData = null;
  let scrollSyncLocked = false;

  const CHANGE_LABELS = {
    added:   { text: '新增', icon: '+', color: '#27ae60' },
    deleted: { text: '删除', icon: '-', color: '#e74c3c' },
    modified:{ text: '修改', icon: '~', color: '#f39c12' },
    unchanged:{ text: '未变', icon: '=', color: '#95a5a6' }
  };

  const PRIORITY_CONFIG = {
    critical: { label: '紧急', color: '#e74c3c', bgColor: '#fdf0f0' },
    important:{ label: '重要', color: '#f39c12', bgColor: '#fef9f0' },
    advisory: { label: '建议', color: '#3498db', bgColor: '#f0f7fd' }
  };

  /**
   * 初始化渲染器
   */
  function init(containerEl) {
    container = containerEl;
  }

  /**
   * 渲染对比视图
   * @param {DiffResult} diffResult
   * @param {Suggestion[]} suggestions
   * @param {RiskDelta[]} riskDeltas
   * @param {object} migrationStats - { total, migrated, invalidated }
   */
  function renderComparison(diffResult, suggestions, riskDeltas, migrationStats) {
    if (!container) return;
    diffData = { diffResult, suggestions, riskDeltas, migrationStats };

    container.innerHTML = '';
    container.className = 'comparison-view';

    // 顶部工具栏
    const toolbar = buildToolbar(diffResult);
    container.appendChild(toolbar);

    // 主体区域
    const main = document.createElement('div');
    main.className = 'comparison-main';

    // 左侧导航
    const nav = buildNav(diffResult, riskDeltas);
    main.appendChild(nav);

    // 中间双栏
    const dualPane = buildDualPane(diffResult, riskDeltas);
    main.appendChild(dualPane);

    // 右侧建议栏
    const sidebar = buildSidebar(suggestions, riskDeltas, migrationStats);
    main.appendChild(sidebar);

    container.appendChild(main);
  }

  function buildToolbar(diffResult) {
    const toolbar = document.createElement('div');
    toolbar.className = 'comparison-toolbar';

    const summary = diffResult.summary;
    const changeTypes = ['added', 'deleted', 'modified', 'unchanged'];

    toolbar.innerHTML = `
      <div class="comparison-toolbar-left">
        <button class="btn btn-ghost" id="exitCompareBtn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          返回评审
        </button>
        <span class="comparison-files">
          <span class="file-label old">旧版</span>
          <span class="vs">对比</span>
          <span class="file-label new">新版</span>
        </span>
      </div>
      <div class="comparison-toolbar-center">
        ${changeTypes.map(ct => {
          const cfg = CHANGE_LABELS[ct];
          const count = ct === 'added' ? summary.sectionsAdded
                      : ct === 'deleted' ? summary.sectionsDeleted
                      : ct === 'modified' ? summary.sectionsModified
                      : summary.sectionsUnchanged;
          return `<span class="diff-stat" style="--stat-color:${cfg.color}">${cfg.icon} ${cfg.text} ${count}</span>`;
        }).join('')}
        <span class="diff-stat-para">段落变更 ${summary.totalParagraphsChanged} 处</span>
      </div>
      <div class="comparison-toolbar-right">
        <button class="btn btn-secondary" id="exportCompareBtn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          导出对比报告
        </button>
      </div>
    `;
    return toolbar;
  }

  function buildNav(diffResult, riskDeltas) {
    const nav = document.createElement('div');
    nav.className = 'comparison-nav';

    // 筛选按钮
    let navHtml = `
      <div class="comparison-nav-header">
        <h4>变更导航</h4>
      </div>
      <div class="comparison-nav-filters">
        <button class="nav-filter-btn active" data-filter="all">全部</button>
        <button class="nav-filter-btn" data-filter="changed">仅变更</button>
        <button class="nav-filter-btn" data-filter="risk">高风险</button>
      </div>
      <div class="comparison-nav-list">
    `;

    diffResult.sectionDiffs.forEach((sd, idx) => {
      const cfg = CHANGE_LABELS[sd.changeType] || CHANGE_LABELS.unchanged;
      const title = sd.newSection?.title || sd.oldSection?.title || `章节 ${idx + 1}`;
      const riskDelta = riskDeltas.find(r => r.sectionTitle === title);
      const hasRiskChange = riskDelta && riskDelta.direction !== 'unchanged';

      navHtml += `
        <div class="nav-diff-item" data-diff-index="${idx}" data-change-type="${sd.changeType}" data-has-risk="${hasRiskChange}">
          <span class="nav-change-badge" style="background:${cfg.color}">${cfg.icon}</span>
          <span class="nav-diff-title">${escapeHTML(title)}</span>
          ${hasRiskChange ? `<span class="nav-risk-badge ${riskDelta.direction === 'increased' ? 'risk-up' : 'risk-down'}">
            ${riskDelta.direction === 'increased' ? '▲' : '▼'}${Math.abs(riskDelta.delta)}
          </span>` : ''}
        </div>
      `;
    });

    navHtml += '</div>';
    nav.innerHTML = navHtml;

    // 绑定导航事件
    setTimeout(() => {
      nav.querySelectorAll('.nav-diff-item').forEach(item => {
        item.addEventListener('click', () => {
          const idx = parseInt(item.dataset.diffIndex);
          scrollToDiff(idx);
        });
      });

      nav.querySelectorAll('.nav-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          nav.querySelectorAll('.nav-filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          filterNavItems(btn.dataset.filter);
        });
      });
    }, 0);

    return nav;
  }

  function buildDualPane(diffResult, riskDeltas) {
    const pane = document.createElement('div');
    pane.className = 'comparison-dual-pane';

    const leftPane = document.createElement('div');
    leftPane.className = 'comparison-pane comparison-pane-old';
    leftPane.innerHTML = '<div class="pane-header">旧版合同</div>';

    const rightPane = document.createElement('div');
    rightPane.className = 'comparison-pane comparison-pane-new';
    rightPane.innerHTML = '<div class="pane-header">新版合同</div>';

    const leftContent = document.createElement('div');
    leftContent.className = 'pane-content';
    const rightContent = document.createElement('div');
    rightContent.className = 'pane-content';

    let diffIdx = 0;
    for (const sectionDiff of diffResult.sectionDiffs) {
      const sectionRow = document.createElement('div');
      sectionRow.className = `diff-section-row diff-${sectionDiff.changeType}`;
      sectionRow.dataset.diffIndex = diffIdx;

      // 章节标题行
      const leftTitle = document.createElement('div');
      const rightTitle = document.createElement('div');
      leftTitle.className = 'diff-section-title';
      rightTitle.className = 'diff-section-title';

      if (sectionDiff.oldSection) {
        leftTitle.textContent = sectionDiff.oldSection.title;
      } else {
        leftTitle.className += ' diff-placeholder';
        leftTitle.textContent = '—';
      }

      if (sectionDiff.newSection) {
        rightTitle.textContent = sectionDiff.newSection.title;
      } else {
        rightTitle.className += ' diff-placeholder';
        rightTitle.textContent = '—';
      }

      sectionRow.appendChild(leftTitle);
      sectionRow.appendChild(rightTitle);

      // 风险标记
      const riskDelta = riskDeltas.find(r =>
        r.sectionTitle === (sectionDiff.newSection?.title || sectionDiff.oldSection?.title)
      );
      if (riskDelta && riskDelta.direction !== 'unchanged') {
        const badge = document.createElement('span');
        badge.className = `risk-delta-badge ${riskDelta.direction === 'increased' ? 'risk-delta-up' : 'risk-delta-down'}`;
        badge.textContent = riskDelta.direction === 'increased'
          ? `▲ +${riskDelta.delta}`
          : `▼ ${riskDelta.delta}`;
        rightTitle.appendChild(badge);
      }

      leftContent.appendChild(sectionRow);
      rightContent.appendChild(sectionRow.cloneNode(true));

      // 段落行
      for (const paraDiff of sectionDiff.paragraphDiffs) {
        const row = document.createElement('div');
        row.className = `diff-para-row diff-${paraDiff.changeType}`;

        const leftCell = document.createElement('div');
        leftCell.className = 'diff-cell';
        const rightCell = document.createElement('div');
        rightCell.className = 'diff-cell';

        if (paraDiff.oldParagraph) {
          if (paraDiff.inlineDiff) {
            leftCell.innerHTML = renderInlineSegments(paraDiff.inlineDiff.oldSegments);
          } else {
            leftCell.textContent = paraDiff.oldParagraph.text;
          }
        } else {
          leftCell.className += ' diff-placeholder';
          leftCell.innerHTML = '<span class="placeholder-text">无对应内容</span>';
        }

        if (paraDiff.newParagraph) {
          if (paraDiff.inlineDiff) {
            rightCell.innerHTML = renderInlineSegments(paraDiff.inlineDiff.newSegments);
          } else {
            rightCell.textContent = paraDiff.newParagraph.text;
          }
        } else {
          rightCell.className += ' diff-placeholder';
          rightCell.innerHTML = '<span class="placeholder-text">无对应内容</span>';
        }

        row.appendChild(leftCell);
        row.appendChild(rightCell);

        leftContent.appendChild(row);
        rightContent.appendChild(row.cloneNode(true));
      }

      diffIdx++;
    }

    leftPane.appendChild(leftContent);
    rightPane.appendChild(rightContent);

    // 同步滚动
    setTimeout(() => {
      setupSyncScroll(leftPane, rightPane);
    }, 0);

    pane.appendChild(leftPane);
    pane.appendChild(rightPane);
    return pane;
  }

  function buildSidebar(suggestions, riskDeltas, migrationStats) {
    const sidebar = document.createElement('div');
    sidebar.className = 'comparison-sidebar';

    let html = '<div class="comparison-sidebar-header"><h4>分析结果</h4></div>';

    // 风险变化摘要
    const riskChanges = riskDeltas.filter(r => r.direction !== 'unchanged');
    if (riskChanges.length > 0) {
      html += '<div class="sidebar-section"><h5>风险变化摘要</h5>';
      html += '<table class="risk-delta-table"><thead><tr><th>章节</th><th>旧</th><th>新</th><th>变化</th></tr></thead><tbody>';
      for (const rd of riskChanges) {
        const dirClass = rd.direction === 'increased' ? 'risk-up' : 'risk-down';
        const dirText = rd.direction === 'increased' ? `+${rd.delta}` : `${rd.delta}`;
        html += `<tr class="${dirClass}">
          <td>${escapeHTML(rd.sectionTitle.substring(0, 15))}</td>
          <td>${rd.oldRiskScore}</td>
          <td>${rd.newRiskScore}</td>
          <td class="delta-cell">${dirText}</td>
        </tr>`;
      }
      html += '</tbody></table></div>';
    }

    // 谈判建议
    if (suggestions.length > 0) {
      html += '<div class="sidebar-section"><h5>谈判建议</h5>';
      suggestions.forEach((sug, idx) => {
        const pcfg = PRIORITY_CONFIG[sug.priority] || PRIORITY_CONFIG.advisory;
        html += `
          <div class="suggestion-card priority-${sug.priority}" data-suggestion-index="${idx}">
            <div class="suggestion-header">
              <span class="suggestion-priority" style="background:${pcfg.color}">${pcfg.label}</span>
              <span class="suggestion-title">${escapeHTML(sug.title)}</span>
            </div>
            <div class="suggestion-section">${escapeHTML(sug.affectedSection)}</div>
            <div class="suggestion-text">${escapeHTML(sug.suggestion)}</div>
          </div>
        `;
      });
      html += '</div>';
    } else {
      html += '<div class="sidebar-section"><h5>谈判建议</h5><p class="empty-hint">未检测到高风险变更</p></div>';
    }

    // 批注迁移统计
    if (migrationStats && migrationStats.total > 0) {
      html += '<div class="sidebar-section"><h5>批注迁移</h5>';
      html += `<div class="migration-stats">
        <div class="stat-row"><span>总批注</span><span>${migrationStats.total}</span></div>
        <div class="stat-row success"><span>已迁移</span><span>${migrationStats.migrated || 0}</span></div>
        <div class="stat-row danger"><span>已失效</span><span>${migrationStats.invalidated || 0}</span></div>
      </div></div>`;
    }

    sidebar.innerHTML = html;
    return sidebar;
  }

  // ==================== 渲染辅助 ====================

  function renderInlineSegments(segments) {
    if (!segments) return '';
    return segments.map(seg => {
      if (seg.type === 'unchanged') return escapeHTML(seg.text);
      if (seg.type === 'deleted') return `<span class="diff-del">${escapeHTML(seg.text)}</span>`;
      if (seg.type === 'added') return `<span class="diff-ins">${escapeHTML(seg.text)}</span>`;
      return escapeHTML(seg.text);
    }).join('');
  }

  function escapeHTML(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function setupSyncScroll(paneA, paneB) {
    let syncing = false;
    const sync = (source, target) => {
      if (syncing) return;
      syncing = true;
      const ratio = source.scrollTop / (source.scrollHeight - source.clientHeight || 1);
      target.scrollTop = ratio * (target.scrollHeight - target.clientHeight || 1);
      requestAnimationFrame(() => { syncing = false; });
    };
    paneA.addEventListener('scroll', () => sync(paneA, paneB));
    paneB.addEventListener('scroll', () => sync(paneB, paneA));
  }

  function scrollToDiff(diffIndex) {
    if (!container) return;
    const rows = container.querySelectorAll(`.diff-section-row[data-diff-index="${diffIndex}"]`);
    rows.forEach(row => {
      row.scrollIntoView({ behavior: 'smooth', block: 'start' });
      row.classList.add('diff-highlight-flash');
      setTimeout(() => row.classList.remove('diff-highlight-flash'), 1500);
    });
  }

  function filterNavItems(filter) {
    if (!container) return;
    container.querySelectorAll('.nav-diff-item').forEach(item => {
      const ct = item.dataset.changeType;
      const hasRisk = item.dataset.hasRisk === 'true';
      let visible = true;
      if (filter === 'changed') visible = ct !== 'unchanged';
      else if (filter === 'risk') visible = hasRisk;
      item.style.display = visible ? '' : 'none';
    });
  }

  function destroy() {
    if (container) {
      container.innerHTML = '';
      container.className = '';
    }
    diffData = null;
  }

  function getContainer() {
    return container;
  }

  return {
    init,
    renderComparison,
    scrollToDiff,
    destroy,
    getContainer
  };
})();
