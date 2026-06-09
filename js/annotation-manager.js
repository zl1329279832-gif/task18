/**
 * annotation-manager.js - 批注管理模块
 * 负责批注CRUD、去重检测、稳定ID生成、状态流转
 * stale标记、迁移结果应用、上下文记录
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

  // 状态流转规则
  const STATUS_FLOW = {
    pending:    { label: '待评审', next: ['reviewing'], color: '#95a5a6' },
    reviewing:  { label: '评审中', next: ['flagged', 'dismissed'], color: '#3498db' },
    flagged:    { label: '已标记', next: ['resolved', 'dismissed'], color: '#e67e22' },
    resolved:   { label: '已解决', next: ['reviewing'], color: '#27ae60' },
    dismissed:  { label: '已忽略', next: ['reviewing'], color: '#7f8c8d' }
  };

  // 批注存储
  let annotations = [];
  let listeners = [];

  /**
   * 生成稳定ID（基于内容哈希）
   */
  function generateStableId(sectionId, paraIdx, anchorText) {
    const str = `${sectionId}_${paraIdx}_${anchorText}_${Date.now()}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + ch;
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
      if (ann.sectionId !== sectionId || ann.paragraphIndex !== paraIdx) continue;
      if (ann.riskType !== riskType) continue;
      if (ann.stale) continue; // 失效批注不参与重复检测

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
   * 添加批注（扩展：支持上下文信息）
   */
  function addAnnotation({ sectionId, paragraphIndex, startOffset, endOffset, anchorText,
                           riskType, riskLevel, comment, contextBefore, contextAfter, paragraphFingerprint }) {
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

    const annotation = {
      id: generateStableId(sectionId, paragraphIndex, anchorText),
      sectionId,
      paragraphIndex,
      startOffset,
      endOffset,
      anchorText,
      riskType,
      riskLevel: riskLevel || 'medium',
      comment: comment || '',
      status: 'pending',
      // 上下文信息（用于迁移消歧）
      contextBefore: contextBefore || '',
      contextAfter: contextAfter || '',
      paragraphFingerprint: paragraphFingerprint || '',
      // 有效性标记
      stale: false,
      staleSince: null,
      staleReason: null,
      // 时间戳
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [{ action: 'created', time: new Date().toISOString(), status: 'pending' }]
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
   * 状态流转
   */
  function changeStatus(id, newStatus) {
    const ann = annotations.find(a => a.id === id);
    if (!ann) throw new Error(`批注不存在: ${id}`);

    const currentFlow = STATUS_FLOW[ann.status];
    if (!currentFlow.next.includes(newStatus)) {
      throw new Error(`无法从 "${currentFlow.label}" 转到 "${STATUS_FLOW[newStatus].label}"`);
    }

    const oldStatus = ann.status;
    ann.status = newStatus;
    ann.updatedAt = new Date().toISOString();
    ann.history.push({
      action: 'status_change',
      from: oldStatus,
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
   * 标记批注为失效（迁移失败时调用）
   */
  function markStale(id, reason) {
    const ann = annotations.find(a => a.id === id);
    if (!ann) return;
    ann.stale = true;
    ann.staleSince = new Date().toISOString();
    ann.staleReason = reason || '锚点定位失效';
    ann.updatedAt = new Date().toISOString();
    ann.history.push({
      action: 'marked_stale',
      reason: ann.staleReason,
      time: new Date().toISOString()
    });
    notifyListeners('stale', ann);
  }

  /**
   * 清除失效标记（迁移成功后调用）
   */
  function clearStale(id) {
    const ann = annotations.find(a => a.id === id);
    if (!ann || !ann.stale) return;
    ann.stale = false;
    ann.staleSince = null;
    ann.staleReason = null;
    ann.updatedAt = new Date().toISOString();
    ann.history.push({
      action: 'stale_cleared',
      time: new Date().toISOString()
    });
    notifyListeners('update', ann);
  }

  /**
   * 获取所有失效批注
   */
  function getStaleAnnotations() {
    return annotations.filter(a => a.stale);
  }

  /**
   * 批量应用迁移结果
   * @param {object} migrationResult - TextParser.migrateAnnotations 的返回值
   */
  function applyMigrationResult(migrationResult) {
    // 应用成功迁移（位置有变化的）
    for (const item of migrationResult.migrated) {
      const ann = annotations.find(a => a.id === item.annotation.id);
      if (!ann) continue;

      const oldSectionId = ann.sectionId;
      const oldParaIdx = ann.paragraphIndex;
      const oldStart = ann.startOffset;

      ann.sectionId = item.newSectionId;
      ann.paragraphIndex = item.newParagraphIndex;
      ann.startOffset = item.newStart;
      ann.endOffset = item.newEnd;
      ann.contextBefore = item.contextBefore;
      ann.contextAfter = item.contextAfter;
      ann.paragraphFingerprint = item.paragraphFingerprint;
      ann.updatedAt = new Date().toISOString();

      // 清除可能的旧 stale 标记
      if (ann.stale) {
        ann.stale = false;
        ann.staleSince = null;
        ann.staleReason = null;
      }

      ann.history.push({
        action: 'migrated',
        from: { sectionId: oldSectionId, paragraphIndex: oldParaIdx, startOffset: oldStart },
        to: { sectionId: ann.sectionId, paragraphIndex: ann.paragraphIndex, startOffset: ann.startOffset },
        confidence: item.confidence,
        time: new Date().toISOString()
      });
    }

    // 应用未变化的（更新上下文信息）
    for (const item of migrationResult.unchanged) {
      const ann = annotations.find(a => a.id === item.annotation.id);
      if (!ann) continue;
      ann.contextBefore = item.contextBefore;
      ann.contextAfter = item.contextAfter;
      ann.paragraphFingerprint = item.paragraphFingerprint;
      if (ann.stale) {
        ann.stale = false;
        ann.staleSince = null;
        ann.staleReason = null;
      }
    }

    // 标记失效的
    for (const item of migrationResult.stale) {
      const ann = annotations.find(a => a.id === item.annotation.id);
      if (!ann) continue;
      ann.stale = true;
      ann.staleSince = new Date().toISOString();
      ann.staleReason = item.reason;
      ann.updatedAt = new Date().toISOString();
      ann.history.push({
        action: 'marked_stale',
        reason: item.reason,
        time: new Date().toISOString()
      });
    }

    notifyListeners('migration', null);
  }

  /**
   * 获取指定章节/段落的批注
   */
  function getAnnotationsForParagraph(sectionId, paragraphIndex) {
    return annotations.filter(a =>
      a.sectionId === sectionId && a.paragraphIndex === paragraphIndex
    );
  }

  /**
   * 获取所有批注
   */
  function getAllAnnotations() {
    return [...annotations];
  }

  /**
   * 获取活跃批注（排除失效的）
   */
  function getActiveAnnotations() {
    return annotations.filter(a => !a.stale);
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
   * 批量导入批注（用于恢复，自动补充缺失字段以兼容旧数据）
   */
  function importAnnotations(data) {
    const imported = Array.isArray(data) ? data : [];
    annotations = imported.map(ann => ({
      // 旧字段
      id: ann.id || generateStableId(ann.sectionId || '', ann.paragraphIndex || 0, ann.anchorText || ''),
      sectionId: ann.sectionId || '',
      paragraphIndex: ann.paragraphIndex || 0,
      startOffset: ann.startOffset || 0,
      endOffset: ann.endOffset || 0,
      anchorText: ann.anchorText || '',
      riskType: ann.riskType || 'payment',
      riskLevel: ann.riskLevel || 'medium',
      comment: ann.comment || '',
      status: ann.status || 'pending',
      createdAt: ann.createdAt || new Date().toISOString(),
      updatedAt: ann.updatedAt || new Date().toISOString(),
      history: ann.history || [],
      // 新增字段 - 向后兼容
      contextBefore: ann.contextBefore || '',
      contextAfter: ann.contextAfter || '',
      paragraphFingerprint: ann.paragraphFingerprint || '',
      stale: ann.stale || false,
      staleSince: ann.staleSince || null,
      staleReason: ann.staleReason || null
    }));
    notifyListeners('importAll', null);
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

  return {
    RISK_TYPES, RISK_LEVELS, STATUS_FLOW,
    addAnnotation, updateAnnotation, deleteAnnotation, changeStatus,
    getAnnotationsForParagraph, getAllAnnotations, getActiveAnnotations,
    getAnnotationsByRiskType, getAnnotationsByStatus,
    getStaleAnnotations, markStale, clearStale, applyMigrationResult,
    importAnnotations, clearAll,
    checkDuplicate, onChange
  };
})();
