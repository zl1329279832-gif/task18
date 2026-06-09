/**
 * negotiation-advisor.js - 谈判建议引擎
 * 基于关键词/正则规则的合同变更风险分析
 * 对每个高风险变更生成可操作的谈判建议
 */
const NegotiationAdvisor = (() => {

  // ==================== 规则定义 ====================

  const RULES = [
    {
      id: 'payment_period_extension',
      label: '付款期限延长',
      category: 'payment',
      priority: 'critical',
      keywords: ['付款', '支付', '工作日', '自然日', '日内', '天数', '延期', '日内支付', '个工作日内'],
      patterns: [/(?:付款|支付).{0,20}(\d+)\s*(?:个工作日|自然日|日|天)/g],
      changeTypes: ['modified', 'added'],
      check(diff) {
        const oldDays = extractDays(diff.oldParagraph?.text);
        const newDays = extractDays(diff.newParagraph?.text);
        if (oldDays !== null && newDays !== null) return newDays > oldDays;
        if (diff.changeType === 'added' && newDays !== null) return newDays > 15;
        return false;
      },
      generate(diff, ctx) {
        const oldDays = extractDays(diff.oldParagraph?.text);
        const newDays = extractDays(diff.newParagraph?.text);
        if (oldDays !== null && newDays !== null) {
          return `付款期限从${oldDays}日延长至${newDays}日，建议协商恢复原期限或增加逾期利息补偿条款。`;
        }
        return `新增付款期限条款（${newDays || '较长'}日），建议评估对现金流的影响，必要时协商缩短付款周期。`;
      }
    },
    {
      id: 'breach_liability_expansion',
      label: '违约责任扩大',
      category: 'breach',
      priority: 'critical',
      keywords: ['违约', '违约金', '赔偿', '解除', '终止', '罚款', '处罚'],
      patterns: [/(?:违约金|赔偿金?|罚[金款]).{0,20}(?:\d+%|百分之[\u4e00-\u9fff]+|万分之[\u4e00-\u9fff]+)/g],
      changeTypes: ['modified', 'added'],
      check(diff) {
        const oldPct = extractPercentage(diff.oldParagraph?.text);
        const newPct = extractPercentage(diff.newParagraph?.text);
        if (oldPct !== null && newPct !== null) return newPct > oldPct;
        if (diff.changeType === 'added') return true;
        return diff.newParagraph?.text && /违约/.test(diff.newParagraph.text) && !diff.oldParagraph;
      },
      generate(diff, ctx) {
        const oldPct = extractPercentage(diff.oldParagraph?.text);
        const newPct = extractPercentage(diff.newParagraph?.text);
        if (oldPct !== null && newPct !== null) {
          return `违约金比例从${oldPct}%提高至${newPct}%，建议评估违约风险并协商合理的违约金上限。`;
        }
        return `新增违约条款，建议评估违约风险范围，协商合理的违约金上限和免责条件。`;
      }
    },
    {
      id: 'auto_renewal_addition',
      label: '自动续约条款新增',
      category: 'general',
      priority: 'important',
      keywords: ['自动续约', '自动续期', '自动延期', '续展', '期满', '届满', '自动延续'],
      patterns: [/自动[续延][约期展]|到期.*自动|期满.*自动|届满.*自动/],
      changeTypes: ['added', 'modified'],
      check(diff) {
        const newText = diff.newParagraph?.text || '';
        const oldText = diff.oldParagraph?.text || '';
        return /自动[续延][约期展]|到期.*自动|期满.*自动|届满.*自动/.test(newText) &&
               !/自动[续延][约期展]|到期.*自动|期满.*自动|届满.*自动/.test(oldText);
      },
      generate() {
        return '新增自动续约条款，建议明确续约条件、提前通知期限（如到期前30日书面通知）和单方终止权。';
      }
    },
    {
      id: 'jurisdiction_change',
      label: '管辖权变更',
      category: 'dispute',
      priority: 'critical',
      keywords: ['管辖', '仲裁', '法院', '争议', '诉讼', '裁决', '仲裁委员会'],
      patterns: [/(?:管辖|争议解决|仲裁|诉讼).{0,30}(?:法院|仲裁委|仲裁机构)/g],
      changeTypes: ['modified'],
      check(diff) {
        const oldLoc = extractJurisdiction(diff.oldParagraph?.text);
        const newLoc = extractJurisdiction(diff.newParagraph?.text);
        return oldLoc && newLoc && oldLoc !== newLoc;
      },
      generate(diff) {
        const oldLoc = extractJurisdiction(diff.oldParagraph?.text) || '原管辖';
        const newLoc = extractJurisdiction(diff.newParagraph?.text) || '新管辖';
        return `争议解决方式/管辖从「${oldLoc}」变更为「${newLoc}」，建议评估变更对己方诉讼便利性的影响，必要时坚持原有管辖约定。`;
      }
    },
    {
      id: 'compensation_cap_removal',
      label: '赔偿上限移除',
      category: 'breach',
      priority: 'critical',
      keywords: ['上限', '最高', '不超过', '封顶', '限额', '累计'],
      patterns: [/(?:累计|赔偿|违约金).{0,20}(?:不超过|上限|最高|封顶).{0,20}(?:\d+%|百分之[\u4e00-\u9fff]+|合同总价)/g],
      changeTypes: ['modified', 'deleted'],
      check(diff) {
        const oldText = diff.oldParagraph?.text || '';
        const newText = diff.newParagraph?.text || '';
        const oldHasCap = /不超过|上限|最高|封顶|限额/.test(oldText);
        const newHasCap = /不超过|上限|最高|封顶|限额/.test(newText);
        return oldHasCap && !newHasCap;
      },
      generate() {
        return '原赔偿上限条款被移除，赔偿风险可能无限扩大。强烈建议坚持设置合理的赔偿责任上限（如合同总价的一定比例）。';
      }
    },
    {
      id: 'confidentiality_period_extension',
      label: '保密期限延长',
      category: 'confidential',
      priority: 'important',
      keywords: ['保密', '期限', '年', '永久', '商业秘密', '保密义务'],
      patterns: [/保密.{0,20}(?:期限|期间).{0,10}(\d+)\s*年|永久保密/g],
      changeTypes: ['modified', 'added'],
      check(diff) {
        const oldYears = extractYears(diff.oldParagraph?.text);
        const newYears = extractYears(diff.newParagraph?.text);
        if (oldYears !== null && newYears !== null) return newYears > oldYears;
        if (/永久/.test(diff.newParagraph?.text) && !/永久/.test(diff.oldParagraph?.text)) return true;
        return false;
      },
      generate(diff) {
        const oldYears = extractYears(diff.oldParagraph?.text);
        const newYears = extractYears(diff.newParagraph?.text);
        if (oldYears !== null && newYears !== null) {
          return `保密期限从${oldYears}年延长至${newYears}年，建议评估实际保密需求，协商合理的保密期限（通常3-5年）。`;
        }
        return '保密期限变更为永久保密，建议协商设定合理的保密期限。';
      }
    },
    {
      id: 'delivery_period_shortening',
      label: '交付期限缩短',
      category: 'delivery',
      priority: 'important',
      keywords: ['交付', '完成', '工作日', '自然日', '期限', '天数'],
      patterns: [/(?:交付|完成|提交).{0,20}(?:后|内|前).{0,10}(\d+)\s*(?:个工作日|自然日|日)/g],
      changeTypes: ['modified'],
      check(diff) {
        const oldDays = extractDays(diff.oldParagraph?.text);
        const newDays = extractDays(diff.newParagraph?.text);
        return oldDays !== null && newDays !== null && newDays < oldDays;
      },
      generate(diff) {
        const oldDays = extractDays(diff.oldParagraph?.text);
        const newDays = extractDays(diff.newParagraph?.text);
        return `交付期限从${oldDays}日缩短至${newDays}日，建议评估交付能力，避免因期限过紧导致违约风险。`;
      }
    },
    {
      id: 'ip_ownership_change',
      label: '知识产权归属变更',
      category: 'general',
      priority: 'critical',
      keywords: ['知识产权', '著作权', '版权', '所有权', '归属', '专利', '成果'],
      patterns: [/(?:知识产权|著作权|版权|专利).{0,30}(?:归|属|转让|许可)/g],
      changeTypes: ['modified', 'added', 'deleted'],
      check(diff) {
        const newText = diff.newParagraph?.text || '';
        const oldText = diff.oldParagraph?.text || '';
        // 检测甲方/乙方归属变化
        const oldOwner = /归\s*([甲乙])方/.exec(oldText);
        const newOwner = /归\s*([甲乙])方/.exec(newText);
        if (oldOwner && newOwner) return oldOwner[1] !== newOwner[1];
        return true; // 任何涉及知识产权的变更都值得注意
      },
      generate() {
        return '知识产权归属条款发生变更，建议确认变更后的权利归属是否符合双方预期，必要时请法务审核。';
      }
    },
    {
      id: 'payment_ratio_change',
      label: '付款比例变更',
      category: 'payment',
      priority: 'important',
      keywords: ['支付', '付款', '比例', '%', '分期', '百分比'],
      patterns: [/(?:合同总价|总价款?|合同金额).{0,20}(\d+)\s*%/g],
      changeTypes: ['modified'],
      check(diff) {
        const oldPcts = extractAllPercentages(diff.oldParagraph?.text);
        const newPcts = extractAllPercentages(diff.newParagraph?.text);
        if (oldPcts.length === 0 || newPcts.length === 0) return false;
        return JSON.stringify(oldPcts) !== JSON.stringify(newPcts);
      },
      generate(diff) {
        const oldPcts = extractAllPercentages(diff.oldParagraph?.text);
        const newPcts = extractAllPercentages(diff.newParagraph?.text);
        return `付款比例发生变更（原${oldPcts.join('%/')}% → 新${newPcts.join('%/')}%），建议评估现金流影响，确保付款节奏与交付里程碑匹配。`;
      }
    },
    {
      id: 'liability_exclusion_addition',
      label: '免责条款新增',
      category: 'breach',
      priority: 'important',
      keywords: ['免责', '不承担', '除外', '例外', '不负责', '不可抗力', '免除'],
      patterns: [/不承担.{0,10}责任|免责|责任除外|不负责|排除.{0,10}责任|免除.{0,10}责任/],
      changeTypes: ['added', 'modified'],
      check(diff) {
        const newText = diff.newParagraph?.text || '';
        const oldText = diff.oldParagraph?.text || '';
        return /不承担|免责|除外|不负责|免除.*责任/.test(newText) &&
               !/不承担|免责|除外|不负责|免除.*责任/.test(oldText);
      },
      generate() {
        return '新增免责条款，建议审查免责范围是否合理，防止对方通过扩大免责范围规避核心义务。';
      }
    },
    {
      id: 'termination_condition_change',
      label: '终止条件变更',
      category: 'general',
      priority: 'important',
      keywords: ['终止', '解除', '提前终止', '单方解除', '通知', '终止合同'],
      patterns: [/(?:终止|解除).{0,20}(?:合同|协议)|单方.{0,10}(?:终止|解除)/g],
      changeTypes: ['modified', 'added', 'deleted'],
      check(diff) {
        const newText = diff.newParagraph?.text || '';
        const oldText = diff.oldParagraph?.text || '';
        return /单方.{0,10}(?:终止|解除)/.test(newText) && !/单方.{0,10}(?:终止|解除)/.test(oldText);
      },
      generate() {
        return '合同终止/解除条件发生变更，建议确认新增的终止条件不会赋予对方不合理的单方解除权。';
      }
    },
    {
      id: 'warranty_period_reduction',
      label: '保修/维护期缩短',
      category: 'delivery',
      priority: 'important',
      keywords: ['维护', '保修', '质保', '月', '年', '免费', '维护期'],
      patterns: [/(?:维护|保修|质保).{0,20}(?:期|期间|服务).{0,10}(\d+)\s*(?:个月|年|月)/g],
      changeTypes: ['modified'],
      check(diff) {
        const oldMonths = extractMonths(diff.oldParagraph?.text);
        const newMonths = extractMonths(diff.newParagraph?.text);
        return oldMonths !== null && newMonths !== null && newMonths < oldMonths;
      },
      generate(diff) {
        const oldMonths = extractMonths(diff.oldParagraph?.text);
        const newMonths = extractMonths(diff.newParagraph?.text);
        return `维护服务期从${oldMonths}个月缩短至${newMonths}个月，建议协商恢复原期限或在维护期后约定合理的付费维护方案。`;
      }
    },
    {
      id: 'acceptance_criteria_tightening',
      label: '验收标准收紧',
      category: 'delivery',
      priority: 'advisory',
      keywords: ['验收', '标准', '通过', '测试', '合格', '验收标准'],
      patterns: [/验收.{0,20}(?:标准|条件|要求)|通过.{0,10}验收/g],
      changeTypes: ['modified', 'added'],
      check() { return true; },
      generate() {
        return '验收标准发生变更，建议评估新标准的可达成性，确保验收条件客观可衡量。';
      }
    },
    {
      id: 'non_compete_addition',
      label: '竞业限制新增',
      category: 'general',
      priority: 'important',
      keywords: ['竞业', '竞争', '同业', '排他', '独家', '竞业限制'],
      patterns: [/竞业[制限]|同业竞争|排他|独家.{0,10}(?:合作|供应|服务)/],
      changeTypes: ['added', 'modified'],
      check(diff) {
        const newText = diff.newParagraph?.text || '';
        const oldText = diff.oldParagraph?.text || '';
        return /竞业[制限]|同业竞争|排他|独家/.test(newText) &&
               !/竞业[制限]|同业竞争|排他|独家/.test(oldText);
      },
      generate() {
        return '新增竞业限制条款，建议明确限制范围、期限和地域，并要求对应的竞业补偿金条款。';
      }
    },
    {
      id: 'dispute_resolution_method_change',
      label: '争议解决方式变更',
      category: 'dispute',
      priority: 'critical',
      keywords: ['仲裁', '诉讼', '法院', '仲裁委员会', '争议解决'],
      patterns: [/(?:提交|向).{0,20}(?:仲裁|法院|诉讼)/g],
      changeTypes: ['modified'],
      check(diff) {
        const oldMethod = detectDisputeMethod(diff.oldParagraph?.text);
        const newMethod = detectDisputeMethod(diff.newParagraph?.text);
        return oldMethod && newMethod && oldMethod !== newMethod;
      },
      generate(diff) {
        const oldMethod = detectDisputeMethod(diff.oldParagraph?.text) || '原方式';
        const newMethod = detectDisputeMethod(diff.newParagraph?.text) || '新方式';
        return `争议解决方式从「${oldMethod}」变更为「${newMethod}」。仲裁为一裁终局，诉讼可上诉，建议根据合同性质选择最有利的方式。`;
      }
    },
    {
      id: 'penalty_rate_increase',
      label: '违约金日利率提高',
      category: 'breach',
      priority: 'critical',
      keywords: ['万分之', '日', '逾期', '每日', '日利率', '滞纳金'],
      patterns: [/万分之[\u4e00-\u9fff\d]+|(\d+)\s*\/\s*万\s*\/\s*日|日利率/g],
      changeTypes: ['modified'],
      check(diff) {
        const oldRate = extractRatePerMyriad(diff.oldParagraph?.text);
        const newRate = extractRatePerMyriad(diff.newParagraph?.text);
        return oldRate !== null && newRate !== null && newRate > oldRate;
      },
      generate(diff) {
        const oldRate = extractRatePerMyriad(diff.oldParagraph?.text);
        const newRate = extractRatePerMyriad(diff.newParagraph?.text);
        return `逾期违约金日利率从万分之${oldRate}提高至万分之${newRate}，建议协商降低至合理水平（通常万分之三至万分之五）。`;
      }
    }
  ];

  // ==================== 辅助提取函数 ====================

  function extractDays(text) {
    if (!text) return null;
    const m = text.match(/(\d+)\s*(?:个工作日|自然日|日|天)/);
    return m ? parseInt(m[1]) : null;
  }

  function extractYears(text) {
    if (!text) return null;
    const m = text.match(/(\d+)\s*年/);
    return m ? parseInt(m[1]) : null;
  }

  function extractMonths(text) {
    if (!text) return null;
    const m = text.match(/(\d+)\s*(?:个月|月)/);
    return m ? parseInt(m[1]) : null;
  }

  function extractPercentage(text) {
    if (!text) return null;
    const m = text.match(/(\d+(?:\.\d+)?)\s*%/);
    return m ? parseFloat(m[1]) : null;
  }

  function extractAllPercentages(text) {
    if (!text) return [];
    const matches = text.match(/(\d+(?:\.\d+)?)\s*%/g);
    return matches ? matches.map(m => parseFloat(m)) : [];
  }

  function extractJurisdiction(text) {
    if (!text) return null;
    const m = text.match(/([\u4e00-\u9fff]{2,6}(?:人民法院|仲裁委员会|法院))/);
    return m ? m[1] : null;
  }

  function detectDisputeMethod(text) {
    if (!text) return null;
    if (/仲裁/.test(text)) return '仲裁';
    if (/诉讼|法院/.test(text)) return '诉讼';
    return null;
  }

  function extractRatePerMyriad(text) {
    if (!text) return null;
    const m = text.match(/万分之([\u4e00-\u9fff\d]+)/);
    if (!m) return null;
    const numMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    const val = m[1];
    if (/^\d+$/.test(val)) return parseInt(val);
    return numMap[val] || null;
  }

  // ==================== 核心分析函数 ====================

  /**
   * 分析变更并生成谈判建议
   * @param {DiffResult} diffResult
   * @param {Annotation[]} oldAnnotations
   * @param {Annotation[]} newAnnotations
   * @returns {Suggestion[]}
   */
  function analyzeChanges(diffResult, oldAnnotations, newAnnotations) {
    const suggestions = [];

    for (const sectionDiff of diffResult.sectionDiffs) {
      if (sectionDiff.changeType === 'unchanged') continue;

      const sectionTitle = sectionDiff.newSection?.title || sectionDiff.oldSection?.title || '未知章节';
      const context = { sectionTitle };

      for (const paraDiff of sectionDiff.paragraphDiffs) {
        if (paraDiff.changeType === 'unchanged') continue;

        const relevantText = paraDiff.newParagraph?.text || paraDiff.oldParagraph?.text || '';

        for (const rule of RULES) {
          // 检查变更类型是否匹配
          if (!rule.changeTypes.includes(paraDiff.changeType)) continue;

          // 关键词快速预过滤
          const hasKeyword = rule.keywords.some(kw => relevantText.includes(kw));
          if (!hasKeyword) continue;

          // 正则模式确认
          if (rule.patterns.length > 0) {
            const hasPattern = rule.patterns.some(p => {
              p.lastIndex = 0; // 重置全局正则
              return p.test(relevantText);
            });
            if (!hasPattern && !rule.check) continue;
          }

          // 自定义检查
          if (rule.check && !rule.check(paraDiff, context)) continue;

          // 生成建议
          const suggestionText = rule.generate(paraDiff, context);
          const detectedKeywords = rule.keywords.filter(kw => relevantText.includes(kw));

          suggestions.push({
            id: 'sug_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5),
            ruleId: rule.id,
            category: rule.category,
            priority: rule.priority,
            title: rule.label,
            description: `在「${sectionTitle}」中检测到${rule.label}变更`,
            affectedSection: sectionTitle,
            affectedParagraph: relevantText.substring(0, 100) + (relevantText.length > 100 ? '...' : ''),
            changeType: paraDiff.changeType,
            oldText: paraDiff.oldParagraph?.text || '',
            newText: paraDiff.newParagraph?.text || '',
            suggestion: suggestionText,
            riskType: rule.category,
            detectedKeywords
          });
        }
      }
    }

    // 按优先级排序：critical > important > advisory
    const priorityOrder = { critical: 0, important: 1, advisory: 2 };
    suggestions.sort((a, b) => (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2));

    return suggestions;
  }

  /**
   * 计算各章节的风险分数变化
   * @param {DiffResult} diffResult
   * @param {Annotation[]} oldAnnotations
   * @param {Annotation[]} newAnnotations
   * @returns {RiskDelta[]}
   */
  function getRiskDelta(diffResult, oldAnnotations, newAnnotations) {
    const RISK_LEVELS = { high: 3, medium: 2, low: 1 };
    const deltas = [];

    for (const sectionDiff of diffResult.sectionDiffs) {
      const oldSectionId = sectionDiff.oldSection?.id;
      const newSectionId = sectionDiff.newSection?.id;
      const sectionTitle = sectionDiff.newSection?.title || sectionDiff.oldSection?.title || '未知章节';

      // 找旧版中属于该章节的批注
      const oldAnns = oldSectionId
        ? oldAnnotations.filter(a => a.sectionId === oldSectionId && a.status !== 'invalidated')
        : [];

      // 找新版中属于该章节的批注
      const newAnns = newSectionId
        ? newAnnotations.filter(a => a.sectionId === newSectionId && a.status !== 'invalidated')
        : [];

      const oldScore = oldAnns.reduce((sum, a) => sum + (RISK_LEVELS[a.riskLevel] || 0), 0);
      const newScore = newAnns.reduce((sum, a) => sum + (RISK_LEVELS[a.riskLevel] || 0), 0);
      const delta = newScore - oldScore;

      let direction = 'unchanged';
      if (delta > 0) direction = 'increased';
      else if (delta < 0) direction = 'decreased';

      // 识别新增/移除/等级变化的批注
      const oldIds = new Set(oldAnns.map(a => a.rangeId));
      const newIds = new Set(newAnns.map(a => a.rangeId));

      const added = newAnns.filter(a => !oldIds.has(a.rangeId));
      const removed = oldAnns.filter(a => !newIds.has(a.rangeId));
      const levelChanged = [];

      for (const newAnn of newAnns) {
        const oldAnn = oldAnns.find(a => a.rangeId === newAnn.rangeId);
        if (oldAnn && oldAnn.riskLevel !== newAnn.riskLevel) {
          levelChanged.push({ annotation: newAnn, oldLevel: oldAnn.riskLevel, newLevel: newAnn.riskLevel });
        }
      }

      deltas.push({
        sectionId: newSectionId || oldSectionId || '',
        sectionTitle,
        oldRiskScore: oldScore,
        newRiskScore: newScore,
        delta,
        direction,
        oldAnnotations: oldAnns,
        newAnnotations: newAnns,
        changes: { added, removed, levelChanged }
      });
    }

    return deltas;
  }

  /**
   * 获取建议优先级
   */
  function getSuggestionPriority(suggestion) {
    return suggestion.priority;
  }

  return {
    analyzeChanges,
    getRiskDelta,
    getSuggestionPriority,
    RULES
  };
})();
