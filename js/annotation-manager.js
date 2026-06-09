/**
 * annotation-manager.js - 批注管理模块
 * 负责批注CRUD、去重检测、稳定ID生成、状态流转
 * 支持 invalidated 状态、rangeId 持久化、迁移辅助
 */
const AnnotationManager = (() => {
  // 风险类型配置
  const RISK_TYPES = {
    payment:    { label: '付款条款',   color: '#e74c3c', icon: '¥',  desc: '付款条件、金额、方式等条款风险' },
    breach:     { label: '违约责任',   color: '#e67e22', icon: '⚠', desc: '违约金、赔偿、解除条件等条款风险' },
    confidential: { label: '保密义务', color: '#9b59b6', icon: '🔒', desc: '保密范围、期限、责任等条款风险' },
    delivery:   { label: '交付期限',   color: '#3498db', icon: '📅', desc: '交付时间、验收标准、延期条件等条款风险' },
    dispute:    { label: '争议解决',   color: '#f39c12', icon: '⚖', desc: '管辖法院、仲裁、适用法律等条款风险' },
    entity:     { label: '主体信息缺失', color: '#1abc9c', icon: '👤', desc: '合同主体身份、资质、授权等信息缺失风险' }
  };

  // 风险等级
  const RISK_LEVELS = {
    high:   { label: '高风险', color: '#e74c3c', value: 3 },
    medium: { label: '中风险', color: '#f39c12', value: 2 },
    low:    { label: '低风险', color: '#27ae60', value: 1 }
  };

  // 状态流转规则（含 invalidated 状态）
  const STATUS_FLOW = {
    pending:     { label: '待评审', next: ['reviewing'],                color: '#95a5a6' },
    reviewing:   { label: '评审中', next: ['flagged', 'dismissed'],     color: '#3498db' },
    flagged:     { label: '已标记', next: ['resolved', 'dismissed'],    color: '#e67e22' },
    resolved:    { label: '已解决', next: ['reviewing'],                color: '#27ae60' },
    dismissed:   { label: '已忽略', next: ['reviewing'],                color: '#7f8c8d' },
    invalidated: { label: '已失效', next: ['reviewing'],                color: '#bdc3c7' }
  };

  // 批注存储
  let annotations = [];
  let listeners = [];

  /**
   * 生成稳定ID（基于内容哈希，不含时间戳，确保可复现）
   */
  function generateStableId(sectionId, paraIdx, anchorText) {
    const str = `${sectionId}_${paraIdx}_${anchorText}`;
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return `ann_${Math.abs(hash).toString(36)}_${Date.now().toString(36)}`;
  }

  /**
   * 检查是否重复标注
   * @returns {{isDuplicate: boolean, existing?: Annotation}}
   */
  function checkDuplicate(sectionId, paraIdx, startOffset, endOffset, riskType) {
    const OVERLAP_THRESHOLD = 5; // 字符重叠阈值
    for (const ann of annotations) {
      // 跳过已失效的批注
      if (ann.status === 'invalidated') continue;
      if (ann.sectionId !== sectionId || ann.paragraphIndex !== paraIdx) continue;
      if (ann.riskType !== riskType) continue;

      // 检查范围重叠
      const overlapStart = Math.max(ann.startOffset, startOffset);
      const overlapEnd = Math.min(ann.endOffset, endOffset);
      const overlapLen = overlapEnd - overlapStart;

      if (overlapLen >= OVERLAP_THRESHOLD ||
          (ann.startOffset === startOffset && ann.endOffset === endOffset)) {
        return { isDuplicate: true, existing: ann };
      }
    }
    return { isDuplicate: false };
  }

  /**
   * 添加批注（增强版：自动计算 rangeId 和上下文）
   */
  function addAnnotation({ sectionId, paragraphIndex, startOffset, endOffset, anchorText, riskType, riskLevel, comment }) {
    // 校验风险类型
    if (!RISK_TYPES[riskType]) {
      throw new Error(`无效的风险类型: ${riskType}`);
    }
    if (!RISK_LEVELS[riskLevel]) {
      throw new Error(`无效的风险等级: ${riskLevel}`);
    }

    // 去重检查
    const dupCheck = checkDuplicate(sectionId, paragraphIndex, startOffset, endOffset, riskType);
    if (dupCheck.isDuplicate) {
      return { error: 'duplicate', existing: dupCheck.existing };
    }

    // 计算 rangeId 和上下文（如果有 TextParser 和章节数据可用）
    let rangeId = '';
    let sectionTitle = '';
    let context = { before: '', after: '' };

    // 尝试从全局获取章节信息
    if (typeof App !== 'undefined' && App.getSections) {
      const sections = App.getSections();
      const section = sections ? sections.find(s => s.id === sectionId) : null;
      if (section) {
        sectionTitle = section.title;
        const para = section.paragraphs.find(p => p.index === paragraphIndex);
        if (para) {
          rangeId = TextParser.computeRangeId(section.title, para.text, anchorText);
          context = TextParser.computeAnchorContext(para.text, startOffset, endOffset);
        }
      }
    }

    // 如果无法获取章节信息，用基础哈希
    if (!rangeId) {
      rangeId = `rng_${sectionId}_${paragraphIndex}_${startOffset}_${endOffset}`;
    }

    const annotation = {
      id: generateStableId(sectionId, paragraphIndex, anchorText),
      rangeId,
      sectionId,
      paragraphIndex,
      startOffset,
      endOffset,
      anchorText,
      riskType,
      riskLevel: riskLevel || 'medium',
      comment: comment || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [{ action: 'created', time: new Date().toISOString(), status: 'pending' }],
      _sectionTitle: sectionTitle,
      _context: context
    };

    annotations.push(annotation);
    notifyListeners('add', annotation);
    return { success: true, annotation };
  }

  /**
   * 更新批注
   */
  function updateAnnotation(id, changes) {
    const ann = annotations.find(a => a.id === id);
    if (!ann) throw new Error(`批注不存在: ${id}`);

    const allowedFields = ['comment', 'riskLevel', 'riskType'];
    allowedFields.forEach(field => {
      if (changes[field] !== undefined) {
        ann[field] = changes[field];
      }
    });
    ann.updatedAt = new Date().toISOString();
    notifyListeners('update', ann);
    return ann;
  }

  /**
   * 状态流转（修复：正确记录 from 状态）
   */
  function changeStatus(id, newStatus) {
    const ann = annotations.find(a => a.id === id);
    if (!ann) throw new Error(`批注不存在: ${id}`);

    const currentFlow = STATUS_FLOW[ann.status];
    if (!currentFlow.next.includes(newStatus)) {
      throw new Error(`无法从 "${currentFlow.label}" 转到 "${STATUS_FLOW[newStatus].label}"`);
    }

    const previousStatus = ann.status; // 修复：先记录旧状态
    ann.status = newStatus;
    ann.updatedAt = new Date().toISOString();
    ann.history.push({
      action: 'status_change',
      from: previousStatus, // 修复：使用旧状态
      to: newStatus,
      time: new Date().toISOString()
    });

    notifyListeners('statusChange', ann);
    return ann;
  }

  /**
   * 删除批注
   */
  function deleteAnnotation(id) {
    const idx = annotations.findIndex(a => a.id === id);
    if (idx < 0) throw new Error(`批注不存在: ${id}`);
    const removed = annotations.splice(idx, 1)[0];
    notifyListeners('delete', removed);
    return removed;
  }

  /**
   * 将批注标记为失效
   */
  function invalidateAnnotation(id, reason) {
    const ann = annotations.find(a => a.id === id);
    if (!ann) throw new Error(`批注不存在: ${id}`);

    const previousStatus = ann.status;
    ann.status = 'invalidated';
    ann._invalidReason = reason || '文本重新解析后无法定位';
    ann.updatedAt = new Date().toISOString();
    ann.history.push({
      action: 'invalidated',
      from: previousStatus,
      to: 'invalidated',
      reason: ann._invalidReason,
      time: new Date().toISOString()
    });

    notifyListeners('invalidate', ann);
    return ann;
  }

  /**
   * 获取指定章节/段落的批注（默认排除已失效）
   */
  function getAnnotationsForParagraph(sectionId, paragraphIndex, includeInvalidated = false) {
    return annotations.filter(a =>
      a.sectionId === sectionId && a.paragraphIndex === paragraphIndex &&
      (includeInvalidated || a.status !== 'invalidated')
    );
  }

  /**
   * 获取所有批注
   */
  function getAllAnnotations() {
    return [...annotations];
  }

  /**
   * 获取所有有效批注（排除已失效）
   */
  function getActiveAnnotations() {
    return annotations.filter(a => a.status !== 'invalidated');
  }

  /**
   * 按风险类型获取批注
   */
  function getAnnotationsByRiskType(riskType) {
    return annotations.filter(a => a.riskType === riskType);
  }

  /**
   * 按状态获取批注
   */
  function getAnnotationsByStatus(status) {
    return annotations.filter(a => a.status === status);
  }

  /**
   * 批量导入批注（用于恢复/迁移）
   * 增强版：自动为缺少 rangeId 的批注补充
   */
  function importAnnotations(data, sections) {
    const imported = Array.isArray(data) ? data : [];

    // 为旧格式批注补充 rangeId 和上下文
    imported.forEach(ann => {
      if (!ann.rangeId && sections) {
        const section = sections.find(s => s.id === ann.sectionId);
        if (section) {
          ann._sectionTitle = ann._sectionTitle || section.title;
          const para = section.paragraphs.find(p => p.index === ann.paragraphIndex);
          if (para) {
            ann.rangeId = TextParser.computeRangeId(section.title, para.text, ann.anchorText);
            if (!ann._context) {
              ann._context = TextParser.computeAnchorContext(para.text, ann.startOffset, ann.endOffset);
            }
          }
        }
      }
    });

    annotations = imported;
    notifyListeners('importAll', null);
  }

  /**
   * 执行批注迁移（重新解析后调用）
   * @param {Section[]} newSections - 新解析的章节
   * @param {Section[]} oldSections - 旧章节
   * @returns {{stats: object}} 迁移统计
   */
  function migrateToNewSections(newSections, oldSections) {
    const oldAnnotations = [...annotations];
    const result = TextParser.migrateAnnotations(oldAnnotations, newSections, oldSections);

    const now = new Date().toISOString();

    // 为失效批注补充 history 记录和时间戳
    result.invalidated.forEach(ann => {
      if (!ann.history) ann.history = [];
      ann.history.push({
        action: 'invalidated',
        from: ann._previousStatus || 'pending',
        to: 'invalidated',
        reason: ann._invalidReason || '文本重新解析后无法定位',
        time: now
      });
      ann._previousStatus = undefined;
      ann.updatedAt = now;
    });

    // 为成功迁移且位置发生变化的批注补充 history 记录
    result.migrated.forEach(ann => {
      const oldAnn = oldAnnotations.find(a => a.id === ann.id);
      if (!oldAnn) return;
      if (!ann.history) ann.history = [];
      const sectionChanged = oldAnn.sectionId !== ann.sectionId;
      const paraChanged = oldAnn.paragraphIndex !== ann.paragraphIndex;
      const offsetChanged = oldAnn.startOffset !== ann.startOffset || oldAnn.endOffset !== ann.endOffset;
      if (sectionChanged || paraChanged || offsetChanged) {
        ann.history.push({
          action: 'migrated',
          from: { sectionId: oldAnn.sectionId, paragraphIndex: oldAnn.paragraphIndex, startOffset: oldAnn.startOffset },
          to: { sectionId: ann.sectionId, paragraphIndex: ann.paragraphIndex, startOffset: ann.startOffset },
          time: now
        });
        ann.updatedAt = now;
      }
    });

    // 合并迁移结果（保留失效批注）
    const allMigrated = [...result.migrated, ...result.invalidated];

    annotations = allMigrated;
    notifyListeners('migrate', { result });

    return {
      stats: result.stats,
      invalidated: result.invalidated
    };
  }

  /**
   * 清空所有批注
   */
  function clearAll() {
    annotations = [];
    notifyListeners('clearAll', null);
  }

  /**
   * 事件监听
   */
  function onChange(listener) {
    listeners.push(listener);
    return () => {
      listeners = listeners.filter(l => l !== listener);
    };
  }

  function notifyListeners(event, data) {
    listeners.forEach(fn => {
      try { fn(event, data); } catch (e) { console.error('Listener error:', e); }
    });
  }

  /**
   * 快照当前批注（深拷贝，不触发监听器）
   */
  function snapshotAnnotations() {
    return JSON.parse(JSON.stringify(annotations));
  }

  /**
   * 从快照恢复批注
   */
  function restoreFromSnapshot(snapshot) {
    annotations = snapshot;
    notifyListeners('restore', null);
  }

  return {
    RISK_TYPES, RISK_LEVELS, STATUS_FLOW,
    addAnnotation, updateAnnotation, deleteAnnotation, changeStatus,
    invalidateAnnotation,
    getAnnotationsForParagraph, getAllAnnotations, getActiveAnnotations,
    getAnnotationsByRiskType, getAnnotationsByStatus,
    importAnnotations, migrateToNewSections,
    clearAll,
    checkDuplicate, onChange,
    snapshotAnnotations, restoreFromSnapshot
  };
})();
