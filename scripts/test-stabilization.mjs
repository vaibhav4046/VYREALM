import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Complements npm test with the persistence and chat regressions added later.
const tests = [
  'desktop/oauth.test.mjs',
  'desktop/runtime-paths.test.mjs',
  'runtime/project-store-paths.test.mjs',
  'runtime/verified-download.test.mjs',
  'runtime/format-render.test.mjs',
  'runtime/flagship-catalogue.test.mjs',
  'runtime/studio-conversation.test.mjs',
  'runtime/studio-chat-context.test.mjs',
  'runtime/catalogue-selection.test.mjs',
  'runtime/creator-workflow.test.mjs',
  'runtime/raw-footage-service.test.mjs',
  'runtime/raw-footage-plan.test.mjs',
  'runtime/raw-footage-edit.test.mjs',
  'runtime/timeline-editor.test.mjs',
  'runtime/creator-pack.test.mjs',
  'runtime/asset-library.test.mjs',
  'runtime/caption-pages.test.mjs',
  'runtime/workspace-quality-ui.test.mjs',
  'runtime/ui-polling.test.mjs',
  'runtime/mcp-connection.test.mjs',
  'runtime/automation-tools-stdio.test.mjs',
  'runtime/creator-templates.test.mjs',
  'runtime/local-automations.test.mjs',
  'runtime/local-automations-ui.test.mjs',
  'runtime/local-automations-http.test.mjs',
  'scripts/audit-public-source.test.mjs'
];
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tests], {
  cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit', windowsHide: true
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
