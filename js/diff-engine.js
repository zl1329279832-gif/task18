/**
 * diff-engine.js - 文本Diff引擎
 * 纯计算模块，负责章节匹配、段落对齐、行内字符级diff
 * 算法：bigram Jaccard相似度、Myers O(ND) diff、LCS段落对齐
 */
const DiffEngine = (() => {
  const SIMILARITY_THRESHOLD = 0.3;
  const UNCHANGED_THRESHOLD = 0.95;
  const MODIFIED_THRESHOLD = 0.8;
  const TITLE_WEIGHT = 0.6;
  const CONTENT_WEIGHT = 0.4;
  const LONG_TEXT_LIMIT = 2000;

  // ==================== 相似度计算 ====================

  /**
   * 计算字符bigram集合
   */
  function getBigrams(text) {
    const bigrams = new Set();
    const normalized = text.replace(/\s+/g, '');
    for (let i = 0; i < normalized.length - 1; i++) {
      bigrams.add(normalized[i] + normalized[i + 1]);
    }
    return bigrams;
  }

  /**
   * Jaccard相似度（基于字符bigram）
   */
  function computeSimilarity(textA, textB) {
    if (textA === textB) return 1;
    if (!textA || !textB) return 0;

    const a = getBigrams(textA);
    const b = getBigrams(textB);
    if (a.size === 0 && b.size === 0) return 1;
    if (a.size === 0 || b.size === 0) return 0;

    let intersection = 0;
    for (const bigram of a) {
      if (b.has(bigram)) intersection++;
    }
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  /**
   * 标题归一化：去除章节编号前缀
   */
  function normalizeTitle(title) {
    return title
      .replace(/^第[一二三四五六七八九十百千零〇\d]+[章节条款项][\s:：]*/g, '')
      .replace(/^\d+[\.\d]*[\s:：]*/g, '')
      .replace(/^[（(][一二三四五六七八九十\d]+[）)]\s*/g, '')
      .trim();
  }

  /**
   * 获取章节全文（拼接所有段落）
   */
  function getSectionText(section) {
    if (!section || !section.paragraphs) return '';
    return section.paragraphs.map(p => p.text).join('\n');
  }

  // ==================== Myers Diff 算法 ====================

  /**
   * Myers O(ND) diff 算法实现
   * 返回编辑脚本 [{type: 'equal'|'insert'|'delete', text}]
   */
  function myersDiff(a, b) {
    const N = a.length;
    const M = b.length;

    if (N === 0 && M === 0) return [];
    if (N === 0) return [{ type: 'insert', text: b }];
    if (M === 0) return [{ type: 'delete', text: a }];
    if (a === b) return [{ type: 'equal', text: a }];

    const MAX = N + M;
    const vSize = 2 * MAX + 1;
    const v = new Int32Array(vSize);
    const trace = [];

    // 偏移量，使k可以为负值
    const offset = MAX;

    for (let d = 0; d <= MAX; d++) {
      // 保存当前V状态用于回溯
      trace.push(new Int32Array(v));

      for (let k = -d; k <= d; k += 2) {
        let x;
        if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) {
          x = v[k + 1 + offset]; // 向下移动（插入）
        } else {
          x = v[k - 1 + offset] + 1; // 向右移动（删除）
        }
        let y = x - k;

        // 沿对角线延伸（相等字符）
        while (x < N && y < M && a[x] === b[y]) {
          x++;
          y++;
        }

        v[k + offset] = x;

        if (x >= N && y >= M) {
          return backtrack(trace, a, b, offset);
        }
      }
    }

    // 不应到达此处
    return [{ type: 'delete', text: a }, { type: 'insert', text: b }];
  }

  /**
   * 回溯生成编辑脚本
   */
  function backtrack(trace, a, b, offset) {
    const N = a.length;
    const M = b.length;
    let x = N;
    let y = M;
    const edits = [];

    for (let d = trace.length - 1; d > 0; d--) {
      const v = trace[d];
      const vPrev = trace[d - 1];
      const k = x - y;

      let prevK;
      if (k === -d || (k !== d && vPrev[k - 1 + offset] < vPrev[k + 1 + offset])) {
        prevK = k + 1;
      } else {
        prevK = k - 1;
      }

      const prevX = vPrev[prevK + offset];
      const prevY = prevX - prevK;

      // 对角线上的相等字符
      while (x > prevX && y > prevY) {
        x--;
        y--;
        edits.unshift({ type: 'equal', char: a[x] });
      }

      if (d > 0) {
        if (x === prevX) {
          // 插入
          y--;
          edits.unshift({ type: 'insert', char: b[y] });
        } else {
          // 删除
          x--;
          edits.unshift({ type: 'delete', char: a[x] });
        }
      }
    }

    // 处理d=0时的对角线
    while (x > 0 && y > 0) {
      x--;
      y--;
      edits.unshift({ type: 'equal', char: a[x] });
    }

    // 合并相邻同类型的编辑
    return mergeEdits(edits);
  }

  /**
   * 合并相邻同类型编辑为连续段
   */
  function mergeEdits(edits) {
    if (edits.length === 0) return [];

    const segments = [];
    let current = { type: edits[0].type, text: edits[0].char };

    for (let i = 1; i < edits.length; i++) {
      if (edits[i].type === current.type) {
        current.text += edits[i].char;
      } else {
        segments.push(current);
        current = { type: edits[i].type, text: edits[i].char };
      }
    }
    segments.push(current);

    // 后处理：极短的equal段（<3字符）合并到周围变更中
    return collapseShortEquals(segments);
  }

  /**
   * 折叠极短的equal段（在两个变更之间的<3字符equal视为变更的一部分）
   */
  function collapseShortEquals(segments) {
    if (segments.length <= 2) return segments;

    const result = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.type === 'equal' && seg.text.length < 3 &&
          i > 0 && i < segments.length - 1 &&
          result.length > 0 && result[result.length - 1].type !== 'equal') {
        // 这个短equal夹在两个变更之间，拆成delete+insert
        result.push({ type: 'delete', text: seg.text });
        result.push({ type: 'insert', text: seg.text });
      } else {
        result.push(seg);
      }
    }

    // 再次合并相邻同类型
    const merged = [];
    for (const seg of result) {
      if (merged.length > 0 && merged[merged.length - 1].type === seg.type) {
        merged[merged.length - 1].text += seg.text;
      } else {
        merged.push({ ...seg });
      }
    }
    return merged;
  }

  /**
   * 中文标点和空白分词
   */
  function tokenize(text) {
    const tokens = [];
    let current = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (/[\s,，。！？；：、""''（）《》【】\(\)\[\]\{\}]/.test(ch)) {
        if (current) { tokens.push(current); current = ''; }
        tokens.push(ch);
      } else {
        current += ch;
      }
    }
    if (current) tokens.push(current);
    return tokens;
  }

  /**
   * 词级diff（用于超长文本降级处理）
   */
  function wordLevelDiff(origText, revText) {
    const origTokens = tokenize(origText);
    const revTokens = tokenize(revText);

    const N = origTokens.length;
    const M = revTokens.length;
    const MAX = N + M;

    if (MAX > 10000) {
      // 极端情况下的简单fallback
      return [{ type: 'delete', text: origText }, { type: 'insert', text: revText }];
    }

    const offset = MAX;
    const v = new Int32Array(2 * MAX + 1);
    const trace = [];

    for (let d = 0; d <= MAX; d++) {
      trace.push(new Int32Array(v));
      for (let k = -d; k <= d; k += 2) {
        let x;
        if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) {
          x = v[k + 1 + offset];
        } else {
          x = v[k - 1 + offset] + 1;
        }
        let y = x - k;
        while (x < N && y < M && origTokens[x] === revTokens[y]) {
          x++;
          y++;
        }
        v[k + offset] = x;
        if (x >= N && y >= M) {
          return backtrackTokens(trace, origTokens, revTokens, offset);
        }
      }
    }
    return [{ type: 'delete', text: origText }, { type: 'insert', text: revText }];
  }

  /**
   * 词级回溯
   */
  function backtrackTokens(trace, origTokens, revTokens, offset) {
    const N = origTokens.length;
    const M = revTokens.length;
    let x = N, y = M;
    const edits = [];

    for (let d = trace.length - 1; d > 0; d--) {
      const vPrev = trace[d - 1];
      const k = x - y;
      let prevK;
      if (k === -d || (k !== d && vPrev[k - 1 + offset] < vPrev[k + 1 + offset])) {
        prevK = k + 1;
      } else {
        prevK = k - 1;
      }
      const prevX = vPrev[prevK + offset];
      const prevY = prevX - prevK;

      while (x > prevX && y > prevY) {
        x--; y--;
        edits.unshift({ type: 'equal', text: origTokens[x] });
      }
      if (d > 0) {
        if (x === prevX) {
          y--;
          edits.unshift({ type: 'insert', text: revTokens[y] });
        } else {
          x--;
          edits.unshift({ type: 'delete', text: origTokens[x] });
        }
      }
    }
    while (x > 0 && y > 0) {
      x--; y--;
      edits.unshift({ type: 'equal', text: origTokens[x] });
    }

    // 合并相邻同类型
    const segments = [];
    for (const edit of edits) {
      if (segments.length > 0 && segments[segments.length - 1].type === edit.type) {
        segments[segments.length - 1].text += edit.text;
      } else {
        segments.push({ ...edit });
      }
    }
    return segments;
  }

  /**
   * 行内diff入口
   * 短文本用字符级Myers，长文本用词级降级
   */
  function diffInline(originalText, revisedText) {
    if (originalText === revisedText) return [{ type: 'equal', text: originalText }];
    if (!originalText) return [{ type: 'insert', text: revisedText }];
    if (!revisedText) return [{ type: 'delete', text: originalText }];

    if (originalText.length > LONG_TEXT_LIMIT && revisedText.length > LONG_TEXT_LIMIT) {
      return wordLevelDiff(originalText, revisedText);
    }

    return myersDiff(originalText, revisedText);
  }

  // ==================== 章节匹配 ====================

  /**
   * 匹配两个版本的章节
   * 返回 SectionMapping[]
   */
  function matchSections(originalSections, revisedSections) {
    const N = originalSections.length;
    const M = revisedSections.length;

    if (N === 0 && M === 0) return [];
    if (N === 0) {
      return revisedSections.map(s => ({
        type: 'added',
        originalSection: null,
        revisedSection: s,
        similarity: 0,
        titleChanged: false,
        paragraphDiffs: []
      }));
    }
    if (M === 0) {
      return originalSections.map(s => ({
        type: 'deleted',
        originalSection: s,
        revisedSection: null,
        similarity: 0,
        titleChanged: false,
        paragraphDiffs: []
      }));
    }

    // 构建相似度矩阵
    const matrix = [];
    const pairs = [];

    for (let i = 0; i < N; i++) {
      matrix[i] = [];
      const origTitle = normalizeTitle(originalSections[i].title);
      const origText = getSectionText(originalSections[i]);

      for (let j = 0; j < M; j++) {
        const revTitle = normalizeTitle(revisedSections[j].title);
        const revText = getSectionText(revisedSections[j]);

        const titleSim = computeSimilarity(origTitle, revTitle);
        const contentSim = computeSimilarity(origText, revText);
        const combined = TITLE_WEIGHT * titleSim + CONTENT_WEIGHT * contentSim;

        matrix[i][j] = combined;
        if (combined >= SIMILARITY_THRESHOLD) {
          pairs.push({ i, j, similarity: combined, titleSim });
        }
      }
    }

    // 按相似度降序排列，贪心匹配
    pairs.sort((a, b) => b.similarity - a.similarity);

    const matchedOrig = new Set();
    const matchedRev = new Set();
    const matches = [];

    for (const pair of pairs) {
      if (matchedOrig.has(pair.i) || matchedRev.has(pair.j)) continue;
      matchedOrig.add(pair.i);
      matchedRev.add(pair.j);
      matches.push(pair);
    }

    // 构建结果：保持原始顺序
    const result = [];
    let origIdx = 0;
    let revIdx = 0;

    // 按照出现顺序交错排列matched/added/deleted
    const matchMap = new Map(); // origIdx -> match
    const revMatchMap = new Map(); // revIdx -> match
    for (const m of matches) {
      matchMap.set(m.i, m);
      revMatchMap.set(m.j, m);
    }

    // 使用双指针遍历
    const usedMatches = new Set();
    while (origIdx < N || revIdx < M) {
      // 检查当前原始章节是否有匹配
      if (origIdx < N && matchMap.has(origIdx)) {
        const match = matchMap.get(origIdx);
        if (!usedMatches.has(match)) {
          // 先输出修订版中在此匹配之前的未匹配章节（added）
          while (revIdx < match.j) {
            if (!revMatchMap.has(revIdx)) {
              result.push({
                type: 'added',
                originalSection: null,
                revisedSection: revisedSections[revIdx],
                similarity: 0,
                titleChanged: false,
                paragraphDiffs: []
              });
            }
            revIdx++;
          }
          // 输出匹配对
          const origSection = originalSections[match.i];
          const revSection = revisedSections[match.j];
          const titleChanged = origSection.title !== revSection.title;

          result.push({
            type: 'matched',
            originalSection: origSection,
            revisedSection: revSection,
            similarity: match.similarity,
            titleChanged,
            paragraphDiffs: diffParagraphs(origSection.paragraphs, revSection.paragraphs)
          });
          usedMatches.add(match);
          revIdx = match.j + 1;
        }
        origIdx++;
      } else if (origIdx < N) {
        // 未匹配的原始章节（deleted）
        result.push({
          type: 'deleted',
          originalSection: originalSections[origIdx],
          revisedSection: null,
          similarity: 0,
          titleChanged: false,
          paragraphDiffs: []
        });
        origIdx++;
      } else {
        // 剩余的修订版章节（added）
        if (!revMatchMap.has(revIdx)) {
          result.push({
            type: 'added',
            originalSection: null,
            revisedSection: revisedSections[revIdx],
            similarity: 0,
            titleChanged: false,
            paragraphDiffs: []
          });
        }
        revIdx++;
      }
    }

    return result;
  }

  // ==================== 段落对齐 ====================

  /**
   * LCS段落对齐
   * 基于相似度的最长公共子序列变种
   */
  function diffParagraphs(origParas, revParas) {
    if (!origParas) origParas = [];
    if (!revParas) revParas = [];

    const N = origParas.length;
    const M = revParas.length;

    if (N === 0 && M === 0) return [];
    if (N === 0) {
      return revParas.map(p => ({
        type: 'added',
        originalParagraph: null,
        revisedParagraph: p,
        inlineDiffs: []
      }));
    }
    if (M === 0) {
      return origParas.map(p => ({
        type: 'deleted',
        originalParagraph: p,
        revisedParagraph: null,
        inlineDiffs: []
      }));
    }

    // 构建相似度矩阵
    const simMatrix = [];
    for (let i = 0; i < N; i++) {
      simMatrix[i] = [];
      for (let j = 0; j < M; j++) {
        simMatrix[i][j] = computeSimilarity(origParas[i].text, revParas[j].text);
      }
    }

    // LCS DP：找最优对齐
    // dp[i][j] = 从origParas[0..i-1]和revParas[0..j-1]的最大匹配相似度之和
    const dp = [];
    for (let i = 0; i <= N; i++) {
      dp[i] = new Float64Array(M + 1);
    }

    for (let i = 1; i <= N; i++) {
      for (let j = 1; j <= M; j++) {
        const sim = simMatrix[i - 1][j - 1];
        if (sim >= MODIFIED_THRESHOLD) {
          dp[i][j] = Math.max(dp[i - 1][j - 1] + sim, dp[i - 1][j], dp[i][j - 1]);
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // 回溯找对齐
    const aligned = [];
    let i = N, j = M;
    while (i > 0 && j > 0) {
      const sim = simMatrix[i - 1][j - 1];
      if (sim >= MODIFIED_THRESHOLD && dp[i][j] === dp[i - 1][j - 1] + sim) {
        aligned.unshift({ origIdx: i - 1, revIdx: j - 1, similarity: sim });
        i--;
        j--;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    // 根据对齐结果构建ParagraphDiff数组
    const result = [];
    let lastOrigIdx = -1;
    let lastRevIdx = -1;

    for (const pair of aligned) {
      // 输出pair之前的未对齐段落
      for (let oi = lastOrigIdx + 1; oi < pair.origIdx; oi++) {
        result.push({
          type: 'deleted',
          originalParagraph: origParas[oi],
          revisedParagraph: null,
          inlineDiffs: []
        });
      }
      for (let ri = lastRevIdx + 1; ri < pair.revIdx; ri++) {
        result.push({
          type: 'added',
          originalParagraph: null,
          revisedParagraph: revParas[ri],
          inlineDiffs: []
        });
      }

      // 输出对齐的段落
      if (pair.similarity >= UNCHANGED_THRESHOLD) {
        result.push({
          type: 'unchanged',
          originalParagraph: origParas[pair.origIdx],
          revisedParagraph: revParas[pair.revIdx],
          inlineDiffs: []
        });
      } else {
        result.push({
          type: 'modified',
          originalParagraph: origParas[pair.origIdx],
          revisedParagraph: revParas[pair.revIdx],
          inlineDiffs: diffInline(origParas[pair.origIdx].text, revParas[pair.revIdx].text)
        });
      }

      lastOrigIdx = pair.origIdx;
      lastRevIdx = pair.revIdx;
    }

    // 输出末尾未对齐的段落
    for (let oi = lastOrigIdx + 1; oi < N; oi++) {
      result.push({
        type: 'deleted',
        originalParagraph: origParas[oi],
        revisedParagraph: null,
        inlineDiffs: []
      });
    }
    for (let ri = lastRevIdx + 1; ri < M; ri++) {
      result.push({
        type: 'added',
        originalParagraph: null,
        revisedParagraph: revParas[ri],
        inlineDiffs: []
      });
    }

    return result;
  }

  // ==================== 顶层编排 ====================

  /**
   * 对比两个版本的合同
   * @param {Section[]} originalSections - 原始版本章节
   * @param {Section[]} revisedSections - 修订版本章节
   * @returns {DiffResult}
   */
  function compare(originalSections, revisedSections) {
    const sectionMappings = matchSections(originalSections, revisedSections);

    // 计算统计
    let addedSections = 0;
    let deletedSections = 0;
    let modifiedSections = 0;
    let unchangedSections = 0;

    for (const mapping of sectionMappings) {
      switch (mapping.type) {
        case 'added': addedSections++; break;
        case 'deleted': deletedSections++; break;
        case 'matched':
          // 检查匹配的章节是否有实际变更
          const hasChanges = mapping.paragraphDiffs.some(pd =>
            pd.type !== 'unchanged'
          );
          if (hasChanges || mapping.titleChanged) {
            modifiedSections++;
          } else {
            unchangedSections++;
          }
          break;
      }
    }

    return {
      sectionMappings,
      stats: {
        totalSectionsOriginal: originalSections.length,
        totalSectionsRevised: revisedSections.length,
        addedSections,
        deletedSections,
        modifiedSections,
        unchangedSections
      }
    };
  }

  return {
    compare,
    matchSections,
    diffParagraphs,
    diffInline,
    computeSimilarity,
    normalizeTitle,
    getSectionText
  };
})();
