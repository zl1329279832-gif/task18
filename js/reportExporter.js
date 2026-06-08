/**
 * reportExporter.js - 报告导出模块
 * 导出带批注的 HTML 报告、保存/恢复项目
 */
const ReportExporter = (() => {
  const RISK_TYPE_LABELS = {
    payment: '付款条款', breach: '违约责任', confidential: '保密义务',
    delivery: '交付期限', dispute: '争议解决', entity: '主体信息缺失',
  };
  const LEVEL_LABELS = { high: '高风险', medium: '中风险', low: '低风险' };
  const STATUS_LABELS = { pending: '待处理', processing: '处理中', resolved: '已解决', closed: '已关闭' };
  const LEVEL_COLORS = { high: '#ef4444', medium: '#f59e0b', low: '#3b82f6' };
  const RISK_COLORS = {
    payment: '#e74c3c', breach: '#e67e22', confidential: '#9b59b6',
    delivery: '#2ecc71', dispute: '#3498db', entity: '#f39c12',
  };

  /**
   * 导出带批注的 HTML 报告
   */
  function exportHtmlReport(sections, annotations, fileName) {
    const stats = RiskAnalytics.computeStats(annotations);
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>合同评审报告 - ${_esc(fileName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1e293b; padding: 40px; max-width: 900px; margin: 0 auto; line-height: 1.8; }
  h1 { font-size: 22px; border-bottom: 3px solid #3b82f6; padding-bottom: 8px; margin-bottom: 20px; }
  h2 { font-size: 18px; margin: 24px 0 12px; color: #334155; }
  h3 { font-size: 15px; margin: 16px 0 8px; color: #475569; }
  .meta { color: #64748b; font-size: 13px; margin-bottom: 24px; }
  .summary { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
  .summary-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 20px; text-align: center; flex: 1; min-width: 100px; }
  .summary-box .num { font-size: 24px; font-weight: 700; }
  .summary-box .label { font-size: 12px; color: #64748b; }
  .section { margin-bottom: 20px; }
  .clause { margin-bottom: 6px; padding: 4px 8px; }
  .highlight { border-radius: 2px; padding: 1px 2px; }
  .ann-note { background: #fffbeb; border-left: 3px solid #f59e0b; padding: 8px 12px; margin: 4px 0 8px 16px; font-size: 13px; border-radius: 0 4px 4px 0; }
  .ann-tag { display: inline-block; padding: 1px 6px; border-radius: 8px; font-size: 11px; font-weight: 600; margin-right: 4px; }
  .risk-list { margin-top: 20px; }
  .risk-item { padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 2px solid #e2e8f0; color: #94a3b8; font-size: 12px; text-align: center; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>
<h1>合同评审报告</h1>
<div class="meta">
  <p>文件: ${_esc(fileName)} &nbsp;|&nbsp; 导出时间: ${dateStr}</p>
  <p>风险标注数: ${stats.total} &nbsp;|&nbsp; 高风险: ${stats.byLevel.high} &nbsp;|&nbsp; 中风险: ${stats.byLevel.medium} &nbsp;|&nbsp; 低风险: ${stats.byLevel.low}</p>
</div>

<div class="summary">
  <div class="summary-box"><div class="num" style="color:#1e293b">${stats.total}</div><div class="label">风险总数</div></div>
  <div class="summary-box"><div class="num" style="color:#ef4444">${stats.byLevel.high}</div><div class="label">高风险</div></div>
  <div class="summary-box"><div class="num" style="color:#f59e0b">${stats.byLevel.medium}</div><div class="label">中风险</div></div>
  <div class="summary-box"><div class="num" style="color:#3b82f6">${stats.byLevel.low}</div><div class="label">低风险</div></div>
</div>

<h2>合同正文（含批注标注）</h2>
`;

    // 按章节渲染
    sections.forEach(section => {
      if (!section.isDefault) {
        html += `<h3>${_esc(section.title)}</h3>\n`;
      }

      section.paragraphs.forEach(para => {
        const paraAnnotations = annotations
          .filter(a => a.paragraphId === para.id)
          .sort((a, b) => (a.startOffset || 0) - (b.startOffset || 0));

        // 渲染段落文本（含高亮）
        let paraHtml;
        if (paraAnnotations.length > 0) {
          paraHtml = _buildAnnotatedText(para.text, paraAnnotations);
        } else {
          paraHtml = _esc(para.text);
        }

        html += `<div class="clause">${paraHtml}</div>\n`;

        // 在段落下方输出批注
        paraAnnotations.forEach(a => {
          const color = RISK_COLORS[a.riskType] || '#666';
          const levelColor = LEVEL_COLORS[a.riskLevel] || '#666';
          html += `<div class="ann-note">
  <span class="ann-tag" style="background:${color}22;color:${color}">${RISK_TYPE_LABELS[a.riskType]}</span>
  <span class="ann-tag" style="background:${levelColor}22;color:${levelColor}">${LEVEL_LABELS[a.riskLevel]}</span>
  <span class="ann-tag" style="background:#f1f5f9;color:#64748b">${STATUS_LABELS[a.status]}</span>
  ${a.comment ? ' ' + _esc(a.comment) : ''}
</div>\n`;
        });
      });
    });

    // 风险清单
    html += `\n<h2>风险清单</h2>\n<div class="risk-list">\n`;
    const sortedAnnotations = [...annotations].sort((a, b) => {
      const levelPriority = { high: 0, medium: 1, low: 2 };
      return (levelPriority[a.riskLevel] || 9) - (levelPriority[b.riskLevel] || 9);
    });

    sortedAnnotations.forEach((a, i) => {
      html += `<div class="risk-item">
  <strong>${i + 1}.</strong>
  <span class="ann-tag" style="background:${LEVEL_COLORS[a.riskLevel]}22;color:${LEVEL_COLORS[a.riskLevel]}">${LEVEL_LABELS[a.riskLevel]}</span>
  <span class="ann-tag" style="background:${RISK_COLORS[a.riskType]}22;color:${RISK_COLORS[a.riskType]}">${RISK_TYPE_LABELS[a.riskType]}</span>
  「${_esc(a.textSnippet)}」 ${a.comment ? '— ' + _esc(a.comment) : ''}
  <span style="color:#94a3b8;font-size:11px">[${STATUS_LABELS[a.status]}]</span>
</div>\n`;
    });

    if (annotations.length === 0) {
      html += '<p style="color:#94a3b8;text-align:center;padding:20px">暂无风险标注</p>\n';
    }

    html += `</div>
<div class="footer">本报告由合同评审系统自动生成 · ${dateStr}</div>
</body></html>`;

    _downloadFile(html, `评审报告_${fileName.replace(/\.[^.]+$/, '')}_${_dateFileStr()}.html`, 'text/html');
  }

  /**
   * 构建带标注的文本 HTML
   */
  function _buildAnnotatedText(text, annotations) {
    const sorted = annotations.filter(a => a.startOffset != null && a.endOffset != null);
    if (sorted.length === 0) return _esc(text);

    const segments = [];
    let pos = 0;

    for (const a of sorted) {
      const start = Math.max(a.startOffset, pos);
      const end = Math.min(a.endOffset, text.length);
      if (start >= end) continue;

      if (pos < start) segments.push(_esc(text.slice(pos, start)));

      const color = RISK_COLORS[a.riskType] || '#fde047';
      segments.push(`<span class="highlight" style="background:${color}30;border-bottom:2px solid ${color}">${_esc(text.slice(start, end))}</span>`);
      pos = end;
    }

    if (pos < text.length) segments.push(_esc(text.slice(pos)));
    return segments.join('');
  }

  /**
   * 保存项目为 JSON 文件（供恢复用）
   */
  function saveProject(contractData, sections, reviewData, fileName) {
    const project = {
      version: 1,
      savedAt: Date.now(),
      fileName: fileName,
      contract: {
        rawText: contractData.rawText || contractData.content,
        format: contractData.format,
      },
      sections: sections.map(s => ({
        id: s.id,
        title: s.title,
        depth: s.depth,
        isDefault: s.isDefault || false,
        paragraphs: s.paragraphs.map(p => ({
          id: p.id,
          text: p.text,
          lineIndex: p.lineIndex,
          sectionId: p.sectionId,
        })),
      })),
      annotations: reviewData.annotations,
      history: reviewData.history,
      contractHash: reviewData.contractHash,
    };

    const json = JSON.stringify(project, null, 2);
    _downloadFile(json, `评审项目_${fileName.replace(/\.[^.]+$/, '')}_${_dateFileStr()}.json`, 'application/json');
  }

  /**
   * 从 JSON 恢复项目
   */
  function loadProject(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('未选择文件'));
        return;
      }

      const ext = file.name.split('.').pop().toLowerCase();
      if (ext !== 'json') {
        reject(new Error('请选择 .json 格式的项目文件'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const project = JSON.parse(e.target.result);

          if (!project.version || !project.contract || !project.sections) {
            reject(new Error('无效的项目文件格式'));
            return;
          }

          resolve(project);
        } catch (err) {
          reject(new Error('项目文件解析失败: ' + err.message));
        }
      };

      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  /**
   * 导出评审清单为 HTML
   */
  function exportChecklist(checklistHtml, fileName) {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>评审清单 - ${_esc(fileName)}</title>
<style>
  * { box-sizing: border-box; } body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; padding: 30px; max-width: 800px; margin: 0 auto; color: #1e293b; }
  h1 { font-size: 20px; margin-bottom: 20px; border-bottom: 2px solid #3b82f6; padding-bottom: 8px; }
  h4 { margin: 16px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e2e8f0; }
  .checklist-item { display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; border-bottom: 1px solid #f8fafc; }
  .checklist-level { padding: 1px 6px; border-radius: 8px; font-size: 10px; font-weight: 600; flex-shrink: 0; }
  strong { font-weight: 600; }
  .footer { margin-top: 30px; text-align: center; color: #94a3b8; font-size: 12px; }
</style>
</head>
<body>
<h1>评审清单 · ${_esc(fileName)}</h1>
${checklistHtml}
<div class="footer">生成于 ${dateStr} · 合同评审系统</div>
</body></html>`;

    _downloadFile(html, `评审清单_${fileName.replace(/\.[^.]+$/, '')}_${_dateFileStr()}.html`, 'text/html');
  }

  // === Helpers ===

  function _downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function _esc(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function _dateFileStr() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  }

  return {
    exportHtmlReport,
    saveProject,
    loadProject,
    exportChecklist,
  };
})();
