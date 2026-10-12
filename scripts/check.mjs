import {readdirSync,readFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';import SwaggerParser from '@apidevtools/swagger-parser';
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name]);}
for(const file of ['src','test','scripts','vendor','examples'].flatMap(walk).filter(f=>/\.(?:c?m?js)$/.test(f))){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr);}
await SwaggerParser.validate('docs/openapi-provider.json');await SwaggerParser.validate('docs/openapi.json');
const length=readFileSync('docs/rapidapi.md','utf8').length;if(length>9800)throw new Error('RapidAPI guide too long: '+length);
const lock=JSON.parse(readFileSync('package-lock.json','utf8'));if(lock.packages['node_modules/bigint-buffer'].resolved!=='vendor/bigint-buffer')throw new Error('Pure JS dependency override missing');
console.log('Syntax, both OpenAPI contracts, dependency override and '+length+'-character guide verified.');
