import {t} from '../i18n';
export type Child = Node | string | undefined | null | false;
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key,value] of Object.entries(attrs)) {
    if (key==='class') element.className=value;
    else if (key.startsWith('on') && typeof value==='function') element.addEventListener(key.slice(2).toLowerCase(),value);
    else if (key==='text') element.textContent=t(value);
    else if (value!==undefined && value!==false) element.setAttribute(key,value===true?'':(['aria-label','placeholder','title'].includes(key)?t(String(value)):String(value)));
  }
  for(const child of children) if(child!==undefined && child!==null && child!==false) element.append(typeof child==='string'?t(child):child);
  return element;
}
const paths: Record<string,string> = {
  shield:'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-4 9 3 3 5-6',
  lock:'M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4',
  arrow:'M5 19 19 5M6 5h13v13',
  down:'M12 3v17M5 13l7 7 7-7',
  copy:'M9 9h12v12H9zM15 9V3H3v12h6',
  refresh:'M20 7V2l-3 3a8 8 0 1 0 3 11M20 7h-5',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
  back:'M20 12H4m7-7-7 7 7 7',
  check:'m4 12 5 5L20 6',
  wallet:'M3 6h17v15H3V6Zm0 0 14-4v4m-1 6h5v4h-5z',
  clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 4v6l4 2',
  eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  plus:'M12 4v16M4 12h16'
};
export function icon(name: string): SVGSVGElement {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  for(const [key,value] of Object.entries({viewBox:'0 0 24 24',width:'20',height:'20',fill:'none',stroke:'currentColor','stroke-width':'1.5','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value);
  const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name]??paths.shield);svg.append(path);return svg;
}
export function btn(text: string, action: ()=>void, cls='button primary', iconName?:string): HTMLButtonElement { return el('button',{type:'button',class:cls,onClick:action},iconName?icon(iconName):null,text); }
export function field(label: string, attrs: Record<string,any>): {row:HTMLLabelElement;input:HTMLInputElement} {
  const input=el('input',{...attrs,autocomplete:'off',spellcheck:'false',autocapitalize:'off'});
  return {row:el('label',{class:'field'},el('span',{},label),input),input};
}
export function short(address:string): string {return `${address.slice(0,9)}…${address.slice(-7)}`;}
