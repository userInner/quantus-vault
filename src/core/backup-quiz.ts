import { wordlist } from '@scure/bip39/wordlists/english.js';
export type BackupQuestion={position:number;choices:string[]};
function randomBelow(limit:number):number {
  const ceiling=0x100000000-(0x100000000%limit);const value=new Uint32Array(1);
  do{crypto.getRandomValues(value);}while(value[0]!>=ceiling);
  return value[0]!%limit;
}
function shuffle<T>(values:T[]):T[]{for(let i=values.length-1;i>0;i--){const j=randomBelow(i+1);[values[i],values[j]]=[values[j]!,values[i]!];}return values;}
export function createBackupQuiz(phrase:string):BackupQuestion[]{
  const words=phrase.split(' ');
  if(words.length!==24 || words.some(w=>!wordlist.includes(w)))throw new Error('助记词格式不正确。');
  const positions=shuffle(words.map((_,i)=>i)).slice(0,3).sort((a,b)=>a-b);
  return positions.map(position=>{
    const answer=words[position]!;
    const pool=[...new Set(words.filter(w=>w!==answer))];
    const others=shuffle(pool).slice(0,5);
    while(others.length<5){const word=wordlist[randomBelow(wordlist.length)]!;if(word!==answer&&!others.includes(word))others.push(word);}
    return {position,choices:shuffle([answer,...others])};
  });
}
