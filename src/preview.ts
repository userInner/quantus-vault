import { el, icon } from './ui/dom';
import { getLocale, setLocale } from './i18n';
const root=document.querySelector<HTMLElement>('#app')!;
document.body.classList.add('preview');
try{setLocale(localStorage.getItem('quantus-vault-locale'));}catch{setLocale('en');}
function render():void {
 const language=el('select',{class:'language-select','aria-label':'Language / 语言'},el('option',{value:'en'},'English'),el('option',{value:'zh-CN'},'简体中文'));language.value=getLocale();
 language.addEventListener('change',()=>{setLocale(language.value);try{localStorage.setItem('quantus-vault-locale',getLocale());}catch{}render();});
 root.replaceChildren(el('div',{class:'shell'},el('header',{class:'topbar'},el('div',{class:'brand'},el('div',{class:'mark'}),el('div',{class:'wordmark'},'QUANTUS VAULT')),language),el('main',{class:'content'},el('div',{class:'hero'},el('div',{class:'orb'},icon('wallet'))),el('h1',{class:'heading'},'在浏览器插件中打开钱包'),el('p',{class:'description'},'点击浏览器工具栏中的 Quantus Vault 图标，即可创建、导入或解锁钱包。'),el('div',{class:'note'},'密钥和钱包操作仅在插件内处理。此页面不接收助记词或密码。')),el('footer',{class:'footer'},'Quantus Vault')));
}
render();
