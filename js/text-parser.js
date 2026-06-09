/**
 * text-parser.js - 文本解析模块
 * 负责章节识别（多级正则匹配）、段落规范化、失败降级
 * 提供稳定的 rangeId 计算、批注迁移（migrateAnnotations）和增强验证
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

  // 上下文窗口大小（用于锚点文本歧义消除）
  const CONTEXT_CHARS = 20;

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
   * 生成稳定的章节ID（仅基于标题内容，不含索引，确保重解析稳定）
   */
  function generateSectionId(index, title) {
    const slug = title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').substring(0, 30);
    return `section_${index}_${slug}`;
  }

  /**
   * 简单字符串哈希（djb2），用于生成稳定标识
   */
  function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash |= 0; // 转为32位整数
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * 计算稳定的 rangeId（基于内容哈希，不受 sectionId 变化影响）
   * @param {string} sectionTitle - 章节标题
   * @param {string} paraText - 段落全文
   * @param {string} anchorText - 锚点文本
   * @returns {string}
   */
  function computeRangeId(sectionTitle, paraText, anchorText) {
    return `rng_${hashString(sectionTitle + '\x00' + paraText + '\x00' + anchorText)}`;
  }

  /**
   * 计算锚点文本的上下文窗口（用于多出现歧义消除）
   * @param {string} paraText - 段落全文
   * @param {number} start - 锚点起始偏移
   * @param {number} end - 锚点结束偏移
   * @returns {{before: string, after: string}}
   */
  function computeAnchorContext(paraText, start, end) {
    const before = paraText.substring(Math.max(0, start - CONTEXT_CHARS), start);
    const after = paraText.substring(end, end + CONTEXT_CHARS);
    return { before, after };
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
   * 在段落文本中查找锚点文本的正确出现位置
   * 使用上下文窗口消除多次出现的歧义
   * @param {string} paraText - 段落全文
   * @param {string} anchorText - 要查找的锚点文本
   * @param {object} context - {before, after} 上下文
   * @param {number} preferredStart - 首选偏移（旧偏移量）
   * @returns {number} 找到的起始位置，未找到返回 -1
   */
  function findAnchorInParagraph(paraText, anchorText, context, preferredStart) {
    if (!anchorText) return -1;

    // 收集所有出现位置
    const occurrences = [];
    let searchFrom = 0;
    while (searchFrom <= paraText.length - anchorText.length) {
      const idx = paraText.indexOf(anchorText, searchFrom);
      if (idx < 0) break;
      occurrences.push(idx);
      searchFrom = idx + 1;
    }

    if (occurrences.length === 0) return -1;

    // 如果只有一处出现，直接返回
    if (occurrences.length === 1) return occurrences[0];

    // 多处出现：按匹配评分排序，选择最佳匹配
    let bestIdx = occurrences[0];
    let bestScore = -1;

    for (const idx of occurrences) {
      let score = 0;
      const actualEnd = idx + anchorText.length;

      // 偏移量越接近首选偏移得分越高
      if (preferredStart >= 0) {
        const dist = Math.abs(idx - preferredStart);
        score += Math.max(0, 100 - dist);
      }

      // 前向上下文匹配
      if (context && context.before) {
        const actualBefore = paraText.substring(Math.max(0, idx - context.before.length), idx);
        if (actualBefore === context.before) {
          score += 50;
        } else {
          // 部分匹配
          let matchLen = 0;
          for (let i = 0; i < Math.min(actualBefore.length, context.before.length); i++) {
            if (actualBefore[actualBefore.length - 1 - i] === context.before[context.before.length - 1 - i]) {
              matchLen++;
            } else break;
          }
          score += matchLen * 2;
        }
      }

      // 后向上下文匹配
      if (context && context.after) {
        const actualAfter = paraText.substring(actualEnd, actualEnd + context.after.length);
        if (actualAfter === context.after) {
          score += 50;
        } else {
          let matchLen = 0;
          for (let i = 0; i < Math.min(actualAfter.length, context.after.length); i++) {
            if (actualAfter[i] === context.after[i]) {
              matchLen++;
            } else break;
          }
          score += matchLen * 2;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    }

    return bestIdx;
  }

  /**
   * 验证标注位置是否仍然有效（增强版：支持上下文歧义消除）
   */
  function validateAnnotationPosition(annotation, sections) {
    // 先通过 sectionId 查找
    let section = sections.find(s => s.id === annotation.sectionId);

    // 如果 sectionId 不匹配，尝试通过标题查找
    if (!section && annotation._sectionTitle) {
      section = sections.find(s => s.title === annotation._sectionTitle);
    }
    if (!section) return { valid: false, reason: '章节不存在' };

    const para = section.paragraphs.find(p => p.index === annotation.paragraphIndex);
    if (!para) return { valid: false, reason: '段落不存在' };

    // 精确匹配
    if (annotation.startOffset >= 0 && annotation.endOffset <= para.text.length) {
      const textAtOffset = para.text.substring(annotation.startOffset, annotation.endOffset);
      if (textAtOffset === annotation.anchorText) {
        // 如果 sectionId 变了，返回修正信息
        if (section.id !== annotation.sectionId) {
          return {
            valid: true,
            corrected: true,
            newSectionId: section.id,
            newStart: annotation.startOffset,
            newEnd: annotation.endOffset,
            reason: '章节ID已更新'
          };
        }
        return { valid: true };
      }
    }

    // 使用上下文感知查找
    const context = annotation._context || {};
    const foundIdx = findAnchorInParagraph(
      para.text, annotation.anchorText, context, annotation.startOffset
    );

    if (foundIdx >= 0) {
      return {
        valid: true,
        corrected: true,
        newSectionId: section.id,
        newStart: foundIdx,
        newEnd: foundIdx + annotation.anchorText.length,
        reason: '锚点位置已修正'
      };
    }

    // 在该章节的所有段落中搜索（段落索引可能已变化）
    for (const otherPara of section.paragraphs) {
      if (otherPara.index === annotation.paragraphIndex) continue;
      const idx = otherPara.text.indexOf(annotation.anchorText);
      if (idx >= 0) {
        return {
          valid: true,
          corrected: true,
          newSectionId: section.id,
          newParagraphIndex: otherPara.index,
          newStart: idx,
          newEnd: idx + annotation.anchorText.length,
          reason: '段落索引已修正'
        };
      }
    }

    return { valid: false, reason: '锚点文本未找到' };
  }

  /**
   * 批注迁移：在合同重新解析后，将旧批注映射到新章节结构
   * @param {Annotation[]} oldAnnotations - 旧批注列表
   * @param {Section[]} newSections - 新解析的章节
   * @param {Section[]} oldSections - 旧章节（用于标题匹配）
   * @returns {{migrated: Annotation[], invalidated: Annotation[], stats: object}}
   */
  function migrateAnnotations(oldAnnotations, newSections, oldSections) {
    const results = {
      migrated: [],
      invalidated: [],
      stats: { total: oldAnnotations.length, exactMatch: 0, corrected: 0, invalidated: 0 }
    };

    if (!oldAnnotations || oldAnnotations.length === 0) return results;
    if (!newSections || newSections.length === 0) {
      // 新章节为空，全部失效
      results.invalidated = oldAnnotations.map(ann => ({
        ...ann,
        status: 'invalidated',
        _invalidReason: '新解析无章节'
      }));
      results.stats.invalidated = oldAnnotations.length;
      return results;
    }

    // 构建标题 → 新sectionId 映射（支持同名章节）
    const titleToNewSections = new Map();
    newSections.forEach(s => {
      if (!titleToNewSections.has(s.title)) titleToNewSections.set(s.title, []);
      titleToNewSections.get(s.title).push(s);
    });

    // 构建旧 sectionId → section 映射
    const oldSectionMap = new Map();
    if (oldSections) {
      oldSections.forEach(s => oldSectionMap.set(s.id, s));
    }

    // 预处理：构建新段落全局索引（用于跨章节/跨段落搜索）
    const allNewParas = [];
    newSections.forEach(s => {
      s.paragraphs.forEach(p => {
        allNewParas.push({ sectionId: s.id, sectionTitle: s.title, paraIndex: p.index, text: p.text });
      });
    });

    // 预处理：构建旧段落内容哈希 → 新段落的映射（处理拆分/合并/重排）
    const oldParaContentMap = new Map();
    if (oldSections) {
      oldSections.forEach(s => {
        s.paragraphs.forEach(p => {
          oldParaContentMap.set(`${s.id}_${p.index}`, p.text);
        });
      });
    }

    // 辅助函数：简单字符双字相似度（内联版本，避免依赖外部模块）
    function quickSimilarity(textA, textB) {
      if (!textA && !textB) return 1;
      if (!textA || !textB) return 0;
      if (textA === textB) return 1;
      const bigramsA = new Set();
      const cleanA = textA.replace(/\s+/g, '');
      for (let i = 0; i < cleanA.length - 1; i++) bigramsA.add(cleanA.substring(i, i + 2));
      if (cleanA.length === 1) bigramsA.add(cleanA);
      const bigramsB = new Set();
      const cleanB = textB.replace(/\s+/g, '');
      for (let i = 0; i < cleanB.length - 1; i++) bigramsB.add(cleanB.substring(i, i + 2));
      if (cleanB.length === 1) bigramsB.add(cleanB);
      let intersection = 0;
      bigramsA.forEach(bg => { if (bigramsB.has(bg)) intersection++; });
      const union = bigramsA.size + bigramsB.size - intersection;
      return union === 0 ? 0 : intersection / union;
    }

    for (const ann of oldAnnotations) {
      let targetSection = null;
      let targetPara = null;
      let corrected = false;
      let newStart = ann.startOffset;
      let newEnd = ann.endOffset;
      let newParaIndex = ann.paragraphIndex;

      // 策略1：通过 sectionId 精确查找
      targetSection = newSections.find(s => s.id === ann.sectionId);

      // 策略2：通过章节标题查找
      if (!targetSection && ann._sectionTitle) {
        const matches = titleToNewSections.get(ann._sectionTitle);
        if (matches && matches.length === 1) {
          targetSection = matches[0];
        } else if (matches && matches.length > 1) {
          // 多个同名章节：通过段落内容匹配选择最佳
          for (const candidate of matches) {
            const para = candidate.paragraphs.find(p => p.index === ann.paragraphIndex);
            if (para) {
              const idx = findAnchorInParagraph(
                para.text, ann.anchorText, ann._context, ann.startOffset
              );
              if (idx >= 0) {
                targetSection = candidate;
                break;
              }
            }
          }
          // 如果仍然没找到，选第一个
          if (!targetSection) targetSection = matches[0];
        }
      }

      // 策略3：通过旧章节标题查找
      if (!targetSection) {
        const oldSection = oldSectionMap.get(ann.sectionId);
        if (oldSection) {
          const matches = titleToNewSections.get(oldSection.title);
          if (matches && matches.length >= 1) {
            targetSection = matches[0];
          }
        }
      }

      // 策略3.5：通过旧段落内容相似度在全局新段落中匹配（处理拆分/合并/重排）
      if (!targetSection) {
        const oldParaText = oldParaContentMap.get(`${ann.sectionId}_${ann.paragraphIndex}`);
        if (oldParaText && ann.anchorText) {
          let bestMatch = null;
          let bestSim = 0;
          for (const np of allNewParas) {
            // 快速预过滤：锚点文本必须在新段落中存在
            if (!np.text.includes(ann.anchorText)) continue;
            const sim = quickSimilarity(oldParaText, np.text);
            if (sim > bestSim && sim >= 0.3) {
              bestSim = sim;
              bestMatch = np;
            }
          }
          if (bestMatch) {
            targetSection = newSections.find(s => s.id === bestMatch.sectionId);
            if (targetSection) {
              targetPara = targetSection.paragraphs.find(p => p.index === bestMatch.paraIndex);
              if (targetPara) {
                const idx = findAnchorInParagraph(targetPara.text, ann.anchorText, ann._context, -1);
                if (idx >= 0) {
                  newStart = idx;
                  newEnd = idx + ann.anchorText.length;
                  newParaIndex = targetPara.index;
                  corrected = true;
                } else {
                  // 相似度匹配了但锚点找不到，重置
                  targetSection = null;
                  targetPara = null;
                }
              }
            }
          }
        }
      }

      // 策略4：全局搜索锚点文本（最后手段）
      if (!targetSection) {
        for (const section of newSections) {
          for (const para of section.paragraphs) {
            const idx = findAnchorInParagraph(
              para.text, ann.anchorText, ann._context, -1
            );
            if (idx >= 0) {
              targetSection = section;
              targetPara = para;
              newStart = idx;
              newEnd = idx + ann.anchorText.length;
              newParaIndex = para.index;
              corrected = true;
              break;
            }
          }
          if (targetSection) break;
        }
      }

      // 策略5：跨段落边界搜索（处理段落拆分场景）
      if (!targetSection && ann.anchorText) {
        for (const section of newSections) {
          const paras = section.paragraphs;
          for (let pi = 0; pi < paras.length - 1; pi++) {
            const joined = paras[pi].text + '\n' + paras[pi + 1].text;
            const idx = joined.indexOf(ann.anchorText);
            if (idx >= 0) {
              targetSection = section;
              // 锚点落在哪个段落中：判断是否跨越了拼接点
              const splitPoint = paras[pi].text.length;
              if (idx + ann.anchorText.length <= splitPoint) {
                // 完全在第一个段落中
                targetPara = paras[pi];
                newStart = idx;
              } else if (idx >= splitPoint + 1) {
                // 完全在第二个段落中（跳过换行符）
                targetPara = paras[pi + 1];
                newStart = idx - splitPoint - 1;
              } else {
                // 跨越两个段落边界 — 取包含更多内容的那个段落
                const inFirst = splitPoint - idx;
                const inSecond = ann.anchorText.length - inFirst;
                if (inFirst >= inSecond) {
                  targetPara = paras[pi];
                  // 锚点文本被截断，使用第一个段落中的部分作为新锚点
                  const partialAnchor = ann.anchorText.substring(0, inFirst);
                  newStart = idx;
                  newEnd = idx + partialAnchor.length;
                  newParaIndex = paras[pi].index;
                  corrected = true;
                  break;
                } else {
                  targetPara = paras[pi + 1];
                  const partialAnchor = ann.anchorText.substring(inFirst);
                  newStart = 0;
                  newEnd = partialAnchor.length;
                  newParaIndex = paras[pi + 1].index;
                  corrected = true;
                  break;
                }
              }
              if (targetPara) {
                newEnd = newStart + ann.anchorText.length;
                newParaIndex = targetPara.index;
                corrected = true;
              }
              break;
            }
          }
          if (targetSection) break;
        }
      }

      // 策略6：通过旧段落内容相似度全局模糊定位（锚点文本可能微调）
      if (!targetSection) {
        const oldParaText = oldParaContentMap.get(`${ann.sectionId}_${ann.paragraphIndex}`);
        if (oldParaText) {
          let bestMatch = null;
          let bestSim = 0;
          for (const np of allNewParas) {
            const sim = quickSimilarity(oldParaText, np.text);
            if (sim > bestSim && sim >= 0.5) {
              bestSim = sim;
              bestMatch = np;
            }
          }
          if (bestMatch) {
            const matchSection = newSections.find(s => s.id === bestMatch.sectionId);
            const matchPara = matchSection ? matchSection.paragraphs.find(p => p.index === bestMatch.paraIndex) : null;
            if (matchPara) {
              const idx = findAnchorInParagraph(matchPara.text, ann.anchorText, ann._context, -1);
              if (idx >= 0) {
                targetSection = matchSection;
                targetPara = matchPara;
                newStart = idx;
                newEnd = idx + ann.anchorText.length;
                newParaIndex = matchPara.index;
                corrected = true;
              }
            }
          }
        }
      }

      if (!targetSection) {
        // 迁移失败 → 标记失效
        results.invalidated.push({
          ...ann,
          status: 'invalidated',
          _invalidReason: '无法在新章节结构中定位'
        });
        results.stats.invalidated++;
        continue;
      }

      // 查找段落
      if (!targetPara) {
        targetPara = targetSection.paragraphs.find(p => p.index === ann.paragraphIndex);
      }

      if (!targetPara) {
        // 段落不存在，尝试在该章节所有段落中查找锚点
        let found = false;
        for (const para of targetSection.paragraphs) {
          const idx = findAnchorInParagraph(
            para.text, ann.anchorText, ann._context, ann.startOffset
          );
          if (idx >= 0) {
            targetPara = para;
            newStart = idx;
            newEnd = idx + ann.anchorText.length;
            newParaIndex = para.index;
            corrected = true;
            found = true;
            break;
          }
        }
        if (!found) {
          results.invalidated.push({
            ...ann,
            status: 'invalidated',
            _invalidReason: `章节"${targetSection.title}"中未找到锚点文本`
          });
          results.stats.invalidated++;
          continue;
        }
      }

      // 验证锚点文本
      let alreadyCounted = false;
      if (!corrected) {
        newParaIndex = targetPara.index;

        // 精确匹配
        if (ann.startOffset >= 0 && ann.endOffset <= targetPara.text.length) {
          const textAtOffset = targetPara.text.substring(ann.startOffset, ann.endOffset);
          if (textAtOffset === ann.anchorText) {
            newStart = ann.startOffset;
            newEnd = ann.endOffset;
            results.stats.exactMatch++;
          } else {
            // 偏移漂移，用上下文感知查找
            const idx = findAnchorInParagraph(
              targetPara.text, ann.anchorText, ann._context, ann.startOffset
            );
            if (idx >= 0) {
              newStart = idx;
              newEnd = idx + ann.anchorText.length;
              corrected = true;
              results.stats.corrected++;
              alreadyCounted = true;
            } else {
              results.invalidated.push({
                ...ann,
                status: 'invalidated',
                _invalidReason: '锚点文本在段落中未找到'
              });
              results.stats.invalidated++;
              continue;
            }
          }
        } else {
          // 偏移越界，用上下文感知查找
          const idx = findAnchorInParagraph(
            targetPara.text, ann.anchorText, ann._context, -1
          );
          if (idx >= 0) {
            newStart = idx;
            newEnd = idx + ann.anchorText.length;
            corrected = true;
            results.stats.corrected++;
            alreadyCounted = true;
          } else {
            results.invalidated.push({
              ...ann,
              status: 'invalidated',
              _invalidReason: '偏移越界且锚点文本未找到'
            });
            results.stats.invalidated++;
            continue;
          }
        }
      }

      // 迁移成功，更新批注
      if (corrected && !alreadyCounted) {
        results.stats.corrected++;
      }

      const migratedAnn = {
        ...ann,
        sectionId: targetSection.id,
        paragraphIndex: newParaIndex,
        startOffset: newStart,
        endOffset: newEnd,
        _sectionTitle: targetSection.title,
        _context: computeAnchorContext(targetPara.text, newStart, newEnd),
        status: ann.status === 'invalidated' ? 'pending' : ann.status, // 恢复已失效的
        _invalidReason: undefined
      };

      // 重新计算 rangeId
      migratedAnn.rangeId = computeRangeId(
        targetSection.title, targetPara.text, ann.anchorText
      );

      results.migrated.push(migratedAnn);
    }

    return results;
  }

  /**
   * 计算段落文本哈希（用于快速身份比对）
   */
  function computeParagraphHash(text) {
    return hashString(text);
  }

  return {
    parseSections, getFullText, validateAnnotationPosition, detectSectionHeader,
    computeRangeId, computeAnchorContext, migrateAnnotations, hashString,
    findAnchorInParagraph, computeParagraphHash
  };
})();
