/**
 * annotation-renderer.js - 标注渲染模块
 * 负责DOM渲染、高亮绘制、虚拟滚动、搜索高亮
 * 支持stale批注渲染、筛选同步高亮
 */
const AnnotationRenderer = (() => {
  // 虚拟滚动配置
  const BUFFER_SCREENS = 2; // 上下各缓冲2屏
  let container = null;
  let sections = [];
  let sectionElements = new Map(); // sectionId -> DOM element
  let observer = null;
  let currentSearchTerm = '';
  let searchMatches = [];

  // 高亮筛选状态（与右侧列表筛选联动）
  let highlightFilter = { riskType: '', status: '' };

  /**
   * 初始化渲染器
   */
  function init(containerEl) {
    container = containerEl;
    setupIntersectionObserver();
  }

  /**
   * 设置 IntersectionObserver 用于虚拟滚动
   */
  function setupIntersectionObserver() {
    if (observer) observer.disconnect();

    observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const sectionEl = entry.target;
        const sectionId = sectionEl.dataset.sectionId;
        if (entry.isIntersecting) {
          ensureSectionRendered(sectionId);
        } else {
          // 超出缓冲区域，卸载内容（保留占位）
          collapseSection(sectionId);
        }
      });
    }, {
      root: container,
      rootMargin: `${BUFFER_SCREENS * 100}% 0px`,
      threshold: 0
    });
  }

  /**
   * 渲染所有章节（带虚拟滚动占位）
   */
  function renderSections(sectionData, annotations) {
    sections = sectionData;
    container.innerHTML = '';
    sectionElements.clear();

    sections.forEach(section => {
      // 创建占位容器
      const wrapper = document.createElement('div');
      wrapper.className = 'section-wrapper';
      wrapper.dataset.sectionId = section.id;
      wrapper.dataset.rendered = 'false';

      // 标题始终渲染
      const header = document.createElement('div');
      header.className = 'section-header';
      header.innerHTML = `
        <span class="section-level level-${section.level}">
          ${escapeHTML(section.title)}
        </span>
        <span class="annotation-count" data-section="${section.id}"></span>
      `;
      wrapper.appendChild(header);

      // 内容占位
      const content = document.createElement('div');
      content.className = 'section-content';
      content.dataset.placeholder = 'true';
      // 预估高度
      const estimatedHeight = section.paragraphs.length * 60;
      content.style.minHeight = estimatedHeight + 'px';
      wrapper.appendChild(content);

      container.appendChild(wrapper);
      sectionElements.set(section.id, wrapper);
      observer.observe(wrapper);
    });

    // 更新批注计数（只计活跃批注）
    updateAnnotationCounts(annotations);
  }

  /**
   * 确保章节内容已渲染
   */
  function ensureSectionRendered(sectionId) {
    const wrapper = sectionElements.get(sectionId);
    if (!wrapper || wrapper.dataset.rendered === 'true') return;

    const section = sections.find(s => s.id === sectionId);
    if (!section) return;

    const contentEl = wrapper.querySelector('.section-content');
    contentEl.innerHTML = '';
    contentEl.dataset.placeholder = 'false';
    contentEl.style.minHeight = '';

    section.paragraphs.forEach(para => {
      const paraEl = document.createElement('div');
      paraEl.className = 'paragraph';
      paraEl.dataset.sectionId = sectionId;
      paraEl.dataset.paraIndex = para.index;
      paraEl.textContent = para.text;
      contentEl.appendChild(paraEl);
    });

    // 应用高亮
    applyHighlights(sectionId, contentEl);
    wrapper.dataset.rendered = 'true';
  }

  /**
   * 折叠章节（虚拟滚动卸载）
   */
  function collapseSection(sectionId) {
    const wrapper = sectionElements.get(sectionId);
    if (!wrapper || wrapper.dataset.rendered !== 'true') return;

    const section = sections.find(s => s.id === sectionId);
    const contentEl = wrapper.querySelector('.section-content');
    const currentHeight = contentEl.offsetHeight;

    contentEl.innerHTML = '';
    contentEl.dataset.placeholder = 'true';
    contentEl.style.minHeight = currentHeight + 'px';
    wrapper.dataset.rendered = 'false';
  }

  /**
   * 设置高亮筛选条件（与右侧列表筛选联动）
   */
  function setHighlightFilter(riskType, status) {
    highlightFilter.riskType = riskType || '';
    highlightFilter.status = status || '';
    refreshHighlights();
  }

  /**
   * 判断批注是否通过当前筛选条件
   */
  function passesFilter(annotation) {
    if (highlightFilter.riskType && annotation.riskType !== highlightFilter.riskType) return false;
    if (highlightFilter.status && annotation.status !== highlightFilter.status) return false;
    return true;
  }

  /**
   * 对指定章节应用高亮
   */
  function applyHighlights(sectionId, contentEl) {
    const allAnnotations = AnnotationManager.getAllAnnotations()
      .filter(a => a.sectionId === sectionId);

    if (allAnnotations.length === 0 && !currentSearchTerm) return;

    const paragraphs = contentEl.querySelectorAll('.paragraph');
    paragraphs.forEach(paraEl => {
      const paraIdx = parseInt(paraEl.dataset.paraIndex);
      const paraAnns = allAnnotations.filter(a => a.paragraphIndex === paraIdx);
      const text = paraEl.textContent;

      // 收集所有需要高亮的范围
      let highlights = [];

      // 批注高亮（区分正常和stale，应用筛选）
      paraAnns.forEach(ann => {
        // 筛选过滤：不通过筛选的批注不渲染高亮
        if (!passesFilter(ann)) return;

        highlights.push({
          start: ann.startOffset,
          end: ann.endOffset,
          type: ann.stale ? 'stale-annotation' : 'annotation',
          data: ann
        });
      });

      // 搜索高亮
      if (currentSearchTerm) {
        let searchIdx = 0;
        const lowerText = text.toLowerCase();
        const lowerTerm = currentSearchTerm.toLowerCase();
        while ((searchIdx = lowerText.indexOf(lowerTerm, searchIdx)) !== -1) {
          highlights.push({
            start: searchIdx,
            end: searchIdx + currentSearchTerm.length,
            type: 'search'
          });
          searchIdx += currentSearchTerm.length;
        }
      }

      if (highlights.length === 0) return;

      // 按位置排序
      highlights.sort((a, b) => a.start - b.start || a.end - b.end);

      // 构建高亮HTML
      paraEl.innerHTML = buildHighlightedHTML(text, highlights);
    });
  }

  /**
   * 构建高亮HTML（不破坏DOM结构）
   */
  function buildHighlightedHTML(text, highlights) {
    let result = '';
    let lastEnd = 0;

    highlights.forEach(h => {
      if (h.start < lastEnd) return; // 跳过重叠
      if (h.start > lastEnd) {
        result += escapeHTML(text.substring(lastEnd, h.start));
      }

      const highlighted = escapeHTML(text.substring(h.start, h.end));
      if (h.type === 'annotation') {
        const rt = AnnotationManager.RISK_TYPES[h.data.riskType];
        const color = rt ? rt.color : '#999';
        result += `<mark class="annotation-highlight risk-${h.data.riskType}"
          data-annotation-id="${h.data.id}"
          style="background-color: ${color}20; border-bottom: 2px solid ${color}"
          title="${rt ? rt.label : ''}: ${escapeHTML(h.data.comment || '')}">${highlighted}</mark>`;
      } else if (h.type === 'stale-annotation') {
        // 失效批注：灰色虚线
        const reason = h.data.staleReason || '锚点失效';
        result += `<mark class="annotation-highlight stale"
          data-annotation-id="${h.data.id}"
          style="background-color: #95a5a620; border-bottom: 2px dashed #95a5a6"
          title="[已失效] ${escapeHTML(reason)}">${highlighted}</mark>`;
      } else {
        result += `<mark class="search-highlight">${highlighted}</mark>`;
      }
      lastEnd = h.end;
    });

    if (lastEnd < text.length) {
      result += escapeHTML(text.substring(lastEnd));
    }

    return result;
  }

  /**
   * 刷新所有章节的高亮
   */
  function refreshHighlights() {
    sectionElements.forEach((wrapper, sectionId) => {
      if (wrapper.dataset.rendered === 'true') {
        const contentEl = wrapper.querySelector('.section-content');
        // 先恢复纯文本
        const section = sections.find(s => s.id === sectionId);
        if (!section) return;
        const paragraphs = contentEl.querySelectorAll('.paragraph');
        paragraphs.forEach(paraEl => {
          const paraIdx = parseInt(paraEl.dataset.paraIndex);
          const para = section.paragraphs.find(p => p.index === paraIdx);
          if (para) paraEl.textContent = para.text;
        });
        // 重新应用高亮
        applyHighlights(sectionId, contentEl);
      }
    });
    updateAnnotationCounts(AnnotationManager.getAllAnnotations());
  }

  /**
   * 搜索高亮（带 debounce）
   */
  let searchTimer = null;
  let searchCallback = null;

  function onSearchComplete(cb) {
    searchCallback = cb;
  }

  function search(term) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentSearchTerm = term.trim();
      searchMatches = [];

      if (currentSearchTerm) {
        sections.forEach(section => {
          section.paragraphs.forEach(para => {
            const lowerText = para.text.toLowerCase();
            const lowerTerm = currentSearchTerm.toLowerCase();
            let idx = 0;
            while ((idx = lowerText.indexOf(lowerTerm, idx)) !== -1) {
              searchMatches.push({
                sectionId: section.id,
                paragraphIndex: para.index,
                offset: idx
              });
              idx += lowerTerm.length;
            }
          });
        });
      }

      refreshHighlights();

      // 通知搜索完成
      if (searchCallback) {
        searchCallback(searchMatches);
      }
    }, 300);
  }

  function getSearchMatchCount() {
    return searchMatches.length;
  }

  /**
   * 滚动到指定批注
   */
  function scrollToAnnotation(annotationId) {
    const ann = AnnotationManager.getAllAnnotations().find(a => a.id === annotationId);
    if (!ann) return false;

    // 确保章节已渲染
    ensureSectionRendered(ann.sectionId);

    const wrapper = sectionElements.get(ann.sectionId);
    if (!wrapper) return false;

    // 滚动到章节
    wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // 高亮闪烁效果
    setTimeout(() => {
      const mark = wrapper.querySelector(`[data-annotation-id="${annotationId}"]`);
      if (mark) {
        mark.classList.add('highlight-flash');
        setTimeout(() => mark.classList.remove('highlight-flash'), 2000);
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);

    return true;
  }

  /**
   * 获取用户在内容区的文本选择
   */
  function getSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;

    const range = sel.getRangeAt(0);
    const paraEl = findParentParagraph(range.startContainer);
    if (!paraEl) return null;

    // 确保起止都在同一段落
    const endParaEl = findParentParagraph(range.endContainer);
    if (endParaEl !== paraEl) return null;

    const sectionId = paraEl.dataset.sectionId;
    const paraIndex = parseInt(paraEl.dataset.paraIndex);

    // 计算相对于纯文本的偏移
    const text = paraEl.textContent;
    const preRange = document.createRange();
    preRange.setStart(paraEl, 0);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = preRange.toString().length;

    const fullRange = document.createRange();
    fullRange.setStart(paraEl, 0);
    fullRange.setEnd(range.endContainer, range.endOffset);
    const endOffset = fullRange.toString().length;

    const anchorText = text.substring(startOffset, endOffset);

    return { sectionId, paragraphIndex: paraIndex, startOffset, endOffset, anchorText };
  }

  /**
   * 查找父级段落元素
   */
  function findParentParagraph(node) {
    let current = node;
    while (current && current !== container) {
      if (current.classList && current.classList.contains('paragraph')) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  /**
   * 更新章节批注计数（只计活跃批注）
   */
  function updateAnnotationCounts(annotations) {
    const counts = {};
    annotations.forEach(a => {
      if (!a.stale) {
        counts[a.sectionId] = (counts[a.sectionId] || 0) + 1;
      }
    });

    // stale计数
    const staleCounts = {};
    annotations.forEach(a => {
      if (a.stale) {
        staleCounts[a.sectionId] = (staleCounts[a.sectionId] || 0) + 1;
      }
    });

    document.querySelectorAll('.annotation-count').forEach(el => {
      const sectionId = el.dataset.section;
      const count = counts[sectionId] || 0;
      const staleCount = staleCounts[sectionId] || 0;
      let text = '';
      if (count > 0) text += `(${count} 条批注)`;
      if (staleCount > 0) text += ` (${staleCount} 条失效)`;
      el.textContent = text;
    });
  }

  /**
   * HTML转义
   */
  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * 销毁渲染器
   */
  function destroy() {
    if (observer) observer.disconnect();
    if (container) container.innerHTML = '';
    sectionElements.clear();
    sections = [];
    currentSearchTerm = '';
    searchMatches = [];
    highlightFilter = { riskType: '', status: '' };
  }

  return {
    init, renderSections, refreshHighlights, search, onSearchComplete,
    scrollToAnnotation, getSelection, destroy, getSearchMatchCount,
    ensureSectionRendered, escapeHTML, setHighlightFilter
  };
})();
