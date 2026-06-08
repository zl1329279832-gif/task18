/**
 * file-reader.js - 文件读取模块
 * 负责 txt/html 文件导入、编码检测、格式校验、HTML净化
 */
const FileReader = (() => {
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const ALLOWED_TYPES = ['text/plain', 'text/html', 'application/xhtml+xml'];
  const ALLOWED_EXTENSIONS = ['.txt', '.html', '.htm'];

  // 允许的HTML标签白名单
  const HTML_WHITELIST = [
    'h1','h2','h3','h4','h5','h6','p','div','span','br','hr',
    'strong','em','b','i','u','ul','ol','li','table','thead',
    'tbody','tr','th','td','blockquote','pre','code','a'
  ];

  // 危险标签
  const DANGEROUS_TAGS = ['script','iframe','object','embed','form','input','button','style','link','meta'];

  /**
   * 检测文件编码（简易BOM检测）
   */
  function detectEncoding(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return 'utf-8';
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return 'utf-16le';
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return 'utf-16be';
    return 'utf-8'; // 默认
  }

  /**
   * 去除BOM头
   */
  function stripBOM(text) {
    if (text.charCodeAt(0) === 0xFEFF) {
      return text.slice(1);
    }
    return text;
  }

  /**
   * 从文件名获取扩展名
   */
  function getExtension(filename) {
    const idx = filename.lastIndexOf('.');
    return idx >= 0 ? filename.substring(idx).toLowerCase() : '';
  }

  /**
   * 校验文件
   */
  function validateFile(file) {
    if (!file) {
      return { valid: false, error: '未选择文件' };
    }
    const ext = getExtension(file.name);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return { valid: false, error: `不支持的文件格式: ${ext}。仅支持 .txt, .html, .htm` };
    }
    if (file.size === 0) {
      return { valid: false, error: '文件内容为空' };
    }
    if (file.size > MAX_FILE_SIZE) {
      return { valid: false, error: `文件过大 (${(file.size / 1024 / 1024).toFixed(1)}MB)，最大支持 10MB` };
    }
    return { valid: true };
  }

  /**
   * 净化HTML - 移除危险标签和属性
   */
  function sanitizeHTML(html) {
    // 移除script/style等危险标签及其内容
    let cleaned = html;
    DANGEROUS_TAGS.forEach(tag => {
      const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
      cleaned = cleaned.replace(regex, '');
      // 也移除自闭合标签
      const selfClose = new RegExp(`<${tag}[^>]*\\/?>`, 'gi');
      cleaned = cleaned.replace(selfClose, '');
    });

    // 移除on*事件属性
    cleaned = cleaned.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
    cleaned = cleaned.replace(/\s+on\w+\s*=\s*[^\s>]*/gi, '');

    // 移除javascript:协议
    cleaned = cleaned.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');

    // 将非白名单标签替换为span（保留内容）
    cleaned = cleaned.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (match, tag) => {
      const lower = tag.toLowerCase();
      if (HTML_WHITELIST.includes(lower)) {
        // 对白名单标签也移除危险属性
        if (match.startsWith('</')) return match;
        return match.replace(/\s+(style|class|id)\s*=\s*["'][^"']*["']/gi, '');
      }
      // 非白名单：转为span或移除
      if (match.startsWith('</')) return '</span>';
      return '<span>';
    });

    return cleaned;
  }

  /**
   * 从HTML中提取纯文本（保留段落结构）
   */
  function htmlToText(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    // 将块级元素转为换行
    const blocks = div.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, tr, br, hr');
    blocks.forEach(el => {
      el.parentNode.insertBefore(document.createTextNode('\n'), el);
    });
    return div.textContent || div.innerText || '';
  }

  /**
   * 读取文件
   * @param {File} file
   * @returns {Promise<{content: string, type: string, encoding: string, rawHTML?: string}>}
   */
  function readFile(file) {
    return new Promise((resolve, reject) => {
      const validation = validateFile(file);
      if (!validation.valid) {
        reject(new Error(validation.error));
        return;
      }

      const ext = getExtension(file.name);
      const reader = new window.FileReader();

      reader.onload = (e) => {
        try {
          let content = stripBOM(e.target.result);

          if (!content || content.trim().length === 0) {
            reject(new Error('文件内容为空，无法解析'));
            return;
          }

          if (ext === '.html' || ext === '.htm') {
            const sanitized = sanitizeHTML(content);
            const textContent = htmlToText(sanitized);
            if (!textContent.trim()) {
              reject(new Error('HTML文件中未找到有效文本内容'));
              return;
            }
            resolve({
              content: textContent,
              type: 'html',
              encoding: 'utf-8',
              rawHTML: sanitized
            });
          } else {
            resolve({
              content: content,
              type: 'txt',
              encoding: detectEncoding(content)
            });
          }
        } catch (err) {
          reject(new Error('文件解析失败: ' + err.message));
        }
      };

      reader.onerror = () => {
        reject(new Error('文件读取失败，请重试'));
      };

      reader.readAsText(file, 'utf-8');
    });
  }

  return { readFile, validateFile, sanitizeHTML, htmlToText };
})();
