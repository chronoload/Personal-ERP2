// ============================================================
// services/agent/llm.js
// OpenAI 兼容 chat/completions 客户端（非流式）。
// 原生走 CapacitorHttp（绕 WebView CORS），Web/Tauri 走 fetch。
// 5xx/429 自动重试 2 次；错误信息带请求地址，便于定位 baseUrl 配错。
// ============================================================
import { Capacitor, CapacitorHttp } from '@capacitor/core';

/**
 * OpenCode 网关归一到根：兼容现行 /inference 与旧的 /zen 写法，
 * 也接受后面多写的 /v1、/openai/v1、/chat/completions 等尾巴。
 */
function opencodeRoot(baseUrl) {
  const m = /^https?:\/\/(?:www\.)?opencode\.ai\/(inference|zen)(\/go)?(?:\/.*)?$/i.exec(String(baseUrl || '').trim());
  if (!m) return '';
  return `https://opencode.ai/${m[1]}${m[2] || ''}`;
}

export function endpointOf(baseUrl) {
  let b = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!b) throw new Error('未配置 baseUrl');
  // OpenCode 网关：实际路径是 /openai/v1/chat/completions
  const oc = opencodeRoot(b);
  if (oc) return `${oc}/openai/v1/chat/completions`;
  if (/\/chat\/completions$/.test(b)) return b;
  if (/\/openai\/v1$/.test(b)) return `${b}/chat/completions`;
  if (!/\/v\d+$/.test(b)) b += '/v1';
  return `${b}/chat/completions`;
}

/** 是否 OpenCode Console 网关（Go / 按量 / 旧 zen 写法），决定要不要加会话头 */
export function isOpencode(baseUrl) {
  return !!opencodeRoot(baseUrl);
}

/** 是否 DeepSeek 官方接口：思考模式 / reasoning_content 只对它启用 */
export function isDeepSeek(baseUrl) {
  return /^https?:\/\/api\.deepseek\.com(\/|$)/i.test(String(baseUrl || '').trim());
}

/** 配置页的服务商预设 */
export const PROVIDER_PRESETS = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { label: 'OpenCode Go', baseUrl: 'https://opencode.ai/inference/go' },
  { label: 'OpenCode Zen（按量）', baseUrl: 'https://opencode.ai/inference' },
];

/** DeepSeek 全家桶的模型：flash 多模态，v4-pro 纯文本 */
export const DEEPSEEK_MODELS = [
  { id: 'deepseek-flash', label: 'DeepSeek-V4.1-Flash（多模态 / 默认）' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro（纯文本）' },
];

/** 当前 baseUrl 命中哪个预设（含旧写法归一），未命中返回空串 */
export function presetOf(baseUrl) {
  const b = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!b) return '';
  const oc = opencodeRoot(b);
  if (oc) return /\/go$/.test(oc) ? 'https://opencode.ai/inference/go' : 'https://opencode.ai/inference';
  if (/^https?:\/\/api\.deepseek\.com(\/|$)/i.test(b)) return 'https://api.deepseek.com';
  return '';
}

function errText(payload, status, url) {
  let detail = '';
  try {
    const d = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const m = d && d.error && (d.error.message || d.error.code);
    if (m) detail = String(m).slice(0, 160);
    else if (typeof payload === 'string') detail = payload.slice(0, 160);
  } catch (e) {
    detail = typeof payload === 'string' ? payload.slice(0, 160) : '';
  }
  const hint = (status === 401 || status === 403) ? '（检查 API Key）'
    : status === 404 ? '（检查 baseUrl 路径）'
      : status === 429 ? '（限流，稍后再试）'
        : status >= 500 ? '（模型服务端异常）' : '';
  return `模型接口错误 ${status}${hint}：${detail || '无响应体'}\n请求地址：${url}`;
}

