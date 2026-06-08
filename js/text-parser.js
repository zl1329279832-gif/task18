/**
 * text-parser.js - 文本解析模块
 * 负责章节识别（多级正则匹配）、段落规范化、失败降级
 */
const TextParser = (() => {
  // 章节标题识别正则（按优先级）
  const SECTION_PATTERNS = [
    { level: 1, regex: /^(第[一二三四五六七八九十百千零〇]+章)\s*(.*)/, type: 'chapter' },
    { level: 2, regex: /^(第[一二三四五六七八九十百千零〇]+节)\s*(.*)/, type: 'section' },
    { level: 2, regex: /^(第[一二三四五六七八九十百千零〇]+条)\s*(.*)/, type: 'article' },
    { level: 3, regex: /^(\d+\.\d+\.\d+)\s*(.*)/, type: 'sub-number' },
    { level: 2, regex: /^(\d+\.\d+)\s*(.*)/, type: 'number' },
    { level: 2, regex: /^([（(][一二三四五六七八九十百千]+[）)])\s*(.*)/, type: 'chinese-num' },
    { level: 2, regex: /^([（(]\d+[）)])\s*(.*)/, type: 'paren-num' },
    { level: 3, regex: /^(第[一二三四五六七八九十百千零〇]+款)\s*(.*)/, type: 'clause' },
  ];

  // 降级：按段落数分组
  const FALLBACK_PARAGRAPHS_PER_SECTION = 10;

  /**
   * 判断一行是否为章节标题
   */
  function detectSectionHeader(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 100) return null; // 过长不太可能是标题

    for (const pattern of SECTION_PATTERNS) {
      const match = trimmed.match(pattern.regex);
      if (match) {
        return {
          level: pattern.level,
          type: pattern.type,
          number: match[1],
          title: match[2] ? `${match[1]} ${match[2]}`.trim() : match[1],
          fullMatch: trimmed
        };
      }
    }
    return null;
  }

  /**
   * 生成稳定的章节ID
   */
  function generateSectionId(index, title) {
    const slug = title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').substring(0, 30);
    return `section_${index}_${slug}`;
  }

  /**
   * 解析合同文本为章节结构
   * @param {string} text - 合同全文
   * @param {string} type - 'txt' 或 'html'
   * @returns {Section[]}
   */
  function parseSections(text, type = 'txt') {
    // 统一换行符
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');

    // 第一遍扫描：识别所有章节标题行
    const headerLines = [];
    for (let i = 0; i < lines.length; i++) {
      const header = detectSectionHeader(lines[i]);
      if (header) {
        headerLines.push({ lineIndex: i, ...header });
      }
    }

    // 如果识别到足够的章节（至少2个），使用章节分组
    if (headerLines.length >= 2) {
      return buildSectionsFromHeaders(lines, headerLines);
    }

    // 降级：按段落数硬切分
    return buildSectionsFallback(lines);
  }

  /**
   * 根据识别到的标题行构建章节
   */
  function buildSectionsFromHeaders(lines, headerLines) {
    const sections = [];

    // 处理标题前的内容（前言/序言）
    if (headerLines[0].lineIndex > 0) {
      const preambleLines = lines.slice(0, headerLines[0].lineIndex);
      const preambleText = preambleLines.join('\n').trim();
      if (preambleText) {
        sections.push({
          id: generateSectionId(0, '前言'),
          title: '前言',
          level: 0,
          paragraphs: buildParagraphs(preambleLines),
          type: 'preamble'
        });
      }
    }

    for (let i = 0; i < headerLines.length; i++) {
      const startLine = headerLines[i].lineIndex;
      const endLine = i + 1 < headerLines.length
        ? headerLines[i + 1].lineIndex
        : lines.length;

      const sectionLines = lines.slice(startLine, endLine);
      sections.push({
        id: generateSectionId(sections.length, headerLines[i].title),
        title: headerLines[i].title,
        level: headerLines[i].level,
        paragraphs: buildParagraphs(sectionLines),
        type: headerLines[i].type
      });
    }

    return sections;
  }

  /**
   * 降级：按固定段落数分组
   */
  function buildSectionsFallback(lines) {
    const sections = [];
    // 将所有非空行收集为段落
    const paragraphs = [];
    let currentPara = [];

    for (const line of lines) {
      if (line.trim() === '') {
        if (currentPara.length > 0) {
          paragraphs.push(currentPara.join('\n'));
          currentPara = [];
        }
      } else {
        currentPara.push(line);
      }
    }
    if (currentPara.length > 0) {
      paragraphs.push(currentPara.join('\n'));
    }

    if (paragraphs.length === 0) return sections;

    // 按 FALLBACK_PARAGRAPHS_PER_SECTION 分组
    for (let i = 0; i < paragraphs.length; i += FALLBACK_PARAGRAPHS_PER_SECTION) {
      const chunk = paragraphs.slice(i, i + FALLBACK_PARAGRAPHS_PER_SECTION);
      const sectionNum = Math.floor(i / FALLBACK_PARAGRAPHS_PER_SECTION) + 1;
      const title = `段落组 ${sectionNum}`;
      sections.push({
        id: generateSectionId(sections.length, title),
        title: title,
        level: 1,
        paragraphs: chunk.map((text, idx) => ({
          index: idx,
          text: text.trim(),
          charOffset: 0 // 后续计算
        })),
        type: 'fallback'
      });
    }

    return sections;
  }

  /**
   * 从行数组构建段落数组
   */
  function buildParagraphs(lines) {
    const paragraphs = [];
    let currentPara = [];
    let charOffset = 0;

    for (const line of lines) {
      if (line.trim() === '') {
        if (currentPara.length > 0) {
          const text = currentPara.join('\n').trim();
          paragraphs.push({
            index: paragraphs.length,
            text: text,
            charOffset: charOffset
          });
          charOffset += text.length + 1;
          currentPara = [];
        }
      } else {
        currentPara.push(line);
      }
    }

    if (currentPara.length > 0) {
      const text = currentPara.join('\n').trim();
      paragraphs.push({
        index: paragraphs.length,
        text: text,
        charOffset: charOffset
      });
    }

    return paragraphs;
  }

  /**
   * 获取合同全文纯文本（用于搜索）
   */
  function getFullText(sections) {
    return sections.map(s =>
      s.paragraphs.map(p => p.text).join('\n\n')
    ).join('\n\n');
  }

  /**
   * 验证标注位置是否仍然有效
   */
  function validateAnnotationPosition(annotation, sections) {
    const section = sections.find(s => s.id === annotation.sectionId);
    if (!section) return { valid: false, reason: '章节不存在' };

    const para = section.paragraphs.find(p => p.index === annotation.paragraphIndex);
    if (!para) return { valid: false, reason: '段落不存在' };

    if (annotation.startOffset >= 0 && annotation.endOffset <= para.text.length) {
      const textAtOffset = para.text.substring(annotation.startOffset, annotation.endOffset);
      if (textAtOffset === annotation.anchorText) {
        return { valid: true };
      }
    }

    // 尝试用 anchorText 模糊定位
    const idx = para.text.indexOf(annotation.anchorText);
    if (idx >= 0) {
      return {
        valid: true,
        corrected: true,
        newStart: idx,
        newEnd: idx + annotation.anchorText.length
      };
    }

    return { valid: false, reason: '锚点文本未找到' };
  }

  return { parseSections, getFullText, validateAnnotationPosition, detectSectionHeader };
})();
