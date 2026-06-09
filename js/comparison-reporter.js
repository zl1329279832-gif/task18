/**
 * comparison-reporter.js - 对比报告导出模块
 * 负责生成包含左右对照、变更摘要、谈判建议、批注迁移状态的HTML报告
 * 依赖：DiffEngine, ChangeAnalyzer, AnnotationManager, ReportExporter(downloadBlob)
 */
const ComparisonReporter = (() => {

  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
  }

  /**
   * 导出对比报告
   */
  function exportComparisonReport(diffResult, analysisResult, migrationResults, originalTitle, revisedTitle) {
    const now = new Date();
    const dateStr = now.toLocaleString('zh-CN');

    let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>合同版本对比报告 - ${dateStr}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; line-height: 1.8; color: #333; padding: 30px; max-width: 1200px; margin: 0 auto; font-size: 13px; }
.report-header { text-align: center; border-bottom: 3px solid #2c3e50; padding-bottom: 16px; margin-bottom: 24px; }
.report-header h1 { font-size: 22px; color: #2c3e50; }
.report-header .meta { color: #7f8c8d; font-size: 13px; margin-top: 6px; }
.summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 24px; }
.summary-card { background: #f8f9fa; border: 1px solid #eee; border-radius: 6px; padding: 12px; text-align: center; }
.summary-card .num { font-size: 24px; font-weight: bold; }
.summary-card .label { font-size: 11px; color: #999; }
.section-title { font-size: 18px; color: #2c3e50; border-bottom: 2px solid #2c3e50; padding-bottom: 6px; margin: 24px 0 12px; }
.sub-title { font-size: 15px; color: #2c3e50; margin: 16px 0 8px; font-weight: 600; }
.comparison-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; table-layout: fixed; }
.comparison-table th { background: #2c3e50; color: #fff; padding: 8px 12px; text-align: left; width: 50%; font-size: 13px; }
.comparison-table td { padding: 8px 12px; border-bottom: 1px solid #eee; vertical-align: top; font-size: 13px; line-height: 1.7; }
.comparison-table tr:hover { background: #fafafa; }
.diff-insert { background: #e6ffed; }
.diff-delete { background: #ffeef0; text-decoration: line-through; color: #cb2431; }
.diff-modify { background: #fff8e1; }
.diff-char-ins { background: #acf2bd; padding: 1px 2px; border-radius: 2px; }
.diff-char-del { background: #fdb8c0; padding: 1px 2px; border-radius: 2px; text-decoration: line-through; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 10px; color: #fff; font-size: 11px; font-weight: 500; }
.badge-high { background: #e74c3c; }
.badge-medium { background: #f39c12; }
.badge-low { background: #27ae60; }
.badge-added { background: #34d058; }
.badge-deleted { background: #d73a49; }
.badge-modified { background: #f9a825; }
.suggestion-box { border: 1px solid #e1e4e8; border-radius: 6px; margin-bottom: 12px; overflow: hidden; page-break-inside: avoid; }
.suggestion-header { padding: 8px 12px; color: #fff; font-weight: 600; font-size: 13px; }
.suggestion-header.high { background: #e74c3c; }
.suggestion-header.medium { background: #f39c12; }
.suggestion-body { padding: 10px 12px; }
.suggestion-label { font-size: 11px; font-weight: 700; color: #7f8c8d; margin-bottom: 2px; text-transform: uppercase; }
.suggestion-text { font-size: 13px; margin-bottom: 8px; line-height: 1.6; }
.suggested-clause { padding: 8px 12px; background: #f0f7ff; border-left: 3px solid #3498db; font-size: 12px; font-style: italic; margin-top: 6px; border-radius: 0 4px 4px 0; }
.migration-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
.migration-table th { background: #2c3e50; color: #fff; padding: 6px 10px; text-align: left; }
.migration-table td { padding: 6px 10px; border-bottom: 1px solid #eee; }
.ghost-row { color: #9ca3af; font-style: italic; }
.trend-up { color: #e74c3c; font-weight: 600; }
.trend-down { color: #27ae60; font-weight: 600; }
.trend-same { color: #7f8c8d; }
.footer { margin-top: 30px; padding-top: 16px; border-top: 1px solid #eee; text-align: center; color: #999; font-size: 11px; }
@media print { body { padding: 15px; } .suggestion-box { page-break-inside: avoid; } }
</style>
</head>
<body>`;

    // 报告头
    html += `<div class="report-header">
  <h1>合同版本对比报告</h1>
  <div class="meta">原始版本：${escapeHTML(originalTitle)} | 修订版本：${escapeHTML(revisedTitle)} | 生成时间：${dateStr}</div>
</div>`;

    // 变更摘要
    html += buildChangeSummaryHTML(analysisResult, diffResult);

    // 左右对照正文
    html += `<h2 class="section-title">版本对照</h2>`;
    html += buildSideBySideHTML(diffResult);

    // 谈判建议
    if (analysisResult.suggestions.length > 0) {
      html += buildSuggestionHTML(analysisResult);
    }

    // 批注迁移
    if (migrationResults && migrationResults.length > 0) {
      html += buildMigrationStatusHTML(migrationResults);
    }

    // 页脚
    html += `<div class="footer">
  <p>本报告由合同评审系统自动生成 | ${dateStr}</p>
</div>`;

    html += '</body></html>';

    // 触发下载
    const filename = `合同对比报告_${formatDate(now)}.html`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /**
   * 构建变更摘要HTML
   */
  function buildChangeSummaryHTML(analysisResult, diffResult) {
    const s = analysisResult.riskSummary;
    const d = diffResult.stats;
    const trendLabels = { increased: '风险上升', decreased: '风险下降', unchanged: '风险持平' };
    const trendClass = { increased: 'trend-up', decreased: 'trend-down', unchanged: 'trend-same' };

    let html = `<h2 class="section-title">变更摘要</h2>`;
    html += '<div class="summary-grid">';
    html += `<div class="summary-card"><div class="num" style="color:#2c3e50">${s.totalChanges}</div><div class="label">总变更数</div></div>`;
    html += `<div class="summary-card"><div class="num" style="color:#e74c3c">${s.highRiskChanges}</div><div class="label">高风险变更</div></div>`;
    html += `<div class="summary-card"><div class="num" style="color:#f39c12">${s.mediumRiskChanges}</div><div class="label">中风险变更</div></div>`;
    html += `<div class="summary-card"><div class="num"><span class="${trendClass[s.riskTrend]}">${trendLabels[s.riskTrend]}</span></div><div class="label">风险趋势</div></div>`;
    html += '</div>';

    // 章节级统计
    html += `<p style="font-size:13px;color:#666;margin-bottom:16px">
      章节统计：原始 ${d.totalSectionsOriginal} 个章节，修订 ${d.totalSectionsRevised} 个章节 |
      新增 <span class="badge badge-added">${d.addedSections}</span>
      删除 <span class="badge badge-deleted">${d.deletedSections}</span>
      修改 <span class="badge badge-modified">${d.modifiedSections}</span>
      未变 ${d.unchangedSections}
    </p>`;

    return html;
  }

  /**
   * 构建左右对照HTML
   */
  function buildSideBySideHTML(diffResult) {
    let html = '<table class="comparison-table">';
    html += '<thead><tr><th>原始版本</th><th>修订版本</th></tr></thead>';
    html += '<tbody>';

    diffResult.sectionMappings.forEach(mapping => {
      if (mapping.type === 'matched') {
        // 章节标题行
        const titleChanged = mapping.titleChanged;
        html += `<tr style="background:#f1f3f5">
          <td><strong>${escapeHTML(mapping.originalSection.title)}</strong></td>
          <td><strong>${escapeHTML(mapping.revisedSection.title)}</strong>
            ${titleChanged ? ' <span class="badge badge-modified">标题变更</span>' : ''}
          </td>
        </tr>`;

        // 段落对比
        mapping.paragraphDiffs.forEach(pd => {
          if (pd.type === 'unchanged') {
            html += `<tr>
              <td>${escapeHTML(pd.originalParagraph.text)}</td>
              <td>${escapeHTML(pd.revisedParagraph.text)}</td>
            </tr>`;
          } else if (pd.type === 'modified') {
            html += `<tr>
              <td class="diff-modify">${renderInlineDiffOriginalReport(pd.inlineDiffs)}</td>
              <td class="diff-modify">${renderInlineDiffRevisedReport(pd.inlineDiffs)}</td>
            </tr>`;
          } else if (pd.type === 'deleted') {
            html += `<tr>
              <td class="diff-delete">${escapeHTML(pd.originalParagraph.text)}</td>
              <td class="ghost-row">（已删除）</td>
            </tr>`;
          } else if (pd.type === 'added') {
            html += `<tr>
              <td class="ghost-row">（新增）</td>
              <td class="diff-insert">${escapeHTML(pd.revisedParagraph.text)}</td>
            </tr>`;
          }
        });
      } else if (mapping.type === 'deleted') {
        html += `<tr style="background:#f1f3f5">
          <td><strong>${escapeHTML(mapping.originalSection.title)}</strong> <span class="badge badge-deleted">整章删除</span></td>
          <td class="ghost-row">（修订版中已删除）</td>
        </tr>`;
        mapping.originalSection.paragraphs.forEach(p => {
          html += `<tr><td class="diff-delete">${escapeHTML(p.text)}</td><td></td></tr>`;
        });
      } else if (mapping.type === 'added') {
        html += `<tr style="background:#f1f3f5">
          <td class="ghost-row">（原始版中无此章节）</td>
          <td><strong>${escapeHTML(mapping.revisedSection.title)}</strong> <span class="badge badge-added">整章新增</span></td>
        </tr>`;
        mapping.revisedSection.paragraphs.forEach(p => {
          html += `<tr><td></td><td class="diff-insert">${escapeHTML(p.text)}</td></tr>`;
        });
      }
    });

    html += '</tbody></table>';
    return html;
  }

  /**
   * 渲染行内diff（原始侧 - 报告用）
   */
  function renderInlineDiffOriginalReport(inlineDiffs) {
    let html = '';
    for (const seg of inlineDiffs) {
      if (seg.type === 'equal') html += escapeHTML(seg.text);
      else if (seg.type === 'delete') html += `<span class="diff-char-del">${escapeHTML(seg.text)}</span>`;
    }
    return html;
  }

  /**
   * 渲染行内diff（修订侧 - 报告用）
   */
  function renderInlineDiffRevisedReport(inlineDiffs) {
    let html = '';
    for (const seg of inlineDiffs) {
      if (seg.type === 'equal') html += escapeHTML(seg.text);
      else if (seg.type === 'insert') html += `<span class="diff-char-ins">${escapeHTML(seg.text)}</span>`;
    }
    return html;
  }

  /**
   * 构建谈判建议HTML
   */
  function buildSuggestionHTML(analysisResult) {
    let html = `<h2 class="section-title">谈判建议（${analysisResult.suggestions.length}条）</h2>`;

    analysisResult.suggestions.forEach((s, idx) => {
      const change = analysisResult.changes.find(c => c.id === s.changeId);
      const riskLevel = change ? change.riskLevel : 'medium';

      html += `<div class="suggestion-box">`;
      html += `<div class="suggestion-header ${riskLevel}">`;
      html += `#${idx + 1} ${escapeHTML(s.whatChanged)}（优先级：${s.priority === 1 ? '高' : '中'}）</div>`;
      html += '<div class="suggestion-body">';

      html += `<div class="suggestion-label">风险说明</div>`;
      html += `<div class="suggestion-text">${escapeHTML(s.whyRisky)}</div>`;

      html += `<div class="suggestion-label">建议方案</div>`;
      html += `<div class="suggestion-text">${escapeHTML(s.counterProposal)}</div>`;

      if (s.suggestedClause) {
        html += `<div class="suggestion-label">建议条款措辞</div>`;
        html += `<div class="suggested-clause">${escapeHTML(s.suggestedClause)}</div>`;
      }

      html += '</div></div>';
    });

    return html;
  }

  /**
   * 构建批注迁移状态HTML
   */
  function buildMigrationStatusHTML(migrationResults) {
    const migrated = migrationResults.filter(r => r.status === 'migrated').length;
    const adjusted = migrationResults.filter(r => r.status === 'adjusted').length;
    const invalidated = migrationResults.filter(r => r.status === 'invalidated').length;

    let html = `<h2 class="section-title">批注迁移状态</h2>`;
    html += `<p style="font-size:13px;color:#666;margin-bottom:12px">
      共 ${migrationResults.length} 条批注：
      <span class="badge badge-added">${migrated} 精确迁移</span>
      <span class="badge badge-modified">${adjusted} 位置调整</span>
      <span class="badge badge-deleted">${invalidated} 已失效</span>
    </p>`;

    html += '<table class="migration-table">';
    html += '<thead><tr><th>批注内容</th><th>风险类型</th><th>迁移状态</th><th>说明</th></tr></thead>';
    html += '<tbody>';

    migrationResults.forEach(r => {
      const ann = r.annotation;
      const rt = AnnotationManager.RISK_TYPES[ann.riskType];
      const statusLabels = { migrated: '已迁移', adjusted: '已调整', invalidated: '已失效' };
      const statusClass = { migrated: 'badge-added', adjusted: 'badge-modified', invalidated: 'badge-deleted' };

      html += `<tr>
        <td title="${escapeHTML(ann.anchorText)}">${escapeHTML(truncate(ann.anchorText, 30))}</td>
        <td>${rt ? rt.label : '未知'}</td>
        <td><span class="badge ${statusClass[r.status]}">${statusLabels[r.status]}</span></td>
        <td style="font-size:11px;color:#7f8c8d">${escapeHTML(r.reason)}</td>
      </tr>`;
    });

    html += '</tbody></table>';
    return html;
  }

  function formatDate(date) {
    return date.getFullYear() +
      String(date.getMonth() + 1).padStart(2, '0') +
      String(date.getDate()).padStart(2, '0') + '_' +
      String(date.getHours()).padStart(2, '0') +
      String(date.getMinutes()).padStart(2, '0');
  }

  return {
    exportComparisonReport,
    buildSideBySideHTML,
    buildChangeSummaryHTML,
    buildSuggestionHTML,
    buildMigrationStatusHTML
  };
})();
