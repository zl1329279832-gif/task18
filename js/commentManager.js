/**
 * commentManager.js - 批注管理模块
 * 批注 CRUD、状态流转、评审记录、localStorage 持久化、重复检测
 */
const CommentManager = (() => {
  const STORAGE_KEY = 'contract_review_data';

  let _annotations = [];
  let _history = [];
  let _contractHash = '';
  let _onChangeCallbacks = [];

  // 状态流转规则
  const STATUS_TRANSITIONS = {
    pending:    ['processing', 'closed'],
    processing: ['resolved', 'pending', 'closed'],
    resolved:   ['closed', 'processing'],
    closed:     ['pending'],
  };

  const STATUS_LABELS = {
    pending: '待处理',
    processing: '处理中',
    resolved: '已解决',
    closed: '已关闭',
  };

  const RISK_TYPE_LABELS = {
    payment: '付款条款',
    breach: '违约责任',
    confidential: '保密义务',
    delivery: '交付期限',
    dispute: '争议解决',
    entity: '主体信息缺失',
  };

  /**
   * 初始化
   */
  function init(contractHash) {
    _contractHash = contractHash;
    _loadFromStorage();
  }

  /**
   * 重置（新合同导入时）
   */
  function reset(contractHash) {
    _annotations = [];
    _history = [];
    _contractHash = contractHash || '';
    _notifyChange();
  }

  /**
   * 添加批注
   */
  function addAnnotation(data) {
    // 检查重复
    const duplicate = _checkDuplicate(data);
    if (duplicate) {
      return { success: false, error: '该区域已存在相同类型的批注', duplicate };
    }

    const annotation = {
      id: _generateId(),
      paragraphId: data.paragraphId,
      sectionId: data.sectionId,
      startOffset: data.startOffset,
      endOffset: data.endOffset,
      selectedText: data.selectedText || '',
      textSnippet: (data.selectedText || '').slice(0, 50),
      riskType: data.riskType,
      riskLevel: data.riskLevel,
      comment: data.comment || '',
      status: data.status || 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    _annotations.push(annotation);
    _addHistory('add', annotation);
    _saveToStorage();
    _notifyChange();

    return { success: true, annotation };
  }

  /**
   * 更新批注
   */
  function updateAnnotation(id, updates) {
    const idx = _annotations.findIndex(a => a.id === id);
    if (idx === -1) return { success: false, error: '批注不存在' };

    const old = _annotations[idx];
    const annotation = { ...old, ...updates, updatedAt: Date.now() };

    // 状态流转验证
    if (updates.status && updates.status !== old.status) {
      const allowed = STATUS_TRANSITIONS[old.status];
      if (!allowed || !allowed.includes(updates.status)) {
        return {
          success: false,
          error: `不能从「${STATUS_LABELS[old.status]}」转为「${STATUS_LABELS[updates.status]}」`,
        };
      }
    }

    _annotations[idx] = annotation;

    // 记录变更
    const changes = [];
    if (updates.status && updates.status !== old.status) {
      changes.push(`状态: ${STATUS_LABELS[old.status]} → ${STATUS_LABELS[updates.status]}`);
    }
    if (updates.riskType && updates.riskType !== old.riskType) {
      changes.push(`风险类型: ${RISK_TYPE_LABELS[old.riskType]} → ${RISK_TYPE_LABELS[updates.riskType]}`);
    }
    if (updates.riskLevel && updates.riskLevel !== old.riskLevel) {
      changes.push(`风险等级变更`);
    }
    if (updates.comment !== undefined && updates.comment !== old.comment) {
      changes.push('修改批注内容');
    }

    _addHistory('update', annotation, changes.join('; '));
    _saveToStorage();
    _notifyChange();

    return { success: true, annotation };
  }

  /**
   * 删除批注
   */
  function deleteAnnotation(id) {
    const idx = _annotations.findIndex(a => a.id === id);
    if (idx === -1) return false;

    const removed = _annotations.splice(idx, 1)[0];
    _addHistory('delete', removed);
    _saveToStorage();
    _notifyChange();
    return true;
  }

  /**
   * 获取单个批注
   */
  function getAnnotation(id) {
    return _annotations.find(a => a.id === id) || null;
  }

  /**
   * 获取所有批注
   */
  function getAnnotations() {
    return [..._annotations];
  }

  /**
   * 按过滤条件获取批注
   */
  function getFiltered(filters) {
    let result = [..._annotations];

    if (filters.status && filters.status !== 'all') {
      result = result.filter(a => a.status === filters.status);
    }
    if (filters.riskType && filters.riskType !== 'all') {
      result = result.filter(a => a.riskType === filters.riskType);
    }
    if (filters.sectionId) {
      result = result.filter(a => a.sectionId === filters.sectionId);
    }

    // 按创建时间倒序
    result.sort((a, b) => b.createdAt - a.createdAt);
    return result;
  }

  /**
   * 获取评审记录
   */
  function getHistory() {
    return [..._history];
  }

  /**
   * 检测重复标注
   */
  function _checkDuplicate(data) {
    return _annotations.find(a =>
      a.paragraphId === data.paragraphId &&
      a.riskType === data.riskType &&
      a.startOffset === data.startOffset &&
      a.endOffset === data.endOffset
    ) || null;
  }

  /**
   * 添加操作记录
   */
  function _addHistory(action, annotation, detail) {
    const actionLabels = { add: '新增批注', update: '更新批注', delete: '删除批注' };
    _history.unshift({
      id: _generateId(),
      action,
      actionLabel: actionLabels[action],
      annotationId: annotation.id,
      riskType: annotation.riskType,
      riskTypeLabel: RISK_TYPE_LABELS[annotation.riskType],
      textSnippet: annotation.textSnippet,
      detail: detail || '',
      timestamp: Date.now(),
    });
    // 只保留最近 200 条
    if (_history.length > 200) _history.length = 200;
  }

  /**
   * 保存到 localStorage
   */
  function _saveToStorage() {
    try {
      const data = {
        contractHash: _contractHash,
        annotations: _annotations,
        history: _history,
        savedAt: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('保存到 localStorage 失败:', e.message);
    }
  }

  /**
   * 从 localStorage 加载
   */
  function _loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const data = JSON.parse(raw);
      if (data.contractHash === _contractHash) {
        _annotations = data.annotations || [];
        _history = data.history || [];
      }
    } catch (e) {
      console.warn('从 localStorage 加载失败:', e.message);
    }
  }

  /**
   * 获取可导出的完整数据
   */
  function exportData() {
    return {
      annotations: [..._annotations],
      history: [..._history],
      contractHash: _contractHash,
    };
  }

  /**
   * 导入数据（恢复项目时使用）
   */
  function importData(data) {
    _annotations = data.annotations || [];
    _history = data.history || [];
    _contractHash = data.contractHash || '';
    _saveToStorage();
    _notifyChange();
  }

  /**
   * 获取有效的状态转换列表
   */
  function getValidTransitions(currentStatus) {
    return STATUS_TRANSITIONS[currentStatus] || [];
  }

  /**
   * 注册数据变更回调
   */
  function onChange(callback) {
    _onChangeCallbacks.push(callback);
  }

  function _notifyChange() {
    _onChangeCallbacks.forEach(cb => {
      try { cb(_annotations, _history); } catch (e) { console.error(e); }
    });
  }

  /**
   * 生成唯一 ID
   */
  function _generateId() {
    return 'ann-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  return {
    init,
    reset,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    getAnnotation,
    getAnnotations,
    getFiltered,
    getHistory,
    exportData,
    importData,
    getValidTransitions,
    onChange,
    STATUS_LABELS,
    STATUS_TRANSITIONS,
    RISK_TYPE_LABELS,
  };
})();
