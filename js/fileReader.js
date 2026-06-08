/**
 * fileReader.js - 文件读取模块
 * 使用 File API 导入 txt/HTML 格式合同文本
 * 处理编码、格式异常、大文件等问题
 */
const ContractFileReader = (() => {
  const SUPPORTED_TYPES = {
    'text/plain': 'txt',
    'text/html': 'html',
    'application/xhtml+xml': 'html',
  };
  const SUPPORTED_EXTENSIONS = ['.txt', '.html', '.htm'];
  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

  /**
   * 验证文件是否可接受
   */
  function validateFile(file) {
    if (!file) {
      return { valid: false, error: '未选择文件' };
    }

    const ext = _getExtension(file.name);
    const typeOk = SUPPORTED_TYPES[file.type];
    const extOk = SUPPORTED_EXTENSIONS.includes(ext);

    if (!typeOk && !extOk) {
      return { valid: false, error: `不支持的文件格式「${ext || file.type}」，请选择 .txt 或 .html 文件` };
    }

    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = (file.size / 1024 / 1024).toFixed(1);
      return { valid: false, error: `文件过大（${sizeMB}MB），请控制在 20MB 以内` };
    }

    if (file.size === 0) {
      return { valid: false, error: '文件内容为空' };
    }

    return { valid: true, format: typeOk || (ext === '.htm' || ext === '.html' ? 'html' : 'txt') };
  }

  /**
   * 读取文件内容（返回 Promise）
   */
  function readFile(file) {
    return new Promise((resolve, reject) => {
      const validation = validateFile(file);
      if (!validation.valid) {
        reject(new Error(validation.error));
        return;
      }

      const reader = new FileReader();

      reader.onload = (e) => {
        let content = e.target.result;
        if (!content || !content.trim()) {
          reject(new Error('文件内容为空'));
          return;
        }

        // 清理内容
        content = _sanitizeContent(content, validation.format);

        resolve({
          fileName: file.name,
          format: validation.format,
          content: content,
          size: file.size,
          lastModified: file.lastModified,
        });
      };

      reader.onerror = () => {
        reject(new Error('文件读取失败，请重试'));
      };

      // 尝试 UTF-8 读取
      reader.readAsText(file, 'UTF-8');
    });
  }

  /**
   * 清理和规范化文件内容
   */
  function _sanitizeContent(content, format) {
    if (format === 'html') {
      return _sanitizeHtml(content);
    }
    // txt: 统一换行符，去除多余空行
    content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // 去除连续超过3个空行
    content = content.replace(/\n{4,}/g, '\n\n\n');
    return content.trim();
  }

  /**
   * 清理 HTML 内容，提取正文
   */
  function _sanitizeHtml(html) {
    // 移除 script/style 标签及内容
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
    html = html.replace(/<link[^>]*>/gi, '');
    html = html.replace(/<meta[^>]*>/gi, '');

    // 提取 body 内容
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      html = bodyMatch[1];
    }

    // 将 HTML 转为纯文本+保留段落结构
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    // 提取结构化文本
    return _extractTextFromHtml(tempDiv);
  }

  /**
   * 从 HTML DOM 提取保留结构的文本
   */
  function _extractTextFromHtml(element) {
    const lines = [];

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text) lines.push(text);
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toLowerCase();
      const blockTags = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'br', 'hr', 'section', 'article'];

      if (tag === 'br' || tag === 'hr') {
        lines.push('');
        return;
      }

      if (blockTags.includes(tag)) {
        // 处理标题标签 - 保留文本
        const text = node.textContent.trim();
        if (text) {
          lines.push(text);
          lines.push(''); // 块元素后加空行
        }
      } else {
        // 内联元素，递归子节点
        for (const child of node.childNodes) {
          walk(child);
        }
      }
    }

    for (const child of element.childNodes) {
      walk(child);
    }

    // 清理空行
    let result = lines.join('\n');
    result = result.replace(/\n{3,}/g, '\n\n');
    return result.trim();
  }

  /**
   * 获取文件扩展名
   */
  function _getExtension(filename) {
    const idx = filename.lastIndexOf('.');
    return idx >= 0 ? filename.slice(idx).toLowerCase() : '';
  }

  // Public API
  return {
    validateFile,
    readFile,
    SUPPORTED_EXTENSIONS,
    MAX_FILE_SIZE,
  };
})();
