// ============================================================
// services/agentMCP.js
// L4.1 代理首 MCP 适配器（thin adapter）——让 AI agent / MCP 客户端驱动 L1→L4 管线。
// 纯逻辑、注入式（通过 ctx 注入 loadDb/loadPrefs），node 可测（不依赖 localStorage）。
// 浏览器默认封装见文件尾部（import { loadDB, Prefs } 的工厂），用于 App 内暴露。
// 规格：docs/api/mcp-agent.md（6 工具 + 结果信封 + 授权门槛 + 存储接缝）。
// ============================================================

import { buildReport, stripIdentity } from '../domain/report.js';
import { extractFeatures, stripFeatureIdentity } from '../domain/learn.js';
import { recommendNext, slotIntoFreeTime } from '../domain/recommend.js';
import { encodeTrajectory, similarity, kAnonymitySuppress } from '../domain/signature.js';

// 信封常量：错误码封闭集（规格定义）
export const ERR = {
  VALIDATION: 'ERR_VALIDATION',
  AUTH_DENIED: 'ERR_AUTH_DENIED',
  NO_DATA: 'ERR_NO_DATA',
  INTERNAL: 'ERR_INTERNAL',
};

const ENV_VERSION = '1.0';

// ---- 工具 -----------------------------------------------------

/** 跑一个带错误捕获的 read-only 工具 → 稳定信封 {ok, tool, version, data|error, warnings?} */
function runTool(tool, fn, validate) {
  const warnings = [];
  try {
    if (typeof validate === 'function') validate(warnings);
    const data = fn(warnings);
    if (data == null) {
      return { ok: false, tool, version: ENV_VERSION, error: { code: ERR.NO_DATA, message: '没有可返回的数据' } };
    }
    return { ok: true, tool, version: ENV_VERSION, data, warnings };
  } catch (e) {
    return { ok: false, tool, version: ENV_VERSION, error: { code: e?.code || ERR.INTERNAL, message: e?.message || '内部错误' } };
  }
}

const intRange = (v, name, min, max, dflt) => {
  if (v == null) return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    const err = new Error(`${name} 须为 ${min}~${max} 的整数`);
    err.code = ERR.VALIDATION;
    throw err;
  }
  return n;
};

/**
 * 创建 agent MCP 适配器。
 * @param {object} ctx 注入接缝：{ loadDb(), loadPrefs(), getAnonymousSpectrum?(), now? }
 * @returns {{ call, tools }} call(tool, params) → envelope；tools 为命名 handler 映射
 */
