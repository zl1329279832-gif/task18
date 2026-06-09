/**
 * 回归测试：复杂合同版本对比场景
 * 测试同时发生付款周期延长、赔偿上限删除、管辖地变化、
 * 自动续约新增和条款拆分时的批注迁移、风险统计、报告导出正确性
 *
 * 运行方式：node test/regression-complex-contract.js
 */

// ======== 最小化 DOM 模拟 ========
const _global = typeof globalThis !== 'undefined' ? globalThis : global;
_global.document = {
  createElement: (tag) => ({
    tagName: tag,
    textContent: '',
    innerHTML: '',
    href: '',
    download: '',
    get innerText() { return this.textContent; },
    set innerText(v) { this.textContent = v; },
    appendChild: function() {},
    removeChild: function() {},
    addEventListener: function() {},
    click: function() {},
    classList: { add(){}, remove(){}, contains(){ return false; } },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    style: {},
    dataset: {}
  }),
  getElementById: () => ({
    innerHTML: '', textContent: '', style: {}, dataset: {},
    addEventListener(){}, querySelectorAll(){ return []; }, querySelector(){ return null; },
    appendChild(){}, classList: { add(){}, remove(){} }, disabled: false, value: ''
  }),
  addEventListener: function() {},
  querySelectorAll: function() { return []; },
  body: { appendChild(){}, removeChild(){} }
};
_global.window = { getSelection: () => null };
_global.localStorage = { getItem(){ return null; }, setItem(){}, removeItem(){} };
_global.URL = { createObjectURL(){ return ''; }, revokeObjectURL(){} };
_global.Blob = function(content, opts) { this.content = content; };
_global.IntersectionObserver = function() { this.observe = function(){}; this.disconnect = function(){}; };
_global.requestAnimationFrame = function(cb) { cb(); };

// ======== 加载模块 ========
const fs = require('fs');
const path = require('path');

const jsDir = path.join(__dirname, '..', 'js');
const loadOrder = [
  'text-parser.js',
  'annotation-manager.js',
  'annotation-renderer.js',
  'version-comparator.js',
  'negotiation-advisor.js',
  'risk-statistics.js',
  'report-exporter.js',
  'comparison-renderer.js',
  'comparison-exporter.js',
];

