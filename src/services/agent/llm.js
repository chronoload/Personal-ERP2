// ============================================================
// services/agent/llm.js
// OpenAI 兼容 chat/completions 客户端（非流式）。
// 原生走 CapacitorHttp（绕 WebView CORS），Web/Tauri 走 fetch。
// 5xx/429 自动重试 2 次；错误信息带请求地址，便于定位 baseUrl 配错。
// ============================================================
import { Capacitor, CapacitorHttp } from '@capacitor/core';

export function endpointOf(baseUrl) {
  let b = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!b) throw new Error('未配置 baseUrl');
  if (/\/chat\/completions$/.test(b)) return b;
  if (!/\/v\d+$/.test(b)) b += '/v1';
  return `${b}/chat/completions`;
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
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
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
  return { content: String(msg.content || ''), toolCalls: normToolCalls(msg.tool_calls) };
}

export async function chat(cfg, messages, tools, { retries = 2 } = {}) {
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
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` };

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
  ], null, { retries: 0 });
  return { ok: true, reply: (r.content || '（空回复）').slice(0, 40) };
}
