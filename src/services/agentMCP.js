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
      const limit = intRange(p.limit, 'limit', 1, 50, 5);
      const k = intRange(p.k, 'k', 0, 50, 2);
      const db = ctx.loadDb();
      const feats = extractFeatures(db);
      const acts = db.activities || [];
      const plans = db.plans || [];
      // 候选：未完成/待办活动（Planned/Started），合并其计划级偏置
      const candidates = acts
        .filter((a) => a.status === 'Planned' || a.status === 'Started')
        .map((a) => {
          const bias = feats.biasModel.find((e) => e.planId === (a.plan_ids?.[0] ?? null));
          return {
            activityId: a.id,
            planId: a.plan_ids?.[0] ?? null,
            deadline: null, // MCP 层不假设截止；由上层/启发填充
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
      const freeMinutes = intRange(p.freeMinutes, 'freeMinutes', 1, 24 * 60, 30);
      const limit = intRange(p.limit, 'limit', 1, 50, 5);
      const now = nowOf();
      const db = ctx.loadDb();
      const feats = extractFeatures(db);
      const acts = (db.activities || []).filter((a) => a.status === 'Planned' || a.status === 'Started');
      // 单个空闲槽：从 freeFrom（或 now）起 freeMinutes 分钟
      let start = now;
      if (p.freeFrom != null) { const t = new Date(p.freeFrom).getTime(); if (Number.isNaN(t)) throw Object.assign(new Error('freeFrom 无效日期'), { code: ERR.VALIDATION }); start = t; }
      const slots = [{ start, end: start + freeMinutes * 60000 }];
      const candidates = acts.slice(0, 50).map((a) => {
        const bias = feats.biasModel.find((e) => e.planId === (a.plan_ids?.[0] ?? null));
        const dur = (a.planned_minutes || 30) * (bias?.biasK ?? 1); // biasK 校正
        return { activityId: a.id, duration: Math.max(5, Math.round(dur / 5) * 5), score: 0 };
      });
      return slotIntoFreeTime(slots, candidates, { now }).slice(0, limit);
    }),

    'community.matchPatterns': (p = {}) => runTool('community.matchPatterns', () => {
      // ---- 授权门槛（核心）：未授权一律拒绝 ----
      if (loadPrefs().communityAuth !== true) {
        const e = new Error('社区功能未授权：请先在设置中开启「允许匿名参与共同习惯群」');
        e.code = ERR.AUTH_DENIED;
        throw e;
      }
      const k = intRange(p.k, 'k', 2, 100, 5);
      const db = ctx.loadDb();
      const localSig = encodeTrajectory(db);
      const spectrum = (typeof ctx.getAnonymousSpectrum === 'function' ? ctx.getAnonymousSpectrum() : p.spectrum) || [];
      // k-匿名抑制：任何共享前先抑制低 n 独特签名（防反指认）
      const { shared, suppressed } = kAnonymitySuppress(spectrum.map((s) => ({ sig: s })), k);
      // 与本机签名比对，取相似样板
      const matches = shared
        .map((s) => ({ similarity: similarity(localSig, s.sig), pattern: s.sig }))
        .filter((m) => m.similarity >= (p.minSimilarity ?? 0.5))
        .sort((a, b) => b.similarity - a.similarity);
      // 回传去身份的顶层概貌：仅相似度 + 匿名计数，无任何身份
      const top = matches.slice(0, 5).map((m) => ({
        similarity: m.similarity,
        eventsLen: m.pattern?.events?.length ?? 0,
        counts: m.pattern?.counts ?? { g: 0, p: 0, o: 0, v: 0 },
      }));
      // 提议组群（consented grouping）：存在 ≥m 相似时仅「提议」，绝不自动组
      const groupable = matches.length >= (p.minGroup ?? 1) && matches.length >= 1;
      const data = {
        authorized: true,
        localEvents: localSig.len,
        suppressedProfiles: suppressed,
        patterns: top,
        groupProposal: groupable ? {
          consentRequired: true,
          matched: matches.length,
          note: '检测到相似模式的共同习惯群候选。你必须显式确认（groupConsent:true）才可能组群；本层绝不自动加入或广播。',
        } : null,
      };
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

