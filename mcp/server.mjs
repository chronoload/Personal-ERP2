#!/usr/bin/env node
// ============================================================
// mcp/server.mjs —— Personal ERP 的外部 MCP 服务 + 命令行
//
//   node mcp/server.mjs --mcp                  # MCP stdio（给 Trae / Claude 等客户端挂载）
//   node mcp/server.mjs tools                  # 列出工具
//   node mcp/server.mjs call erp.status        # 直接调用一个工具（返回 JSON 信封）
//   node mcp/server.mjs call erp.add_activity '{"title":"写周报","start":"09:00","minutes":45}'
//   node mcp/server.mjs path                   # 打印数据文件路径
//
// 数据文件默认 %LOCALAPPDATA%\com.personal.erp.desktop\erp-db.json，可用 ERP_DB 或 --db 覆盖。
// 协议：MCP JSON-RPC 2.0，换行分隔（stdio）。
// ============================================================
import process from 'node:process';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { TOOLS, callTool, createContext, VERSION } from './tools.mjs';
import { defaultDbPath, readDb, writeDb } from './db-file.mjs';

const KNOWN_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
const LATEST_VERSION = '2025-11-25';

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/// 处理一条已解析的 JSON-RPC 消息；通知返回 null
export function handleMessage(msg, ctx) {
  if (msg == null) return null;
  if (typeof msg !== 'object' || Array.isArray(msg)) return rpcError(null, -32600, 'Invalid Request');
  const hasId = Object.prototype.hasOwnProperty.call(msg, 'id');
  const id = hasId ? msg.id : null;
  const method = msg.method;
  // 客户端发来的 response（我们从不主动请求）→ 忽略
  if (typeof method !== 'string') return hasId ? rpcError(id, -32600, 'Invalid Request') : null;
  if (!hasId) return null; // notifications/initialized、notifications/cancelled…

  const params = (msg.params && typeof msg.params === 'object') ? msg.params : {};
  switch (method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      return rpcResult(id, {
        protocolVersion: KNOWN_VERSIONS.includes(asked) ? asked : LATEST_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'personal-erp', version: VERSION },
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : '';
      if (!name) return rpcError(id, -32602, 'tools/call 需要工具名');
      const envelope = callTool(name, params.arguments, ctx);
      return rpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(envelope) }],
        isError: !envelope.ok,
      });
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

/// 一行文本 → 一行响应（无法解析返回 null，避免污染 stdout）
export function handleLine(line, ctx) {
  if (!line || !line.trim()) return null;
  let msg;
  try { msg = JSON.parse(line); } catch (e) { return JSON.stringify(rpcError(null, -32700, 'Parse error')); }
  const res = handleMessage(msg, ctx);
  return res ? JSON.stringify(res) : null;
}

export function makeContext(file) {
  return createContext({
    file,
    read: () => readDb(file),
    append: (db) => writeDb(db, file),
  });
}

// ---------------- MCP stdio 主循环 ----------------

function runStdio(file) {
  const ctx = makeContext(file);
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const out = handleLine(line, ctx);
    if (out) process.stdout.write(out + '\n');
  });
}

// ---------------- CLI ----------------

function parseArgv(argv) {
  const rest = [];
  let file = defaultDbPath();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--db') { if (argv[i + 1]) { file = argv[i + 1]; i += 1; } }
    else if (a.startsWith('--db=')) file = a.slice(5);
    else rest.push(a);
  }
  return { file, rest };
}

function printHelp(file) {
  console.log(`Personal ERP MCP（数据文件：${file}）

用法：
  node mcp/server.mjs --mcp                      MCP stdio 服务（供 AI 客户端挂载）
  node mcp/server.mjs tools                      列出全部工具
  node mcp/server.mjs call <工具> [JSON参数]     直接调用（例：call erp.status）
  node mcp/server.mjs path                       打印数据文件路径

环境变量：
  ERP_DB   覆盖数据文件路径

写入是「只追加」：没有 update / delete 工具。`);
}

function main() {
  const { file, rest } = parseArgv(process.argv.slice(2));
  const cmd = rest[0] || '';
  if (cmd === '--mcp' || cmd === 'mcp') return runStdio(file);
  if (cmd === 'tools') {
    for (const t of TOOLS) console.log(`${t.name}\t${t.description}`);
    return;
  }
  if (cmd === 'path') { console.log(file); return; }
  if (cmd === 'call') {
    const name = rest[1];
    if (!name) { console.error('缺少工具名；先运行 tools 查看'); process.exitCode = 2; return; }
    let args = {};
    if (rest[2]) {
      try { args = JSON.parse(rest[2]); } catch (e) { console.error('参数不是合法 JSON：' + e.message); process.exitCode = 2; return; }
    }
    const envelope = callTool(name, args, makeContext(file));
    console.log(JSON.stringify(envelope, null, 2));
    if (!envelope.ok) process.exitCode = 1;
    return;
  }
  printHelp(file);
}

const isMainModule = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMainModule) main();
