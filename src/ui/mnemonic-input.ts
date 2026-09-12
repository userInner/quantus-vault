import {el,btn} from './dom';
import {t} from '../i18n';

/** Read only after an explicit click; never request persistent clipboard permission. */
export function mnemonicInput(readText:()=>Promise<string>=()=>navigator.clipboard.readText()):{row:HTMLElement;input:HTMLTextAreaElement} {
  const input=el('textarea',{id:'recovery-phrase',rows:3,placeholder:'用空格分隔每个单词',autocomplete:'off',spellcheck:'false',autocapitalize:'off','aria-label':'助记词'});
  const status=el('p',{class:'hint',role:'status','aria-live':'polite'});
  const paste=btn('粘贴助记词',()=>{void read();},'text-link');
  let pending=false;
  async function read():Promise<void> {
    if(pending)return;
    pending=true;paste.disabled=true;status.textContent='';
    try {
      const value=await readText();
      // A permission prompt or navigation may have closed/locked the wallet.
      if(!input.isConnected || document.hidden)return;
      if(value===''){status.textContent=t('剪贴板没有文本，请先复制助记词。');return;}
      input.value=value;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.focus();input.setSelectionRange(input.value.length,input.value.length);
    } catch {
      if(input.isConnected)status.textContent=t('无法读取剪贴板。请点击输入框，按 ⌘V（Mac）或 Ctrl+V（Windows）粘贴。');
    } finally {pending=false;paste.disabled=false;}
  }
  // Native keyboard/context-menu paste remains untouched, including undo and selection.
  input.addEventListener('input',()=>{status.textContent='';});
  return {input,row:el('div',{class:'field'},el('div',{class:'row between'},el('label',{for:'recovery-phrase'},'助记词'),paste),input,status)};
}
