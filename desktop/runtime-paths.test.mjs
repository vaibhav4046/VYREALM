import test from 'node:test';
import assert from 'node:assert/strict';
import { blenderRuntimePath } from './runtime-paths.mjs';
test('an explicitly configured Blender path is preserved for the lean package',()=>{
  assert.equal(blenderRuntimePath({configured:'D:/Existing/Blender/blender.exe',bundled:'C:/App/blender-runtime/blender.exe',exists:()=>false}),'D:/Existing/Blender/blender.exe');
});
test('absent optional bundled Blender does not become a forced invalid override',()=>{
  assert.equal(blenderRuntimePath({bundled:'C:/App/blender-runtime/blender.exe',exists:()=>false}),undefined);
  assert.equal(blenderRuntimePath({bundled:'C:/App/blender-runtime/blender.exe',exists:()=>true}),'C:/App/blender-runtime/blender.exe');
  assert.equal(blenderRuntimePath({exists:()=>true}),undefined);
});
