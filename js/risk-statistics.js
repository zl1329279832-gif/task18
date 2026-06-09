/**
 * risk-statistics.js - 风险统计模块
 * 负责六类风险归类汇总、SVG图表、评审清单生成、标注有效性验证
 * 支持stale批注统计与迁移触发
 */
const RiskStatistics = (() => {

  /**
   * 计算统计数据
   */
  function computeStats(annotations) {
    const stats = {
      total: annotations.length,
      active: 0,
      stale: 0,
      byType: {},
      byLevel: { high: 0, medium: 0, low: 0 },
      byStatus: {},
      byTypeAndLevel: {}
    };

    // 初始化类型计数
    Object.keys(AnnotationManager.RISK_TYPES).forEach(type => {
      stats.byType[type] = 0;
      stats.byTypeAndLevel[type] = { high: 0, medium: 0, low: 0 };
    });

    // 初始化状态计数
    Object.keys(AnnotationManager.STATUS_FLOW).forEach(status => {
      stats.byStatus[status] = 0;
    });

    annotations.forEach(ann => {
      // 统计stale
      if (ann.stale) {
        stats.stale++;
        return; // 失效批注不计入正常统计
      }

      stats.active++;

      if (stats.byType[ann.riskType] !== undefined) {
        stats.byType[ann.riskType]++;
      }
      if (stats.byLevel[ann.riskLevel] !== undefined) {
        stats.byLevel[ann.riskLevel]++;
      }
      if (stats.byStatus[ann.status] !== undefined) {
        stats.byStatus[ann.status]++;
      }
      if (stats.byTypeAndLevel[ann.riskType]) {
        stats.byTypeAndLevel[ann.riskType][ann.riskLevel]++;
      }
    });

    return stats;
  }

  /**
   * 渲染SVG柱状图
   */
  function renderBarChart(stats, svgContainer) {
    const types = Object.keys(AnnotationManager.RISK_TYPES);
    const width = 500;
    const height = 220;
    const padding = { top: 20, right: 20, bottom: 60, left: 40 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const maxVal = Math.max(...types.map(t => stats.byType[t] || 0), 1);
    const barWidth = Math.min(40, (chartWidth / types.length) * 0.6);
    const gap = chartWidth / types.length;

    let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${width}px">`;

    // Y轴
    svg += `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="#ddd" stroke-width="1"/>`;
    // X轴
    svg += `<line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="#ddd" stroke-width="1"/>`;

    // Y轴刻度
    for (let i = 0; i <= 4; i++) {
      const val = Math.round(maxVal * i / 4);
      const y = height - padding.bottom - (chartHeight * i / 4);
      svg += `<text x="${padding.left - 5}" y="${y + 4}" text-anchor="end" font-size="10" fill="#999">${val}</text>`;
      svg += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#eee" stroke-width="0.5"/>`;
    }

    // 柱子
    types.forEach((type, i) => {
      const count = stats.byType[type] || 0;
      const barHeight = (count / maxVal) * chartHeight;
      const x = padding.left + gap * i + (gap - barWidth) / 2;
      const y = height - padding.bottom - barHeight;
      const color = AnnotationManager.RISK_TYPES[type].color;
      const label = AnnotationManager.RISK_TYPES[type].label;

      // 柱子（带圆角）
      if (barHeight > 0) {
        svg += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${color}" rx="3" ry="3" opacity="0.85">
          <title>${label}: ${count}条</title>
        </rect>`;
        // 数值标签
        svg += `<text x="${x + barWidth/2}" y="${y - 4}" text-anchor="middle" font-size="11" font-weight="bold" fill="${color}">${count}</text>`;
      }

      // X轴标签
      svg += `<text x="${x + barWidth/2}" y="${height - padding.bottom + 14}" text-anchor="middle" font-size="9" fill="#666" transform="rotate(-25 ${x + barWidth/2} ${height - padding.bottom + 14})">${label}</text>`;
    });

    svg += '</svg>';
    svgContainer.innerHTML = svg;
  }

  /**
   * 渲染SVG饼图（按风险等级）
   */
  function renderPieChart(stats, svgContainer) {
    const size = 180;
    const cx = size / 2;
    const cy = size / 2;
    const radius = 65;
    const total = stats.byLevel.high + stats.byLevel.medium + stats.byLevel.low;

    let svg = `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${size}px">`;

    if (total === 0) {
      svg += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="#eee"/>`;
      svg += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="12" fill="#999">暂无数据</text>`;
    } else {
      const levels = [
        { key: 'high', label: '高风险', color: AnnotationManager.RISK_LEVELS.high.color, value: stats.byLevel.high },
        { key: 'medium', label: '中风险', color: AnnotationManager.RISK_LEVELS.medium.color, value: stats.byLevel.medium },
        { key: 'low', label: '低风险', color: AnnotationManager.RISK_LEVELS.low.color, value: stats.byLevel.low }
      ];

      let startAngle = -Math.PI / 2;
      levels.forEach(level => {
        if (level.value === 0) return;
        const angle = (level.value / total) * 2 * Math.PI;
        const endAngle = startAngle + angle;

        const x1 = cx + radius * Math.cos(startAngle);
        const y1 = cy + radius * Math.sin(startAngle);
        const x2 = cx + radius * Math.cos(endAngle);
        const y2 = cy + radius * Math.sin(endAngle);
        const largeArc = angle > Math.PI ? 1 : 0;

        svg += `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${level.color}" opacity="0.85">
          <title>${level.label}: ${level.value}条 (${Math.round(level.value/total*100)}%)</title>
        </path>`;

        // 标签
        const midAngle = startAngle + angle / 2;
        const labelR = radius * 0.65;
        const lx = cx + labelR * Math.cos(midAngle);
        const ly = cy + labelR * Math.sin(midAngle);
        if (level.value > 0 && angle > 0.3) {
          svg += `<text x="${lx}" y="${ly + 3}" text-anchor="middle" font-size="10" fill="#fff" font-weight="bold">${level.value}</text>`;
        }

        startAngle = endAngle;
      });
    }

    svg += '</svg>';
    svgContainer.innerHTML = svg;
  }

  /**
   * 生成评审清单 HTML
   */
  function generateChecklist(annotations, sections) {
    // 分离活跃和失效批注
    const activeAnns = annotations.filter(a => !a.stale);
    const staleAnns = annotations.filter(a => a.stale);

    if (activeAnns.length === 0 && staleAnns.length === 0) {
      return '<p class="checklist-empty">暂无批注，请先对合同条款进行标注。</p>';
    }

    let html = '<div class="checklist">';
    html += `<div class="checklist-header">
      <h3>合同评审清单</h3>
      <p>共 ${activeAnns.length} 条有效批注${staleAnns.length > 0 ? `、${staleAnns.length} 条失效批注` : ''} |
        高风险 ${activeAnns.filter(a => a.riskLevel === 'high').length} 条 |
        待处理 ${activeAnns.filter(a => a.status === 'pending' || a.status === 'reviewing').length} 条
      </p>
    </div>`;

    // 按风险类型分组（仅活跃批注）
    const grouped = {};
    activeAnns.forEach(ann => {
      if (!grouped[ann.riskType]) grouped[ann.riskType] = [];
      grouped[ann.riskType].push(ann);
    });

    Object.keys(AnnotationManager.RISK_TYPES).forEach(type => {
      const items = grouped[type];
      if (!items || items.length === 0) return;

      const rt = AnnotationManager.RISK_TYPES[type];
      html += `<div class="checklist-group">
        <h4 style="color:${rt.color}">${rt.icon} ${rt.label} (${items.length}条)</h4>
        <table class="checklist-table">
          <thead>
            <tr>
              <th>等级</th>
              <th>章节</th>
              <th>条款内容</th>
              <th>批注</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>`;

      items.forEach(ann => {
        const section = sections.find(s => s.id === ann.sectionId);
        const sectionTitle = section ? section.title : '未知章节';
        const statusInfo = AnnotationManager.STATUS_FLOW[ann.status];
        const levelInfo = AnnotationManager.RISK_LEVELS[ann.riskLevel];

        html += `<tr>
          <td><span class="badge" style="background:${levelInfo.color}">${levelInfo.label}</span></td>
          <td>${AnnotationRenderer.escapeHTML(sectionTitle)}</td>
          <td class="anchor-text" title="${AnnotationRenderer.escapeHTML(ann.anchorText)}">${AnnotationRenderer.escapeHTML(truncate(ann.anchorText, 30))}</td>
          <td>${AnnotationRenderer.escapeHTML(ann.comment || '无')}</td>
          <td><span class="badge status-badge" style="background:${statusInfo.color}">${statusInfo.label}</span></td>
        </tr>`;
      });

      html += '</tbody></table></div>';
    });

    // 失效批注区域
    if (staleAnns.length > 0) {
      html += `<div class="checklist-group stale-group">
        <h4 style="color:#95a5a6">&#9888; 失效批注 (${staleAnns.length}条)</h4>
        <table class="checklist-table">
          <thead>
            <tr>
              <th>原风险类型</th>
              <th>条款内容</th>
              <th>失效原因</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>`;

      staleAnns.forEach(ann => {
        const rt = AnnotationManager.RISK_TYPES[ann.riskType];
        html += `<tr class="stale-row">
          <td><span class="badge" style="background:#95a5a6">${rt ? rt.label : '未知'}</span></td>
          <td class="anchor-text" title="${AnnotationRenderer.escapeHTML(ann.anchorText)}">${AnnotationRenderer.escapeHTML(truncate(ann.anchorText, 30))}</td>
          <td>${AnnotationRenderer.escapeHTML(ann.staleReason || '未知原因')}</td>
          <td><button class="btn-delete-stale" data-id="${ann.id}" title="删除此失效批注">删除</button></td>
        </tr>`;
      });

      html += '</tbody></table></div>';
    }

    html += '</div>';
    return html;
  }

  /**
   * 验证所有批注的定位有效性（增强版：自动修正和标记stale）
   * @param {boolean} autoApply - 是否自动应用修正和标记stale
   */
  function validateAnnotations(annotations, sections, autoApply) {
    const results = {
      valid: [],
      corrected: [],
      invalid: []
    };

    annotations.forEach(ann => {
      // 已经是stale的跳过验证
      if (ann.stale) {
        results.invalid.push({ annotation: ann, reason: ann.staleReason || '已标记失效' });
        return;
      }

      const result = TextParser.validateAnnotationPosition(ann, sections);
      if (result.valid && !result.corrected) {
        results.valid.push(ann);
      } else if (result.valid && result.corrected) {
        results.corrected.push({ annotation: ann, correction: result });
      } else {
        results.invalid.push({ annotation: ann, reason: result.reason });
      }
    });

    // 自动应用修正和标记stale
    if (autoApply) {
      // 修正位置偏移的批注
      for (const item of results.corrected) {
        const ann = item.annotation;
        const corr = item.correction;
        ann.sectionId = corr.newSectionId || ann.sectionId;
        ann.paragraphIndex = corr.newParagraphIndex !== undefined ? corr.newParagraphIndex : ann.paragraphIndex;
        ann.startOffset = corr.newStart;
        ann.endOffset = corr.newEnd;
        ann.updatedAt = new Date().toISOString();

        // 更新上下文
        const ctx = TextParser.extractContext(sections, ann.sectionId, ann.paragraphIndex, ann.startOffset, ann.endOffset);
        ann.contextBefore = ctx.before;
        ann.contextAfter = ctx.after;

        // 清除stale标记
        if (ann.stale) {
          ann.stale = false;
          ann.staleSince = null;
          ann.staleReason = null;
        }

        ann.history.push({
          action: 'auto_corrected',
          newStart: corr.newStart,
          newEnd: corr.newEnd,
          time: new Date().toISOString()
        });
      }

      // 标记无效批注为stale
      for (const item of results.invalid) {
        if (!item.annotation.stale) {
          AnnotationManager.markStale(item.annotation.id, item.reason);
        }
      }
    }

    return results;
  }

  /**
   * 渲染验证结果
   */
  function renderValidationResults(results, container) {
    if (results.invalid.length === 0 && results.corrected.length === 0) {
      container.innerHTML = '<p class="validation-ok">所有批注定位正常</p>';
      return;
    }

    let html = '';

    if (results.corrected.length > 0) {
      html += `<div class="validation-warning">
        <strong>已自动修正 ${results.corrected.length} 条批注定位</strong>
        <ul>`;
      results.corrected.forEach(item => {
        html += `<li>${AnnotationRenderer.escapeHTML(truncate(item.annotation.anchorText, 20))} - 位置已修正</li>`;
      });
      html += '</ul></div>';
    }

    if (results.invalid.length > 0) {
      html += `<div class="validation-error">
        <strong>${results.invalid.length} 条批注定位失效（已标记为失效）：</strong>
        <ul>`;
      results.invalid.forEach(item => {
        html += `<li>
          <span>${AnnotationRenderer.escapeHTML(truncate(item.annotation.anchorText, 20))}</span>
          <span class="stale-reason"> - ${AnnotationRenderer.escapeHTML(item.reason)}</span>
        </li>`;
      });
      html += '</ul></div>';
    }

    container.innerHTML = html;
  }

  function truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
  }

  return { computeStats, renderBarChart, renderPieChart, generateChecklist, validateAnnotations, renderValidationResults };
})();
