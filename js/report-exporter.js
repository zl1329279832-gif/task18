/**
 * report-exporter.js - 报告导出模块
 * 负责带批注HTML报告生成、localStorage存取、完整状态序列化
 */
const ReportExporter = (() => {
  const STORAGE_KEY = 'contract_review_data';
  const MAX_LOCAL_STORAGE_SIZE = 5 * 1024 * 1024; // 5MB

  /**
   * 导出带批注的 HTML 报告
   */
  function exportReport(sections, annotations, stats) {
    const now = new Date();
    const dateStr = now.toLocaleString('zh-CN');

    let reportHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>合同评审报告 - ${dateStr}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; line-height: 1.8; color: #333; padding: 40px; max-width: 900px; margin: 0 auto; }
  .report-header { text-align: center; border-bottom: 3px solid #2c3e50; padding-bottom: 20px; margin-bottom: 30px; }
  .report-header h1 { font-size: 24px; color: #2c3e50; }
  .report-header .meta { color: #7f8c8d; font-size: 14px; margin-top: 8px; }
  .summary { background: #f8f9fa; border-radius: 8px; padding: 20px; margin-bottom: 30px; }
  .summary h2 { font-size: 18px; margin-bottom: 12px; color: #2c3e50; }
  .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .summary-item { background: #fff; padding: 12px; border-radius: 6px; text-align: center; border: 1px solid #eee; }
  .summary-item .num { font-size: 28px; font-weight: bold; }
  .summary-item .label { font-size: 12px; color: #999; }
  .section { margin-bottom: 30px; page-break-inside: avoid; }
  .section h2 { font-size: 18px; color: #2c3e50; border-left: 4px solid #3498db; padding-left: 12px; margin-bottom: 16px; }
  .paragraph { margin-bottom: 12px; text-indent: 2em; }
  .annotation-highlight { padding: 2px 4px; border-radius: 3px; font-weight: 500; }
  .annotation-note { display: block; margin: 4px 0 8px 2em; padding: 8px 12px; background: #fff3cd; border-left: 3px solid #f39c12; border-radius: 0 4px 4px 0; font-size: 13px; }
  .annotation-note .risk-tag { display: inline-block; padding: 1px 6px; border-radius: 3px; color: #fff; font-size: 11px; margin-right: 6px; }
  .annotation-note .status-tag { display: inline-block; padding: 1px 6px; border-radius: 3px; color: #fff; font-size: 11px; }
  .checklist-section { margin-top: 40px; page-break-before: always; }
  .checklist-section h2 { font-size: 20px; color: #2c3e50; border-bottom: 2px solid #2c3e50; padding-bottom: 8px; margin-bottom: 16px; }
  .checklist-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px; }
  .checklist-table th { background: #2c3e50; color: #fff; padding: 8px 10px; text-align: left; }
  .checklist-table td { padding: 8px 10px; border-bottom: 1px solid #eee; }
  .checklist-table tr:hover { background: #f8f9fa; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; color: #fff; font-size: 11px; }
  .risk-group-title { font-size: 15px; font-weight: bold; margin: 16px 0 8px; padding: 6px 12px; border-radius: 4px; }
  .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #999; font-size: 12px; }
  @media print { body { padding: 20px; } .section { page-break-inside: avoid; } }
</style>
</head>
<body>
<div class="report-header">
  <h1>合同评审报告</h1>
  <div class="meta">生成时间：${dateStr} | 批注总数：${annotations.length} 条</div>
</div>`;

    // 统计摘要
    const highCount = annotations.filter(a => a.riskLevel === 'high').length;
    const mediumCount = annotations.filter(a => a.riskLevel === 'medium').length;
    const lowCount = annotations.filter(a => a.riskLevel === 'low').length;

    reportHTML += `
<div class="summary">
  <h2>风险概览</h2>
  <div class="summary-grid">
    <div class="summary-item"><div class="num" style="color:#e74c3c">${highCount}</div><div class="label">高风险</div></div>
    <div class="summary-item"><div class="num" style="color:#f39c12">${mediumCount}</div><div class="label">中风险</div></div>
    <div class="summary-item"><div class="num" style="color:#27ae60">${lowCount}</div><div class="label">低风险</div></div>
  </div>
</div>`;

    // 合同正文（带批注）
    sections.forEach(section => {
      reportHTML += `<div class="section">
        <h2>${escapeHTML(section.title)}</h2>`;

      section.paragraphs.forEach(para => {
        const paraAnns = annotations.filter(a =>
          a.sectionId === section.id && a.paragraphIndex === para.index
        ).sort((a, b) => a.startOffset - b.startOffset);

        let paraHTML = '<div class="paragraph">';
        if (paraAnns.length > 0) {
          paraHTML += buildAnnotatedText(para.text, paraAnns);
          // 添加批注详情
          paraAnns.forEach(ann => {
            const rt = AnnotationManager.RISK_TYPES[ann.riskType];
            const st = AnnotationManager.STATUS_FLOW[ann.status];
            const rl = AnnotationManager.RISK_LEVELS[ann.riskLevel];
            paraHTML += `<div class="annotation-note">
              <span class="risk-tag" style="background:${rt.color}">${rt.label}</span>
              <span class="status-tag" style="background:${st.color}">${st.label}</span>
              <span class="risk-tag" style="background:${rl.color}">${rl.label}</span>
              ${escapeHTML(ann.comment || '无批注说明')}
            </div>`;
          });
        } else {
          paraHTML += escapeHTML(para.text);
        }
        paraHTML += '</div>';
        reportHTML += paraHTML;
      });

      reportHTML += '</div>';
    });

    // 评审清单
    reportHTML += `<div class="checklist-section">
      <h2>评审清单</h2>`;

    // 按风险类型分组
    const grouped = {};
    annotations.forEach(ann => {
      if (!grouped[ann.riskType]) grouped[ann.riskType] = [];
      grouped[ann.riskType].push(ann);
    });

    Object.keys(AnnotationManager.RISK_TYPES).forEach(type => {
      const items = grouped[type];
      if (!items || items.length === 0) return;
      const rt = AnnotationManager.RISK_TYPES[type];

      reportHTML += `<div class="risk-group-title" style="background:${rt.color}15;color:${rt.color}">${rt.icon} ${rt.label} (${items.length}条)</div>
        <table class="checklist-table">
          <thead><tr><th>等级</th><th>章节</th><th>条款内容</th><th>批注说明</th><th>状态</th></tr></thead>
          <tbody>`;

      items.forEach(ann => {
        const section = sections.find(s => s.id === ann.sectionId);
        const st = AnnotationManager.STATUS_FLOW[ann.status];
        const rl = AnnotationManager.RISK_LEVELS[ann.riskLevel];
        reportHTML += `<tr>
          <td><span class="badge" style="background:${rl.color}">${rl.label}</span></td>
          <td>${escapeHTML(section ? section.title : '未知')}</td>
          <td>${escapeHTML(truncate(ann.anchorText, 40))}</td>
          <td>${escapeHTML(ann.comment || '无')}</td>
          <td><span class="badge" style="background:${st.color}">${st.label}</span></td>
        </tr>`;
      });

      reportHTML += '</tbody></table>';
    });

    reportHTML += '</div>';

    // 页脚
    reportHTML += `<div class="footer">
      <p>本报告由合同评审系统自动生成 | ${dateStr}</p>
    </div></body></html>`;

    // 触发下载
    downloadBlob(reportHTML, `合同评审报告_${formatDate(now)}.html`, 'text/html');
  }

  /**
   * 构建带标注内联的文本HTML
   */
  function buildAnnotatedText(text, annotations) {
    let result = '';
    let lastEnd = 0;

    annotations.forEach(ann => {
      if (ann.startOffset < lastEnd) return;
      if (ann.startOffset > lastEnd) {
        result += escapeHTML(text.substring(lastEnd, ann.startOffset));
      }
      const rt = AnnotationManager.RISK_TYPES[ann.riskType];
      const highlighted = escapeHTML(text.substring(ann.startOffset, ann.endOffset));
      result += `<span class="annotation-highlight" style="background-color:${rt.color}20;border-bottom:2px solid ${rt.color}">${highlighted}</span>`;
      lastEnd = ann.endOffset;
    });

    if (lastEnd < text.length) {
      result += escapeHTML(text.substring(lastEnd));
    }
    return result;
  }

  /**
   * 保存项目状态到 localStorage
   */
  function saveToLocal(data) {
    try {
      const serialized = JSON.stringify(data);
      // 检查大小
      if (serialized.length > MAX_LOCAL_STORAGE_SIZE) {
        throw new Error(`数据过大 (${(serialized.length / 1024).toFixed(0)}KB)，超出 localStorage 限制`);
      }
      localStorage.setItem(STORAGE_KEY, serialized);
      localStorage.setItem(STORAGE_KEY + '_time', new Date().toISOString());
      return { success: true, size: serialized.length };
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        return { success: false, error: '存储空间不足，请清理浏览器数据后重试' };
      }
      return { success: false, error: e.message };
    }
  }

  /**
   * 从 localStorage 加载项目状态
   */
  function loadFromLocal() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) return null;
      const parsed = JSON.parse(data);
      const savedTime = localStorage.getItem(STORAGE_KEY + '_time');
      return { data: parsed, savedTime };
    } catch (e) {
      console.error('localStorage 读取失败:', e);
      return null;
    }
  }

  /**
   * 清除 localStorage 中的数据
   */
  function clearLocal() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY + '_time');
  }

  /**
   * 导出项目状态（完整序列化）
   */
  function exportProjectState(sections, annotations, contractTitle) {
    return {
      version: '1.0',
      contractTitle: contractTitle || '未命名合同',
      sections: sections,
      annotations: annotations,
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * 导入项目状态
   */
  function importProjectState(stateData) {
    if (!stateData || !stateData.sections || !stateData.annotations) {
      throw new Error('无效的项目数据格式');
    }
    if (stateData.version !== '1.0') {
      console.warn('项目数据版本不匹配，尝试兼容加载');
    }
    return {
      sections: stateData.sections,
      annotations: stateData.annotations,
      contractTitle: stateData.contractTitle || '未命名合同'
    };
  }

  /**
   * 下载 Blob
   */
  function downloadBlob(content, filename, mimeType) {
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

  /**
   * 导出项目文件（JSON）
   */
  function exportProjectFile(sections, annotations, contractTitle) {
    const state = exportProjectState(sections, annotations, contractTitle);
    const json = JSON.stringify(state, null, 2);
    downloadBlob(json, `合同评审_${formatDate(new Date())}.json`, 'application/json');
  }

  /**
   * 从项目文件导入
   */
  function importProjectFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new window.FileReader();
      reader.onload = (e) => {
        try {
          const state = JSON.parse(e.target.result);
          resolve(importProjectState(state));
        } catch (err) {
          reject(new Error('项目文件格式错误: ' + err.message));
        }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file);
    });
  }

  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
  }

  function formatDate(date) {
    return date.getFullYear() +
      String(date.getMonth()+1).padStart(2,'0') +
      String(date.getDate()).padStart(2,'0') + '_' +
      String(date.getHours()).padStart(2,'0') +
      String(date.getMinutes()).padStart(2,'0');
  }

  return {
    exportReport, saveToLocal, loadFromLocal, clearLocal,
    exportProjectState, importProjectState,
    exportProjectFile, importProjectFile
  };
})();
