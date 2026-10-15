const fs = require('node:fs'), path = require('node:path');
const MODEL_ID = 'meta/muse-spark-1.3-contributor';
function configure(rows, model) {
  if (model?.id !== MODEL_ID || !model.architecture?.input_modalities?.includes('image')) throw new Error('Expected Muse Contributor vision definition');
  const inputPrice = Number((Number(model.pricing?.prompt) * 1e6).toFixed(6)), outputPrice = Number((Number(model.pricing?.completion) * 1e6).toFixed(6));
  if (!Number.isFinite(inputPrice) || !Number.isFinite(outputPrice)) throw new Error('Price is unavailable');
  const providers = rows.find(r => r.id === 'llm-pi-ai')?.config?.providers;
  if (!providers) throw new Error('Provider config is absent');
  const existing = providers['openrouter-paid'];
  if (existing && (existing.baseURL !== 'https://openrouter.ai/api/v1' || existing.apiKeyEnv !== 'OPENROUTER_API_KEY')) throw new Error('Existing paid provider has a different route');
  const provider = providers['openrouter-paid'] ||= {displayName:'OpenRouter · Paid · Contributor data-use tier',api:'openai-completions',baseURL:'https://openrouter.ai/api/v1',apiKeyEnv:'OPENROUTER_API_KEY',models:[]};
  const definition = {id:MODEL_ID,name:`👁 Muse Spark 1.3 Contributor · $${inputPrice.toFixed(2)}/$${outputPrice.toFixed(2)} per 1M`,
    contextWindow:model.context_length,maxTokens:16384,input:['text','image'],
    // Exact installed pi-ai model capability: no Off, six named effort levels.
    reasoningEfforts:{minimal:'minimal',low:'low',medium:'medium',high:'high',xhigh:'xhigh',max:'max'},
    compat:{supportsDeveloperRole:false,supportsStrictMode:true,supportsStore:false,thinkingFormat:'openrouter',maxTokensField:'max_tokens'}};
  provider.models ||= [];
  const index=provider.models.findIndex(m=>m.id===MODEL_ID);
  if(index<0) provider.models.push(definition); else provider.models[index]=definition;
  return {inputPrice,outputPrice};
}
async function main(){
  const response=await fetch('https://openrouter.ai/api/v1/models'); if(!response.ok) throw new Error('Catalog unavailable');
  const model=(await response.json()).data.find(m=>m.id===MODEL_ID); if(!model) throw new Error('Muse model unavailable');
  const yaml=require(path.join(process.env.LOCALAPPDATA,'NeoXider','DeepSeek Harness Runtime','node_modules','js-yaml'));
  class JsExpression{constructor(value){this.value=value;}}
  const schema=yaml.DEFAULT_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js',{kind:'scalar',construct:v=>new JsExpression(v),instanceOf:JsExpression,represent:v=>v.value}));
  for(const home of [path.join(process.env.USERPROFILE,'.dsh'),path.join(process.env.APPDATA,'dsh-desktop','harness')]){
    const file=path.join(home,'profiles','web','cordis.patch.yml'),rows=yaml.load(fs.readFileSync(file,'utf8'),{schema});
    const prices=configure(rows,model);fs.copyFileSync(file,file+`.before-muse-${Date.now()}.bak`);fs.writeFileSync(file,yaml.dump(rows,{schema,lineWidth:-1}));
    console.log(JSON.stringify({home,added:MODEL_ID,paid:true,...prices,paidInferenceRequests:0,credentialValuesChanged:false}));
  }
}
module.exports={configure,MODEL_ID};
if(require.main===module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
