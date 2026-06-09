/**
 * change-analyzer.js - 变更分析模块
 * 负责变更分类、风险模式检测、谈判建议生成、批注迁移状态追踪
 * 依赖：AnnotationManager（风险常量）、TextParser（迁移）、DiffEngine（相似度）
 */
const ChangeAnalyzer = (() => {

  // ==================== 辅助函数 ====================

  function extractNumber(text, regex) {
    const m = text.match(regex);
    if (!m) return null;
    const numStr = m[1];
    const cnMap = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,
      '十一':11,'十二':12,'十五':15,'二十':20,'三十':30,'六十':60,'九十':90 };
    if (cnMap[numStr] !== undefined) return cnMap[numStr];
    const n = parseInt(numStr);
    return isNaN(n) ? null : n;
  }

  function generateId(text) {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) & 0x7fffffff;
    }
    return 'chg_' + hash.toString(36) + '_' + Date.now().toString(36).slice(-4);
  }

  // ==================== 风险模式规则 ====================

  const RISK_PATTERNS = [
    // 1. 付款周期延长
    {
      id: 'payment_period_extend',
      label: '付款周期延长',
      riskType: 'payment',
      riskLevel: 'high',
      detect(orig, rev) {
        const dayRegex = /(\d+|[一二三四五六七八九十]+)\s*个?(?:工作)?[日天]/g;
        const origDays = [];
        const revDays = [];
        let m;
        while ((m = dayRegex.exec(orig)) !== null) origDays.push(extractNumber(m[0], /(\d+|[一二三四五六七八九十]+)/));
        dayRegex.lastIndex = 0;
        while ((m = dayRegex.exec(rev)) !== null) revDays.push(extractNumber(m[0], /(\d+|[一二三四五六七八九十]+)/));

        if (origDays.length > 0 && revDays.length > 0) {
          const maxOrig = Math.max(...origDays.filter(Boolean));
          const maxRev = Math.max(...revDays.filter(Boolean));
          if (maxRev > maxOrig && maxOrig > 0) {
            return { matched: true, origMatch: `${maxOrig}天`, revMatch: `${maxRev}天`,
              description: `付款周期从${maxOrig}天延长至${maxRev}天，增加了资金回收风险` };
          }
        }
        return { matched: false };
      },
      suggestion: {
        riskExplanation: '付款周期延长将导致资金回收延迟，增加现金流压力和坏账风险。',
        counterProposal: '建议恢复原付款周期，或协商折中方案。如需延长，应约定逾期利息补偿条款。',
        suggestedClause: '付款方应在验收合格后{原天数}个工作日内完成付款。逾期付款的，应按同期LPR利率的1.5倍支付逾期利息。'
      }
    },

    // 2. 违约责任扩大
    {
      id: 'breach_liability_expand',
      label: '违约责任扩大',
      riskType: 'breach',
      riskLevel: 'high',
      detect(orig, rev) {
        // 检测违约金比例增加
        const rateRegex = /(?:日)?万分之(\d+|[一二三四五六七八九十]+)/;
        const pctRegex = /百分之(\d+|[一二三四五六七八九十]+)|(\d+)%/;
        const origRate = extractNumber(orig, rateRegex);
        const revRate = extractNumber(rev, rateRegex);
        if (origRate !== null && revRate !== null && revRate > origRate) {
          return { matched: true, origMatch: `万分之${origRate}`, revMatch: `万分之${revRate}`,
            description: `违约金比例从万分之${origRate}提高至万分之${revRate}` };
        }
        const origPct = extractNumber(orig, pctRegex);
        const revPct = extractNumber(rev, pctRegex);
        if (origPct !== null && revPct !== null && revPct > origPct) {
          return { matched: true, origMatch: `${origPct}%`, revMatch: `${revPct}%`,
            description: `违约金比例从${origPct}%提高至${revPct}%` };
        }
        // 检测新增违约条款关键词
        const penaltyKeywords = ['违约金', '罚款', '赔偿损失', '承担违约责任'];
        const origHas = penaltyKeywords.some(k => orig.includes(k));
        const revHas = penaltyKeywords.some(k => rev.includes(k));
        if (!origHas && revHas) {
          return { matched: true, origMatch: null, revMatch: '新增违约条款',
            description: '修订版新增了违约责任条款，扩大了违约风险敞口' };
        }
        return { matched: false };
      },
      suggestion: {
        riskExplanation: '违约责任扩大将增加合同履行的法律风险和潜在赔偿金额。',
        counterProposal: '建议设置违约金上限（如不超过合同总金额的30%），并要求违约责任条款双方对等适用。',
        suggestedClause: '任何一方违约的，违约金累计不超过合同总金额的30%。双方违约责任对等适用。'
      }
    },

    // 3. 自动续约新增
    {
      id: 'auto_renewal_added',
      label: '自动续约新增',
      riskType: 'delivery',
      riskLevel: 'high',
      detect(orig, rev) {
        const regex = /自动续[约期展]|自动延[长期]|自行顺延|自动顺延/;
        const origHas = regex.test(orig);
        const revHas = regex.test(rev);
        if (!origHas && revHas) {
          const m = rev.match(regex);
          return { matched: true, origMatch: null, revMatch: m ? m[0] : '自动续约',
            description: '修订版新增了自动续约/自动延期条款，可能导致合同被动延续' };
        }
        return { matched: false };
      },
      suggestion: {
        riskExplanation: '自动续约条款可能导致在未充分评估的情况下被动延续合同，限制了重新谈判或终止的灵活性。',
        counterProposal: '建议删除自动续约条款，改为到期前协商续约。如保留，应设置明确的提前通知解约期限（如到期前60天）。',
        suggestedClause: '合同到期前60日内，任何一方均可书面通知对方不予续约。未通知的，视为同意续约一年。'
      }
    },

    // 4. 管辖地变化
    {
      id: 'jurisdiction_change',
      label: '管辖地变化',
      riskType: 'dispute',
      riskLevel: 'high',
      detect(orig, rev) {
        const courtRegex = /([\u4e00-\u9fff]{2,10}(?:人民法院|仲裁委员会|仲裁机构|仲裁中心))/g;
        const origCourts = [];
        const revCourts = [];
        let m;
        while ((m = courtRegex.exec(orig)) !== null) origCourts.push(m[1]);
        courtRegex.lastIndex = 0;
        while ((m = courtRegex.exec(rev)) !== null) revCourts.push(m[1]);

        if (origCourts.length > 0 && revCourts.length > 0) {
          const origSet = new Set(origCourts);
          const revSet = new Set(revCourts);
          const changed = [...revSet].filter(c => !origSet.has(c));
          if (changed.length > 0) {
            return { matched: true, origMatch: origCourts.join('、'), revMatch: revCourts.join('、'),
              description: `管辖机构从"${origCourts.join('、')}"变更为"${revCourts.join('、')}"` };
          }
        }
        // 仲裁与诉讼切换
        const origArb = /仲裁/.test(orig);
        const revArb = /仲裁/.test(rev);
        const origCourt = /诉讼|法院/.test(orig);
        const revCourt = /诉讼|法院/.test(rev);
        if (origArb && !revArb && revCourt) {
          return { matched: true, origMatch: '仲裁', revMatch: '诉讼',
            description: '争议解决方式从仲裁变更为诉讼' };
        }
        if (origCourt && !revCourt && revArb) {
          return { matched: true, origMatch: '诉讼', revMatch: '仲裁',
            description: '争议解决方式从诉讼变更为仲裁' };
        }
        return { matched: false };
      },
      suggestion: {
        riskExplanation: '管辖地或争议解决方式变更可能影响维权成本和诉讼便利性，对方可能选择对其有利的管辖地。',
        counterProposal: '建议约定我方所在地或合同签订地法院/仲裁机构管辖，避免异地诉讼带来的额外成本。',
        suggestedClause: '因本合同引起的争议，双方应友好协商解决。协商不成的，任何一方均有权向{我方所在地}人民法院提起诉讼。'
      }
    },

    // 5. 赔偿上限删除
    {
      id: 'compensation_cap_removed',
      label: '赔偿上限删除',
      riskType: 'breach',
      riskLevel: 'high',
      detect(orig, rev) {
        const capRegex = /(?:累计)?(?:赔偿|补偿|违约金)?(?:总[额计])?不[得能]?超过|上限为|最高不[得能]?超过/;
        const origHasCap = capRegex.test(orig);
        const revHasCap = capRegex.test(rev);
        if (origHasCap && !revHasCap && rev.length > 10) {
          return { matched: true, origMatch: '含赔偿上限', revMatch: '赔偿上限已删除',
            description: '原合同中的赔偿上限条款在修订版中被删除，赔偿风险敞口无限' };
        }
        return { matched: false };
      },
      suggestion: {
        riskExplanation: '删除赔偿上限意味着赔偿金额不受限制，极端情况下可能面临远超合同金额的赔偿责任。',
        counterProposal: '强烈建议恢复赔偿上限条款，将累计赔偿总额限定在合同金额以内。',
        suggestedClause: '因本合同引起的任何赔偿、补偿及违约金，累计总额不得超过本合同总金额的100%。'
      }
    },

    // 6. 保密期限缩短
    {
      id: 'confidentiality_shortened',
      label: '保密期限缩短',
      riskType: 'confidential',
      riskLevel: 'medium',
      detect(orig, rev) {
        const yearRegex = /保密[期义][限务]?\D*?(\d+|[一二三四五六七八九十]+)\s*年/;
        const origYears = extractNumber(orig, yearRegex);
        const revYears = extractNumber(rev, yearRegex);
        if (origYears !== null && revYears !== null && revYears < origYears) {
          return { matched: true, origMatch: `${origYears}年`, revMatch: `${revYears}年`,
            description: `保密期限从${origYears}年缩短至${revYears}年` };
        }
        // 保密义务条款被删除
        const confKeywords = ['保密', '商业秘密', '不得泄露', '保密义务'];
        const origHas = confKeywords.some(k => orig.includes(k));
        const revHas = confKeywords.some(k => rev.includes(k));
        if (origHas && !revHas && rev.length < orig.length * 0.5) {
          return { matched: true, origMatch: '含保密条款', revMatch: '保密条款减弱',
            description: '保密相关条款在修订版中被大幅削减' };
        }
        return { matched: false };
      },
      suggestion: {
        riskExplanation: '保密期限缩短可能导致商业秘密和敏感信息在合同终止后过早失去保护。',
        counterProposal: '建议维持原保密期限，核心商业秘密的保密义务应持续到信息公开为止。',
        suggestedClause: '保密义务的有效期为合同终止后{原年数}年，涉及核心商业秘密的信息保密义务不受期限限制。'
      }
    },

    // 7. 付款比例变更
    {
      id: 'payment_ratio_change',
      label: '付款比例变更',
      riskType: 'payment',
      riskLevel: 'medium',
      detect(orig, rev) {
        const ratioRegex = /(?:预付|首付|定金|尾款|验收款|进度款)\D{0,5}(\d+)\s*%/g;
        const origRatios = {};
        const revRatios = {};
        let m;
        while ((m = ratioRegex.exec(orig)) !== null) {
          const label = m[0].replace(/\d+\s*%/, '').trim();
          origRatios[label] = parseInt(m[1]);
        }
        ratioRegex.lastIndex = 0;
        while ((m = ratioRegex.exec(rev)) !== null) {
          const label = m[0].replace(/\d+\s*%/, '').trim();
          revRatios[label] = parseInt(m[1]);
        }
        const changes = [];
        for (const label of Object.keys(origRatios)) {
          if (revRatios[label] !== undefined && revRatios[label] !== origRatios[label]) {
            changes.push(`${label}从${origRatios[label]}%变为${revRatios[label]}%`);
          }
        }
        if (changes.length > 0) {
          return { matched: true, origMatch: Object.entries(origRatios).map(([k,v])=>`${k}${v}%`).join('、'),
            revMatch: Object.entries(revRatios).map(([k,v])=>`${k}${v}%`).join('、'),
            description: `付款比例变更：${changes.join('；')}` };
        }
        return { matched: false };
      },
      suggestion: {
        riskExplanation: '付款比例变更可能影响项目各阶段的资金保障和风险分配。',
        counterProposal: '建议维持合理的预付比例（不低于30%），确保项目启动资金充足，尾款比例不宜过高。',
        suggestedClause: null
      }
    },

    // 8. 验收期限缩短
    {
      id: 'acceptance_period_shortened',
      label: '验收期限缩短',
      riskType: 'delivery',
      riskLevel: 'medium',
      detect(orig, rev) {
        const regex = /验收\D{0,10}(\d+|[一二三四五六七八九十]+)\s*个?(?:工作)?[日天]/;
        const origDays = extractNumber(orig, regex);
        const revDays = extractNumber(rev, regex);
        if (origDays !== null && revDays !== null && revDays < origDays) {
          return { matched: true, origMatch: `${origDays}天`, revMatch: `${revDays}天`,
            description: `验收期限从${origDays}天缩短至${revDays}天，验收时间压力增大` };
        }
        return { matched: false };
      },
      suggestion: {
        riskExplanation: '验收期限缩短可能导致无法充分测试和验证交付物质量。',
        counterProposal: '建议维持合理的验收期限（不少于15个工作日），确保有充分时间进行质量验证。',
        suggestedClause: null
      }
    },

    // 9. 免责条款新增
    {
      id: 'exemption_clause_added',
      label: '免责条款新增',
      riskType: 'breach',
      riskLevel: 'high',
      detect(orig, rev) {
        const exemptKeywords = ['免除责任', '不承担责任', '免于承担', '概不负责', '不承担任何', '免责'];
        const origHas = exemptKeywords.filter(k => orig.includes(k));
        const revHas = exemptKeywords.filter(k => rev.includes(k));
        const newExemptions = revHas.filter(k => !origHas.includes(k));
        if (newExemptions.length > 0) {
          return { matched: true, origMatch: null, revMatch: newExemptions.join('、'),
            description: `修订版新增了免责条款关键词："${newExemptions.join('、')}"` };
        }
        return { matched: false };
      },
      suggestion: {
        riskExplanation: '新增免责条款可能导致对方在履约不当时逃避法律责任，造成我方权益受损。',
        counterProposal: '建议限制免责范围仅适用于不可抗力等法定情形，对因故意或重大过失造成的损失不得免责。',
        suggestedClause: '因故意或重大过失造成的损失，不适用免责条款。'
      }
    },

    // 10. 知识产权归属变更
    {
      id: 'ip_ownership_change',
      label: '知识产权归属变更',
      riskType: 'confidential',
      riskLevel: 'high',
      detect(orig, rev) {
        const ipRegex = /知识产权|著作权|专利权|版权/;
        const ownerRegex = /(甲方|乙方|委托方|受托方|开发方|需求方)\s*(?:所有|享有|归属|拥有)/g;
        if (!ipRegex.test(orig) && !ipRegex.test(rev)) return { matched: false };

        const origOwners = [...orig.matchAll(ownerRegex)].map(m => m[1]);
        const revOwners = [...rev.matchAll(ownerRegex)].map(m => m[1]);

        if (origOwners.length > 0 && revOwners.length > 0) {
          const origSet = new Set(origOwners);
          const revSet = new Set(revOwners);
          if ([...origSet].join() !== [...revSet].join()) {
            return { matched: true, origMatch: [...origSet].join('、'), revMatch: [...revSet].join('、'),
              description: `知识产权归属从"${[...origSet].join('、')}"变更为"${[...revSet].join('、')}"` };
          }
        }
        // 检测共有变独有
        const origShared = /共同所有|共有|共同享有/.test(orig);
        const revShared = /共同所有|共有|共同享有/.test(rev);
        if (origShared && !revShared) {
          return { matched: true, origMatch: '共同所有', revMatch: '单方所有',
            description: '知识产权从共同所有变更为单方所有' };
        }
        return { matched: false };
      },
      suggestion: {
        riskExplanation: '知识产权归属变更可能影响后续对技术成果的使用、许可和商业化权利。',
        counterProposal: '建议明确约定知识产权归属，区分背景知识产权和项目产出知识产权的权属分配。',
        suggestedClause: '项目执行过程中产生的知识产权成果由双方共同所有，各方均可独立使用但不得向第三方单独许可。'
      }
    },

    // 11. 不可抗力范围扩大
    {
      id: 'force_majeure_expanded',
      label: '不可抗力范围扩大',
      riskType: 'breach',
      riskLevel: 'medium',
      detect(orig, rev) {
        const fmKeywords = ['不可抗力', '自然灾害', '战争', '疫情', '政府行为', '政策变化',
          '罢工', '暴动', '恐怖活动', '流行病', '网络攻击', '系统故障', '市场变化'];
        const origFM = fmKeywords.filter(k => orig.includes(k));
        const revFM = fmKeywords.filter(k => rev.includes(k));
        const newFM = revFM.filter(k => !origFM.includes(k));
        if (newFM.length >= 2) {
          return { matched: true, origMatch: origFM.join('、') || '无', revMatch: revFM.join('、'),
            description: `不可抗力范围新增：${newFM.join('、')}` };
        }
        return { matched: false };
      },
      suggestion: {
        riskExplanation: '不可抗力范围扩大可能使对方以更多理由免除履约责任。',
        counterProposal: '建议严格限定不可抗力范围为法律规定的不可预见、不可避免、不可克服的客观事件，排除商业风险。',
        suggestedClause: null
      }
    },

    // 12. 合同终止条件变更
    {
      id: 'termination_condition_change',
      label: '合同终止条件变更',
      riskType: 'delivery',
      riskLevel: 'medium',
      detect(orig, rev) {
        const termKeywords = ['单方解除', '单方终止', '有权解除', '有权终止', '立即解除', '随时终止'];
        const origTerm = termKeywords.filter(k => orig.includes(k));
        const revTerm = termKeywords.filter(k => rev.includes(k));
        const newTerm = revTerm.filter(k => !origTerm.includes(k));
        if (newTerm.length > 0) {
          return { matched: true, origMatch: origTerm.join('、') || '无', revMatch: revTerm.join('、'),
            description: `修订版新增单方解除/终止权："${newTerm.join('、')}"` };
        }
        return { matched: false };
      },
      suggestion: {
        riskExplanation: '新增的单方终止权可能导致对方随意终止合同，影响已投入资源的回收。',
        counterProposal: '建议限定单方终止的适用条件，并要求提前通知期（不少于30天），同时约定终止后的结算机制。',
        suggestedClause: '任何一方解除合同的，应提前30日书面通知对方，并对已完成工作量按合同约定进行结算。'
      }
    }
  ];

  // ==================== 变更分类 ====================

  /**
   * 对变更运行所有风险模式检测
   */
  function detectPatterns(origText, revText) {
    const matches = [];
    for (const pattern of RISK_PATTERNS) {
      const result = pattern.detect(origText || '', revText || '');
      if (result.matched) {
        matches.push({
          patternId: pattern.id,
          patternLabel: pattern.label,
          riskType: pattern.riskType,
          riskLevel: pattern.riskLevel,
          matchedOriginal: result.origMatch || null,
          matchedRevised: result.revMatch || null,
          description: result.description
        });
      }
    }
    return matches;
  }

  /**
   * 根据章节标题和内容推断风险类型
   */
  function inferRiskType(sectionTitle, text) {
    const combined = (sectionTitle || '') + ' ' + (text || '');
    const typeKeywords = {
      payment: ['付款', '支付', '结算', '价款', '费用', '金额', '预付', '尾款'],
      breach: ['违约', '赔偿', '罚款', '损害', '责任', '补偿'],
      confidential: ['保密', '商业秘密', '知识产权', '著作权', '专利'],
      delivery: ['交付', '验收', '期限', '工期', '进度', '里程碑', '合同期'],
      dispute: ['争议', '管辖', '仲裁', '诉讼', '法律适用', '法院'],
      entity: ['主体', '资质', '授权', '代理', '法定代表人']
    };

    for (const [type, keywords] of Object.entries(typeKeywords)) {
      if (keywords.some(k => combined.includes(k))) return type;
    }
    return null;
  }

  /**
   * 从模式匹配中聚合风险等级
   */
  function assessRiskLevel(patterns) {
    if (patterns.length === 0) return null;

    const levelValues = { high: 3, medium: 2, low: 1 };
    let maxLevel = 'low';
    for (const p of patterns) {
      if (levelValues[p.riskLevel] > levelValues[maxLevel]) {
        maxLevel = p.riskLevel;
      }
    }
    return maxLevel;
  }

  /**
   * 将diff结果中的一个变更映射为ChangeRecord
   */
  function classifyChange(sectionMapping, paragraphDiff, mappingIndex) {
    let changeType, originalText, revisedText, sectionTitle;

    if (sectionMapping.type === 'added') {
      changeType = 'section_added';
      originalText = '';
      revisedText = DiffEngine.getSectionText(sectionMapping.revisedSection);
      sectionTitle = sectionMapping.revisedSection.title;
    } else if (sectionMapping.type === 'deleted') {
      changeType = 'section_deleted';
      originalText = DiffEngine.getSectionText(sectionMapping.originalSection);
      revisedText = '';
      sectionTitle = sectionMapping.originalSection.title;
    } else if (paragraphDiff) {
      changeType = 'paragraph_' + paragraphDiff.type;
      originalText = paragraphDiff.originalParagraph ? paragraphDiff.originalParagraph.text : '';
      revisedText = paragraphDiff.revisedParagraph ? paragraphDiff.revisedParagraph.text : '';
      sectionTitle = sectionMapping.originalSection ?
        sectionMapping.originalSection.title : sectionMapping.revisedSection.title;
    } else {
      changeType = 'section_modified';
      originalText = DiffEngine.getSectionText(sectionMapping.originalSection);
      revisedText = DiffEngine.getSectionText(sectionMapping.revisedSection);
      sectionTitle = sectionMapping.originalSection.title;
    }

    const patterns = detectPatterns(originalText, revisedText);
    const riskType = patterns.length > 0 ? patterns[0].riskType : inferRiskType(sectionTitle, revisedText || originalText);
    const riskLevel = assessRiskLevel(patterns);

    // 生成变更摘要
    let summary;
    switch (changeType) {
      case 'section_added': summary = `新增章节：${sectionTitle}`; break;
      case 'section_deleted': summary = `删除章节：${sectionTitle}`; break;
      case 'section_modified': summary = `修改章节：${sectionTitle}`; break;
      case 'paragraph_added': summary = `新增条款（${sectionTitle}）`; break;
      case 'paragraph_deleted': summary = `删除条款（${sectionTitle}）`; break;
      case 'paragraph_modified': summary = `修改条款（${sectionTitle}）`; break;
      default: summary = `变更（${sectionTitle}）`;
    }

    if (patterns.length > 0) {
      summary += '：' + patterns[0].patternLabel;
    }

    return {
      id: generateId(changeType + sectionTitle + originalText.slice(0, 50)),
      sectionMappingIndex: mappingIndex,
      changeType,
      riskType,
      riskLevel,
      riskLevelBefore: patterns.length > 0 && changeType.includes('modified') ? 'medium' : null,
      riskLevelAfter: riskLevel,
      patterns,
      originalText,
      revisedText,
      sectionTitle,
      summary
    };
  }

  // ==================== 谈判建议生成 ====================

  /**
   * 为变更记录生成谈判建议
   */
  function generateSuggestion(changeRecord) {
    if (!changeRecord.riskLevel || changeRecord.riskLevel === 'low') return null;
    if (changeRecord.patterns.length === 0) {
      // 无具体模式匹配但有风险类型，生成通用建议
      return generateGenericSuggestion(changeRecord);
    }

    // 取最高优先级的模式
    const levelValues = { high: 3, medium: 2, low: 1 };
    const sortedPatterns = [...changeRecord.patterns].sort(
      (a, b) => levelValues[b.riskLevel] - levelValues[a.riskLevel]
    );
    const topPattern = sortedPatterns[0];
    const patternDef = RISK_PATTERNS.find(p => p.id === topPattern.patternId);

    if (!patternDef || !patternDef.suggestion) {
      return generateGenericSuggestion(changeRecord);
    }

    return {
      changeId: changeRecord.id,
      priority: changeRecord.riskLevel === 'high' ? 1 : 2,
      whatChanged: changeRecord.summary,
      whyRisky: topPattern.description + '。' + patternDef.suggestion.riskExplanation,
      counterProposal: patternDef.suggestion.counterProposal,
      suggestedClause: patternDef.suggestion.suggestedClause || null,
      relatedPatterns: changeRecord.patterns.map(p => p.patternId)
    };
  }

  /**
   * 生成通用谈判建议（无具体模式匹配时）
   */
  function generateGenericSuggestion(changeRecord) {
    const typeLabels = {
      payment: '付款条款', breach: '违约责任', confidential: '保密义务',
      delivery: '交付期限', dispute: '争议解决', entity: '主体信息'
    };
    const typeName = typeLabels[changeRecord.riskType] || '合同条款';

    let whyRisky, counterProposal;
    switch (changeRecord.changeType) {
      case 'section_added':
      case 'paragraph_added':
        whyRisky = `修订版新增了${typeName}相关条款，需要评估对合同平衡性的影响。`;
        counterProposal = `建议仔细审阅新增的${typeName}条款，确保双方权利义务对等。`;
        break;
      case 'section_deleted':
      case 'paragraph_deleted':
        whyRisky = `修订版删除了${typeName}相关条款，可能导致相关权益缺乏保障。`;
        counterProposal = `建议恢复被删除的${typeName}条款，或补充替代性保护条款。`;
        break;
      default:
        whyRisky = `修订版对${typeName}进行了修改，需要关注变更对权益的影响。`;
        counterProposal = `建议对比修改前后的${typeName}条款，确认变更是否可接受。`;
    }

    return {
      changeId: changeRecord.id,
      priority: changeRecord.riskLevel === 'high' ? 1 : 2,
      whatChanged: changeRecord.summary,
      whyRisky,
      counterProposal,
      suggestedClause: null,
      relatedPatterns: []
    };
  }

  // ==================== 顶层分析 ====================

  /**
   * 分析diff结果，生成变更记录和谈判建议
   * @param {DiffResult} diffResult
   * @param {Section[]} originalSections
   * @param {Section[]} revisedSections
   * @returns {AnalysisResult}
   */
  function analyze(diffResult, originalSections, revisedSections) {
    const changes = [];
    const suggestions = [];

    diffResult.sectionMappings.forEach((mapping, index) => {
      if (mapping.type === 'added' || mapping.type === 'deleted') {
        const change = classifyChange(mapping, null, index);
        changes.push(change);
        const suggestion = generateSuggestion(change);
        if (suggestion) suggestions.push(suggestion);
      } else if (mapping.type === 'matched') {
        // 对每个变更的段落生成变更记录
        const changedParas = mapping.paragraphDiffs.filter(pd => pd.type !== 'unchanged');
        if (changedParas.length === 0 && !mapping.titleChanged) return;

        // 如果标题变更但段落不变
        if (changedParas.length === 0 && mapping.titleChanged) {
          const change = classifyChange(mapping, null, index);
          changes.push(change);
          return;
        }

        for (const paraDiff of changedParas) {
          const change = classifyChange(mapping, paraDiff, index);
          changes.push(change);
          const suggestion = generateSuggestion(change);
          if (suggestion) suggestions.push(suggestion);
        }
      }
    });

    // 按优先级排序建议
    suggestions.sort((a, b) => a.priority - b.priority);

    // 统计
    const riskSummary = {
      totalChanges: changes.length,
      highRiskChanges: changes.filter(c => c.riskLevel === 'high').length,
      mediumRiskChanges: changes.filter(c => c.riskLevel === 'medium').length,
      lowRiskChanges: changes.filter(c => c.riskLevel === 'low').length,
      byType: {},
      riskTrend: 'unchanged'
    };

    // 按类型统计
    for (const type of Object.keys(AnnotationManager.RISK_TYPES)) {
      riskSummary.byType[type] = changes.filter(c => c.riskType === type).length;
    }

    // 判断风险趋势
    if (riskSummary.highRiskChanges > 0) {
      riskSummary.riskTrend = 'increased';
    } else if (riskSummary.totalChanges > 0 && riskSummary.highRiskChanges === 0) {
      const hasAddedRisk = changes.some(c =>
        c.changeType.includes('added') && c.riskLevel
      );
      const hasRemovedRisk = changes.some(c =>
        c.changeType.includes('deleted') && c.riskLevel
      );
      if (hasAddedRisk && !hasRemovedRisk) {
        riskSummary.riskTrend = 'increased';
      } else if (hasRemovedRisk && !hasAddedRisk) {
        riskSummary.riskTrend = 'decreased';
      }
    }

    return { changes, suggestions, riskSummary };
  }

  // ==================== 批注迁移状态追踪 ====================

  /**
   * 执行批注迁移并返回带状态追踪的结果
   */
  function migrateAnnotationsForComparison(annotations, originalSections, revisedSections) {
    if (!annotations || annotations.length === 0) return [];

    const result = TextParser.migrateAnnotations(annotations, revisedSections, originalSections);
    const migrationResults = [];

    // 处理成功迁移的批注
    for (const migrated of result.migrated) {
      const original = annotations.find(a => a.id === migrated.id);
      if (!original) continue;

      const positionChanged =
        original.sectionId !== migrated.sectionId ||
        original.paragraphIndex !== migrated.paragraphIndex ||
        original.startOffset !== migrated.startOffset ||
        original.endOffset !== migrated.endOffset;

      migrationResults.push({
        annotation: migrated,
        status: positionChanged ? 'adjusted' : 'migrated',
        originalPosition: {
          sectionId: original.sectionId,
          paragraphIndex: original.paragraphIndex,
          startOffset: original.startOffset,
          endOffset: original.endOffset
        },
        newPosition: {
          sectionId: migrated.sectionId,
          paragraphIndex: migrated.paragraphIndex,
          startOffset: migrated.startOffset,
          endOffset: migrated.endOffset
        },
        reason: positionChanged ? '批注位置已自动调整到新版本对应位置' : '批注成功迁移到新版本'
      });
    }

    // 处理失效的批注
    for (const invalidated of result.invalidated) {
      migrationResults.push({
        annotation: invalidated,
        status: 'invalidated',
        originalPosition: {
          sectionId: invalidated.sectionId,
          paragraphIndex: invalidated.paragraphIndex,
          startOffset: invalidated.startOffset,
          endOffset: invalidated.endOffset
        },
        newPosition: null,
        reason: invalidated._invalidReason || '无法在新版本中定位对应文本'
      });
    }

    return migrationResults;
  }

  return {
    analyze,
    classifyChange,
    detectPatterns,
    generateSuggestion,
    assessRiskLevel,
    migrateAnnotationsForComparison,
    RISK_PATTERNS
  };
})();
