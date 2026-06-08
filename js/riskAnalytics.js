/**
 * riskAnalytics.js - 风险统计模块
 * 风险类型/等级统计、SVG 图表、评审清单生成
 */
const RiskAnalytics = (() => {
  const RISK_TYPES = [
    { key: 'payment',      label: '付款条款',     color: '#e74c3c' },
    { key: 'breach',       label: '违约责任',     color: '#e67e22' },
    { key: 'confidential', label: '保密义务',     color: '#9b59b6' },
    { key: 'delivery',     label: '交付期限',     color: '#2ecc71' },
    { key: 'dispute',      label: '争议解决',     color: '#3498db' },
    { key: 'entity',       label: '主体信息缺失', color: '#f39c12' },
  ];

  const LEVEL_ORDER = ['high', 'medium', 'low'];
  const LEVEL_LABELS = { high: '高风险', medium: '中风险', low: '低风险' };
  const LEVEL_COLORS = { high: '#ef4444', medium: '#f59e0b', low: '#3b82f6' };

  /**
   * 计算统计数据
   */
  function computeStats(annotations) {
    const stats = {
      total: annotations.length,
      byLevel: { high: 0, medium: 0, low: 0 },
      byType: {},
      byStatus: { pending: 0, processing: 0, resolved: 0, closed: 0 },
      byTypeAndLevel: {},
    };

    RISK_TYPES.forEach(t => {
      stats.byType[t.key] = 0;
      stats.byTypeAndLevel[t.key] = { high: 0, medium: 0, low: 0 };
    });

    annotations.forEach(a => {
      stats.byLevel[a.riskLevel] = (stats.byLevel[a.riskLevel] || 0) + 1;
      stats.byType[a.riskType] = (stats.byType[a.riskType] || 0) + 1;
      stats.byStatus[a.status] = (stats.byStatus[a.status] || 0) + 1;
      if (stats.byTypeAndLevel[a.riskType]) {
        stats.byTypeAndLevel[a.riskType][a.riskLevel]++;
      }
    });

    return stats;
  }

  /**
   * 更新风险统计面板
   */
  function updateDashboard(annotations) {
    const stats = computeStats(annotations);

    // 更新数字
    _setText('#risk-total .stat-num', stats.total);
    _setText('#risk-high-count .stat-num', stats.byLevel.high);
    _setText('#risk-medium-count .stat-num', stats.byLevel.medium);
    _setText('#risk-low-count .stat-num', stats.byLevel.low);

    // 渲染 SVG 图表
    _renderChart(stats);

    // 渲染风险类型列表
    _renderTypeList(stats);
  }

  /**
   * 渲染 SVG 饼图
   */
  function _renderChart(stats) {
    const svg = document.getElementById('risk-chart');
    if (!svg) return;

    svg.innerHTML = '';

    if (stats.total === 0) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', '150');
      text.setAttribute('y', '105');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', '#94a3b8');
      text.setAttribute('font-size', '14');
      text.textContent = '暂无风险数据';
      svg.appendChild(text);
      return;
    }

    const cx = 90, cy = 100, r = 70;
    const data = RISK_TYPES.filter(t => stats.byType[t.key] > 0)
      .map(t => ({ label: t.label, value: stats.byType[t.key], color: t.color }));

    if (data.length === 0) return;

    // 绘制饼图
    let startAngle = -Math.PI / 2;
    data.forEach((d, i) => {
      const sliceAngle = (d.value / stats.total) * Math.PI * 2;
      const endAngle = startAngle + sliceAngle;

      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const largeArc = sliceAngle > Math.PI ? 1 : 0;

      if (data.length === 1) {
        // 只有一种类型，画圆
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', cx);
        circle.setAttribute('cy', cy);
        circle.setAttribute('r', r);
        circle.setAttribute('fill', d.color);
        circle.setAttribute('opacity', '0.8');
        svg.appendChild(circle);
      } else {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const pathD = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
        path.setAttribute('d', pathD);
        path.setAttribute('fill', d.color);
        path.setAttribute('opacity', '0.8');
        path.setAttribute('stroke', '#fff');
        path.setAttribute('stroke-width', '2');
        svg.appendChild(path);
      }

      startAngle = endAngle;
    });

    // 中心数字
    const centerCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    centerCircle.setAttribute('cx', cx);
    centerCircle.setAttribute('cy', cy);
    centerCircle.setAttribute('r', '35');
    centerCircle.setAttribute('fill', '#fff');
    svg.appendChild(centerCircle);

    const totalText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    totalText.setAttribute('x', cx);
    totalText.setAttribute('y', cy - 5);
    totalText.setAttribute('text-anchor', 'middle');
    totalText.setAttribute('font-size', '22');
    totalText.setAttribute('font-weight', '700');
    totalText.setAttribute('fill', '#1e293b');
    totalText.textContent = stats.total;
    svg.appendChild(totalText);

    const labelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    labelText.setAttribute('x', cx);
    labelText.setAttribute('y', cy + 14);
    labelText.setAttribute('text-anchor', 'middle');
    labelText.setAttribute('font-size', '11');
    labelText.setAttribute('fill', '#94a3b8');
    labelText.textContent = '风险总数';
    svg.appendChild(labelText);

    // 右侧图例
    const legendX = 200, legendStartY = 30;
    data.forEach((d, i) => {
      const y = legendStartY + i * 26;

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', legendX);
      rect.setAttribute('y', y);
      rect.setAttribute('width', '12');
      rect.setAttribute('height', '12');
      rect.setAttribute('rx', '2');
      rect.setAttribute('fill', d.color);
      svg.appendChild(rect);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', legendX + 18);
      text.setAttribute('y', y + 10);
      text.setAttribute('font-size', '12');
      text.setAttribute('fill', '#475569');
      text.textContent = `${d.label} (${d.value})`;
      svg.appendChild(text);
    });
  }

  /**
   * 渲染风险类型详情列表
   */
  function _renderTypeList(stats) {
    const container = document.getElementById('risk-type-list');
    if (!container) return;

    container.innerHTML = RISK_TYPES.map(t => {
      const count = stats.byType[t.key] || 0;
      const detail = stats.byTypeAndLevel[t.key];
      const breakdown = LEVEL_ORDER
        .filter(l => detail[l] > 0)
        .map(l => `<span style="color:${LEVEL_COLORS[l]}">${LEVEL_LABELS[l]}${detail[l]}</span>`)
        .join(' ');

      return `
        <div class="risk-type-item">
          <span class="risk-type-color" style="background:${t.color}"></span>
          <span class="risk-type-name">${t.label}</span>
          <span class="risk-type-count">${count}</span>
          <span style="font-size:11px;margin-left:4px">${breakdown}</span>
        </div>`;
    }).join('');
  }

  /**
   * 生成评审清单数据
   */
  function generateChecklist(annotations, sections) {
    const checklist = {
      summary: computeStats(annotations),
      items: [],
      bySection: {},
    };

    // 按章节分组
    for (const section of sections) {
      const sectionAnnotations = annotations.filter(a => a.sectionId === section.id);
      if (sectionAnnotations.length === 0) continue;

      checklist.bySection[section.id] = {
        title: section.title,
        items: sectionAnnotations.map(a => ({
          id: a.id,
          riskType: a.riskType,
          riskTypeLabel: CommentManager.RISK_TYPE_LABELS[a.riskType],
          riskLevel: a.riskLevel,
          riskLevelLabel: LEVEL_LABELS[a.riskLevel],
          status: a.status,
          statusLabel: CommentManager.STATUS_LABELS[a.status],
          comment: a.comment,
          selectedText: a.selectedText,
          textSnippet: a.textSnippet,
        })),
      };
    }

    return checklist;
  }

  /**
   * 渲染评审清单到 HTML
   */
  function renderChecklistHtml(checklist) {
    const { summary, bySection } = checklist;
    let html = '';

    // 总概
    html += `<div class="checklist-section">
      <h4>评审概要</h4>
      <p>风险总数: <strong>${summary.total}</strong> &nbsp;|&nbsp;
         高风险: <strong style="color:var(--color-high)">${summary.byLevel.high}</strong> &nbsp;|&nbsp;
         中风险: <strong style="color:var(--color-medium)">${summary.byLevel.medium}</strong> &nbsp;|&nbsp;
         低风险: <strong style="color:var(--color-low)">${summary.byLevel.low}</strong></p>
      <p>待处理: ${summary.byStatus.pending} &nbsp;|&nbsp;
         处理中: ${summary.byStatus.processing} &nbsp;|&nbsp;
         已解决: ${summary.byStatus.resolved} &nbsp;|&nbsp;
         已关闭: ${summary.byStatus.closed}</p>
    </div>`;

    // 按章节列出
    for (const [sectionId, sectionData] of Object.entries(bySection)) {
      html += `<div class="checklist-section"><h4>${_escapeHtml(sectionData.title)}</h4>`;

      sectionData.items.forEach(item => {
        const levelClass = `status-${item.status}`;
        const levelBg = item.riskLevel === 'high' ? 'var(--color-high-bg)' :
                        item.riskLevel === 'medium' ? 'var(--color-medium-bg)' : 'var(--color-low-bg)';
        const levelColor = LEVEL_COLORS[item.riskLevel];

        html += `<div class="checklist-item">
          <span class="checklist-level" style="background:${levelBg};color:${levelColor}">${item.riskLevelLabel}</span>
          <div class="checklist-detail">
            <div class="cl-text"><strong>${item.riskTypeLabel}</strong>: ${_escapeHtml(item.comment || '无批注')}</div>
            <div class="cl-excerpt">"${_escapeHtml(item.textSnippet)}"</div>
          </div>
          <span class="comment-status-tag ${levelClass}">${item.statusLabel}</span>
        </div>`;
      });

      html += '</div>';
    }

    if (Object.keys(bySection).length === 0) {
      html += '<p class="placeholder-text">暂无风险标注，请先对合同条款进行标注</p>';
    }

    return html;
  }

  function _setText(selector, value) {
    const el = document.querySelector(selector);
    if (el) el.textContent = value;
  }

  function _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  return {
    computeStats,
    updateDashboard,
    generateChecklist,
    renderChecklistHtml,
    RISK_TYPES,
    LEVEL_LABELS,
    LEVEL_COLORS,
  };
})();
