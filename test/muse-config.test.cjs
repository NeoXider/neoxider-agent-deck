const test=require('node:test'),assert=require('node:assert/strict');
const {configure,MODEL_ID}=require('../scripts/configure-muse-contributor.cjs');
test('Muse remains an explicitly paid route with real vision and no default/credential changes',()=>{
  const free={models:[{id:'free:free'}]},local={models:[{id:'local'}]};
  const rows=[{id:'llm-pi-ai',config:{providers:{openrouter:free,lmstudio:local}}},{id:'agent-default-model',config:{provider:'lmstudio',model:'local'}}];
  const model={id:MODEL_ID,pricing:{prompt:'0.0000001',completion:'0.0000002'},context_length:1048576,architecture:{input_modalities:['text','image','video']}};
  assert.deepEqual(configure(rows,model),{inputPrice:.1,outputPrice:.2});
  const paid=rows[0].config.providers['openrouter-paid'];assert.equal(paid.models.length,1);assert.deepEqual(paid.models[0].input,['text','image']);
  assert.match(paid.models[0].name,/^👁 .*\$0\.10\/\$0\.20/);assert.equal(paid.models[0].reasoningEfforts.off,undefined);
  assert.strictEqual(rows[0].config.providers.openrouter,free);assert.strictEqual(rows[0].config.providers.lmstudio,local);
  assert.deepEqual(rows[1].config,{provider:'lmstudio',model:'local'});configure(rows,model);assert.equal(paid.models.length,1);
});
