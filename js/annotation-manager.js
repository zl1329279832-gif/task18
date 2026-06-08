/**
 * annotation-manager.js - 批注管理模块
 * 负责批注CRUD、去重检测、稳定ID生成、状态流转
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
   * 添加批注
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

    ann.status = newStatus;
    ann.updatedAt = new Date().toISOString();
    ann.history.push({
      action: 'status_change',
      from: ann.status,
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
   * 批量导入批注（用于恢复）
   */
  function importAnnotations(data) {
    annotations = Array.isArray(data) ? data : [];
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
    getAnnotationsForParagraph, getAllAnnotations,
    getAnnotationsByRiskType, getAnnotationsByStatus,
    importAnnotations, clearAll,
    checkDuplicate, onChange
  };
})();
