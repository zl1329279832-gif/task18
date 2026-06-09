/**
 * text-parser.js - 文本解析模块
 * 负责章节识别（多级正则匹配）、段落规范化、失败降级
 * 批注迁移引擎、上下文指纹与评分
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

  // 上下文长度（前后各取多少字符用于消歧）
  const CONTEXT_LENGTH = 30;

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
   * 简单字符串哈希（djb2变体）
   */
  function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * 生成稳定的章节ID（基于标题内容哈希，不依赖位置索引）
   * @param {string} title - 章节标题
   * @param {string} type - 章节类型
   * @param {number} occurrence - 同标题的第几次出现（从0开始）
   */
  function generateSectionId(title, type, occurrence) {
    const normalized = title.replace(/\s+/g, '').trim();
    const base = `sec_${type}_${hashString(normalized)}`;
    return occurrence > 0 ? `${base}_${occurrence}` : base;
  }

  /**
   * 计算段落内容指纹（用于段落级识别与去重）
   */
  function computeParagraphFingerprint(text) {
    // 去除空白后取哈希，保证格式变化不影响指纹
    const normalized = text.replace(/\s+/g, '').trim();
    return hashString(normalized);
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
    // 标题出现次数计数器（处理重复标题）
    const titleCounters = {};

    // 处理标题前的内容（前言/序言）
    if (headerLines[0].lineIndex > 0) {
      const preambleLines = lines.slice(0, headerLines[0].lineIndex);
      const preambleText = preambleLines.join('\n').trim();
      if (preambleText) {
        sections.push({
          id: generateSectionId('前言', 'preamble', 0),
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
      const title = headerLines[i].title;
      const type = headerLines[i].type;

      // 计算同标题出现次数
      const titleKey = `${type}_${title.replace(/\s+/g, '')}`;
      titleCounters[titleKey] = (titleCounters[titleKey] || 0);
      const occurrence = titleCounters[titleKey];
      titleCounters[titleKey]++;

      sections.push({
        id: generateSectionId(title, type, occurrence),
        title: title,
        level: headerLines[i].level,
        paragraphs: buildParagraphs(sectionLines),
        type: type
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
        id: generateSectionId(title, 'fallback', 0),
        title: title,
        level: 1,
        paragraphs: chunk.map((text, idx) => ({
          index: idx,
          text: text.trim(),
          charOffset: 0,
          fingerprint: computeParagraphFingerprint(text)
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
            charOffset: charOffset,
            fingerprint: computeParagraphFingerprint(text)
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
        charOffset: charOffset,
        fingerprint: computeParagraphFingerprint(text)
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
   * 提取批注的上下文（锚点前后文本）
   * @param {Section[]} sections
   * @param {string} sectionId
   * @param {number} paragraphIndex
   * @param {number} startOffset
   * @param {number} endOffset
   * @param {number} contextLen - 前后取多少字符
   * @returns {{before: string, after: string}}
   */
  function extractContext(sections, sectionId, paragraphIndex, startOffset, endOffset, contextLen) {
    contextLen = contextLen || CONTEXT_LENGTH;
    const section = sections.find(s => s.id === sectionId);
    if (!section) return { before: '', after: '' };

    const para = section.paragraphs.find(p => p.index === paragraphIndex);
    if (!para) return { before: '', after: '' };

    const before = para.text.substring(Math.max(0, startOffset - contextLen), startOffset);
    const after = para.text.substring(endOffset, endOffset + contextLen);
    return { before, after };
  }

  /**
   * 计算两段文本的相似度（简化Jaccard，按字符2-gram）
   * @returns {number} 0~1之间的相似度
   */
  function textSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;

    const ngramA = new Set();
    const ngramB = new Set();
    for (let i = 0; i < a.length - 1; i++) ngramA.add(a.substring(i, i + 2));
    for (let i = 0; i < b.length - 1; i++) ngramB.add(b.substring(i, i + 2));

    if (ngramA.size === 0 && ngramB.size === 0) return 1;
    if (ngramA.size === 0 || ngramB.size === 0) return 0;

    let intersection = 0;
    for (const ng of ngramA) {
      if (ngramB.has(ng)) intersection++;
    }
    return intersection / (ngramA.size + ngramB.size - intersection);
  }

  /**
   * 计算候选位置的上下文匹配评分
   * @param {object} annotation - 带 contextBefore/contextAfter 的批注
   * @param {string} paraText - 候选段落文本
   * @param {number} matchStart - 候选匹配的起始偏移
   * @param {number} matchEnd - 候选匹配的结束偏移
   * @returns {number} 0~1 之间的综合评分
   */
  function computeContextScore(annotation, paraText, matchStart, matchEnd) {
    const candidateBefore = paraText.substring(Math.max(0, matchStart - CONTEXT_LENGTH), matchStart);
    const candidateAfter = paraText.substring(matchEnd, matchEnd + CONTEXT_LENGTH);

    const beforeScore = textSimilarity(annotation.contextBefore || '', candidateBefore);
    const afterScore = textSimilarity(annotation.contextAfter || '', candidateAfter);

    // 如果段落指纹匹配，加分
    let fingerprintBonus = 0;
    if (annotation.paragraphFingerprint) {
      const candidateFp = computeParagraphFingerprint(paraText);
      if (candidateFp === annotation.paragraphFingerprint) {
        fingerprintBonus = 0.2;
      }
    }

    return Math.min(1, (beforeScore * 0.4 + afterScore * 0.4) + fingerprintBonus);
  }

  /**
   * 在章节列表中搜索 anchorText 的所有出现位置
   * @param {string} anchorText
   * @param {Section[]} sections
   * @param {string|null} limitSectionId - 如果指定，只在该章节内搜索
   * @returns {Array<{sectionId, paragraphIndex, startOffset, endOffset, paraText}>}
   */
  function findAllOccurrences(anchorText, sections, limitSectionId) {
    const results = [];
    const targetSections = limitSectionId
      ? sections.filter(s => s.id === limitSectionId)
      : sections;

    for (const section of targetSections) {
      for (const para of section.paragraphs) {
        let searchFrom = 0;
        while (true) {
          const idx = para.text.indexOf(anchorText, searchFrom);
          if (idx < 0) break;
          results.push({
            sectionId: section.id,
            paragraphIndex: para.index,
            startOffset: idx,
            endOffset: idx + anchorText.length,
            paraText: para.text
          });
          searchFrom = idx + 1; // 允许重叠搜索
        }
      }
    }
    return results;
  }

  /**
   * 验证标注位置是否仍然有效（增强版：支持上下文消歧）
   */
  function validateAnnotationPosition(annotation, sections) {
    const section = sections.find(s => s.id === annotation.sectionId);
    if (!section) {
      // 章节ID变化，尝试全局搜索
      return tryGlobalRelocate(annotation, sections);
    }

    const para = section.paragraphs.find(p => p.index === annotation.paragraphIndex);
    if (!para) {
      // 段落索引变化，在同章节内搜索
      return trySectionRelocate(annotation, section, sections);
    }

    // 精确偏移匹配
    if (annotation.startOffset >= 0 && annotation.endOffset <= para.text.length) {
      const textAtOffset = para.text.substring(annotation.startOffset, annotation.endOffset);
      if (textAtOffset === annotation.anchorText) {
        return { valid: true };
      }
    }

    // 同段落模糊定位（带上下文消歧）
    const occurrences = findAllOccurrences(annotation.anchorText, sections, annotation.sectionId);
    if (occurrences.length === 0) {
      // 同章节找不到，全局搜索
      return tryGlobalRelocate(annotation, sections);
    }

    // 只有一个匹配，直接用
    if (occurrences.length === 1) {
      const match = occurrences[0];
      return {
        valid: true,
        corrected: true,
        newSectionId: match.sectionId,
        newParagraphIndex: match.paragraphIndex,
        newStart: match.startOffset,
        newEnd: match.endOffset
      };
    }

    // 多个匹配，用上下文评分消歧
    return disambiguateByContext(annotation, occurrences);
  }

  /**
   * 在同章节内重新定位
   */
  function trySectionRelocate(annotation, section, sections) {
    const occurrences = findAllOccurrences(annotation.anchorText, [section], null);
    if (occurrences.length === 0) {
      return tryGlobalRelocate(annotation, sections);
    }
    if (occurrences.length === 1) {
      const match = occurrences[0];
      return {
        valid: true,
        corrected: true,
        newSectionId: match.sectionId,
        newParagraphIndex: match.paragraphIndex,
        newStart: match.startOffset,
        newEnd: match.endOffset
      };
    }
    return disambiguateByContext(annotation, occurrences);
  }

  /**
   * 全局搜索重新定位
   */
  function tryGlobalRelocate(annotation, sections) {
    const occurrences = findAllOccurrences(annotation.anchorText, sections, null);
    if (occurrences.length === 0) {
      return { valid: false, reason: '锚点文本未找到' };
    }
    if (occurrences.length === 1) {
      const match = occurrences[0];
      return {
        valid: true,
        corrected: true,
        newSectionId: match.sectionId,
        newParagraphIndex: match.paragraphIndex,
        newStart: match.startOffset,
        newEnd: match.endOffset
      };
    }
    return disambiguateByContext(annotation, occurrences);
  }

  /**
   * 通过上下文评分在多个候选中消歧
   */
  function disambiguateByContext(annotation, occurrences) {
    // 如果批注没有上下文信息（旧数据），回退到位置最近的匹配
    if (!annotation.contextBefore && !annotation.contextAfter) {
      return pickClosestMatch(annotation, occurrences);
    }

    let bestMatch = null;
    let bestScore = -1;

    for (const occ of occurrences) {
      const score = computeContextScore(annotation, occ.paraText, occ.startOffset, occ.endOffset);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = occ;
      }
    }

    // 评分阈值：至少0.3才认为有效匹配
    if (bestScore < 0.3) {
      return { valid: false, reason: '多处相似文本，上下文均不匹配' };
    }

    return {
      valid: true,
      corrected: true,
      newSectionId: bestMatch.sectionId,
      newParagraphIndex: bestMatch.paragraphIndex,
      newStart: bestMatch.startOffset,
      newEnd: bestMatch.endOffset,
      confidence: bestScore
    };
  }

  /**
   * 在无上下文信息时，选择位置最接近原始位置的匹配
   */
  function pickClosestMatch(annotation, occurrences) {
    // 优先同 sectionId，然后同 paragraphIndex，最后最近 offset
    let best = occurrences[0];
    let bestDist = Infinity;

    for (const occ of occurrences) {
      let dist = 0;
      if (occ.sectionId !== annotation.sectionId) dist += 10000;
      if (occ.paragraphIndex !== annotation.paragraphIndex) dist += 1000;
      dist += Math.abs(occ.startOffset - annotation.startOffset);

      if (dist < bestDist) {
        bestDist = dist;
        best = occ;
      }
    }

    return {
      valid: true,
      corrected: true,
      newSectionId: best.sectionId,
      newParagraphIndex: best.paragraphIndex,
      newStart: best.startOffset,
      newEnd: best.endOffset,
      confidence: 0.5 // 无上下文，中等置信度
    };
  }

  /**
   * 批注迁移引擎：将旧批注映射到新的章节结构
   * @param {Annotation[]} annotations - 现有批注列表
   * @param {Section[]} oldSections - 旧章节结构
   * @param {Section[]} newSections - 新章节结构
   * @returns {{migrated: Array, stale: Array, unchanged: Array}}
   */
  function migrateAnnotations(annotations, oldSections, newSections) {
    const result = { migrated: [], stale: [], unchanged: [] };

    for (const ann of annotations) {
      // 第一层：精确匹配（sectionId + paragraphIndex + offset）
      const newSection = newSections.find(s => s.id === ann.sectionId);
      if (newSection) {
        const newPara = newSection.paragraphs.find(p => p.index === ann.paragraphIndex);
        if (newPara && ann.startOffset >= 0 && ann.endOffset <= newPara.text.length) {
          const textAtOffset = newPara.text.substring(ann.startOffset, ann.endOffset);
          if (textAtOffset === ann.anchorText) {
            // 完全匹配，无需迁移
            const ctx = extractContext(newSections, ann.sectionId, ann.paragraphIndex, ann.startOffset, ann.endOffset);
            result.unchanged.push({
              annotation: ann,
              contextBefore: ctx.before,
              contextAfter: ctx.after,
              paragraphFingerprint: newPara.fingerprint
            });
            continue;
          }
        }
      }

      // 第二层：同章节模糊匹配
      if (newSection) {
        const occurrences = findAllOccurrences(ann.anchorText, [newSection], null);
        if (occurrences.length > 0) {
          const match = selectBestMatch(ann, occurrences);
          if (match) {
            const ctx = extractContext(newSections, match.sectionId, match.paragraphIndex, match.startOffset, match.endOffset);
            result.migrated.push({
              annotation: ann,
              newSectionId: match.sectionId,
              newParagraphIndex: match.paragraphIndex,
              newStart: match.startOffset,
              newEnd: match.endOffset,
              contextBefore: ctx.before,
              contextAfter: ctx.after,
              paragraphFingerprint: computeParagraphFingerprint(match.paraText),
              confidence: match.confidence || 0.7
            });
            continue;
          }
        }
      }

      // 第三层：全局搜索
      const globalOccurrences = findAllOccurrences(ann.anchorText, newSections, null);
      if (globalOccurrences.length > 0) {
        const match = selectBestMatch(ann, globalOccurrences);
        if (match) {
          const ctx = extractContext(newSections, match.sectionId, match.paragraphIndex, match.startOffset, match.endOffset);
          result.migrated.push({
            annotation: ann,
            newSectionId: match.sectionId,
            newParagraphIndex: match.paragraphIndex,
            newStart: match.startOffset,
            newEnd: match.endOffset,
            contextBefore: ctx.before,
            contextAfter: ctx.after,
            paragraphFingerprint: computeParagraphFingerprint(match.paraText),
            confidence: match.confidence || 0.5
          });
          continue;
        }
      }

      // 迁移失败
      result.stale.push({
        annotation: ann,
        reason: '锚点文本在新文本中未找到'
      });
    }

    return result;
  }

  /**
   * 从多个候选中选择最佳匹配
   */
  function selectBestMatch(annotation, occurrences) {
    if (occurrences.length === 1) {
      return { ...occurrences[0], confidence: 0.8 };
    }

    // 有上下文信息，用上下文评分
    if (annotation.contextBefore || annotation.contextAfter) {
      let bestMatch = null;
      let bestScore = -1;

      for (const occ of occurrences) {
        const score = computeContextScore(annotation, occ.paraText, occ.startOffset, occ.endOffset);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = occ;
        }
      }

      if (bestScore >= 0.3) {
        return { ...bestMatch, confidence: bestScore };
      }
      // 评分太低，按位置距离回退
    }

    // 无上下文或评分不足，选位置最近的
    let best = occurrences[0];
    let bestDist = Infinity;

    for (const occ of occurrences) {
      let dist = 0;
      if (occ.sectionId !== annotation.sectionId) dist += 10000;
      if (occ.paragraphIndex !== annotation.paragraphIndex) dist += 1000;
      dist += Math.abs(occ.startOffset - (annotation.startOffset || 0));

      if (dist < bestDist) {
        bestDist = dist;
        best = occ;
      }
    }

    return { ...best, confidence: 0.5 };
  }

  return {
    parseSections, getFullText, validateAnnotationPosition, detectSectionHeader,
    migrateAnnotations, extractContext, computeParagraphFingerprint
  };
})();
