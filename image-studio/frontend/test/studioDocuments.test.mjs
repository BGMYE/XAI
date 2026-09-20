import assert from 'node:assert/strict';
import test from 'node:test';
import { safeMediaSource, buildStudioDocument, documentNode, videoTaskNode, mergeTaskRecords, DocumentWriter } from '../src/lib/studioDocuments.ts';
import { sourceHistoryItemForCanvasNode, createCanvasNode } from '../src/state/canvasNodes.ts';
const node = { id:'image-1', type:'image', src:'/media/full/'+'a'.repeat(32), x:-500,y:40,width:200,height:100,createdAt:1 };
const blank = (name='first') => ({version:1,revision:0,activeWorkspaceId:'ws',workspaces:[{id:'ws',name,prompt:'',nodes:[],viewport:{x:0,y:0,scale:1},selectedNodeId:''}],appliedVideoTaskIds:[]});
test('canvas serialization uses a field allowlist and never includes keys, blobs or request payloads',()=>{
  const workspace={id:'ws',name:'test',prompt:'prompt',canvasNodes:[node],sources:[],lastPayload:{apiKey:'sk-secret'}};
  const doc=buildStudioDocument({activeWorkspaceId:'ws',workspaces:[workspace],history:[{id:'image-1',savedPath:'/managed/images/a.png'}],canvasNodes:[{...node,apiKey:'hidden',imageB64:'large-binary'}],canvasViewport:{x:-34,y:12,scale:.5},selectedNodeId:'missing',prompt:'edited',apiKey:'sk-secret'},new Set(['t1']));
  const json=JSON.stringify(doc); assert.doesNotMatch(json,/sk-secret|hidden|large-binary|apiKey|lastPayload/);
  assert.equal(doc.workspaces[0].nodes[0].savedPath,'/managed/images/a.png');assert.equal(doc.workspaces[0].nodes[0].x,-500);assert.equal(doc.workspaces[0].selectedNodeId,'');assert.equal(doc.workspaces[0].prompt,'edited');assert.deepEqual(doc.appliedVideoTaskIds,['t1']);
});
test('canvas excludes embedded media, signed links, credentials and unsafe source URLs',()=>{
  for(const value of ['javascript:alert(1)','data:video/mp4;base64,AAAA','blob:https://site.test/foo','https://u:p@site.test/a','https://site.test/a?token=secret','/media/../private','http://site.test/a']) assert.equal(safeMediaSource(value),'',value);
  assert.equal(safeMediaSource('https://cdn.example/a.mp4'),'https://cdn.example/a.mp4');assert.equal(safeMediaSource(node.src),node.src);
});
test('image sources can be restored without loading the entire historical gallery',()=>{
  const stored=createCanvasNode({...node,savedPath:'/managed/images/a.png'});
  assert.equal(sourceHistoryItemForCanvasNode(stored)?.savedPath,'/managed/images/a.png');
  assert.equal(sourceHistoryItemForCanvasNode({...stored,type:'video'}),undefined);
  assert.equal(documentNode({...node,id:'source-preview:/managed/imports/a.png'},[]).savedPath,'/managed/imports/a.png');
});
test('video task delivery uses deterministic IDs and local media references',()=>{
  const task={id:'task-1',kind:'video',status:'succeeded',createdAt:123,result:{savedPath:'/videos/a.mp4',mediaUrl:node.src,width:1920,height:1080}};
  assert.equal(videoTaskNode(task)?.id,'video-task-task-1');assert.equal(videoTaskNode(task)?.height,270);
  assert.equal(videoTaskNode({...task,status:'running'}),null);assert.equal(videoTaskNode({...task,result:{...task.result,mediaUrl:'javascript:x'}}),null);
});
test('stale task events cannot replace newer terminal state',()=>{
  const previous=[{id:'t',revision:3,status:'succeeded',createdAt:1}];
  assert.equal(mergeTaskRecords(previous,[{id:'t',revision:2,status:'running',createdAt:1}])[0].status,'succeeded');
  assert.equal(mergeTaskRecords(previous,[{id:'t',revision:4,status:'cancelled',createdAt:1}])[0].status,'cancelled');
});
test('document writer serializes edits arriving during a slow save',async()=>{
  let release;const barrier=new Promise(r=>release=r);const writes=[];const states=[];
  const writer=new DocumentWriter(7,async(doc,revision)=>{writes.push([doc.workspaces[0].name,revision]);if(writes.length===1)await barrier;return {...doc,revision:revision+1};},s=>states.push(s));
  const first=writer.enqueue(blank('first'));writer.enqueue(blank('second'));writer.enqueue(blank('latest'));assert.equal(writes.length,1);release();await first;
  assert.deepEqual(writes,[['first',7],['latest',8]]);assert.equal(states.at(-1),'saved');
});
test('failed saves fail closed without rebasing a conflict or losing newer layout',async()=>{
  let fail=true;const writes=[];const states=[];
  const writer=new DocumentWriter(2,async(doc,revision)=>{writes.push([doc.workspaces[0].name,revision]);if(fail)throw new Error('CANVAS_CONFLICT');return {...doc,revision:3};},(s,error)=>states.push([s,error]));
  await writer.enqueue(blank('first'));await writer.enqueue(blank('newer'));assert.equal(writes.length,1);assert.equal(states.at(-1)[0],'error');fail=false;await writer.retry();assert.deepEqual(writes,[['first',2],['newer',2]]);
});

test("task IDs use secure random bytes without requiring randomUUID", async () => {
  const { newStudioTaskID } = await import("../src/lib/studioDocuments.ts");
  const values = Array.from({ length: 64 }, () => newStudioTaskID());
  assert.ok(values.every((value) => /^[a-f0-9]{32}$/.test(value)));
  assert.equal(new Set(values).size, values.length);
});
