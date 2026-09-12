import english from './en.json';
export type Locale='en'|'zh-CN';
let locale:Locale='en';
export function normalizeLocale(value:unknown):Locale{return value==='zh-CN'?'zh-CN':'en';}
export function getLocale():Locale{return locale;}
export function setLocale(value:unknown):void{locale=normalizeLocale(value);if(typeof document!=='undefined')document.documentElement.lang=locale;}
const messages:Record<string,string>=english;
const fragments=Object.keys(messages).sort((a,b)=>b.length-a.length);
const escaped=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const fragmentPattern=new RegExp(fragments.map(escaped).join('|'),'g');
const dynamic:Array<[RegExp,(...parts:string[])=>string]>=[
 [/^正在扫描(收款|找零)地址，索引 (\d+)$/,(_s,branch,n)=>`Scanning ${branch==='收款'?'receiving':'change'} addresses, index ${n}`],
 [/^备份验证，第 (\d+) 步，共 3 步$/,(_s,n)=>`Backup verification, step ${n} of 3`],
 [/^第 (\d+) 个单词是什么？$/,(_s,n)=>`What is word #${n}?`],
 [/^第 (\d+) \/ 3 项$/,(_s,n)=>`WORD ${n} OF 3`],
 [/^请等待 (\d+) 秒后再试。$/,(_s,n)=>`Wait ${n} seconds before trying again.`],
 [/^已在最终确认区块 (\d+) 执行成功。$/,(_s,n)=>`Executed successfully in finalized block ${n}.`],
 [/^区块 (\d+) 执行失败，可能已扣除网络费。$/,(_s,n)=>`Execution failed in block ${n}. A network fee may have been charged.`],
 [/^区块 (.+)$/,(_s,n)=>`Block ${n}`],
 [/^账户 (\d+)$/,(_s,n)=>`Account ${n}`],
 [/^可转余额 (.+) (PLK|QTC)，另需预留手续费。$/,(_s,n,symbol)=>`Available: ${n} ${symbol}. Keep enough for the fee.`],
 [/^可转余额 (.+) · 另需预留手续费$/,(_s,n)=>`Available: ${n} · Fee reserve required`],
];
/** Translate display text only; never mutate stored data, input values or signing payloads. */
export function t(source:string):string {
 if(locale==='zh-CN')return source;
 if(messages[source]!==undefined)return messages[source]!;
 for(const [pattern,render] of dynamic){const match=source.match(pattern);if(match)return render(...match);}
 // Composite labels (address + status, version) retain their non-language data exactly.
 return source.replace(fragmentPattern,key=>messages[key]!);
}
