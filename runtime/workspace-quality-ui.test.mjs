import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { jobProgressPercent } from '../cinematic-studio.js';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import[^\n]*\r?\n/gm,'').replace(/\ninit\(\);\s*$/,'\n');
function fixture(){const context=vm.createContext({jobProgressPercent,document:{addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[]}});vm.runInContext(source,context);return code=>vm.runInContext(code,context);}
test('dashboard uses the selected project instead of hardcoding Mahabharata',()=>{const run=fixture();run("store.state.projects=[{id:'old',name:'Mahabharata'},{id:'current',name:'Aurora'}];store.project=store.state.projects[1]");assert.equal(run('featuredProduction().id'),'current');});
test('storyboard footage has a bounded playable source and an editor action',()=>{const run=fixture();run("store.state.assets=[{id:'source',kind:'video',mime:'video/mp4',url:'/media/source',name:'Aurora orbit'}];store.project={timeline:[{id:'shot',assetId:'source',duration:5,trimStart:8}]}");const html=run('plannedShotCard(store.project.timeline[0],0,store.project)');assert.match(html,/<video[^>]*controls/);assert.match(html,/\/media\/source#t=8,13/);assert.match(html,/data-open-timeline/);assert.doesNotMatch(html,/Camera to direct/);});
test('catalogue keeps unfinished projects out of film cards',()=>{const run=fixture();run("store.state.projects=[{id:'draft',name:'Not a film',timeline:[]}];store.state.flagships=[]");const html=run('catalog()');assert.match(html,/No films selected/);assert.doesNotMatch(html,/project-art|IN PRODUCTION|REVIEWS? FILMS/);});
test('film evidence is collapsed and the current selection cannot be added twice',()=>{const run=fixture();run("store.state.assets=[];store.state.flagships=[{id:'f',projectId:'p',title:'Orbit',sourceLabel:'Edited',outputHash:'abc',verification:{},videoAssetId:'v'}];store.state.projects=[{id:'p',name:'Orbit',latestOutput:{status:'reviewed',videoAssetId:'v',provenance:{outputHash:'abc'}}}];store.project=store.state.projects[0]");const html=run('catalog()');assert.match(html,/<details class="film-evidence">/);assert.doesNotMatch(html,/id="selectFlagship"/);});
test('new project page does not claim an untested inference runtime is ready',()=>{const run=fixture();assert.doesNotMatch(run('studio()'),/Local inference ready/);});

test('workflow research opens the actual source tool and script opens audio',()=>{const run=fixture();const html=run("workflowRail({id:'p',timeline:[]})");assert.match(html,/data-open-view="Studio chat" data-chat-context="research"/);assert.match(html,/data-open-view="Audio"/);});

test('audio has a dedicated workspace and does not show cinematic production buttons',()=>{const run=fixture();run("store.project={id:'p',name:'Aurora',revision:1,timeline:[]}");const html=run('audioWorkspace()');assert.match(html,/Narration/);assert.match(html,/class="workspace audio-workspace"/);assert.doesNotMatch(html,/Build 3D|Run production/);});

test('a newly reviewed project can be added even when an older catalogue filter exists',()=>{const run=fixture();run("store.state.catalogueSelection={mode:'selected',projectIds:['old']};store.project={id:'new',name:'Earth',latestOutput:{status:'reviewed',videoAssetId:'v',provenance:{outputHash:'abc'}}};store.state.flagships=[];store.state.projects=[store.project]");assert.match(run('catalog()'),/id="selectFlagship"/);});
