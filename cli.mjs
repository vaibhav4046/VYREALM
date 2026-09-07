import { readFile } from 'node:fs/promises';
import { TOOL_DEFINITIONS, dispatchTool } from './runtime/automation-tools.mjs';

const [command, inputFile] = process.argv.slice(2);
try {
  if (!command || command === 'tools' || command === '--help') {
    console.log(JSON.stringify({ usage: 'node cli.mjs <tool_name> <arguments.json>', tools: TOOL_DEFINITIONS }, null, 2));
  } else {
    const args = inputFile ? JSON.parse(await readFile(inputFile, 'utf8')) : {};
    const receipt = await dispatchTool(command, args);
    console.log(JSON.stringify(receipt, null, 2));
    if (['failed', 'blocked'].includes(receipt.status)) process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', diagnostics: [{ code: 'CLI_INPUT_ERROR', message: error.message }] }));
  process.exitCode = 1;
}
