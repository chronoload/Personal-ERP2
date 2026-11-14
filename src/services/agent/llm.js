// ============================================================
// services/agent/llm.js
// OpenAI 兼容 chat/completions 客户端（非流式）。
// 原生走 CapacitorHttp（绕 WebView CORS），Web/Tauri 走 fetch。
// ============================================================
import { Capacitor, CapacitorHttp } from '@capacitor/core';

export function endpointOf(baseUrl) {
  let b = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!b) throw new Error('未配置 baseUrl');
  if (/\/chat\/completions$/.test(b)) return b;
  if (!/\/v\d+$/.test(b)) b += '/v1';
  return `${b}/chat/completions`;
}

function errText(payload, status) {
  try {
    const d = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const m = d && d.error && (d.error.message || d.error.code);
    if (m) return `模型接口错误（${status}）：${String(m).slice(0, 200)}`;
  } catch (e) { /* 忽略 */ }
  return `模型接口错误（${status}）`;
}

function normToolCalls(list) {
  if (!Array.isArray(list)) return [];
  return list.map((c) => {
    let args = {};
    try { args = typeof c.function?.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : (c.function?.arguments || {}); } catch (e) { args = { __raw: c.function?.arguments }; }
    return { id: c.id || `call_${Math.random().toString(36).slice(2, 9)}`, name: c.function?.name || '', args };
  }).filter((c) => c.name);
}

export async function chat(cfg, messages, tools) {
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

  let payload;
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.post({
      url, headers, data: body, connectTimeout: 20000, readTimeout: 60000,
    });
    if (r.status < 200 || r.status >= 300) throw new Error(errText(r.data, r.status));
    payload = r.data;
  } else {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(errText(await r.text(), r.status));
    payload = await r.json();
  }
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch (e) { throw new Error('模型返回不是合法 JSON'); }
  }
  const msg = payload && payload.choices && payload.choices[0] && payload.choices[0].message;
  if (!msg) throw new Error('模型返回为空（choices 缺失）');
  return { content: String(msg.content || ''), toolCalls: normToolCalls(msg.tool_calls) };
}