export function createAgentMCP(ctx) {
  if (!ctx || typeof ctx.loadDb !== 'function') {
    throw new Error('createAgentMCP 需要 ctx.loadDb（存储接缝）');
  }
  const loadPrefs = typeof ctx.loadPrefs === 'function' ? ctx.loadPrefs : () => ({});
  const nowOf = () => (typeof ctx.now === 'function' ? ctx.now() : ctx.now ?? Date.now());

  const tools = {
    'report.weekly': (p = {}) => runTool('report.weekly', () => {
      const offset = intRange(p.offset, 'offset', -100, 100, 0);
      let now = nowOf();
      if (p.now != null) { now = new Date(p.now).getTime(); if (Number.isNaN(now)) { const e = new Error('now 无效日期'); e.code = ERR.VALIDATION; throw e; } }
      const r = buildReport(ctx.loadDb(), { period: 'week', offset, now });
      // 去身份边界：任何导出面必须过 stripIdentity
      return stripIdentity(r);
    }),

    'report.monthly': (p = {}) => runTool('report.monthly', () => {
      const offset = intRange(p.offset, 'offset', -100, 100, 0);
      let now = nowOf();
      if (p.now != null) { now = new Date(p.now).getTime(); if (Number.isNaN(now)) { const e = new Error('now 无效日期'); e.code = ERR.VALIDATION; throw e; } }
      const r = buildReport(ctx.loadDb(), { period: 'month', offset, now });
      return stripIdentity(r);
    }),

    'learn.features': (p = {}) => runTool('learn.features', () => {
      intRange(p.weeks, 'weeks', 1, 52, 8); // 校验但不强制窗口（快照账本整体统计）
      const feats = extractFeatures(ctx.loadDb());
      return stripFeatureIdentity(feats);
    }),

    'recommend.next': (p = {}) => runTool('recommend.next', () => {
      const limit = intRange(p.limit, 'limit', 1, 20, 5);
      const k = intRange(p.k, 'k', 0, 10, 2);
      const db = ctx.loadDb();
      const feats = extractFeatures(db);
      const acts = db.activities || [];
      const plans = db.plans || [];
      // 候选：未完成/待办活动（Planned/Started），合并其计划级偏置与截止
      const candidates = acts
        .filter((a) => a.status === 'Planned' || a.status === 'Started')
        .map((a) => {
          const plan = plans.find((x) => x.id === (a.plan_ids?.[0] ?? null));
          const bias = feats.biasModel.find((e) => e.planId === (a.plan_ids?.[0] ?? null));
          return {
            activityId: a.id,
            planId: a.plan_ids?.[0] ?? null,
            plannedStart: a.planned_start ?? null,
            deadline: plan?.deadline ?? null, // 关联计划的截止（缺失则无紧迫度）
            plannedMinutes: a.planned_minutes || 0,
            n: bias?.n ?? 0,
            conflictsCount: Array.isArray(a.conflicts) ? a.conflicts.length : 0,
          };
        });
      const recs = recommendNext(candidates, feats, { now: nowOf(), limit, k });
      // 输出已去身份（recommendation 契约，仅 activityId 引用键 + 数字/理由）
      return recs;
    }),

    'recommend.slot': (p = {}) => runTool('recommend.slot', () => {
      const freeMinutes = intRange(p.freeMinutes, 'freeMinutes', 1, 1440, null); // 必填：未给即 null → 校验拒绝
      if (freeMinutes == null) { const e = new Error('freeMinutes 必填（>0 且 ≤1440 的整数）'); e.code = ERR.VALIDATION; throw e; }
      const limit = intRange(p.limit, 'limit', 1, 20, 5);
      const now = nowOf();
      const db = ctx.loadDb();
      const feats = extractFeatures(db);
      const acts = (db.activities || []).filter((a) => a.status === 'Planned' || a.status === 'Started');
      // 单个空闲槽：从 freeFrom（或 now）起 freeMinutes 分钟
      let start = now;
      if (p.freeFrom != null) { const t = new Date(p.freeFrom).getTime(); if (Number.isNaN(t)) throw Object.assign(new Error('freeFrom 无效日期'), { code: ERR.VALIDATION }); start = t; }
      const slots = [{ start, end: start + freeMinutes * 60000 }];
      // 契约：先全量评分（limit 99 保证候选不被截断），再按时长写入空闲槽
      const candidates = acts.map((a) => {
        const bias = feats.biasModel.find((e) => e.planId === (a.plan_ids?.[0] ?? null));
        return {
          activityId: a.id,
          planId: a.plan_ids?.[0] ?? null,
          plannedStart: a.planned_start ?? null,
          plannedMinutes: a.planned_minutes || 0,
          n: bias?.n ?? 0,
          conflictsCount: Array.isArray(a.conflicts) ? a.conflicts.length : 0,
        };
      });
      const scored = recommendNext(candidates, feats, { now, limit: 99, k: 0 }); // 全量评分，保底不参与槽位分配
      const slotCands = scored.map((r) => {
        const bias = feats.biasModel.find((e) => e.planId === r.planId);
        const dur = (r.estMinutes || 30) * (bias?.biasK ?? 1); // biasK 校正时长
        return { activityId: r.activityId, duration: Math.max(5, Math.round(dur / 5) * 5), score: r.score };
      });
      return slotIntoFreeTime(slots, slotCands, { now }).slice(0, limit);
    }),

    'community.matchPatterns': (p = {}) => runTool('community.matchPatterns', (warnings) => {
      // ---- 授权门槛（核心，契约 §4）：未授权一律拒绝 ----
      if (loadPrefs().communityAuth !== true) {
        const e = new Error('社区匹配功能需要授权。请在设置中开启「社区参与」选项后重试。');
        e.code = ERR.AUTH_DENIED;
        throw e;
      }
      const k = intRange(p.k, 'k', 2, 50, 5);
      const db = ctx.loadDb();
      const localSig = encodeTrajectory(db);
      // 匿名签名谱注入（契约 §3.6 接缝名 loadAnonSpectrum；兼容旧 getAnonymousSpectrum）
      const anonSpectrum = (typeof ctx.loadAnonSpectrum === 'function' ? ctx.loadAnonSpectrum()
        : typeof ctx.getAnonymousSpectrum === 'function' ? ctx.getAnonymousSpectrum()
        : (Array.isArray(p.spectrum) ? p.spectrum : [])) || [];
      // k-匿名抑制（双重护栏之一）：任何共享前先抑制低 n 独特签名（防反指认）
      const profiles = anonSpectrum.map((s) => (s && s.sig ? s : { sig: s }));
      const { shared, suppressed } = kAnonymitySuppress(profiles, k);
      // 按组聚合：每个 groupKey/签名 → 一条样板（含 sampleCount，仅匿名计数）
      const groupOf = (s) => s.groupKey ?? JSON.stringify((s.sig?.events || []).map((e) => e.k));
      const groupCnt = new Map();
      for (const s of shared) groupCnt.set(groupOf(s), (groupCnt.get(groupOf(s)) || 0) + 1);
      const groups = [];
      for (const s of shared) {
        const gk = groupOf(s);
        if (groupCnt.get(gk) >= k && !groups.some((g) => g.key === gk)) groups.push({ key: gk, sig: s.sig, sampleCount: groupCnt.get(gk) });
      }
      // 与本机签名比对，取相似样板（pattern-matching）
      const matches = groups
        .map((g) => ({ similarity: similarity(localSig, g.sig), group: g }))
        .filter((m) => m.similarity >= (p.minSimilarity ?? 0.5))
        .sort((a, b) => b.similarity - a.similarity);
      // 回传去身份样板：仅相似度 + 事件序列 + 匿名计数，无任何身份
      const patterns = matches.slice(0, 5).map((m) => ({
        similarity: Math.round(m.similarity * 100) / 100,
        eventSequence: (m.group.sig?.events || []).map((e) => e.k).join(''),
        groupKey: m.group.key,
        sampleCount: m.group.sampleCount,
      }));
      // 提议组群（consented grouping 契约 §4）：存在 ≥m 相似时仅「提议」，绝不自动组
      const threshold = p.minGroup ?? 1;
      const groupProposal = matches.length >= threshold ? {
        candidatePatterns: matches.length,
        threshold,
        consentRequired: true, // 永远为 true；组群需单独写入工具 + 显式 groupConsent
      } : null;
      const data = {
        patterns,
        localSignature: {
          v: localSig.v,
          len: localSig.len,
          counts: localSig.counts || { g: 0, p: 0, o: 0, v: 0 },
          eventSequence: (localSig.events || []).map((e) => e.k).join(''),
        },
        groupProposal,
        suppressed,
      };
      if (suppressed > 0) warnings.push(`${suppressed} 个模式因 k-匿名阈值不足被抑制`); // 契约 §6c 示例警告
      return data;
    }),
  };

  function call(tool, params) {
    const h = tools[tool];
    if (!h) {
      return { ok: false, tool, version: ENV_VERSION, error: { code: ERR.VALIDATION, message: `未知工具: ${tool}` } };
    }
    return h(params);
  }

  return { call, tools };
}

// ============================================================
// 浏览器默认封装：App 内通过真实 localStorage 存储接缝暴露同一适配器。
// 用动态 import()（异步）延迟加载 store 模块，避免在 node 测试/无 DOM 环境下
// 在模块装载时就触达 localStorage。node 测试只测 createAgentMCP + fake ctx。
// ============================================================
export async function createBrowserAgentMCP() {
  const [{ loadDB }, { Prefs }] = await Promise.all([
    import('../store/db.js'),
    import('../store/prefs.js'),
  ]);
  return createAgentMCP({
    loadDb: () => loadDB(),
    loadPrefs: () => Prefs.load(),
    getAnonymousSpectrum: () => [], // 社区谱由未来 L4 薄后端/授权同步注入；默认空
  });
}

