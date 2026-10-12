import {readdirSync,readFileSync,existsSync} from 'node:fs';import {dirname,resolve} from 'node:path';import {spawnSync} from 'node:child_process';import SwaggerParser from '@apidevtools/swagger-parser';import {VERSION} from '../src/http.js';
import {FEE_BPS} from '../src/fees.js';
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name]);}
for(const file of ['src','test','scripts','vendor','examples'].flatMap(walk).filter(f=>/\.(?:c?m?js)$/.test(f))){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr);}
await SwaggerParser.validate('docs/openapi-provider.json');await SwaggerParser.validate('docs/openapi.json');
const length=readFileSync('docs/API.md','utf8').length;if(!length)throw new Error('API guide is empty');
const lock=JSON.parse(readFileSync('package-lock.json','utf8'));if(lock.packages['node_modules/bigint-buffer'].resolved!=='vendor/bigint-buffer')throw new Error('Pure JS dependency override missing');
const spec=JSON.parse(readFileSync('docs/openapi.json','utf8')),config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
if(spec.info.version!==VERSION||lock.version!==VERSION)throw new Error('Published versions disagree');
if(spec.components.schemas.Quote.properties.serviceFeeBps.enum[0]!==FEE_BPS||!spec.components.schemas.TradeRequest.properties.maxServiceFeeBps)throw new Error('Fee policy or ceiling missing from OpenAPI');
if(spec.security.length||config.vars.ACCESS_MODE!=='public'||config.vars.TRADE_ENGINE!=='jupiter')throw new Error('Default public access or routing contract changed');
if(spec.components.securitySchemes)throw new Error('Public OpenAPI must not show an API-key authorization prompt');
if(config.compatibility_date>new Date().toISOString().slice(0,10))throw new Error('Worker compatibility date cannot be in the future in UTC');
const readme=readFileSync('README.md','utf8');if(/API_KEY\s*=/.test(readme))throw new Error('Public quickstart must not require an API key');
for(const file of ['README.md','SECURITY.md','AGENTS.md','CHANGELOG.md',...walk('docs').filter(f=>f.endsWith('.md'))]){
 const text=readFileSync(file,'utf8');if(text.includes('\ufffd'))throw new Error('Invalid text encoding: '+file);
 for(const match of text.matchAll(/\]\(([^)]+)\)/g)){const path=match[1].split('#')[0];if(!path||/^[a-z]+:/i.test(path))continue;if(!existsSync(resolve(dirname(file),path)))throw new Error('Broken documentation link in '+file+': '+path);}
}
console.log('Syntax, both OpenAPI contracts, dependency override and '+length+'-character guide verified.');
