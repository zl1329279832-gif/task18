/**
 * version-comparator.js - 合同版本对比引擎
 * 实现条款级 diff：章节匹配 → 段落对齐 → 内联字级差异
 * 算法：字符双字 Jaccard 相似度 + Needleman-Wunsch DP 对齐 + LCS 内联 diff
 */
const VersionComparator = (() => {

  /**
   * 计算两段文本的字符双字 Jaccard 相似度
   * @param {string} textA
   * @param {string} textB
   * @returns {number} 0~1
   */
  function computeSimilarity(textA, textB) {
    if (!textA && !textB) return 1;
    if (!textA || !textB) return 0;
    if (textA === textB) return 1;

    const bigramsA = extractBigrams(textA);
    const bigramsB = extractBigrams(textB);

    let intersection = 0;
    bigramsA.forEach(bg => {
      if (bigramsB.has(bg)) intersection++;
    });

    const union = bigramsA.size + bigramsB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  function extractBigrams(text) {
    const set = new Set();
    const cleaned = text.replace(/\s+/g, '');
    for (let i = 0; i < cleaned.length - 1; i++) {
      set.add(cleaned.substring(i, i + 2));
    }
    // 单字文本也加入
    if (cleaned.length === 1) set.add(cleaned);
    return set;
  }

  /**
   * 内联字级 diff：基于字符 LCS 产生 oldSegments / newSegments
   * @param {string} oldText
   * @param {string} newText
   * @returns {{ oldSegments: InlineSegment[], newSegments: InlineSegment[] }}
   */
  function computeInlineDiff(oldText, newText) {
    const oldTokens = tokenizeCJK(oldText);
    const newTokens = tokenizeCJK(newText);

    // LCS
    const m = oldTokens.length;
    const n = newTokens.length;
    const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = oldTokens[i - 1] === newTokens[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }

    // 回溯
    const oldSegments = [];
    const newSegments = [];
    let i = m, j = n;
    const stack = [];

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldTokens[i - 1] === newTokens[j - 1]) {
        stack.push({ type: 'unchanged', oldToken: oldTokens[i - 1], newToken: newTokens[j - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        stack.push({ type: 'added', newToken: newTokens[j - 1] });
        j--;
      } else {
        stack.push({ type: 'deleted', oldToken: oldTokens[i - 1] });
        i--;
      }
    }
    stack.reverse();

    // 合并相邻同类型 token
    for (const item of stack) {
      if (item.type === 'unchanged') {
        appendSegment(oldSegments, item.oldToken, 'unchanged');
        appendSegment(newSegments, item.newToken, 'unchanged');
      } else if (item.type === 'deleted') {
        appendSegment(oldSegments, item.oldToken, 'deleted');
      } else {
        appendSegment(newSegments, item.newToken, 'added');
      }
    }

    return { oldSegments, newSegments };
  }

  function appendSegment(segments, text, type) {
    const last = segments[segments.length - 1];
    if (last && last.type === type) {
      last.text += text;
    } else {
      segments.push({ text, type });
    }
  }

  /**
   * CJK 友好的分词：每个 CJK 字符为独立 token，连续 ASCII/数字/标点为一组
   */
  function tokenizeCJK(text) {
    const tokens = [];
    let buf = '';
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      const isCJK = (code >= 0x4e00 && code <= 0x9fff) ||
                    (code >= 0x3400 && code <= 0x4dbf) ||
                    (code >= 0xf900 && code <= 0xfaff) ||
                    (code >= 0x3000 && code <= 0x303f) || // CJK symbols
                    (code >= 0xff00 && code <= 0xffef);   // fullwidth
      if (isCJK) {
        if (buf) { tokens.push(buf); buf = ''; }
        tokens.push(ch);
      } else if (/\s/.test(ch)) {
        if (buf) { tokens.push(buf); buf = ''; }
      } else {
        buf += ch;
      }
    }
    if (buf) tokens.push(buf);
    return tokens;
  }

  /**
   * 提取章节编号前缀（如"第三条"、"第一章"、"1.2"）
   */
  function extractNumberPrefix(title) {
    if (!title) return null;
    const m = title.match(/^(第[一二三四五六七八九十百千零〇]+[条款章节款])|^(?:\d+\.\d+(?:\.\d+)?)|^(?:[（(][一二三四五六七八九十百千\d]+[）)])/);
    return m ? m[0] : null;
  }

  /**
   * 段落级对齐（Needleman-Wunsch DP）
   * @param {Array} oldParas - [{index, text}, ...]
   * @param {Array} newParas - [{index, text}, ...]
   * @returns {ParagraphDiff[]}
   */
  function alignParagraphs(oldParas, newParas) {
    const m = oldParas.length;
    const n = newParas.length;
    const GAP = -3;
    const MISMATCH = -2;

    // 构建得分矩阵
    const score = Array.from({ length: m + 1 }, () => new Float64Array(n + 1));
    score[0][0] = 0;
    for (let i = 1; i <= m; i++) score[i][0] = score[i - 1][0] + GAP;
    for (let j = 1; j <= n; j++) score[0][j] = score[0][j - 1] + GAP;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const sim = computeSimilarity(oldParas[i - 1].text, newParas[j - 1].text);
        const matchScore = sim >= 0.4 ? sim * 10 : MISMATCH;
        score[i][j] = Math.max(
          score[i - 1][j - 1] + matchScore,
          score[i - 1][j] + GAP,
          score[i][j - 1] + GAP
        );
      }
    }

    // 回溯
    const diffs = [];
    let i = m, j = n;
    const stack = [];

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0) {
        const sim = computeSimilarity(oldParas[i - 1].text, newParas[j - 1].text);
        const matchScore = sim >= 0.4 ? sim * 10 : MISMATCH;
        if (Math.abs(score[i][j] - (score[i - 1][j - 1] + matchScore)) < 0.001) {
          stack.push({ dir: 'diag', i: i - 1, j: j - 1, sim });
          i--; j--;
          continue;
        }
      }
      if (i > 0 && Math.abs(score[i][j] - (score[i - 1][j] + GAP)) < 0.001) {
        stack.push({ dir: 'up', i: i - 1 });
        i--;
      } else {
        stack.push({ dir: 'left', j: j - 1 });
        j--;
      }
    }
    stack.reverse();

    for (const step of stack) {
      if (step.dir === 'diag') {
        const oldP = oldParas[step.i];
        const newP = newParas[step.j];
        const sim = step.sim;
        let changeType;
        if (sim >= 0.98) changeType = 'unchanged';
        else changeType = 'modified'; // 任何差异都标记为修改

        const diff = {
          changeType,
          oldParagraph: { index: oldP.index, text: oldP.text },
          newParagraph: { index: newP.index, text: newP.text },
          similarity: sim,
          inlineDiff: null
        };

        if (changeType === 'modified') {
          diff.inlineDiff = computeInlineDiff(oldP.text, newP.text);
        }

        diffs.push(diff);
      } else if (step.dir === 'up') {
        const oldP = oldParas[step.i];
        diffs.push({
          changeType: 'deleted',
          oldParagraph: { index: oldP.index, text: oldP.text },
          newParagraph: null,
          similarity: 0,
          inlineDiff: null
        });
      } else {
        const newP = newParas[step.j];
        diffs.push({
          changeType: 'added',
          oldParagraph: null,
          newParagraph: { index: newP.index, text: newP.text },
          similarity: 0,
          inlineDiff: null
        });
      }
    }

    return diffs;
  }

  /**
   * 章节匹配：精确标题 → 模糊标题 → 位置对齐
   * @param {Section[]} oldSections
   * @param {Section[]} newSections
   * @returns {SectionDiff[]}
   */
  function compareSections(oldSections, newSections) {
    const oldUsed = new Set();
    const newUsed = new Set();
    const pairs = [];

    // 第一轮：精确匹配
    for (let i = 0; i < oldSections.length; i++) {
      for (let j = 0; j < newSections.length; j++) {
        if (newUsed.has(j)) continue;
        if (oldSections[i].title === newSections[j].title) {
          pairs.push({ oldIdx: i, newIdx: j, sim: 1 });
          oldUsed.add(i);
          newUsed.add(j);
          break;
        }
      }
    }

    // 第二轮：模糊匹配
    for (let i = 0; i < oldSections.length; i++) {
      if (oldUsed.has(i)) continue;
      let bestJ = -1, bestSim = 0;
      for (let j = 0; j < newSections.length; j++) {
        if (newUsed.has(j)) continue;
        const sim = computeSimilarity(oldSections[i].title, newSections[j].title);
        if (sim > bestSim && sim >= 0.6) {
          bestSim = sim;
          bestJ = j;
        }
      }
      if (bestJ >= 0) {
        pairs.push({ oldIdx: i, newIdx: bestJ, sim: bestSim });
        oldUsed.add(i);
        newUsed.add(bestJ);
      }
    }

    // 第二轮B：编号前缀匹配（如"第三条 ... "→"第三条 ..."）
    for (let i = 0; i < oldSections.length; i++) {
      if (oldUsed.has(i)) continue;
      const oldPrefix = extractNumberPrefix(oldSections[i].title);
      if (!oldPrefix) continue;
      let bestJ = -1, bestSim = 0;
      for (let j = 0; j < newSections.length; j++) {
        if (newUsed.has(j)) continue;
        const newPrefix = extractNumberPrefix(newSections[j].title);
        if (newPrefix && oldPrefix === newPrefix) {
          const sim = computeSimilarity(
            oldSections[i].paragraphs.map(p => p.text).join(''),
            newSections[j].paragraphs.map(p => p.text).join('')
          );
          if (sim > bestSim) {
            bestSim = sim;
            bestJ = j;
          }
        }
      }
      if (bestJ >= 0) {
        pairs.push({ oldIdx: i, newIdx: bestJ, sim: bestSim });
        oldUsed.add(i);
        newUsed.add(bestJ);
      }
    }

    // 处理剩余位置对齐（未匹配的中间段落按位置尝试匹配）
    for (let i = 0; i < oldSections.length; i++) {
      if (oldUsed.has(i)) continue;
      // 找位置最近的未使用新章节
      let bestJ = -1, bestDist = Infinity;
      for (let j = 0; j < newSections.length; j++) {
        if (newUsed.has(j)) continue;
        const dist = Math.abs(i - j);
        if (dist < bestDist) {
          bestDist = dist;
          bestJ = j;
        }
      }
      if (bestJ >= 0 && bestDist <= 2) {
        const sim = computeSimilarity(
          oldSections[i].paragraphs.map(p => p.text).join(''),
          newSections[bestJ].paragraphs.map(p => p.text).join('')
        );
        if (sim >= 0.3) {
          pairs.push({ oldIdx: i, newIdx: bestJ, sim });
          oldUsed.add(i);
          newUsed.add(bestJ);
        }
      }
    }

    // 按位置排序
    pairs.sort((a, b) => a.oldIdx - b.oldIdx);

    // 构建 SectionDiff 数组
    const sectionDiffs = [];
    let summary = { sectionsAdded: 0, sectionsDeleted: 0, sectionsModified: 0, sectionsUnchanged: 0, totalParagraphsChanged: 0 };

    // 合并：按顺序遍历新旧章节
    let oi = 0, ni = 0, pi = 0;

    while (oi < oldSections.length || ni < newSections.length) {
      if (pi < pairs.length && pairs[pi].oldIdx === oi && pairs[pi].newIdx === ni) {
        // 匹配对
        const pair = pairs[pi];
        const oldSec = oldSections[pair.oldIdx];
        const newSec = newSections[pair.newIdx];
        const paraDiffs = alignParagraphs(oldSec.paragraphs, newSec.paragraphs);

        const hasChanges = paraDiffs.some(d => d.changeType !== 'unchanged');
        const changeType = hasChanges ? 'modified' : 'unchanged';

        if (changeType === 'modified') summary.sectionsModified++;
        else summary.sectionsUnchanged++;

        paraDiffs.forEach(d => {
          if (d.changeType !== 'unchanged') summary.totalParagraphsChanged++;
        });

        sectionDiffs.push({
          changeType,
          oldSection: oldSec,
          newSection: newSec,
          paragraphDiffs: paraDiffs,
          sectionSimilarity: pair.sim
        });

        oi++; ni++; pi++;
      } else if (pi < pairs.length && pairs[pi].oldIdx === oi) {
        // 新章节在配对之前（新增）
        while (ni < pairs[pi].newIdx && ni < newSections.length) {
          const newSec = newSections[ni];
          sectionDiffs.push({
            changeType: 'added',
            oldSection: null,
            newSection: newSec,
            paragraphDiffs: newSec.paragraphs.map(p => ({
              changeType: 'added',
              oldParagraph: null,
              newParagraph: { index: p.index, text: p.text },
              similarity: 0,
              inlineDiff: null
            })),
            sectionSimilarity: 0
          });
          summary.sectionsAdded++;
          summary.totalParagraphsChanged += newSec.paragraphs.length;
          ni++;
        }
      } else if (pi < pairs.length && pairs[pi].newIdx === ni) {
        // 旧章节在配对之前（删除）
        while (oi < pairs[pi].oldIdx && oi < oldSections.length) {
          const oldSec = oldSections[oi];
          sectionDiffs.push({
            changeType: 'deleted',
            oldSection: oldSec,
            newSection: null,
            paragraphDiffs: oldSec.paragraphs.map(p => ({
              changeType: 'deleted',
              oldParagraph: { index: p.index, text: p.text },
              newParagraph: null,
              similarity: 0,
              inlineDiff: null
            })),
            sectionSimilarity: 0
          });
          summary.sectionsDeleted++;
          summary.totalParagraphsChanged += oldSec.paragraphs.length;
          oi++;
        }
      } else {
        // 没有更多配对，剩余的都是未匹配
        if (oi < oldSections.length && (ni >= newSections.length || (pi >= pairs.length))) {
          const oldSec = oldSections[oi];
          sectionDiffs.push({
            changeType: 'deleted',
            oldSection: oldSec,
            newSection: null,
            paragraphDiffs: oldSec.paragraphs.map(p => ({
              changeType: 'deleted',
              oldParagraph: { index: p.index, text: p.text },
              newParagraph: null,
              similarity: 0,
              inlineDiff: null
            })),
            sectionSimilarity: 0
          });
          summary.sectionsDeleted++;
          summary.totalParagraphsChanged += oldSec.paragraphs.length;
          oi++;
        } else if (ni < newSections.length) {
          const newSec = newSections[ni];
          sectionDiffs.push({
            changeType: 'added',
            oldSection: null,
            newSection: newSec,
            paragraphDiffs: newSec.paragraphs.map(p => ({
              changeType: 'added',
              oldParagraph: null,
              newParagraph: { index: p.index, text: p.text },
              similarity: 0,
              inlineDiff: null
            })),
            sectionSimilarity: 0
          });
          summary.sectionsAdded++;
          summary.totalParagraphsChanged += newSec.paragraphs.length;
          ni++;
        }
      }
    }

    return {
      oldTitle: oldSections.length > 0 ? (oldSections[0]._sourceTitle || '原版合同') : '原版合同',
      newTitle: newSections.length > 0 ? (newSections[0]._sourceTitle || '修订版合同') : '修订版合同',
      sectionDiffs,
      summary
    };
  }

  /**
   * 获取 diff 摘要统计
   */
  function getDiffSummary(diffResult) {
    return diffResult.summary;
  }

  return {
    compareSections,
    computeSimilarity,
    alignParagraphs,
    computeInlineDiff,
    getDiffSummary
  };
})();
