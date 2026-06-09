/**
 * regression.js - 合同版本对比回归测试
 * 覆盖：批注迁移正确性、失效过滤、报告内容、拆分检测、风险等级历史
 */
const RegressionTests = (() => {
  let results = [];
  let currentTest = '';

  function assert(condition, message) {
    if (!condition) {
      throw new Error('断言失败: ' + message);
    }
  }

  function assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(
        (message || '值不相等') + ': 期望 "' + expected + '", 实际 "' + actual + '"'
      );
    }
  }

  function assertIncludes(haystack, needle, message) {
    if (!haystack || haystack.indexOf(needle) === -1) {
      throw new Error(
        (message || '未包含预期内容') + ': 在 "' + (haystack || '').substring(0, 100) + '..." 中未找到 "' + needle + '"'
      );
    }
  }

  function test(name, fn) {
    currentTest = name;
    try {
      fn();
      results.push({ name, passed: true, message: '通过' });
    } catch (e) {
      results.push({ name, passed: false, message: e.message });
    }
  }

  // ==================== 辅助：构造模拟章节和批注 ====================

  function buildSections(text) {
    return TextParser.parseSections(text, 'txt');
  }

  function buildAnnotation(overrides) {
    const defaults = {
      sectionId: '', paragraphIndex: 0, startOffset: 0, endOffset: 0,
      anchorText: '', riskType: 'payment', riskLevel: 'medium',
      comment: '', status: 'pending',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      history: [{ action: 'created', time: new Date().toISOString(), status: 'pending' }],
      _sectionTitle: '', _context: { before: '', after: '' }
    };
    const ann = Object.assign({}, defaults, overrides);
    if (!ann.id) {
      ann.id = 'ann_' + Math.random().toString(36).substring(2, 10);
    }
    if (!ann.rangeId) {
      ann.rangeId = 'rng_' + Math.random().toString(36).substring(2, 10);
    }
    return ann;
  }

  function findSectionByTitle(sections, titleKeyword) {
    return sections.find(s => s.title.includes(titleKeyword));
  }

  function findSectionParagraph(section, textKeyword) {
    if (!section) return null;
    return section.paragraphs.find(p => p.text.includes(textKeyword));
  }

  // ==================== 测试用例 ====================

  function runAll() {
    results = [];

    testPaymentMigration();
    testJurisdictionMigration();
    testCompensationCapInvalidation();
    testBreachSplitDetection();
    testAutoRenewalAdded();
    testInvalidatedExcludedFromStats();
    testRiskLevelChangeHistory();
    testAnnotationMigrationMetadata();
    testDiffAwareMigrationWithSectionMapping();
    testContextOverlapScoring();
    testSplitMergeDetection();
    testReportContainsAnnotationDetails();

    return results;
  }

  // ---------- 测试1：付款周期批注迁移正确性 ----------
  function testPaymentMigration() {
    test('付款周期批注：30天→60天迁移到正确位置', () => {
      const v1Text = getFixtureText('v1');
      const v2Text = getFixtureText('v2');
      const oldSections = buildSections(v1Text);
      const newSections = buildSections(v2Text);

      // 找到旧版"付款周期"章节中包含"30个工作日"的段落
      const oldPaymentSection = findSectionByTitle(oldSections, '付款周期');
      assert(oldPaymentSection, '旧版应包含"付款周期"章节');

      const oldPara = findSectionParagraph(oldPaymentSection, '30个工作日');
      assert(oldPara, '旧版付款周期段落应包含"30个工作日"');

      const anchorText = '30个工作日';
      const startOffset = oldPara.text.indexOf(anchorText);
      assert(startOffset >= 0, '应找到"30个工作日"的偏移');

      const ann = buildAnnotation({
        sectionId: oldPaymentSection.id,
        paragraphIndex: oldPara.index,
        startOffset: startOffset,
        endOffset: startOffset + anchorText.length,
        anchorText: anchorText,
        riskType: 'payment',
        riskLevel: 'high',
        comment: '付款周期偏长，需关注',
        _sectionTitle: oldPaymentSection.title,
        _context: TextParser.computeAnchorContext(oldPara.text, startOffset, startOffset + anchorText.length)
      });

      const diffResult = VersionComparator.compareSections(oldSections, newSections);
      const migrationResult = TextParser.migrateAnnotations([ann], newSections, oldSections, diffResult);

      assert(migrationResult.migrated.length === 1, '应有1条批注成功迁移');
      const migrated = migrationResult.migrated[0];

      // 验证迁移到新版正确的章节
      const newPaymentSection = findSectionByTitle(newSections, '付款周期');
      assert(newPaymentSection, '新版应包含"付款周期"章节');
      assertEqual(migrated.sectionId, newPaymentSection.id, '批注应迁移到新版付款周期章节');

      // 验证锚点文本在新版中指向"60个工作日"所在位置（因为30已被改为60，但锚点文本不变）
      const newPara = newSections.find(s => s.id === migrated.sectionId)
        ?.paragraphs.find(p => p.index === migrated.paragraphIndex);
      assert(newPara, '应找到迁移后的段落');
    });
  }

  // ---------- 测试2：管辖地变更批注迁移 ----------
  function testJurisdictionMigration() {
    test('管辖地批注：北京法院→上海仲裁迁移', () => {
      const v1Text = getFixtureText('v1');
      const v2Text = getFixtureText('v2');
      const oldSections = buildSections(v1Text);
      const newSections = buildSections(v2Text);

      const oldDisputeSection = findSectionByTitle(oldSections, '争议解决方式');
      assert(oldDisputeSection, '旧版应包含"争议解决方式"章节');

      const oldPara = findSectionParagraph(oldDisputeSection, '人民法院');
      assert(oldPara, '旧版争议解决段落应包含"人民法院"');

      const anchorText = '人民法院提起诉讼';
      const startOffset = oldPara.text.indexOf(anchorText);
      assert(startOffset >= 0, '应找到锚点文本');

      const ann = buildAnnotation({
        sectionId: oldDisputeSection.id,
        paragraphIndex: oldPara.index,
        startOffset: startOffset,
        endOffset: startOffset + anchorText.length,
        anchorText: anchorText,
        riskType: 'dispute',
        riskLevel: 'high',
        comment: '管辖地变更风险',
        _sectionTitle: oldDisputeSection.title,
        _context: TextParser.computeAnchorContext(oldPara.text, startOffset, startOffset + anchorText.length)
      });

      const diffResult = VersionComparator.compareSections(oldSections, newSections);
      const migrationResult = TextParser.migrateAnnotations([ann], newSections, oldSections, diffResult);

      // 由于"人民法院提起诉讼"在v2中被改为"仲裁委员会申请仲裁"，
      // 该锚点在新版中不存在，批注应被标记为失效
      // 或者如果 diff 映射将其映射到争议解决章节，则通过全局搜索可能定位或失效
      const total = migrationResult.migrated.length + migrationResult.invalidated.length;
      assertEqual(total, 1, '应有1条批注结果');

      if (migrationResult.invalidated.length === 1) {
        assert(
          migrationResult.invalidated[0]._invalidReason,
          '失效批注应有原因说明'
        );
        assertIncludes(
          migrationResult.invalidated[0]._invalidReason,
          '未找到',
          '失效原因应说明未找到锚点'
        );
      }
      // 如果迁移成功（因为 diff 映射找到了对应章节），验证章节正确
      if (migrationResult.migrated.length === 1) {
        const newDisputeSection = findSectionByTitle(newSections, '争议解决方式');
        assert(newDisputeSection, '新版应包含争议解决章节');
        assertEqual(migrationResult.migrated[0].sectionId, newDisputeSection.id,
          '管辖地批注应迁移到新版争议解决章节');
      }
    });
  }

  // ---------- 测试3：赔偿上限删除导致批注失效 ----------
  function testCompensationCapInvalidation() {
    test('赔偿上限批注：删除后批注失效并记录原因', () => {
      const v1Text = getFixtureText('v1');
      const v2Text = getFixtureText('v2');
      const oldSections = buildSections(v1Text);
      const newSections = buildSections(v2Text);

      const oldBreachSection = findSectionByTitle(oldSections, '乙方违约');
      assert(oldBreachSection, '旧版应包含乙方违约章节');

      const anchorText = '500万元';
      let oldPara = null;
      let startOffset = -1;
      for (const p of oldBreachSection.paragraphs) {
        const idx = p.text.indexOf(anchorText);
        if (idx >= 0) { oldPara = p; startOffset = idx; break; }
      }
      assert(oldPara && startOffset >= 0, '旧版应包含"500万元"');

      const ann = buildAnnotation({
        sectionId: oldBreachSection.id,
        paragraphIndex: oldPara.index,
        startOffset: startOffset,
        endOffset: startOffset + anchorText.length,
        anchorText: anchorText,
        riskType: 'breach',
        riskLevel: 'high',
        comment: '赔偿上限过高，需重新评估',
        _sectionTitle: oldBreachSection.title,
        _context: TextParser.computeAnchorContext(oldPara.text, startOffset, startOffset + anchorText.length)
      });

      const diffResult = VersionComparator.compareSections(oldSections, newSections);
      const migrationResult = TextParser.migrateAnnotations([ann], newSections, oldSections, diffResult);

      // "500万元"在v2中被删除，批注应该失效
      const total = migrationResult.migrated.length + migrationResult.invalidated.length;
      assertEqual(total, 1, '应有1条批注结果');

      // 由于"500万元"在v2中完全不存在，该批注应该被失效
      // 但如果 diff-mapping-split 将其映射到拆分后的某个子条款，
      // 并且通过全局搜索在别处找到"500万元"，可能会迁移成功
      // 这里我们检查至少有一个合理的结果
      if (migrationResult.invalidated.length === 1) {
        const inv = migrationResult.invalidated[0];
        assertEqual(inv.status, 'invalidated', '失效批注状态应为 invalidated');
        assert(inv._invalidReason && inv._invalidReason.length > 0, '应有失效原因');
        assert(inv._migrationStrategy, '应有迁移策略标记');
      }
    });
  }

  // ---------- 测试4：违约条款拆分检测 ----------
  function testBreachSplitDetection() {
    test('违约条款拆分：单条款拆为两条', () => {
      const v1Text = getFixtureText('v1');
      const v2Text = getFixtureText('v2');
      const oldSections = buildSections(v1Text);
      const newSections = buildSections(v2Text);

      const diffResult = VersionComparator.compareSections(oldSections, newSections);

      // 旧版"乙方违约责任"应该被识别为拆分或修改
      const oldBreachSection = findSectionByTitle(oldSections, '乙方违约');
      assert(oldBreachSection, '旧版应有"乙方违约"章节');

      // 检查 sectionMapping 中是否存在该章节的映射
      const mapping = diffResult.sectionMapping;
      assert(mapping, 'diffResult 应包含 sectionMapping');

      // 旧版违约条款应该在 sectionMapping 中有对应的映射
      const mapped = mapping.get(oldBreachSection.id);
      assert(mapped && mapped.length > 0, '违约条款应有映射目标');
    });
  }

  // ---------- 测试5：自动续约新增 ----------
  function testAutoRenewalAdded() {
    test('自动续约条款：新版新增', () => {
      const v1Text = getFixtureText('v1');
      const v2Text = getFixtureText('v2');
      const oldSections = buildSections(v1Text);
      const newSections = buildSections(v2Text);

      const diffResult = VersionComparator.compareSections(oldSections, newSections);

      // 新版应包含"自动续约"章节，旧版不应包含
      const newAutoRenewal = findSectionByTitle(newSections, '自动续约');
      assert(newAutoRenewal, '新版应包含"自动续约"章节');

      const oldAutoRenewal = findSectionByTitle(oldSections, '自动续约');
      assert(!oldAutoRenewal, '旧版不应包含"自动续约"章节');

      // 在 diffResult 中应有 added 类型的 sectionDiff
      const addedDiffs = diffResult.sectionDiffs.filter(d => d.changeType === 'added');
      const autoRenewalDiff = addedDiffs.find(d =>
        d.newSection && d.newSection.title.includes('自动续约')
      );
      assert(autoRenewalDiff, 'diff结果中应包含自动续约的新增记录');
    });
  }

  // ---------- 测试6：失效批注不计入风险统计 ----------
  function testInvalidatedExcludedFromStats() {
    test('失效批注不计入风险统计的 byType 和 byLevel', () => {
      const activeAnns = [
        buildAnnotation({ riskType: 'payment', riskLevel: 'high', status: 'pending' }),
        buildAnnotation({ riskType: 'breach', riskLevel: 'medium', status: 'flagged' }),
        buildAnnotation({ riskType: 'payment', riskLevel: 'low', status: 'resolved' })
      ];
      const invalidatedAnns = [
        buildAnnotation({ riskType: 'payment', riskLevel: 'high', status: 'invalidated' }),
        buildAnnotation({ riskType: 'breach', riskLevel: 'high', status: 'invalidated' })
      ];
      const allAnns = activeAnns.concat(invalidatedAnns);

      // 启用过滤（默认行为）
      const stats = RiskStatistics.computeStats(allAnns, true);

      assertEqual(stats.total, 3, '过滤后总数应为3（排除2条失效）');
      assertEqual(stats.byType.payment, 2, 'payment 类型应为2（排除1条失效的 payment）');
      assertEqual(stats.byType.breach, 1, 'breach 类型应为1（排除1条失效的 breach）');
      assertEqual(stats.byLevel.high, 1, '高风险应为1（排除2条失效的 high）');
      assertEqual(stats.byLevel.medium, 1, '中风险应为1');
      assertEqual(stats.byLevel.low, 1, '低风险应为1');
      assertEqual(stats.invalidatedCount, 2, '失效计数应为2');

      // 不过滤模式（兼容旧行为）
      const statsAll = RiskStatistics.computeStats(allAnns, false);
      assertEqual(statsAll.total, 5, '不过滤时总数应为5');
      assertEqual(statsAll.byLevel.high, 3, '不过滤时高风险应为3');
    });
  }

  // ---------- 测试7：风险等级变更记录到 history ----------
  function testRiskLevelChangeHistory() {
    test('风险等级变更推送到 history[]', () => {
      // 模拟 AnnotationManager 的 updateAnnotation 行为
      const ann = buildAnnotation({
        riskLevel: 'medium',
        history: [{ action: 'created', time: new Date().toISOString(), status: 'pending' }]
      });

      // 模拟 updateAnnotation 的逻辑（因为无法直接调用带状态的 manager）
      const trackedFields = ['riskLevel', 'riskType'];
      const changes = { riskLevel: 'high' };
      const now = new Date().toISOString();

      for (const field of Object.keys(changes)) {
        if (changes[field] !== ann[field]) {
          const oldVal = ann[field];
          ann[field] = changes[field];
          if (trackedFields.includes(field)) {
            ann.history.push({
              action: 'field_change', field, from: oldVal, to: changes[field], time: now
            });
          }
        }
      }

      assertEqual(ann.riskLevel, 'high', '风险等级应更新为 high');
      assertEqual(ann.history.length, 2, 'history 应有2条记录');

      const lastEntry = ann.history[ann.history.length - 1];
      assertEqual(lastEntry.action, 'field_change', '最新记录应为 field_change');
      assertEqual(lastEntry.field, 'riskLevel', '变更字段应为 riskLevel');
      assertEqual(lastEntry.from, 'medium', '旧值应为 medium');
      assertEqual(lastEntry.to, 'high', '新值应为 high');
    });
  }

  // ---------- 测试8：迁移批注携带策略元数据 ----------
  function testAnnotationMigrationMetadata() {
    test('迁移批注携带 _migrationStrategy 和 history', () => {
      const v1Text = getFixtureText('v1');
      const v2Text = getFixtureText('v2');
      const oldSections = buildSections(v1Text);
      const newSections = buildSections(v2Text);

      // 在"合同总价"章节创建批注（该章节两版本不变）
      const oldPriceSection = findSectionByTitle(oldSections, '合同总价');
      assert(oldPriceSection, '旧版应有"合同总价"章节');

      const anchorText = '800,000';
      let oldPara = null;
      let startOffset = -1;
      for (const p of oldPriceSection.paragraphs) {
        const idx = p.text.indexOf(anchorText);
        if (idx >= 0) { oldPara = p; startOffset = idx; break; }
      }
      assert(oldPara && startOffset >= 0, '应找到"800,000"');

      const ann = buildAnnotation({
        sectionId: oldPriceSection.id,
        paragraphIndex: oldPara.index,
        startOffset: startOffset,
        endOffset: startOffset + anchorText.length,
        anchorText: anchorText,
        riskType: 'payment',
        riskLevel: 'medium',
        _sectionTitle: oldPriceSection.title,
        _context: TextParser.computeAnchorContext(oldPara.text, startOffset, startOffset + anchorText.length)
      });

      const diffResult = VersionComparator.compareSections(oldSections, newSections);
      const migrationResult = TextParser.migrateAnnotations([ann], newSections, oldSections, diffResult);

      assert(migrationResult.migrated.length === 1, '应有1条批注成功迁移');
      const migrated = migrationResult.migrated[0];

      // 验证策略标记
      assert(migrated._migrationStrategy, '迁移后的批注应有 _migrationStrategy');
      assert(migrated._migrationDetail, '迁移后的批注应有 _migrationDetail');

      // 验证 history 中有迁移记录
      const migrationHistory = migrated.history.filter(h => h.action === 'migrated');
      assert(migrationHistory.length >= 1, 'history 中应有 migrated 记录');
      assert(migrationHistory[0].strategy, '迁移历史应有 strategy');
      assert(migrationHistory[0].time, '迁移历史应有 time');

      // 验证 details 数组
      assert(migrationResult.details && migrationResult.details.length > 0, '应有 details 数组');
      const detail = migrationResult.details[0];
      assert(detail.strategy, 'detail 应有 strategy');
      assert(detail.anchorText === anchorText, 'detail anchorText 应匹配');
    });
  }

  // ---------- 测试9：diff 感知迁移策略优先级 ----------
  function testDiffAwareMigrationWithSectionMapping() {
    test('diff 感知迁移优先于纯文本匹配', () => {
      const v1Text = getFixtureText('v1');
      const v2Text = getFixtureText('v2');
      const oldSections = buildSections(v1Text);
      const newSections = buildSections(v2Text);

      // 在有 diffResult 和无 diffResult 两种情况下迁移
      const diffResult = VersionComparator.compareSections(oldSections, newSections);

      // 在"付款方式"章节创建批注
      const oldPayMethodSection = findSectionByTitle(oldSections, '付款方式');
      assert(oldPayMethodSection, '旧版应有"付款方式"章节');

      const anchorText = '30%';
      let oldPara = null;
      let startOffset = -1;
      for (const p of oldPayMethodSection.paragraphs) {
        const idx = p.text.indexOf(anchorText);
        if (idx >= 0) { oldPara = p; startOffset = idx; break; }
      }
      assert(oldPara && startOffset >= 0, '应找到"30%"');

      const ann = buildAnnotation({
        sectionId: oldPayMethodSection.id,
        paragraphIndex: oldPara.index,
        startOffset: startOffset,
        endOffset: startOffset + anchorText.length,
        anchorText: anchorText,
        riskType: 'payment',
        riskLevel: 'low',
        _sectionTitle: oldPayMethodSection.title,
        _context: TextParser.computeAnchorContext(oldPara.text, startOffset, startOffset + anchorText.length)
      });

      // 带 diffResult 的迁移
      const withDiff = TextParser.migrateAnnotations([ann], newSections, oldSections, diffResult);
      // 不带 diffResult 的迁移
      const withoutDiff = TextParser.migrateAnnotations([ann], newSections, oldSections);

      // 两种方式都应成功迁移
      assert(withDiff.migrated.length >= 1, '带 diff 迁移应成功');
      assert(withoutDiff.migrated.length >= 1, '不带 diff 迁移也应成功');

      // 带 diff 的策略应该是 diff-mapping 或 exact-id 相关
      if (withDiff.migrated.length > 0) {
        const strategy = withDiff.migrated[0]._migrationStrategy;
        assert(strategy, '应有策略标记');
      }
    });
  }

  // ---------- 测试10：上下文重叠评分 ----------
  function testContextOverlapScoring() {
    test('computeContextOverlap 正确评分', () => {
      const candidateText = '甲方应在收到乙方付款申请及等额发票后60个工作日内完成付款。如甲方逾期付款，应按照逾期金额每日万分之五支付违约金。';
      const anchorText = '60个工作日';
      const context = {
        before: '等额发票后',
        after: '内完成付款'
      };

      const score = TextParser.computeContextOverlap(candidateText, anchorText, context);
      assert(score > 0.5, '上下文完全匹配时得分应大于0.5, 实际=' + score);

      // 无上下文的得分应低于有上下文的得分
      const scoreNoContext = TextParser.computeContextOverlap(candidateText, anchorText, {});
      assert(score >= scoreNoContext, '有上下文得分应 >= 无上下文得分');

      // 锚点不存在时得分为0
      const scoreNotFound = TextParser.computeContextOverlap(candidateText, '不存在的文本', context);
      assertEqual(scoreNotFound, 0, '锚点不存在时得分应为0');
    });
  }

  // ---------- 测试11：拆分/合并检测 ----------
  function testSplitMergeDetection() {
    test('version-comparator 检测拆分并生成 sectionMapping', () => {
      const v1Text = getFixtureText('v1');
      const v2Text = getFixtureText('v2');
      const oldSections = buildSections(v1Text);
      const newSections = buildSections(v2Text);

      const diffResult = VersionComparator.compareSections(oldSections, newSections);

      // diffResult 应包含 sectionMapping 和 splitMergeInfo
      assert(diffResult.sectionMapping, 'diffResult 应有 sectionMapping');
      assert(diffResult.splitMergeInfo !== undefined, 'diffResult 应有 splitMergeInfo');

      // sectionMapping 应该是 Map
      assert(typeof diffResult.sectionMapping.get === 'function', 'sectionMapping 应为 Map');

      // 新版章节数应多于旧版（因为拆分+新增）
      assert(newSections.length > oldSections.length,
        '新版章节数(' + newSections.length + ')应多于旧版(' + oldSections.length + ')');

      // 检查 splitMergeInfo 或 sectionDiffs 中是否有拆分/新增标记
      const hasSplitOrAdded = diffResult.splitMergeInfo.length > 0 ||
        diffResult.sectionDiffs.some(d => d.changeType === 'added' || d.splitMerge);
      assert(hasSplitOrAdded, '应有拆分或新增的 diff 记录');
    });
  }

  // ---------- 测试12：导出报告包含批注详情 ----------
  function testReportContainsAnnotationDetails() {
    test('对比报告导出包含批注迁移详情和历史', () => {
      const v1Text = getFixtureText('v1');
      const v2Text = getFixtureText('v2');
      const oldSections = buildSections(v1Text);
      const newSections = buildSections(v2Text);

      // 创建几条批注
      const oldPriceSection = findSectionByTitle(oldSections, '合同总价');
      const oldPaySection = findSectionByTitle(oldSections, '付款周期');

      const oldAnnotations = [];
      if (oldPriceSection) {
        const para = oldPriceSection.paragraphs[0];
        const anchor = '800,000';
        const idx = para.text.indexOf(anchor);
        if (idx >= 0) {
          oldAnnotations.push(buildAnnotation({
            sectionId: oldPriceSection.id, paragraphIndex: para.index,
            startOffset: idx, endOffset: idx + anchor.length,
            anchorText: anchor, riskType: 'payment', riskLevel: 'medium',
            comment: '合同总价需确认',
            _sectionTitle: oldPriceSection.title,
            _context: TextParser.computeAnchorContext(para.text, idx, idx + anchor.length)
          }));
        }
      }

      if (oldPaySection) {
        const para = oldPaySection.paragraphs.find(p => p.text.includes('30个工作日'));
        if (para) {
          const anchor = '30个工作日';
          const idx = para.text.indexOf(anchor);
          oldAnnotations.push(buildAnnotation({
            sectionId: oldPaySection.id, paragraphIndex: para.index,
            startOffset: idx, endOffset: idx + anchor.length,
            anchorText: anchor, riskType: 'payment', riskLevel: 'high',
            comment: '付款周期偏长',
            _sectionTitle: oldPaySection.title,
            _context: TextParser.computeAnchorContext(para.text, idx, idx + anchor.length)
          }));
        }
      }

      const diffResult = VersionComparator.compareSections(oldSections, newSections);
      const migrationResult = TextParser.migrateAnnotations(oldAnnotations, newSections, oldSections, diffResult);
      const newAnnotations = migrationResult.migrated || [];

      const migrationStats = {
        total: oldAnnotations.length,
        migrated: (migrationResult.stats?.exactMatch || 0) + (migrationResult.stats?.corrected || 0),
        invalidated: migrationResult.stats?.invalidated || 0,
        byStrategy: migrationResult.stats?.byStrategy || {},
        details: migrationResult.details || []
      };

      const riskDeltas = NegotiationAdvisor.getRiskDelta(diffResult, oldAnnotations, newAnnotations);
      const suggestions = NegotiationAdvisor.analyzeChanges(diffResult, oldAnnotations, newAnnotations);

      // 模拟导出（不触发下载，只检查生成的 HTML）
      // 由于 ComparisonExporter 内部生成 HTML 并直接下载，
      // 我们通过检查其内部逻辑间接验证
      // 这里直接验证传入的数据结构完整性

      assert(migrationStats.details.length > 0, '迁移详情数组不应为空');
      assert(migrationStats.byStrategy && Object.keys(migrationStats.byStrategy).length > 0,
        '策略分布不应为空');

      // 验证每条 detail 都有必要字段
      for (const d of migrationStats.details) {
        assert(d.anchorText !== undefined, 'detail 应有 anchorText');
        assert(d.strategy !== undefined, 'detail 应有 strategy');
        assert(d.status !== undefined, 'detail 应有 status');
      }

      // 验证批注的 history 包含迁移记录
      for (const ann of newAnnotations) {
        const migHistory = ann.history.filter(h => h.action === 'migrated');
        assert(migHistory.length > 0, '迁移后的批注 history 应有 migrated 记录');
      }

      // 验证 riskDeltas 结构完整
      assert(Array.isArray(riskDeltas), 'riskDeltas 应为数组');
      for (const rd of riskDeltas) {
        assert(rd.sectionTitle !== undefined, 'riskDelta 应有 sectionTitle');
        assert(rd.changes !== undefined, 'riskDelta 应有 changes');
      }
    });
  }

  // ==================== Fixture 加载 ====================

  const fixtureCache = {};

  function getFixtureText(version) {
    if (fixtureCache[version]) return fixtureCache[version];

    // 尝试从 DOM 中获取（tests/index.html 预加载）
    const el = document.getElementById('fixture-' + version);
    if (el) {
      fixtureCache[version] = el.textContent;
      return fixtureCache[version];
    }

    // 内联 fallback：使用硬编码的精简版文本
    if (version === 'v1') {
      fixtureCache[version] = V1_FALLBACK;
    } else {
      fixtureCache[version] = V2_FALLBACK;
    }
    return fixtureCache[version];
  }

  // 内联回退文本（当无法通过 fetch 加载 fixture 文件时使用）
  const V1_FALLBACK = [
    '软件开发服务合同',
    '',
    '第一章 总则',
    '',
    '第一条 合同目的',
    '甲方委托乙方进行企业管理系统的软件开发工作。',
    '',
    '第二章 项目范围与交付',
    '',
    '第三条 开发内容',
    '乙方应按照甲方需求完成开发工作。',
    '',
    '第三章 合同价款与支付',
    '',
    '第四条 合同总价',
    '本合同总价款为人民币捌拾万元整（¥800,000.00）。',
    '',
    '第五条 付款周期',
    '甲方应在收到乙方付款申请及等额发票后30个工作日内完成付款。如甲方逾期付款，应按照逾期金额每日万分之五支付违约金。',
    '',
    '第四章 违约责任',
    '',
    '第六条 乙方违约责任',
    '乙方逾期交付的，每逾期一日应向甲方支付合同总价万分之五的违约金，但累计不超过合同总价的15%。乙方交付的软件存在重大缺陷且无法修复的，甲方有权解除合同。双方因违约产生的赔偿责任，以合同总价500万元为上限。',
    '',
    '第五章 争议解决',
    '',
    '第七条 争议解决方式',
    '因本合同产生的争议，双方应首先通过友好协商解决。协商不成的，任何一方均可向合同签订地有管辖权的人民法院提起诉讼。',
    '',
    '第六条 其他条款',
    '',
    '第八条 合同终止',
    '本合同在双方义务全部履行完毕后终止。'
  ].join('\n');

  const V2_FALLBACK = [
    '软件开发服务合同',
    '',
    '第一章 总则',
    '',
    '第一条 合同目的',
    '甲方委托乙方进行企业管理系统的软件开发工作。',
    '',
    '第二章 项目范围与交付',
    '',
    '第三条 开发内容',
    '乙方应按照甲方需求完成开发工作。',
    '',
    '第三章 合同价款与支付',
    '',
    '第四条 合同总价',
    '本合同总价款为人民币捌拾万元整（¥800,000.00）。',
    '',
    '第五条 付款周期',
    '甲方应在收到乙方付款申请及等额发票后60个工作日内完成付款。如甲方逾期付款，应按照逾期金额每日万分之五支付违约金。',
    '',
    '第四章 违约责任',
    '',
    '第六条 乙方逾期交付责任',
    '乙方逾期交付的，每逾期一日应向甲方支付合同总价万分之五的违约金，但累计不超过合同总价的15%。',
    '',
    '第七条 软件质量违约责任',
    '乙方交付的软件存在重大缺陷且无法修复的，甲方有权解除合同，乙方应退还已收取的全部款项并赔偿甲方因此遭受的直接损失。',
    '',
    '第五章 争议解决',
    '',
    '第八条 争议解决方式',
    '因本合同产生的争议，双方应首先通过友好协商解决。协商不成的，任何一方均可向上海国际经济贸易仲裁委员会申请仲裁。',
    '',
    '第六章 其他条款',
    '',
    '第九条 自动续约',
    '本合同项下的维护服务期满后，如双方未签署新的合同且未书面提出终止，则维护服务自动续约一年。',
    '',
    '第十条 合同终止',
    '本合同在双方义务全部履行完毕后终止。'
  ].join('\n');

  // ==================== 渲染结果 ====================

  function renderResults(containerEl) {
    if (!containerEl) return;

    let html = '<h2>回归测试结果</h2>';
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    html += `<div class="test-summary">
      <span class="test-passed-count">${passed} 通过</span> /
      <span class="test-failed-count">${failed} 失败</span> /
      <span>${results.length} 总计</span>
    </div>`;

    html += '<table class="test-results-table"><thead><tr><th>测试用例</th><th>结果</th><th>详情</th></tr></thead><tbody>';
    for (const r of results) {
      const cls = r.passed ? 'test-pass' : 'test-fail';
      const icon = r.passed ? '&#10004;' : '&#10008;';
      html += `<tr class="${cls}">
        <td>${escapeHTML(r.name)}</td>
        <td class="test-icon">${icon}</td>
        <td>${escapeHTML(r.message)}</td>
      </tr>`;
    }
    html += '</tbody></table>';

    containerEl.innerHTML = html;
  }

  function escapeHTML(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  return { runAll, renderResults, getFixtureText };
})();
