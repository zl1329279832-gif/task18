/**
 * textParser.js - 文本解析模块
 * 解析合同文本，识别章节结构
 * 处理多种章节格式和识别失败的情况
 */
const ContractTextParser = (() => {
  // 章节标题正则模式（按优先级排序）
  const HEADING_PATTERNS = [
    // 第X章 / 第X编
    { regex: /^第[一二三四五六七八九十百千\d]+[章编]\s*.+/,    depth: 1 },
    // 第X节
    { regex: /^第[一二三四五六七八九十百千\d]+节\s*.+/,       depth: 2 },
    // 第X条
    { regex: /^第[一二三四五六七八九十百千\d]+条\s*.+/,       depth: 2 },
    // 一、二、…（顶级中文数字序号）
    { regex: /^[一二三四五六七八九十]+[、.．]\s*.+/,          depth: 1 },
    // (一)（一）编号
    { regex: /^[（(][一二三四五六七八九十]+[)）]\s*.+/,       depth: 2 },
    // 1. 2. 3. 或 1、2、 （阿拉伯数字顶级）
    { regex: /^\d{1,2}[、.．]\s*.{2,}/,                       depth: 1 },
    // 1.1 / 1.2 子编号
    { regex: /^\d{1,2}\.\d{1,2}\s*.+/,                        depth: 2 },
    // 1.1.1 三级编号
    { regex: /^\d{1,2}\.\d{1,2}\.\d{1,2}\s*.+/,               depth: 3 },
    // 大写标题行（不超过 30 字，全是中文/数字/空格/标点）
    { regex: /^[A-Z\u4e00-\u9fff][\u4e00-\u9fff\w\s，、：:（）()]{2,28}$/,  depth: 1, loose: true },
  ];

  /**
   * 解析合同文本，返回章节结构
   * @param {string} text 合同原始文本
   * @returns {{ sections: Array, rawText: string }}
   */
  function parse(text) {
    if (!text || !text.trim()) {
      return { sections: [], rawText: '' };
    }

    text = text.trim();
    const lines = text.split('\n');
    const sections = [];
    let currentSection = null;
    let paragraphId = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // 跳过空行（在段落间作为分隔）
      if (!trimmed) {
        if (currentSection && currentSection.paragraphs.length > 0) {
          // 标记最后一个段落后有空行
          const lastP = currentSection.paragraphs[currentSection.paragraphs.length - 1];
          lastP.trailingBlank = true;
        }
        continue;
      }

      // 检测是否是标题行
      const heading = _detectHeading(trimmed, lines, i);

      if (heading) {
        currentSection = {
          id: 'section-' + sections.length,
          title: trimmed,
          depth: heading.depth,
          lineIndex: i,
          paragraphs: [],
        };
        sections.push(currentSection);
      } else {
        // 普通段落
        if (!currentSection) {
          // 没有章节头，创建一个默认章节
          currentSection = {
            id: 'section-0',
            title: '合同正文',
            depth: 1,
            lineIndex: 0,
            paragraphs: [],
            isDefault: true,
          };
          sections.push(currentSection);
        }

        currentSection.paragraphs.push({
          id: 'p-' + (paragraphId++),
          text: trimmed,
          lineIndex: i,
          sectionId: currentSection.id,
          trailingBlank: false,
        });
      }
    }

    // 如果完全没有识别到章节，对全文做自动分段
    if (sections.length === 0) {
      sections.push({
        id: 'section-0',
        title: '合同正文',
        depth: 1,
        lineIndex: 0,
        paragraphs: [],
        isDefault: true,
      });
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed) {
          sections[0].paragraphs.push({
            id: 'p-' + (paragraphId++),
            text: trimmed,
            lineIndex: i,
            sectionId: 'section-0',
            trailingBlank: false,
          });
        }
      }
    }

    // 合并过短的连续段落（可能是断行造成的）
    for (const section of sections) {
      section.paragraphs = _mergeBrokenParagraphs(section.paragraphs);
    }

    // 删除没有段落的空章节（保留至少一个）
    const filtered = sections.filter(s => s.paragraphs.length > 0 || s === sections[0]);

    return {
      sections: filtered.length > 0 ? filtered : sections,
      rawText: text,
    };
  }

  /**
   * 检测一行文本是否是章节标题
   */
  function _detectHeading(line, allLines, lineIndex) {
    // 标题不应该太长
    if (line.length > 60) return null;

    for (const pattern of HEADING_PATTERNS) {
      if (pattern.regex.test(line)) {
        // 宽松模式的标题需额外验证
        if (pattern.loose) {
          if (!_isLikelyHeading(line, allLines, lineIndex)) continue;
        }
        return { depth: pattern.depth };
      }
    }
    return null;
  }

  /**
   * 进一步验证宽松匹配的标题
   */
  function _isLikelyHeading(line, allLines, lineIndex) {
    // 标题通常较短
    if (line.length > 25) return false;
    // 标题前后通常有空行
    const prevEmpty = lineIndex === 0 || !allLines[lineIndex - 1].trim();
    const nextEmpty = lineIndex === allLines.length - 1 || !allLines[lineIndex + 1].trim();
    if (!prevEmpty && !nextEmpty) return false;
    // 标题不应包含句号等
    if (/[。；;,，]/.test(line)) return false;
    return true;
  }

  /**
   * 合并断行造成的过短段落
   */
  function _mergeBrokenParagraphs(paragraphs) {
    if (paragraphs.length <= 1) return paragraphs;

    const merged = [];
    let buffer = null;

    for (const p of paragraphs) {
      if (!buffer) {
        buffer = { ...p };
        continue;
      }

      // 如果上一段没有正常结束（没有句号等标点），且较短，则合并
      const prevEndsNormally = /[。！？；;.!?》）)"]$/.test(buffer.text);
      const prevIsShort = buffer.text.length < 20;

      if (!prevEndsNormally && prevIsShort && !buffer.trailingBlank) {
        buffer.text += p.text;
      } else {
        merged.push(buffer);
        buffer = { ...p };
      }
    }

    if (buffer) merged.push(buffer);
    return merged;
  }

  /**
   * 在段落文本中定位偏移（用于恢复批注位置）
   * 基于段落ID + 文本内容哈希匹配
   */
  function locateParagraph(sections, paragraphId, textSnippet) {
    // 先精确匹配 ID
    for (const section of sections) {
      for (const p of section.paragraphs) {
        if (p.id === paragraphId) return p;
      }
    }

    // ID 匹配失败，用文本内容模糊匹配
    if (textSnippet) {
      const snippet = textSnippet.slice(0, 40);
      for (const section of sections) {
        for (const p of section.paragraphs) {
          if (p.text.includes(snippet)) return p;
        }
      }
    }

    return null;
  }

  /**
   * 计算简单文本哈希（用于比对段落变化）
   */
  function hashText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return hash;
  }

  return {
    parse,
    locateParagraph,
    hashText,
  };
})();
