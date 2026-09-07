import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createLocalApi, dispatchTool, TOOL_DEFINITIONS } from './runtime/automation-tools.mjs';

const response = (id, result) => ({ jsonrpc: '2.0', id, result });
const protocolError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
export function createMcpHandler({ api = createLocalApi(), dispatch = dispatchTool } = {}) {
  return async function handle(message) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return protocolError(message?.id ?? null, -32600, 'Invalid JSON-RPC request');
    if (!Object.hasOwn(message, 'id')) return undefined;
    if (message.method === 'initialize') return response(message.id, { protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18'].includes(message.params?.protocolVersion) ? message.params.protocolVersion : '2024-11-05', serverInfo: { name: 'vyrealm-local', version: '1.2.0' }, capabilities: { tools: { listChanged: false } } });
    if (message.method === 'ping') return response(message.id, {});
    if (message.method === 'tools/list') return response(message.id, { tools: TOOL_DEFINITIONS });
    if (message.method !== 'tools/call') return protocolError(message.id, -32601, 'Method not found');
    if (!TOOL_DEFINITIONS.some(tool => tool.name === message.params?.name)) return protocolError(message.id, -32602, 'Unknown VYREALM tool');
    const receipt = await dispatch(message.params.name, message.params.arguments ?? {}, { api });
    return response(message.id, { content: [{ type: 'text', text: JSON.stringify(receipt) }], isError: ['failed', 'blocked', 'review_required'].includes(receipt.status) });
  };
}
export function serveMcp({ input = process.stdin, output = process.stdout, handle = createMcpHandler() } = {}) {
  const reader = createInterface({ input, crlfDelay: Infinity }); let chain = Promise.resolve();
  reader.on('line', line => { chain = chain.then(async () => { let result; try { result = await handle(JSON.parse(line)); } catch (error) { result = protocolError(null, error instanceof SyntaxError ? -32700 : -32603, error.message); } if (result !== undefined) output.write(`${JSON.stringify(result)}\n`); }); });
  return reader;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serveMcp();
