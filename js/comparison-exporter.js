/**
 * comparison-exporter.js - 对比报告导出模块
 * 生成独立的 HTML 对比报告，包含变更摘要、左右对照、谈判建议
 */
const ComparisonExporter = (() => {

  /**
   * 导出对比报告为 HTML 文件
   * @param {DiffResult} diffResult
   * @param {Suggestion[]} suggestions
   * @param {RiskDelta[]} riskDeltas
   * @param {object} migrationStats
   * @param {Annotation[]} [oldAnnotations] - 旧版批注
   * @param {Annotation[]} [newAnnotations] - 迁移后的新版批注
   */
  function exportComparisonReport(diffResult, suggestions, riskDeltas, migrationStats, oldAnnotations, newAnnotations) {
    const now = new Date();
    const timestamp = now.toLocaleString('zh-CN');
    const fileTimestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;

    const summary = diffResult.summary;
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>合同版本对比报告 - ${escapeHTML(diffResult.oldTitle)} vs ${escapeHTML(diffResult.newTitle)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; color: #333; line-height: 1.6; padding: 40px; max-width: 1200px; margin: 0 auto; background: #fff; }
    h1 { font-size: 24px; margin-bottom: 8px; color: #2c3e50; }
    h2 { font-size: 18px; margin: 24px 0 12px; color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 6px; }
    h3 { font-size: 15px; margin: 16px 0 8px; color: #34495e; }
    .meta { color: #7f8c8d; font-size: 13px; margin-bottom: 24px; }
    .summary-cards { display: flex; gap: 16px; flex-wrap: wrap; margin: 16px 0; }
    .summary-card { background: #f8f9fa; border-radius: 8px; padding: 16px 24px; text-align: center; min-width: 120px; }
    .summary-card .num { font-size: 28px; font-weight: bold; }
    .summary-card .label { font-size: 12px; color: #7f8c8d; }
    .num-added { color: #27ae60; } .num-deleted { color: #e74c3c; } .num-modified { color: #f39c12; } .num-unchanged { color: #95a5a6; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; vertical-align: top; }
    th { background: #f1f3f5; font-weight: 600; }
    .diff-table td { width: 50%; }
    .diff-added { background: #e6ffe6; } .diff-deleted { background: #ffe6e6; } .diff-modified { background: #fffde6; }
    .diff-ins { background: #acf2bd; padding: 1px 2px; } .diff-del { background: #fdb8c0; text-decoration: line-through; padding: 1px 2px; }
    .diff-placeholder { background: #f8f9fa; color: #bbb; font-style: italic; }
    .risk-up { color: #e74c3c; font-weight: bold; } .risk-down { color: #27ae60; font-weight: bold; }
    .suggestion { margin: 12px 0; padding: 12px 16px; border-radius: 6px; border-left: 4px solid; }
    .suggestion.critical { border-color: #e74c3c; background: #fdf0f0; }
    .suggestion.important { border-color: #f39c12; background: #fef9f0; }
    .suggestion.advisory { border-color: #3498db; background: #f0f7fd; }
    .suggestion .sug-title { font-weight: 600; margin-bottom: 4px; }
    .suggestion .sug-section { font-size: 12px; color: #7f8c8d; margin-bottom: 4px; }
    .suggestion .sug-text { font-size: 13px; }
    .priority-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; color: #fff; font-size: 11px; margin-right: 6px; }
    .priority-critical { background: #e74c3c; } .priority-important { background: #f39c12; } .priority-advisory { background: #3498db; }
    .section-header { background: #ecf0f1; padding: 8px 12px; font-weight: 600; }
    .ann-migration-table td, .ann-migration-table th { font-size: 12px; padding: 6px 10px; }
    .ann-status-migrated { color: #27ae60; font-weight: 600; }
    .ann-status-invalidated { color: #e74c3c; font-weight: 600; }
    .ann-status-corrected { color: #f39c12; font-weight: 600; }
    .ann-history-block { margin: 12px 0; padding: 12px 16px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #3498db; }
    .ann-history-block .ann-comment { margin: 6px 0; padding: 6px 10px; background: #fff; border-radius: 4px; font-size: 13px; }
    .ann-history-timeline { margin: 6px 0 0 0; padding: 0; list-style: none; font-size: 12px; color: #666; }
    .ann-history-timeline li { padding: 2px 0; border-left: 2px solid #ddd; padding-left: 10px; margin-left: 4px; }
    .ann-history-timeline li .time { color: #999; margin-right: 6px; }
    .strategy-badge { display: inline-block; padding: 1px 6px; border-radius: 8px; font-size: 11px; color: #fff; }
    .strategy-diff-mapping { background: #27ae60; } .strategy-exact-id { background: #3498db; }
    .strategy-title-match { background: #9b59b6; } .strategy-global-search { background: #f39c12; }
    .strategy-failed { background: #e74c3c; } .strategy-old-title-match { background: #1abc9c; }
    @media print { body { padding: 20px; } .suggestion { break-inside: avoid; } .ann-history-block { break-inside: avoid; } }
  </style>
</head>
<body>
  <h1>合同版本对比报告</h1>
  <div class="meta">
    <div>生成时间：${timestamp}</div>
    <div>旧版：${escapeHTML(diffResult.oldTitle)} &nbsp;→&nbsp; 新版：${escapeHTML(diffResult.newTitle)}</div>
  </div>

  <h2>变更概览</h2>
  <div class="summary-cards">
    <div class="summary-card"><div class="num num-added">${summary.sectionsAdded}</div><div class="label">新增章节</div></div>
    <div class="summary-card"><div class="num num-deleted">${summary.sectionsDeleted}</div><div class="label">删除章节</div></div>
    <div class="summary-card"><div class="num num-modified">${summary.sectionsModified}</div><div class="label">修改章节</div></div>
    <div class="summary-card"><div class="num num-unchanged">${summary.sectionsUnchanged}</div><div class="label">未变章节</div></div>
    <div class="summary-card"><div class="num num-modified">${summary.totalParagraphsChanged}</div><div class="label">段落变更</div></div>
  </div>

  ${buildRiskDeltaSection(riskDeltas)}
  ${buildRiskDeltaDetailSection(riskDeltas)}
  ${buildComparisonTable(diffResult)}
  ${buildSuggestionsSection(suggestions)}
  ${buildAnnotationMigrationSection(migrationStats, oldAnnotations, newAnnotations)}
  ${buildAnnotationHistorySection(newAnnotations)}

  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#999">
    本报告由合同评审系统自动生成，仅供参考。
  </div>
</body>
</html>`;

    downloadBlob(html, `合同版本对比报告_${fileTimestamp}.html`, 'text/html');
  }

  function buildRiskDeltaSection(riskDeltas) {
    const changes = riskDeltas.filter(r => r.direction !== 'unchanged');
    if (changes.length === 0) return '';

    let html = '<h2>风险变化摘要</h2><table><thead><tr><th>章节</th><th>旧版风险分</th><th>新版风险分</th><th>变化</th></tr></thead><tbody>';
    for (const rd of changes) {
      const cls = rd.direction === 'increased' ? 'risk-up' : 'risk-down';
      const text = rd.direction === 'increased' ? `+${rd.delta}` : `${rd.delta}`;
      html += `<tr><td>${escapeHTML(rd.sectionTitle)}</td><td>${rd.oldRiskScore}</td><td>${rd.newRiskScore}</td><td class="${cls}">${text}</td></tr>`;
    }
    html += '</tbody></table>';
    return html;
  }

  function buildComparisonTable(diffResult) {
    let html = '<h2>条款对照</h2>';

    for (const sectionDiff of diffResult.sectionDiffs) {
      const title = sectionDiff.newSection?.title || sectionDiff.oldSection?.title || '未知章节';
      const changeClass = `diff-${sectionDiff.changeType}`;

      html += `<h3 class="section-header">${escapeHTML(title)} <span style="font-weight:normal;font-size:12px;color:#7f8c8d">[${getChangeLabel(sectionDiff.changeType)}]</span></h3>`;

      if (sectionDiff.changeType === 'unchanged') {
        html += '<p style="color:#999;font-size:13px;padding:4px 0">该章节内容未发生变化</p>';
        continue;
      }

      html += '<table class="diff-table"><thead><tr><th>旧版</th><th>新版</th></tr></thead><tbody>';

      for (const paraDiff of sectionDiff.paragraphDiffs) {
        const rowClass = `diff-${paraDiff.changeType}`;
        const leftContent = paraDiff.oldParagraph
          ? (paraDiff.inlineDiff ? renderInlineSegments(paraDiff.inlineDiff.oldSegments) : escapeHTML(paraDiff.oldParagraph.text))
          : '<span class="diff-placeholder">无对应内容</span>';
        const rightContent = paraDiff.newParagraph
          ? (paraDiff.inlineDiff ? renderInlineSegments(paraDiff.inlineDiff.newSegments) : escapeHTML(paraDiff.newParagraph.text))
          : '<span class="diff-placeholder">无对应内容</span>';

        html += `<tr class="${rowClass}"><td>${leftContent}</td><td>${rightContent}</td></tr>`;
      }

      html += '</tbody></table>';
    }

    return html;
  }

  function buildSuggestionsSection(suggestions) {
    if (!suggestions || suggestions.length === 0) return '';

    let html = '<h2>谈判建议</h2>';
    for (const sug of suggestions) {
      html += `
        <div class="suggestion ${sug.priority}">
          <div class="sug-title">
            <span class="priority-badge priority-${sug.priority}">${getPriorityLabel(sug.priority)}</span>
            ${escapeHTML(sug.title)}
          </div>
          <div class="sug-section">章节：${escapeHTML(sug.affectedSection)}</div>
          <div class="sug-text">${escapeHTML(sug.suggestion)}</div>
        </div>
      `;
    }
    return html;
  }

  function buildMigrationSection(migrationStats) {
    if (!migrationStats || migrationStats.total === 0) return '';

    return `
      <h2>批注迁移结果</h2>
      <table>
        <tr><th>总批注数</th><td>${migrationStats.total}</td></tr>
        <tr><th>成功迁移</th><td>${migrationStats.migrated || 0}</td></tr>
        <tr><th>已失效</th><td>${migrationStats.invalidated || 0}</td></tr>
      </table>
    `;
  }

  // ==================== 批注迁移详情 ====================

  function buildAnnotationMigrationSection(migrationStats, oldAnnotations, newAnnotations) {
    if (!migrationStats || migrationStats.total === 0) return '';

    let html = '<h2>批注迁移详情</h2>';

    // 策略分布摘要
    if (migrationStats.byStrategy && Object.keys(migrationStats.byStrategy).length > 0) {
      html += '<div style="margin-bottom:12px;font-size:13px;color:#555"><strong>迁移策略分布：</strong>';
      const stratLabels = {
        'diff-mapping': 'Diff映射', 'diff-mapping-split': '拆分映射', 'diff-mapping-split-fallback': '拆分回退',
        'exact-id': '精确ID', 'title-match': '标题匹配', 'old-title-match': '旧标题匹配',
        'global-search': '全局搜索', 'failed': '失败', 'unknown': '未知'
      };
      for (const [key, count] of Object.entries(migrationStats.byStrategy)) {
        html += `<span class="strategy-badge strategy-${key}">${stratLabels[key] || key}: ${count}</span> `;
      }
      html += '</div>';
    }

    // 逐条迁移明细表
    const details = migrationStats.details || [];
    if (details.length > 0) {
      html += '<table class="ann-migration-table"><thead><tr>';
      html += '<th>锚点文本</th><th>风险类型</th><th>风险等级</th><th>旧章节</th><th>新章节</th><th>迁移状态</th><th>策略</th><th>详情</th>';
      html += '</tr></thead><tbody>';

      for (const d of details) {
        const stratCls = (d.strategy || 'unknown').replace(/[^a-z-]/g, '');
        let statusHtml;
        if (d.status === 'invalidated') {
          statusHtml = `<span class="ann-status-invalidated">已失效</span><br><small style="color:#999">${escapeHTML(d.invalidReason || '')}</small>`;
        } else if (d.corrected) {
          statusHtml = `<span class="ann-status-corrected">已修正</span>`;
        } else {
          statusHtml = `<span class="ann-status-migrated">已迁移</span>`;
        }

        html += `<tr>
          <td title="${escapeHTML(d.anchorText)}">${escapeHTML(truncate(d.anchorText, 25))}</td>
          <td>${escapeHTML(d.riskType || '')}</td>
          <td>${escapeHTML(d.riskLevel || '')}</td>
          <td>${escapeHTML(d.oldSectionTitle || '')}</td>
          <td>${escapeHTML(d.newSectionTitle || '—')}</td>
          <td>${statusHtml}</td>
          <td><span class="strategy-badge strategy-${stratCls}">${escapeHTML(d.strategy || '')}</span></td>
          <td style="font-size:11px;color:#666">${escapeHTML(d.detail || '')}</td>
        </tr>`;
      }

      html += '</tbody></table>';
    } else {
      // 回退：仅显示汇总
      html += `<table>
        <tr><th>总批注数</th><td>${migrationStats.total}</td></tr>
        <tr><th>成功迁移</th><td>${migrationStats.migrated || 0}</td></tr>
        <tr><th>已失效</th><td>${migrationStats.invalidated || 0}</td></tr>
      </table>`;
    }

    return html;
  }

  // ==================== 批注评论与历史 ====================

  function buildAnnotationHistorySection(annotations) {
    if (!annotations || annotations.length === 0) return '';

    // 筛选有评论内容或有历史的批注
    const annotsWithContext = annotations.filter(a =>
      (a.comment && a.comment.trim()) ||
      (a.history && a.history.length > 1)
    );
    if (annotsWithContext.length === 0) return '';

    let html = '<h2>批注评论与操作历史</h2>';

    for (const ann of annotsWithContext) {
      const levelLabels = { high: '高风险', medium: '中风险', low: '低风险' };
      const typeLabels = {
        payment: '付款', breach: '违约', confidential: '保密',
        delivery: '交付', dispute: '争议', entity: '主体'
      };
      const statusLabels = {
        pending: '待评审', reviewing: '评审中', flagged: '已标记',
        resolved: '已解决', dismissed: '已忽略', invalidated: '已失效'
      };

      html += `<div class="ann-history-block">`;
      html += `<strong>${escapeHTML(typeLabels[ann.riskType] || ann.riskType)}</strong>`;
      html += ` — <span style="font-weight:600">${escapeHTML(levelLabels[ann.riskLevel] || ann.riskLevel)}</span>`;
      html += ` — ${escapeHTML(statusLabels[ann.status] || ann.status)}`;
      html += `<br><small style="color:#999">章节：${escapeHTML(ann._sectionTitle || ann.sectionId || '')} | 锚点：${escapeHTML(truncate(ann.anchorText, 30))}</small>`;

      // 评论内容
      if (ann.comment && ann.comment.trim()) {
        html += `<div class="ann-comment">${escapeHTML(ann.comment)}</div>`;
      }

      // 操作历史时间线
      if (ann.history && ann.history.length > 0) {
        html += '<ul class="ann-history-timeline">';
        for (const entry of ann.history) {
          const time = entry.time ? new Date(entry.time).toLocaleString('zh-CN') : '';
          let desc = '';

          switch (entry.action) {
            case 'created':
              desc = '创建批注';
              break;
            case 'status_change':
              desc = `状态变更：${statusLabels[entry.from] || entry.from} → ${statusLabels[entry.to] || entry.to}`;
              break;
            case 'field_change':
              desc = `字段变更：${entry.field} 从 "${entry.from}" 改为 "${entry.to}"`;
              break;
            case 'invalidated':
              desc = `批注失效：${escapeHTML(entry.reason || '未知原因')}`;
              break;
            case 'migrated':
              desc = `版本迁移 (${escapeHTML(entry.strategy || '')})：${escapeHTML(entry.detail || '')}`;
              break;
            default:
              desc = escapeHTML(entry.action || '');
          }

          html += `<li><span class="time">${time}</span>${desc}</li>`;
        }
        html += '</ul>';
      }

      html += '</div>';
    }

    return html;
  }

  // ==================== 风险变化明细 ====================

  function buildRiskDeltaDetailSection(riskDeltas) {
    if (!riskDeltas) return '';

    const changesWithDetails = riskDeltas.filter(rd =>
      rd.changes && (rd.changes.added.length > 0 || rd.changes.removed.length > 0 || rd.changes.levelChanged.length > 0)
    );
    if (changesWithDetails.length === 0) return '';

    const levelLabels = { high: '高风险', medium: '中风险', low: '低风险' };

    let html = '<h2>风险变化明细</h2>';

    for (const rd of changesWithDetails) {
      html += `<h3 style="margin-top:12px">${escapeHTML(rd.sectionTitle)}</h3>`;
      html += '<table><thead><tr><th>变更类型</th><th>锚点文本</th><th>风险类型</th><th>旧等级</th><th>新等级</th></tr></thead><tbody>';

      for (const added of rd.changes.added) {
        html += `<tr class="diff-added">
          <td>新增</td>
          <td>${escapeHTML(truncate(added.anchorText, 30))}</td>
          <td>${escapeHTML(added.riskType || '')}</td>
          <td>—</td>
          <td>${escapeHTML(levelLabels[added.riskLevel] || added.riskLevel || '')}</td>
        </tr>`;
      }

      for (const removed of rd.changes.removed) {
        html += `<tr class="diff-deleted">
          <td>移除</td>
          <td>${escapeHTML(truncate(removed.anchorText, 30))}</td>
          <td>${escapeHTML(removed.riskType || '')}</td>
          <td>${escapeHTML(levelLabels[removed.riskLevel] || removed.riskLevel || '')}</td>
          <td>—</td>
        </tr>`;
      }

      for (const changed of rd.changes.levelChanged) {
        html += `<tr class="diff-modified">
          <td>等级变更</td>
          <td>${escapeHTML(truncate(changed.annotation ? changed.annotation.anchorText : '', 30))}</td>
          <td>${escapeHTML(changed.annotation ? changed.annotation.riskType : '')}</td>
          <td>${escapeHTML(levelLabels[changed.oldLevel] || changed.oldLevel || '')}</td>
          <td>${escapeHTML(levelLabels[changed.newLevel] || changed.newLevel || '')}</td>
        </tr>`;
      }

      html += '</tbody></table>';
    }

    return html;
  }

  function buildMigrationSection(migrationStats) {
    // 保留作为回退：仅当无 details 时使用
    if (!migrationStats || migrationStats.total === 0) return '';
    return `
      <h2>批注迁移结果</h2>
      <table>
        <tr><th>总批注数</th><td>${migrationStats.total}</td></tr>
        <tr><th>成功迁移</th><td>${migrationStats.migrated || 0}</td></tr>
        <tr><th>已失效</th><td>${migrationStats.invalidated || 0}</td></tr>
      </table>
    `;
  }

  // ==================== 辅助函数 ====================

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
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
  }

  function getChangeLabel(ct) {
    const map = { added: '新增', deleted: '删除', modified: '修改', unchanged: '未变' };
    return map[ct] || ct;
  }

  function getPriorityLabel(p) {
    const map = { critical: '紧急', important: '重要', advisory: '建议' };
    return map[p] || p;
  }

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  return {
    exportComparisonReport
  };
})();