function normToolCalls(list) {
  if (!Array.isArray(list)) return [];
  return list.map((c) => {
    let args = {};
    try {
      args = typeof c.function?.arguments === 'string'
        ? JSON.parse(c.function.arguments || '{}')
        : (c.function?.arguments || {});
    } catch (e) { args = { __raw: c.function?.arguments }; }
    return {
      id: c.id || `call_${Math.random().toString(36).slice(2, 9)}`,
      name: c.function?.name || '',
      args,
    };
  }).filter((c) => c.name);
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let nativeFetch = null;
/** Tauri 桌面壳走插件原生 HTTP（绕 CORS）；浏览器用 window.fetch */
async function httpFetch() {
  if (nativeFetch) return nativeFetch;
  if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
    try {
      const m = await import('@tauri-apps/plugin-http');
      if (m && m.fetch) nativeFetch = m.fetch;
    } catch (e) { /* 插件不可用时退回 fetch */ }
  }
  return nativeFetch || fetch;
}

/** 单次请求：成功返回 {content, toolCalls}，失败抛带 status 的 Error */
async function once(url, headers, body) {
  let payload;
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.post({
      url, headers, data: body, connectTimeout: 20000, readTimeout: 60000,
    });
    if (r.status < 200 || r.status >= 300) {
      const e = new Error(errText(r.data, r.status, url));
      e.status = r.status;
      throw e;
    }
    payload = r.data;
  } else {
    const f = await httpFetch();
    const r = await f(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) {
      const e = new Error(errText(await r.text(), r.status, url));
      e.status = r.status;
      throw e;
    }
    payload = await r.json();
  }
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch (e) { throw new Error('模型返回不是合法 JSON'); }
  }
  const msg = payload && payload.choices && payload.choices[0] && payload.choices[0].message;
  if (!msg) {
    const e = new Error(`模型返回为空（choices 缺失）\n请求地址：${url}`);
    e.status = 200;
    throw e;
  }
  return {
    content: String(msg.content || ''),
    toolCalls: normToolCalls(msg.tool_calls),
    // DeepSeek 思考模式：带 tools 时后续请求必须完整回传，否则 400
    reasoning: String(msg.reasoning_content || ''),
  };
}

export async function chat(cfg, messages, tools, { retries = 2, sessionId = '' } = {}) {
  if (!cfg || !cfg.apiKey) throw new Error('未配置 API Key');
  if (!cfg.model) throw new Error('未配置模型名');
  const url = endpointOf(cfg.baseUrl);
  const body = {
    model: cfg.model,
    messages,
    temperature: Number.isFinite(cfg.temperature) ? cfg.temperature : 0.3,
    stream: false,
  };
  if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
  // DeepSeek：思考模式默认开启（effort=high），显式传参才能关掉或调强度
  if (isDeepSeek(cfg.baseUrl)) {
    if (cfg.thinking === 'on' || cfg.thinking === 'off') {
      body.thinking = { type: cfg.thinking === 'on' ? 'enabled' : 'disabled' };
    }
    if (cfg.thinking !== 'off' && cfg.effort) body.reasoning_effort = cfg.effort;
  }
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` };
  if (isOpencode(cfg.baseUrl)) {
    // Go 要求标识客户端身份，并带上稳定的会话 ID 做路由与提示词缓存
    headers['User-Agent'] = 'personal-erp/1.0';
    if (sessionId) headers['x-opencode-session'] = sessionId;
  }

  for (let attempt = 0; ; attempt++) {
    try {
      return await once(url, headers, body);
    } catch (e) {
      if (!RETRYABLE.has(e.status) || attempt >= retries) throw e;
      await sleep(700 * (attempt + 1));
    }
  }
}

/** 设置页「测试连接」：发一条最小请求，验证 baseUrl / key / model 三者是否可用 */
export async function testConnection(cfg) {
  const r = await chat({ ...cfg, temperature: 0 }, [
    { role: 'user', content: 'ping（收到请只回复 pong）' },
  ], null, { retries: 0, sessionId: `test_${Date.now().toString(36)}` });
  return { ok: true, reply: (r.content || '（空回复）').slice(0, 40) };
}
