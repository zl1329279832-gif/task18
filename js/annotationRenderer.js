/**
 * annotationRenderer.js - 标注渲染模块
 * 负责合同内容渲染、条款高亮、搜索高亮、批注定位
 * 处理重复标注、超长合同性能优化
 */
const AnnotationRenderer = (() => {
  let _containerEl = null;
  let _sections = [];
  let _annotations = [];
  let _searchMatches = [];
  let _activeSearchIdx = -1;
  let _contextToolbar = null;
  let _lastSelection = null;
  let _visibleSections = new Set();
  let _observer = null;

  // 风险类型中文映射
  const RISK_LABELS = {
    payment: '付款条款',
    breach: '违约责任',
    confidential: '保密义务',
    delivery: '交付期限',
    dispute: '争议解决',
    entity: '主体信息缺失',
  };

  const LEVEL_LABELS = { high: '高', medium: '中', low: '低' };

  /**
   * 初始化渲染器
   */
  function init(containerEl) {
    _containerEl = containerEl;
    _setupSelectionListener();
  }

  /**
   * 渲染整个合同内容
   */
  function renderContract(sections, annotations) {
    if (!_containerEl) return;
    _sections = sections;
    _annotations = annotations || [];
    _containerEl.innerHTML = '';

    // 使用 DocumentFragment 减少重排
    const fragment = document.createDocumentFragment();

    sections.forEach((section) => {
      const sectionEl = document.createElement('div');
      sectionEl.className = 'contract-section';
      sectionEl.id = section.id;
      sectionEl.dataset.sectionId = section.id;

      // 章节标题
      if (!section.isDefault) {
        const headingEl = document.createElement('h3');
        headingEl.className = `section-heading depth-${section.depth}`;
        headingEl.textContent = section.title;
        headingEl.id = section.id + '-heading';
        sectionEl.appendChild(headingEl);
      }

      // 段落
      section.paragraphs.forEach((para) => {
        const pEl = document.createElement('div');
        pEl.className = 'clause-paragraph';
        pEl.id = para.id;
        pEl.dataset.paragraphId = para.id;
        pEl.dataset.sectionId = section.id;

        // 应用批注高亮
        pEl.innerHTML = _applyAnnotations(para.text, para.id);

        sectionEl.appendChild(pEl);
      });

      fragment.appendChild(sectionEl);
    });

    _containerEl.appendChild(fragment);

    // 设置 IntersectionObserver 实现懒加载
    _setupLazyObserver();
  }

  /**
   * 在段落文本上应用批注高亮
   */
  function _applyAnnotations(text, paragraphId) {
    const paraAnnotations = _annotations.filter(a => a.paragraphId === paragraphId);

    if (paraAnnotations.length === 0) {
      return _escapeHtml(text);
    }

    // 按 startOffset 排序，处理重叠
    const sorted = paraAnnotations
      .filter(a => a.startOffset != null && a.endOffset != null)
      .sort((a, b) => a.startOffset - b.startOffset);

    if (sorted.length === 0) {
      return _escapeHtml(text);
    }

    // 检测重复标注
    _markDuplicates(sorted);

    // 构建标注区间，处理重叠
    const segments = _buildSegments(text, sorted);
    return segments.map(seg => {
      const escaped = _escapeHtml(seg.text);
      if (!seg.annotation) return escaped;

      const a = seg.annotation;
      const dupClass = a._duplicate ? ' duplicate-warning' : '';
      const indicator = `<span class="risk-indicator level-${a.riskLevel}">${LEVEL_LABELS[a.riskLevel] || ''}</span>`;
      return `<span class="annotation-highlight${dupClass}" data-risk="${a.riskType}" data-annotation-id="${a.id}" title="${RISK_LABELS[a.riskType] || ''} - ${a.comment || ''}">${escaped}${indicator}</span>`;
    }).join('');
  }

  /**
   * 构建文本分段（处理标注区间重叠）
   */
  function _buildSegments(text, annotations) {
    const segments = [];
    let pos = 0;

    for (const a of annotations) {
      const start = Math.max(a.startOffset, pos);
      const end = Math.min(a.endOffset, text.length);

      if (start < 0 || end > text.length || start >= end) continue;

      // 标注前的普通文本
      if (pos < start) {
        segments.push({ text: text.slice(pos, start), annotation: null });
      }

      // 标注区域
      segments.push({ text: text.slice(start, end), annotation: a });
      pos = end;
    }

    // 剩余文本
    if (pos < text.length) {
      segments.push({ text: text.slice(pos), annotation: null });
    }

    return segments;
  }

  /**
   * 检测并标记重复标注
   */
  function _markDuplicates(sorted) {
    for (let i = 0; i < sorted.length; i++) {
      sorted[i]._duplicate = false;
      for (let j = 0; j < i; j++) {
        // 检查是否有大量重叠
        const overlapStart = Math.max(sorted[i].startOffset, sorted[j].startOffset);
        const overlapEnd = Math.min(sorted[i].endOffset, sorted[j].endOffset);
        if (overlapEnd > overlapStart) {
          const overlapLen = overlapEnd - overlapStart;
          const iLen = sorted[i].endOffset - sorted[i].startOffset;
          if (overlapLen / iLen > 0.7) {
            sorted[i]._duplicate = true;
            break;
          }
        }
      }
    }
  }

  /**
   * 刷新单个段落的高亮渲染
   */
  function refreshParagraph(paragraphId, annotations) {
    _annotations = annotations;
    const el = document.getElementById(paragraphId);
    if (!el) return;

    // 找到原始文本
    let originalText = '';
    for (const section of _sections) {
      for (const p of section.paragraphs) {
        if (p.id === paragraphId) {
          originalText = p.text;
          break;
        }
      }
      if (originalText) break;
    }

    el.innerHTML = _applyAnnotations(originalText, paragraphId);
  }

  /**
   * 刷新所有标注渲染
   */
  function refreshAll(annotations) {
    _annotations = annotations;
    _sections.forEach(section => {
      section.paragraphs.forEach(para => {
        const el = document.getElementById(para.id);
        if (el) {
          el.innerHTML = _applyAnnotations(para.text, para.id);
        }
      });
    });
  }

  /**
   * 搜索高亮
   */
  function highlightSearch(keyword) {
    clearSearch();
    if (!keyword || !keyword.trim()) return [];

    _searchMatches = [];
    const term = keyword.trim().toLowerCase();

    _sections.forEach(section => {
      section.paragraphs.forEach(para => {
        const el = document.getElementById(para.id);
        if (!el) return;

        const text = para.text;
        const lower = text.toLowerCase();
        let idx = lower.indexOf(term);

        while (idx !== -1) {
          _searchMatches.push({
            paragraphId: para.id,
            sectionId: section.id,
            offset: idx,
            length: term.length,
          });
          idx = lower.indexOf(term, idx + 1);
        }
      });
    });

    // 应用搜索高亮
    if (_searchMatches.length > 0) {
      _applySearchHighlights();
      _activeSearchIdx = 0;
      _scrollToSearchMatch(0);
    }

    return _searchMatches;
  }

  /**
   * 应用搜索高亮到 DOM
   */
  function _applySearchHighlights() {
    // 按段落分组
    const byParagraph = {};
    _searchMatches.forEach((m, idx) => {
      if (!byParagraph[m.paragraphId]) byParagraph[m.paragraphId] = [];
      byParagraph[m.paragraphId].push({ ...m, globalIdx: idx });
    });

    for (const [pid, matches] of Object.entries(byParagraph)) {
      const el = document.getElementById(pid);
      if (!el) continue;

      // 在已有的 innerHTML 上添加搜索高亮
      let html = el.innerHTML;

      // 使用 text content 匹配而不是 innerHTML
      // 需要在纯文本层面定位然后映射到HTML
      const textContent = el.textContent;
      const keyword = textContent.slice(matches[0].offset, matches[0].offset + matches[0].length);

      // 简单方式：使用 TreeWalker 遍历文本节点
      _highlightTextNodes(el, keyword, matches);
    }
  }

  /**
   * 在 DOM 文本节点中添加搜索高亮
   */
  function _highlightTextNodes(rootEl, keyword, matches) {
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    const lowerKeyword = keyword.toLowerCase();
    let globalMatchIdx = 0;

    for (const textNode of textNodes) {
      const text = textNode.textContent;
      const lower = text.toLowerCase();
      let pos = lower.indexOf(lowerKeyword);

      if (pos === -1) continue;

      const parts = [];
      let lastEnd = 0;

      while (pos !== -1 && globalMatchIdx < matches.length) {
        if (pos > lastEnd) {
          parts.push(document.createTextNode(text.slice(lastEnd, pos)));
        }

        const mark = document.createElement('mark');
        mark.className = 'search-highlight';
        mark.dataset.searchIdx = matches[globalMatchIdx].globalIdx;
        mark.textContent = text.slice(pos, pos + lowerKeyword.length);
        parts.push(mark);

        lastEnd = pos + lowerKeyword.length;
        globalMatchIdx++;
        pos = lower.indexOf(lowerKeyword, lastEnd);
      }

      if (parts.length > 0) {
        if (lastEnd < text.length) {
          parts.push(document.createTextNode(text.slice(lastEnd)));
        }
        const parent = textNode.parentNode;
        for (const part of parts) {
          parent.insertBefore(part, textNode);
        }
        parent.removeChild(textNode);
      }
    }
  }

  /**
   * 导航到下一个搜索结果
   */
  function nextSearchMatch() {
    if (_searchMatches.length === 0) return -1;
    _activeSearchIdx = (_activeSearchIdx + 1) % _searchMatches.length;
    _scrollToSearchMatch(_activeSearchIdx);
    return _activeSearchIdx;
  }

  /**
   * 导航到上一个搜索结果
   */
  function prevSearchMatch() {
    if (_searchMatches.length === 0) return -1;
    _activeSearchIdx = (_activeSearchIdx - 1 + _searchMatches.length) % _searchMatches.length;
    _scrollToSearchMatch(_activeSearchIdx);
    return _activeSearchIdx;
  }

  /**
   * 滚动到指定搜索结果
   */
  function _scrollToSearchMatch(idx) {
    // 移除旧的 active
    const oldActive = document.querySelector('.search-highlight.active');
    if (oldActive) oldActive.classList.remove('active');

    const mark = document.querySelector(`[data-search-idx="${idx}"]`);
    if (mark) {
      mark.classList.add('active');
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /**
   * 清除搜索高亮
   */
  function clearSearch() {
    _searchMatches = [];
    _activeSearchIdx = -1;

    // 移除所有 mark 元素
    const marks = _containerEl ? _containerEl.querySelectorAll('mark.search-highlight') : [];
    marks.forEach(mark => {
      const parent = mark.parentNode;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    });
  }

  /**
   * 滚动到指定批注位置
   */
  function scrollToAnnotation(annotationId) {
    const el = _containerEl ? _containerEl.querySelector(`[data-annotation-id="${annotationId}"]`) : null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // 闪烁效果
      el.style.transition = 'filter 0.2s';
      el.style.filter = 'brightness(0.8)';
      setTimeout(() => { el.style.filter = ''; }, 600);
      return true;
    }
    return false;
  }

  /**
   * 滚动到指定章节
   */
  function scrollToSection(sectionId) {
    const heading = document.getElementById(sectionId + '-heading');
    const section = document.getElementById(sectionId);
    const target = heading || section;
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /**
   * 设置文本选中监听，弹出上下文工具栏
   */
  function _setupSelectionListener() {
    document.addEventListener('mouseup', (e) => {
      // 只在合同内容区域
      if (!_containerEl || !_containerEl.contains(e.target)) {
        _hideContextToolbar();
        return;
      }

      // 如果点击了已有的标注，触发编辑
      const annotationEl = e.target.closest('.annotation-highlight');
      if (annotationEl && !window.getSelection().toString().trim()) {
        const annId = annotationEl.dataset.annotationId;
        if (annId && typeof window.onAnnotationClick === 'function') {
          window.onAnnotationClick(annId);
        }
        return;
      }

      setTimeout(() => _checkSelection(e), 10);
    });

    document.addEventListener('mousedown', (e) => {
      if (_contextToolbar && !_contextToolbar.contains(e.target)) {
        _hideContextToolbar();
      }
    });
  }

  /**
   * 检查文本选择并显示上下文工具栏
   */
  function _checkSelection(e) {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';

    if (!text || text.length < 2) {
      _hideContextToolbar();
      return;
    }

    // 获取选区所在的段落
    const anchorPara = sel.anchorNode ? sel.anchorNode.parentElement.closest('.clause-paragraph') : null;
    const focusPara = sel.focusNode ? sel.focusNode.parentElement.closest('.clause-paragraph') : null;

    if (!anchorPara) {
      _hideContextToolbar();
      return;
    }

    // 计算选区在段落中的偏移
    const paraEl = anchorPara;
    const paraText = _getParagraphOriginalText(paraEl.dataset.paragraphId);

    if (!paraText) return;

    const startOffset = paraText.indexOf(text);
    const endOffset = startOffset >= 0 ? startOffset + text.length : -1;

    _lastSelection = {
      text: text,
      paragraphId: paraEl.dataset.paragraphId,
      sectionId: paraEl.dataset.sectionId,
      startOffset: startOffset,
      endOffset: endOffset,
    };

    _showContextToolbar(e);
  }

  /**
   * 获取段落的原始文本
   */
  function _getParagraphOriginalText(paragraphId) {
    for (const section of _sections) {
      for (const p of section.paragraphs) {
        if (p.id === paragraphId) return p.text;
      }
    }
    return null;
  }

  /**
   * 显示上下文工具栏
   */
  function _showContextToolbar(e) {
    _hideContextToolbar();

    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = _containerEl.closest('.contract-view').getBoundingClientRect();

    _contextToolbar = document.createElement('div');
    _contextToolbar.className = 'context-toolbar';
    _contextToolbar.innerHTML = `
      <button class="btn btn-primary btn-sm" id="ctx-annotate">添加批注</button>
    `;

    _contextToolbar.style.position = 'fixed';
    _contextToolbar.style.left = (rect.left + rect.width / 2 - 50) + 'px';
    _contextToolbar.style.top = (rect.top - 40) + 'px';

    document.body.appendChild(_contextToolbar);

    document.getElementById('ctx-annotate').addEventListener('click', () => {
      if (_lastSelection && typeof window.onAddAnnotation === 'function') {
        window.onAddAnnotation(_lastSelection);
      }
      _hideContextToolbar();
    });
  }

  /**
   * 隐藏上下文工具栏
   */
  function _hideContextToolbar() {
    if (_contextToolbar) {
      _contextToolbar.remove();
      _contextToolbar = null;
    }
  }

  /**
   * IntersectionObserver 懒加载（超长合同优化）
   */
  function _setupLazyObserver() {
    if (_observer) _observer.disconnect();

    const sectionEls = _containerEl.querySelectorAll('.contract-section');
    if (sectionEls.length < 20) return; // 短合同无需优化

    _observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const id = entry.target.dataset.sectionId;
        if (entry.isIntersecting) {
          _visibleSections.add(id);
          entry.target.style.contentVisibility = 'visible';
        } else {
          _visibleSections.delete(id);
          entry.target.style.contentVisibility = 'auto';
        }
      });
    }, { rootMargin: '200px 0px' });

    sectionEls.forEach(el => {
      el.style.contentVisibility = 'auto';
      el.style.containIntrinsicSize = 'auto 200px';
      _observer.observe(el);
    });
  }

  /**
   * 获取当前选中信息
   */
  function getLastSelection() {
    return _lastSelection;
  }

  /**
   * HTML 转义
   */
  function _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  return {
    init,
    renderContract,
    refreshParagraph,
    refreshAll,
    highlightSearch,
    nextSearchMatch,
    prevSearchMatch,
    clearSearch,
    scrollToAnnotation,
    scrollToSection,
    getLastSelection,
    RISK_LABELS,
    LEVEL_LABELS,
  };
})();