for (const file of loadOrder) {
  let code = fs.readFileSync(path.join(jsDir, file), 'utf-8');
  // 将 IIFE 顶层 const 声明转为全局赋值，使模块间可互相引用
  code = code.replace(/^const\s+(\w+)\s*=\s*\(\(\)\s*=>\s*\{/m, '_global.$1 = (() => {');
  try {
    eval(code);
  } catch (e) {
    console.warn(`  [WARN] 加载 ${file} 时出现警告: ${e.message}`);
  }
}

// 提取全局引用
const TextParser = _global.TextParser;
const AnnotationManager = _global.AnnotationManager;
const AnnotationRenderer = _global.AnnotationRenderer;
const VersionComparator = _global.VersionComparator;
const NegotiationAdvisor = _global.NegotiationAdvisor;
const RiskStatistics = _global.RiskStatistics;
const ReportExporter = _global.ReportExporter;
const ComparisonRenderer = _global.ComparisonRenderer;
const ComparisonExporter = _global.ComparisonExporter;

// ======== 测试用合同文本 ========

const OLD_CONTRACT = `软件开发服务合同

甲方：北京科技有限公司
乙方：上海软件开发有限公司

第一章 总则

第一条 合同目的
甲方委托乙方进行企业管理系统的软件开发工作，双方本着平等互利、诚实信用的原则，经友好协商，就相关事项达成如下协议。

第二章 合同价款与支付

第三条 合同总价
本合同总价款为人民币捌拾万元整（¥800,000.00），包含软件开发费、部署实施费及一年维护费。

第四条 付款方式
甲方按以下节点付款：合同签订后5个工作日内支付合同总价的30%，系统通过验收后5个工作日内支付合同总价的60%，维护期满后5个工作日内支付合同总价的10%。

第三章 违约责任

第五条 乙方违约
乙方逾期交付的，每逾期一日应向甲方支付合同总价万分之五的违约金，但累计不超过合同总价的15%。乙方交付的软件存在重大缺陷且无法修复的，甲方有权解除合同，乙方应退还已收取的全部款项。

第四章 争议解决

第六条 争议解决方式
因本合同产生的争议，双方应首先通过友好协商解决。协商不成的，任何一方均可向合同签订地有管辖权的人民法院提起诉讼。

第五章 其他条款

第七条 合同终止
本合同在双方义务全部履行完毕或双方协商一致时终止。`;

const NEW_CONTRACT = `软件开发服务合同

甲方：北京科技有限公司
乙方：上海软件开发有限公司

第一章 总则

第一条 合同目的
甲方委托乙方进行企业管理系统的软件开发工作，双方本着平等互利、诚实信用的原则，经友好协商，就相关事项达成如下协议。

第二章 合同价款与支付

第三条 合同总价
本合同总价款为人民币壹佰万元整（¥1,000,000.00），包含软件开发费、部署实施费及两年维护费。

第四条 付款方式（首期）
甲方按以下节点付款：合同签订后15个工作日内支付合同总价的30%，即人民币叁拾万元整。

第四条之一 付款方式（后期）
系统通过验收后15个工作日内支付合同总价的50%，维护期满后15个工作日内支付合同总价的20%。

第三章 违约责任

第五条 乙方违约
乙方逾期交付的，每逾期一日应向甲方支付合同总价万分之五的违约金。乙方交付的软件存在重大缺陷且无法修复的，甲方有权解除合同，乙方应退还已收取的全部款项。

第四章 争议解决

第六条 争议解决方式
因本合同产生的争议，双方应首先通过友好协商解决。协商不成的，任何一方均可向北京市海淀区人民法院提起诉讼。

第五章 其他条款

第七条 合同终止
本合同在双方义务全部履行完毕或双方协商一致时终止。

第八条 自动续约
本合同期满后，如双方均无书面异议，合同自动续约一年，续约条款与本合同相同。`;

// ======== 测试断言工具 ========
let passed = 0, failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${message}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${message}`);
  }
}

// ======== 测试1：章节解析 ========
console.log('\n=== 测试1：章节解析 ===');

const oldSections = TextParser.parseSections(OLD_CONTRACT);
const newSections = TextParser.parseSections(NEW_CONTRACT);

assert(oldSections.length >= 7, `旧版识别到 ${oldSections.length} 个章节（含前言），预期 >= 7`);
assert(newSections.length >= 9, `新版识别到 ${newSections.length} 个章节（含拆分和新增），预期 >= 9`);

// 检测拆分：新版应有"第四条 付款方式（首期）"和"第四条之一 付款方式（后期）"
const splitSection1 = newSections.find(s => s.title.includes('首期'));
const splitSection2 = newSections.find(s => s.title.includes('后期') || s.title.includes('第四条之一'));
assert(!!splitSection1, '新版检测到拆分章节"付款方式（首期）"');
assert(!!splitSection2, '新版检测到拆分章节"付款方式（后期）"或"第四条之一"');

// 检测新增：自动续约
const autoRenewSection = newSections.find(s => s.title.includes('自动续约'));
assert(!!autoRenewSection, '新版检测到新增章节"自动续约"');

// ======== 测试2：版本对比 ========
console.log('\n=== 测试2：版本对比 ===');

const diffResult = VersionComparator.compareSections(oldSections, newSections);

assert(diffResult.sectionDiffs.length > 0, `生成了 ${diffResult.sectionDiffs.length} 个章节diff`);
assert(diffResult.summary.sectionsAdded >= 1, `检测到 ${diffResult.summary.sectionsAdded} 个新增章节（预期 >= 1，含自动续约）`);
assert(diffResult.summary.sectionsModified >= 1, `检测到 ${diffResult.summary.sectionsModified} 个修改章节（预期 >= 1）`);

// 检查管辖地变化是否被检测到
const disputeDiff = diffResult.sectionDiffs.find(sd =>
  (sd.oldSection?.title || '').includes('争议解决方式') || (sd.newSection?.title || '').includes('争议解决方式')
);
assert(!!disputeDiff && disputeDiff.changeType === 'modified',
  '争议解决章节被检测为修改');

// ======== 测试3：批注迁移 ========
console.log('\n=== 测试3：批注迁移 ===');

// 在旧版上创建批注
const oldPaymentSection = oldSections.find(s => s.title.includes('付款方式'));
const oldBreachSection = oldSections.find(s => s.title.includes('乙方违约'));
const oldDisputeSection = oldSections.find(s => s.title.includes('争议解决方式'));

const oldAnnotations = [];

if (oldPaymentSection) {
  const payPara = oldPaymentSection.paragraphs.find(p => p.text.includes('5个工作日'));
  if (payPara) {
    const anchorText = '5个工作日内';
    const startOffset = payPara.text.indexOf(anchorText);
    oldAnnotations.push({
      id: 'ann_payment_1',
      rangeId: TextParser.computeRangeId(oldPaymentSection.title, payPara.text, anchorText),
      sectionId: oldPaymentSection.id,
      paragraphIndex: payPara.index,
      startOffset: startOffset,
      endOffset: startOffset + anchorText.length,
      anchorText: anchorText,
      riskType: 'payment',
      riskLevel: 'medium',
      comment: '付款周期需确认',
      status: 'pending',
      history: [{ action: 'created', time: new Date().toISOString(), status: 'pending' }],
      _sectionTitle: oldPaymentSection.title,
      _context: TextParser.computeAnchorContext(payPara.text, startOffset, startOffset + anchorText.length)
    });
  }
}

if (oldBreachSection) {
  const breachPara = oldBreachSection.paragraphs.find(p => p.text.includes('不超过'));
  if (breachPara) {
    const anchorText = '累计不超过合同总价的15%';
    const startOffset = breachPara.text.indexOf(anchorText);
    if (startOffset >= 0) {
      oldAnnotations.push({
        id: 'ann_breach_cap',
        rangeId: TextParser.computeRangeId(oldBreachSection.title, breachPara.text, anchorText),
        sectionId: oldBreachSection.id,
        paragraphIndex: breachPara.index,
        startOffset: startOffset,
        endOffset: startOffset + anchorText.length,
        anchorText: anchorText,
        riskType: 'breach',
        riskLevel: 'high',
        comment: '赔偿上限条款 - 必须保留',
        status: 'flagged',
        history: [
          { action: 'created', time: new Date().toISOString(), status: 'pending' },
          { action: 'status_change', from: 'pending', to: 'reviewing', time: new Date().toISOString() },
          { action: 'status_change', from: 'reviewing', to: 'flagged', time: new Date().toISOString() }
        ],
        _sectionTitle: oldBreachSection.title,
        _context: TextParser.computeAnchorContext(breachPara.text, startOffset, startOffset + anchorText.length)
      });
    }
  }
}

if (oldDisputeSection) {
  const disputePara = oldDisputeSection.paragraphs.find(p => p.text.includes('合同签订地'));
  if (disputePara) {
    const anchorText = '合同签订地有管辖权的人民法院';
    const startOffset = disputePara.text.indexOf(anchorText);
    if (startOffset >= 0) {
      oldAnnotations.push({
        id: 'ann_dispute_1',
        rangeId: TextParser.computeRangeId(oldDisputeSection.title, disputePara.text, anchorText),
        sectionId: oldDisputeSection.id,
        paragraphIndex: disputePara.index,
        startOffset: startOffset,
        endOffset: startOffset + anchorText.length,
        anchorText: anchorText,
        riskType: 'dispute',
        riskLevel: 'medium',
        comment: '需确认管辖法院',
        status: 'reviewing',
        history: [
          { action: 'created', time: new Date().toISOString(), status: 'pending' },
          { action: 'status_change', from: 'pending', to: 'reviewing', time: new Date().toISOString() }
        ],
        _sectionTitle: oldDisputeSection.title,
        _context: TextParser.computeAnchorContext(disputePara.text, startOffset, startOffset + anchorText.length)
      });
    }
  }
}

assert(oldAnnotations.length === 3, `创建了 ${oldAnnotations.length} 条旧版批注（预期 3）`);

// 执行迁移
const migrationResult = TextParser.migrateAnnotations(oldAnnotations, newSections, oldSections);

console.log(`  迁移统计: 总计=${migrationResult.stats.total}, 精确=${migrationResult.stats.exactMatch}, 修正=${migrationResult.stats.corrected}, 失效=${migrationResult.stats.invalidated}`);

// 付款周期批注（"5个工作日内"）：新版改为"15个工作日内"，原锚点文本仍然存在但上下文变了
// 这个批注的锚点是"5个工作日内"，新版中没有"5个"但有"15个"，所以应该失效
const paymentMigrated = migrationResult.migrated.find(a => a.id === 'ann_payment_1');
const paymentInvalidated = migrationResult.invalidated.find(a => a.id === 'ann_payment_1');

// 赔偿上限批注（"累计不超过合同总价的15%"）：新版已删除这个文本
const breachCapInvalidated = migrationResult.invalidated.find(a => a.id === 'ann_breach_cap');
assert(!!breachCapInvalidated, '赔偿上限批注被正确标记为失效（文本已删除）');

// 管辖地批注（"合同签订地有管辖权的人民法院"）：新版改为"北京市海淀区人民法院"
const disputeInvalidated = migrationResult.invalidated.find(a => a.id === 'ann_dispute_1');
assert(!!disputeInvalidated, '管辖地批注被正确标记为失效（文本已变更）');

// 验证失效批注有失效原因
if (breachCapInvalidated) {
  assert(!!breachCapInvalidated._invalidReason, `赔偿上限批注有失效原因: "${breachCapInvalidated._invalidReason}"`);
}

// ======== 测试4：风险统计排除失效批注 ========
console.log('\n=== 测试4：风险统计排除失效批注 ===');

const allAnnsForStats = [...migrationResult.migrated, ...migrationResult.invalidated];
const stats = RiskStatistics.computeStats(allAnnsForStats);

assert(stats.total + stats.invalidatedCount === allAnnsForStats.length,
  `有效(${stats.total}) + 失效(${stats.invalidatedCount}) = 总数(${allAnnsForStats.length})`);

// 失效批注不应被计入风险等级
const totalByLevel = stats.byLevel.high + stats.byLevel.medium + stats.byLevel.low;
assert(totalByLevel === stats.total,
  `风险等级总和(${totalByLevel}) 等于有效批注数(${stats.total})，失效批注不参与`);

// 失效批注不应被计入风险类型
const totalByType = Object.values(stats.byType).reduce((a, b) => a + b, 0);
assert(totalByType === stats.total,
  `风险类型总和(${totalByType}) 等于有效批注数(${stats.total})，失效批注不参与`);

// ======== 测试5：谈判建议检测 ========
console.log('\n=== 测试5：谈判建议检测 ===');

const suggestions = NegotiationAdvisor.analyzeChanges(diffResult, oldAnnotations, migrationResult.migrated);

const paymentSug = suggestions.find(s => s.ruleId === 'payment_period_extension');
assert(!!paymentSug, '检测到付款期限延长建议');

const capRemovalSug = suggestions.find(s => s.ruleId === 'compensation_cap_removal');
assert(!!capRemovalSug, '检测到赔偿上限移除建议');

const jurisdictionSug = suggestions.find(s => s.ruleId === 'jurisdiction_change');
assert(!!jurisdictionSug, '检测到管辖权变更建议');

const autoRenewSug = suggestions.find(s => s.ruleId === 'auto_renewal_addition');
assert(!!autoRenewSug, '检测到自动续约新增建议');

// ======== 测试6：风险变化计算 ========
console.log('\n=== 测试6：风险变化计算 ===');

const riskDeltas = NegotiationAdvisor.getRiskDelta(diffResult, oldAnnotations, migrationResult.migrated);
assert(riskDeltas.length > 0, `计算了 ${riskDeltas.length} 个章节的风险变化`);

// ======== 测试7：导出报告不崩溃 ========
console.log('\n=== 测试7：导出报告完整性 ===');

// Mock downloadBlob to capture output
let capturedReport = '';
const origDownload = _global.ComparisonExporter;

try {
  // 直接测试 buildComparisonTable 等不会崩溃
  // 由于 downloadBlob 依赖 DOM，我们只测试数据流
  assert(typeof ComparisonExporter.exportComparisonReport === 'function',
    'exportComparisonReport 函数存在');

  // 验证函数签名支持新参数（不会抛出参数错误）
  let exportError = null;
  try {
    ComparisonExporter.exportComparisonReport(
      diffResult, suggestions, riskDeltas,
      { total: 3, migrated: 1, invalidated: 2 },
      oldAnnotations,
      migrationResult.migrated
    );
  } catch (e) {
    exportError = e;
  }
  assert(!exportError, `导出报告无崩溃${exportError ? ': ' + exportError.message : ''}`);
} catch (e) {
  assert(false, '导出报告测试异常: ' + e.message);
}

// ======== 测试8：批注迁移历史记录 ========
console.log('\n=== 测试8：迁移历史记录 ===');

// 模拟 AnnotationManager 的迁移流程
AnnotationManager.clearAll();
AnnotationManager.importAnnotations([...oldAnnotations]);
const mgResult = AnnotationManager.migrateToNewSections(newSections, oldSections);

const allAfterMigration = AnnotationManager.getAllAnnotations();
const invalidatedAfter = allAfterMigration.filter(a => a.status === 'invalidated');

invalidatedAfter.forEach(ann => {
  const hasInvalidHistory = ann.history && ann.history.some(h => h.action === 'invalidated');
  assert(hasInvalidHistory, `失效批注 "${ann.id}" 的 history 中有 invalidated 记录`);
  assert(!!ann.updatedAt, `失效批注 "${ann.id}" 有 updatedAt 时间戳`);
});

// ======== 汇总 ========
console.log(`\n==============================`);
console.log(`测试结果: ${passed} 通过, ${failed} 失败`);
console.log(`==============================\n`);

process.exit(failed > 0 ? 1 : 0);
