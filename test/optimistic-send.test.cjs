const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/renderer/app.js'), 'utf8');
function fixture() {
  const state = { selectedSessionId: 'A', currentMessages: [{ seq: 10, role: 'user', text: 'same' }], pendingSendsBySession: new Map(), nextPendingSendId: 1, queuedPromptsBySession: new Map(), steeringPromptsBySession: new Map(), queueSnapshotRevisions: new Map() };
  const context = vm.createContext({ state, renderMessages() {}, jumpToLatestTranscript() {},
    queueSnapshotRevision: id => state.queueSnapshotRevisions.get(id) || 0,
    queuedPromptsFor: id => state.queuedPromptsBySession.get(id) || [],
    steeringPromptsFor: id => state.steeringPromptsBySession.get(id) || [] });
  vm.runInContext(source.slice(source.indexOf('function pendingSendsFor('), source.indexOf('function renderMessages(')), context);
  return { state, run: code => vm.runInContext(code, context) };
}
test('pending send appears before acknowledgement and removes only after a newer matching history record', () => {
  const f = fixture(); f.run('var entry = beginPendingSend("A", "same", []);');
  assert.equal(f.state.pendingSendsBySession.get('A')[0].status, 'sending');
  f.run('reconcilePendingSends("A", state.currentMessages)'); assert.equal(f.run('pendingSendsFor("A").length'), 1);
  f.run('settlePendingSend(entry, "accepted"); reconcilePendingSends("A", [{seq:11, role:"user", text:"same"}])');
  assert.equal(f.run('pendingSendsFor("A").length'), 0);
});
test('one receipt cannot consume two identical sends and another chat cannot settle them', () => {
  const f = fixture(); f.run('beginPendingSend("A","same",[]); beginPendingSend("A","same",[]); reconcilePendingSends("B",[{seq:11,role:"user",text:"same"}]);');
  assert.equal(f.run('pendingSendsFor("A").length'), 2);
  f.run('reconcilePendingSends("A",[{seq:11,role:"user",text:"same"}]);'); assert.equal(f.run('pendingSendsFor("A").length'), 1);
  f.run('reconcilePendingSends("A",[{seq:11,role:"user",text:"same"}]);'); assert.equal(f.run('pendingSendsFor("A").length'), 1);
  f.run('reconcilePendingSends("A",[{seq:11,role:"user",text:"same"},{seq:12,role:"user",text:"same"}]);'); assert.equal(f.run('pendingSendsFor("A").length'), 0);
});
test('failed sends remain labelled as failures and retry replaces the failed preview', () => {
  const f = fixture(); f.run('var entry=beginPendingSend("A","new",[]); settlePendingSend(entry,"failed");');
  assert.equal(f.run('pendingSendsFor("A")[0].status'), 'failed');
  f.run('beginPendingSend("A","new",[])'); assert.equal(f.run('pendingSendsFor("A").length'), 1);
});
test('empty and older snapshots are rejected, while newer compaction snapshots may legitimately shrink', () => {
  const f = fixture();
  assert.equal(f.run('historyWouldRegress([{seq:20}],[])'), true);
  assert.equal(f.run('historyWouldRegress([{seq:20}],[{seq:10}])'), true);
  assert.equal(f.run('historyWouldRegress([{seq:10},{seq:20}],[{seq:21,role:"compaction"}])'), false);
  assert.equal(f.run('historyWouldRegress([],[{seq:1}])'), false);
});

test('queued acknowledgement transfers ownership out of the transcript, including edit/delete/steer', () => {
  const f = fixture();
  f.run('var entry=beginPendingSend("A","queued text",[]); settlePendingSend(entry,"queued");');
  assert.equal(f.run('pendingSendsFor("A").length'), 0);
  for (const placement of ['queued', 'steering']) {
    f.state.queueSnapshotRevisions.set('A', 2);
    f.state[placement === 'queued' ? 'queuedPromptsBySession' : 'steeringPromptsBySession'].set('A', [{ id: 'server', text: 'edited text' }]);
    assert.equal(f.run('visiblePendingSendsFor("A").length'), 0);
  }
  f.state.queuedPromptsBySession.set('A', []); f.state.steeringPromptsBySession.set('A', []);
  assert.equal(f.run('visiblePendingSendsFor("A").length'), 0);
});

test('queue-before-ack race hides just one matching preview per new queue item, not old or identical intents', () => {
  const f = fixture();
  f.state.queuedPromptsBySession.set('A', [{ id: 'old', text: 'same' }]);
  f.state.queueSnapshotRevisions.set('A', 1);
  f.run('beginPendingSend("A","same",[]); beginPendingSend("A","same",[]);');
  f.state.queueSnapshotRevisions.set('A', 2);
  assert.equal(f.run('visiblePendingSendsFor("A").length'), 2);
  f.state.queuedPromptsBySession.get('A').push({ id: 'new-1', text: 'same' });
  assert.equal(f.run('visiblePendingSendsFor("A").length'), 1);
  f.state.steeringPromptsBySession.set('A', [{ id: 'new-2', text: 'same' }]);
  assert.equal(f.run('visiblePendingSendsFor("A").length'), 0);
  assert.equal(f.run('pendingSendsFor("A").length'), 2);
  f.run('settlePendingSend(pendingSendsFor("A")[0],"failed");');
  assert.equal(f.run('visiblePendingSendsFor("A").length'), 1);
});

test('image queue ownership checks attachments and stays scoped to the submitting chat', () => {
  const f = fixture();
  f.run('beginPendingSend("A","",[{kind:"image"}]);');
  f.state.queueSnapshotRevisions.set('A', 1);
  f.state.queuedPromptsBySession.set('A', [{ id: 'text-only', text: '', attachments: [] }]);
  assert.equal(f.run('visiblePendingSendsFor("A").length'), 1);
  f.state.queuedPromptsBySession.set('B', [{ id: 'other-chat', text: '', attachments: [{ kind: 'image' }] }]);
  assert.equal(f.run('visiblePendingSendsFor("A").length'), 1);
  f.state.queuedPromptsBySession.set('A', [{ id: 'image', text: '', attachments: [{ kind: 'image' }] }]);
  assert.equal(f.run('visiblePendingSendsFor("A").length'), 0);
});
