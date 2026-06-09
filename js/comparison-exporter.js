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
   * @param {Annotation[]} oldAnnotations - 旧版批注
   * @param {Annotation[]} newAnnotations - 迁移后批注
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
    @media print { body { padding: 20px; } .suggestion { break-inside: avoid; } }
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
  ${buildComparisonTable(diffResult, oldAnnotations, newAnnotations)}
  ${buildAnnotationThreadsSection(oldAnnotations, newAnnotations)}
  ${buildSuggestionsSection(suggestions)}
  ${buildMigrationSection(migrationStats, oldAnnotations, newAnnotations)}

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

  function buildComparisonTable(diffResult, oldAnnotations, newAnnotations) {
    let html = '<h2>条款对照</h2>';
    const safeOldAnns = oldAnnotations || [];
    const safeNewAnns = newAnnotations || [];

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

        // 显示该段落关联的旧版批注
        const oldSectionId = sectionDiff.oldSection?.id;
        const oldParaIdx = paraDiff.oldParagraph?.index;
        if (oldSectionId !== undefined && oldParaIdx !== undefined) {
          const paraAnns = safeOldAnns.filter(a =>
            a.sectionId === oldSectionId && a.paragraphIndex === oldParaIdx && a.status !== 'invalidated'
          );
          if (paraAnns.length > 0) {
            html += `<tr class="annotation-row"><td colspan="2" style="background:#fff8e1;border-left:3px solid #f39c12;font-size:12px;padding:6px 12px">`;
            paraAnns.forEach(ann => {
              html += `<div style="margin:2px 0"><span style="background:#f39c12;color:#fff;padding:1px 6px;border-radius:3px;font-size:11px;margin-right:4px">${escapeHTML(ann.riskType)}</span>`;
              html += `<span style="color:#666">${escapeHTML(ann.anchorText ? ann.anchorText.substring(0, 40) : '')}</span>`;
              if (ann.comment) html += ` — <span style="color:#333">${escapeHTML(ann.comment)}</span>`;
              // 评论线程（历史记录）
              if (ann.history && ann.history.length > 1) {
                html += ` <span style="color:#999;font-size:11px">(${ann.history.length - 1}条操作记录)</span>`;
              }
              html += `</div>`;
            });
            html += `</td></tr>`;
          }
        }
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

  function buildMigrationSection(migrationStats, oldAnnotations, newAnnotations) {
    if (!migrationStats || migrationStats.total === 0) return '';
    const safeOldAnns = oldAnnotations || [];
    const safeNewAnns = newAnnotations || [];

    // 识别失效批注（在旧版中存在但在新版迁移结果中标记为 invalidated 的）
    const invalidatedAnns = safeOldAnns.filter(a => a.status === 'invalidated');

    let html = `
      <h2>批注迁移结果</h2>
      <table>
        <tr><th>总批注数</th><td>${migrationStats.total}</td></tr>
        <tr><th>成功迁移</th><td>${migrationStats.migrated || 0}</td></tr>
        <tr><th>已失效</th><td style="color:#e74c3c;font-weight:bold">${migrationStats.invalidated || 0}</td></tr>
      </table>
    `;

    // 显示失效批注的详细信息和失效原因
    if (invalidatedAnns.length > 0) {
      html += `<h3 style="margin-top:16px;color:#e74c3c">失效批注详情</h3>
        <table>
          <thead><tr><th>锚点文本</th><th>风险类型</th><th>批注说明</th><th>失效原因</th></tr></thead>
          <tbody>`;
      invalidatedAnns.forEach(ann => {
        html += `<tr style="color:#999;text-decoration:line-through">
          <td style="text-decoration:line-through">${escapeHTML((ann.anchorText || '').substring(0, 40))}</td>
          <td>${escapeHTML(ann.riskType || '')}</td>
          <td>${escapeHTML(ann.comment || '无')}</td>
          <td style="text-decoration:none;color:#e74c3c">${escapeHTML(ann._invalidReason || '无法定位')}</td>
        </tr>`;
      });
      html += '</tbody></table>';
    }

    // 显示成功迁移但位置发生变化的批注
    const migratedAnns = safeNewAnns.filter(a => {
      if (a.status === 'invalidated') return false;
      return a.history && a.history.some(h => h.action === 'migrated');
    });
    if (migratedAnns.length > 0) {
      html += `<h3 style="margin-top:16px;color:#f39c12">位置修正批注</h3>
        <table>
          <thead><tr><th>锚点文本</th><th>风险类型</th><th>原位置</th><th>新位置</th></tr></thead>
          <tbody>`;
      migratedAnns.forEach(ann => {
        const migRecord = ann.history.find(h => h.action === 'migrated');
        const fromStr = migRecord && migRecord.from ? `段落${migRecord.from.paragraphIndex}` : '—';
        const toStr = migRecord && migRecord.to ? `段落${migRecord.to.paragraphIndex}` : '—';
        html += `<tr>
          <td>${escapeHTML((ann.anchorText || '').substring(0, 40))}</td>
          <td>${escapeHTML(ann.riskType || '')}</td>
          <td>${fromStr}</td>
          <td>${toStr}</td>
        </tr>`;
      });
      html += '</tbody></table>';
    }

    return html;
  }

  /**
   * 构建评论线程区块（完整的批注操作历史）
   */
  function buildAnnotationThreadsSection(oldAnnotations, newAnnotations) {
    const safeOldAnns = oldAnnotations || [];
    const safeNewAnns = newAnnotations || [];
    // 合并去重：以 id 为键取最新版本
    const annMap = new Map();
    safeOldAnns.forEach(a => annMap.set(a.id, a));
    safeNewAnns.forEach(a => annMap.set(a.id, a));
    const allAnns = Array.from(annMap.values());

    // 只显示有评论或有操作历史的批注
    const annsWithThreads = allAnns.filter(a =>
      (a.comment && a.comment.trim()) || (a.history && a.history.length > 1)
    );
    if (annsWithThreads.length === 0) return '';

    let html = '<h2>评论线程</h2>';
    annsWithThreads.forEach(ann => {
      const isInvalidated = ann.status === 'invalidated';
      const statusStyle = isInvalidated ? 'color:#999;text-decoration:line-through' : '';
      html += `<div class="suggestion" style="border-color:#3498db;background:#f8f9fa;${statusStyle}">`;
      html += `<div class="sug-title" style="text-decoration:none">${escapeHTML((ann.anchorText || '').substring(0, 50))}`;
      if (isInvalidated) html += ` <span style="color:#e74c3c;font-size:11px;text-decoration:none">[已失效]</span>`;
      html += `</div>`;
      if (ann.comment) {
        html += `<div class="sug-text" style="text-decoration:none;margin:4px 0">${escapeHTML(ann.comment)}</div>`;
      }
      // 操作历史时间线
      if (ann.history && ann.history.length > 0) {
        html += `<div style="text-decoration:none;margin-top:8px;font-size:11px;color:#7f8c8d;border-top:1px solid #eee;padding-top:6px">`;
        ann.history.forEach(h => {
          const timeStr = h.time ? new Date(h.time).toLocaleString('zh-CN') : '';
          let actionLabel = h.action;
          if (h.action === 'created') actionLabel = '创建';
          else if (h.action === 'status_change') actionLabel = `状态: ${h.from || ''} → ${h.to || ''}`;
          else if (h.action === 'invalidated') actionLabel = `失效: ${h.reason || ''}`;
          else if (h.action === 'migrated') actionLabel = '位置迁移';
          html += `<div>${timeStr} — ${escapeHTML(actionLabel)}</div>`;
        });
        html += `</div>`;
      }
      html += `</div>`;
    });

    return html;
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
