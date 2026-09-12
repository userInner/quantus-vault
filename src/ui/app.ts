import {quotePrivateBatches,reservePrivateBatches,cancelRemainingPrivateBatches,type PrivateBatchQuote} from '../core/privacy/batches';
import {privacyEconomics} from '../core/privacy/witness';
import {prepareReservedPrivateBatch,sendPreparedPrivateTransfer,type PrivateTransferReview} from '../core/privacy/transfer';
import {PRIVATE_BROADCAST_ENABLED} from '../core/privacy/release-gate';
import initPrivacy,{verifyPrivacyMerkle} from '../../privacy-wasm/quantus_privacy_keys';
import {PrivateJournal,privateRecoveryState,type PrivatePending} from '../core/privacy/journal';
import {refreshPrivateReceipts} from '../core/privacy/receipt';
import {cancelPrivatePreparation} from '../core/privacy/reservation';
import {scanPrivacyWallet} from '../core/privacy/recovery';
import {mnemonicInput} from './mnemonic-input';
import {t,getLocale,setLocale} from '../i18n';
import {createBackupQuiz,type BackupQuestion} from '../core/backup-quiz';
import QRCode from 'qrcode';
import { el, btn, icon, field, short } from './dom';
import { type Store, type TxRecord } from '../core/storage';
import { type Vault } from '../core/vault';
import { Session } from '../core/session';
import { CryptoClient } from '../core/crypto-client';
import { NETWORKS, Rpc, type NetworkId } from '../core/rpc';
import { ChainCodec, readAccount, prepareTransfer, recheckDraft, transactionHash, type AccountState, type Draft } from '../core/chain';
import { formatAmount, MIN_PASSWORD_LENGTH, requirePassword, safeError, validAddress, parseAmount } from '../core/validation';
import { checkReceipt } from '../core/receipt';
import {submitReviewedTransfer,refreshTransactionRecords} from '../core/transaction-flow';

export class WalletApp {
  private privateQuote?:PrivateBatchQuote;
  private privateReview?:PrivateTransferReview;
  private privateGroup?:string;
  private vault?:Vault;
  private privateRecords:PrivatePending[]=[];
  private privacyAbort?:AbortController;
  private privacyResult?:Awaited<ReturnType<typeof scanPrivacyWallet>>;
  private readonly session=new Session();
  private readonly crypto=new CryptoClient();
  private network:NetworkId='mainnet';
  private rpc=new Rpc('mainnet');
  private codec?:ChainCodec;
  private balance?:AccountState;
  private records:TxRecord[]=[];
  private draft?:Draft;
  private page='welcome';
  private busy=false;
  private error='';
  private notice='';
  private epoch=0;
  private operation=0;
  private authFailures=0;
  private retryAfter=0;
  private backup?:string;
  private generated?:string;
  private mnemonicIndex=0;
  private quiz:BackupQuestion[]=[];
  private quizStep=0;
  private quizSelected='';
  private sendTo='';
  private sendAmount='';
  private showActivity=false;
  private hideBalance=false;
  private viewTimer?:ReturnType<typeof setTimeout>;
  private setupTimer?:ReturnType<typeof setTimeout>;
  private activeContent?:HTMLElement;
  constructor(private root:HTMLElement,private store:Store,private scanPrivate=scanPrivacyWallet) {}
  async init():Promise<void> {
    try{setLocale(this.store.loadLocale?await this.store.loadLocale():localStorage.getItem('quantus-vault-locale'));}catch{setLocale('en');}
    try {this.vault=await this.store.loadVault();this.records=await this.store.history();this.page=this.vault?'locked':'welcome';}
    catch(e){this.page='fatal';this.error=safeError(e);}
    this.render();
    for(const name of ['pointerdown','keydown']) document.addEventListener(name,()=>{
      if(this.vault && !this.session.isUnlocked() && this.page!=='locked' && this.page!=='fatal'){this.lock();return;}
      this.session.touch();
    },{capture:true});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.lock();});
    window.addEventListener('pagehide',()=>this.lock(false));
    setInterval(()=>{if(this.vault && !this.session.isUnlocked() && !['locked','fatal'].includes(this.page))this.lock();},1000);
  }
  private clearTransient():void {this.privateQuote=undefined;this.privateReview=undefined;this.privateGroup=undefined;this.backup=undefined;this.generated=undefined;this.quiz=[];this.quizStep=0;this.quizSelected='';this.draft=undefined;this.sendTo='';this.sendAmount='';clearTimeout(this.viewTimer);clearTimeout(this.setupTimer);}
  private lock(render=true):void {
    this.privacyAbort?.abort();this.privacyResult=undefined;this.privateRecords=[];this.epoch++;this.operation++;this.session.lock();this.crypto.cancelAll();this.rpc.cancel();this.clearTransient();this.busy=false;this.error='';this.notice='';this.balance=undefined;
    this.page=this.vault?'locked':'welcome';if(render)this.render();else this.root.replaceChildren();
  }
  private guard(epoch:number):void {if(epoch!==this.epoch)throw new Error('操作已取消。');}
  private async task(work:(epoch:number)=>Promise<void>):Promise<void> {
    if(this.busy)return;this.busy=true;this.error='';this.notice='';const epoch=this.epoch;const op=++this.operation;
    this.setBusy(true);
    try{await work(epoch);}catch(e){if(epoch===this.epoch)this.error=safeError(e);}
    finally{if(epoch===this.epoch && op===this.operation){this.busy=false;this.render();}}
  }
  private setBusy(value:boolean,message=' 正在本地处理，请稍候…'):void {
    for(const button of this.root.querySelectorAll('button,select')) if(!button.hasAttribute('data-lock'))(button as HTMLButtonElement).disabled=value;
    if(value){const status=el('div',{class:'status',role:'status'},el('span',{class:'spinner'}),message);this.activeContent?.append(status);}
  }
  private go(page:string):void {
    if(this.busy)return;
    if(this.vault && !this.session.isUnlocked()){this.lock();return;}
    if(!['backup','quiz','password'].includes(page)){this.generated=undefined;clearTimeout(this.setupTimer);}
    if(page==='backup' || !['quiz','password'].includes(page)){this.quiz=[];this.quizStep=0;this.quizSelected='';}
    this.page=page;this.error='';this.notice='';this.backup=undefined;clearTimeout(this.viewTimer);this.render();
  }
  private toast(text:string):void {const node=el('div',{class:'toast',role:'status'},text);this.root.append(node);setTimeout(()=>node.remove(),2200);}
  private copyAddress():void {
    if(!this.vault)return;
    void navigator.clipboard.writeText(this.vault.address).then(()=>this.toast('已复制地址，请在收款方再次核对完整地址。')).catch(()=>this.toast('无法复制，请手动选择完整地址。'));
  }
  private authAllowed():void {if(Date.now()<this.retryAfter)throw new Error(`请等待 ${Math.ceil((this.retryAfter-Date.now())/1000)} 秒后再试。`);}
  private authFailed():void {this.authFailures++;this.retryAfter=Date.now()+Math.min(60_000,1000*2**Math.min(this.authFailures-1,6));}
  private async unlock(password:string,epoch:number):Promise<void> {
    this.authAllowed();
    try{
      const current=await this.store.loadVault();this.guard(epoch);
      if(!current)throw new Error('钱包文件无效。');this.vault=current;
      const {key}=await this.crypto.run<{key:CryptoKey}>({op:'unlock',vault:current,password});this.guard(epoch);
      this.authFailures=0;this.session.unlock(key);this.page='home';this.showBalanceLoading();
      await this.loadBalance(epoch);
    }catch(e){if(this.page==='locked')this.authFailed();throw e;}
  }
  private async persistCreated(result:{vault:Vault;key:CryptoKey},epoch:number):Promise<void> {
    await this.store.saveVault(result.vault);
    this.vault=result.vault;
    // Storage may commit while the popup is hiding/locking. Never reopen that session.
    if(epoch!==this.epoch){this.lock();return;}
    this.session.unlock(result.key);this.clearTransient();this.page='home';this.showBalanceLoading();await this.loadBalance(epoch);
  }
  private showBalanceLoading():void {
    this.render();this.setBusy(true,'正在连接节点并加载余额…');
  }
  private async loadBalance(epoch:number):Promise<void> {
    this.balance=undefined;const token=this.session.token();
    await this.rpc.connect();this.guard(epoch);this.session.assert(token);
    if(!this.codec)this.codec=await ChainCodec.load(this.rpc.network);
    const balance=await readAccount(this.rpc,this.codec,this.vault!.address);
    this.guard(epoch);this.session.assert(token);this.balance=balance;
  }
  private header():HTMLElement {
    const language=el('select',{class:'language-select','aria-label':'Language / 语言'},el('option',{value:'en'},'English'),el('option',{value:'zh-CN'},'简体中文'));
    language.value=getLocale();language.disabled=this.busy;
    language.addEventListener('change',()=>{
      if(this.busy)return;
      const selected=language.value==='zh-CN'?'zh-CN':'en';
      void this.task(async()=>{
        try{if(this.store.saveLocale)await this.store.saveLocale(selected);else localStorage.setItem('quantus-vault-locale',selected);}
        catch{throw new Error(t('语言偏好保存失败，请重试。'));}
        setLocale(selected);
      });
    });
    const network=this.vault && !['locked','fatal'].includes(this.page)?btn(this.network==='planck'?'PLANCK 测试网':'QTC 主网',()=>this.go('network'),'network-pill'):null;
    return el('header',{class:'topbar'},el('div',{class:'brand'},el('div',{class:'mark','aria-hidden':'true'}),el('div',{},el('div',{class:'wordmark'},'QUANTUS'),el('small',{},'INDEPENDENT WALLET'))),el('div',{class:'header-controls'},network,language));
  }
  private footer():HTMLElement {return el('footer',{class:'footer'},el('span',{class:'row'},icon('shield'),'密钥仅在本机处理'),el('span',{},'独立开发 · v0.1.16'));}
  private title(text:string,back='home'):HTMLElement {return el('div',{class:'subhead'},el('button',{type:'button',class:'icon-button','aria-label':'返回',onClick:()=>this.go(back)},icon('back')),el('h1',{},text));}
  private passField(label='解锁密码',placeholder='至少 8 个字符'):ReturnType<typeof field>{return field(label,{type:'password',placeholder,minlength:MIN_PASSWORD_LENGTH,maxlength:256,'aria-label':label});}
  private checkbox(text:string):{node:HTMLLabelElement;input:HTMLInputElement}{const input=el('input',{type:'checkbox'});return {input,node:el('label',{class:'check-row'},input,el('span',{},text))};}
  render():void {
    const content=el('main',{class:'content'});this.activeContent=content;
    const shell=el('div',{class:'shell'},this.header(),content);
    if(this.error)content.append(el('div',{class:'error',role:'alert'},this.error));
    if(this.notice)content.append(el('div',{class:'note green',role:'status'},this.notice));
    switch(this.page){
      case'welcome':this.welcome(content);break;
      case'create':case'import':this.createForm(content);break;
      case'backup':this.backupScreen(content);break;
      case'quiz':this.quizScreen(content);break;
      case'password':this.passwordScreen(content);break;
      case'locked':this.locked(content);break;
      case'home':this.home(content);break;
      case'receive':this.receive(content);break;
      case'send':this.send(content);break;
      case'review':this.review(content);break;
      case'settings':this.settings(content);break;
      case'privacy':this.privacyScreen(content);break;
      case'private-send':this.privateSendScreen(content);break;
      case'network':this.networkScreen(content);break;
      case'reveal':this.reveal(content);break;
      case'history':this.history(content);break;
      case'fatal':content.append(el('h1',{class:'heading'},'钱包无法打开'),el('p',{class:'description'},'请保留现有扩展数据，不要卸载或覆盖。核对安装文件与备份后重试。'));break;
    }
    if(['home','history','settings'].includes(this.page))shell.append(el('nav',{class:'nav','aria-label':'钱包导航'},btn('资产',()=>this.go('home'),this.page==='home'?'active':'','wallet'),btn('活动',()=>this.go('history'),this.page==='history'?'active':'','clock'),btn('安全',()=>this.go('settings'),this.page==='settings'?'active':'','shield')));
    else shell.append(this.footer());
    this.root.replaceChildren(shell);
  }
  private welcome(c:HTMLElement):void {
    c.append(el('div',{class:'hero'},el('div',{class:'wave cross'}),el('div',{class:'orb'},icon('shield'))),el('div',{class:'eyebrow center'},'YOUR KEYS. YOUR QUANTUS.'),el('h1',{class:'heading center'},'资产由你掌握。'),el('p',{class:'description center'},'为 Quantus 网络打造的独立插件钱包。\n密钥由你保管，每一笔转账由你确认。'),el('div',{class:'stack'},btn('创建新钱包',()=>this.go('create'),'button primary','plus'),btn('导入已有钱包',()=>this.go('import'),'button secondary')),el('p',{class:'safety-line'},icon('lock'),'本地加密 · 关闭即锁定 · 无数据追踪'),el('div',{class:'note',style:undefined},'助记词是恢复钱包的唯一凭据，请妥善离线保管。'));
  }
  private createForm(c:HTMLElement):void {
    const imported=this.page==='import';
    c.append(this.title(imported?'导入钱包':'创建钱包','welcome'),el('div',{class:'steps'},el('div',{class:'step active'}),el('div',{class:'step'}),el('div',{class:'step'})),el('p',{class:'description'},imported?'恢复普通账户地址。支持英文 12 / 24 词及账户索引；暂不支持 BIP39 附加口令和加密账户。':'先生成并离线备份 24 个单词，再设置本机解锁密码。助记词是恢复钱包的唯一凭据。'));
    const form=el('form',{});
    let mnemonic:HTMLTextAreaElement|undefined;
    let index:HTMLInputElement|undefined;
    if(imported){const recovery=mnemonicInput();mnemonic=recovery.input;form.append(recovery.row);const f=field('账户索引',{type:'number',value:'0',min:0,max:1000});index=f.input;form.append(f.row,el('p',{class:'hint'},'官方钱包的首个普通账户通常为 0。导入后请核对完整地址。'));}
    const pass=this.passField();const repeat=this.passField('再次输入密码');const accept=this.checkbox('我了解助记词无法找回，并会妥善保管离线备份。');
    if(imported)form.append(pass.row,repeat.row);form.append(accept.node);
    const submit=el('button',{type:'submit',class:'button primary'},imported?'加密并导入':'生成助记词');form.append(submit);
    form.addEventListener('submit',e=>{
      e.preventDefault();
      const password=pass.input.value;const repeated=repeat.input.value;const phrase=mnemonic?.value??'';const accountIndex=Number(index?.value??0);const checked=accept.input.checked;
      void this.task(async epoch=>{
        if(imported){requirePassword(password);if(password!==repeated)throw new Error('两次输入的密码不一致。');}if(!checked)throw new Error('请先阅读并确认助记词保管说明。');
        if(imported){
          pass.input.value='';repeat.input.value='';if(mnemonic)mnemonic.value='';
          const result=await this.crypto.run<{vault:Vault;key:CryptoKey}>({op:'create',mnemonic:phrase,password,accountIndex});this.guard(epoch);
          await this.persistCreated(result,epoch);
        }else{
          // Set the password only after the user has verified their offline backup.
          pass.input.value='';repeat.input.value='';
          const result=await this.crypto.run<{mnemonic:string}>({op:'generate'});this.guard(epoch);
          this.generated=result.mnemonic;this.mnemonicIndex=0;this.page='backup';this.setupTimer=setTimeout(()=>this.lock(),120_000);
        }
      });
    });c.append(form);
  }
  private backupScreen(c:HTMLElement):void {
    if(!this.generated){this.page='welcome';return;}
    c.append(this.title('备份助记词','welcome'),el('div',{class:'steps'},el('div',{class:'step active'}),el('div',{class:'step active'}),el('div',{class:'step'})),el('div',{class:'note accent'},'按顺序抄写到离线纸张。任何拿到这些单词的人都能控制资产。请勿截图、上传或发送给他人。'));
    const words=el('div',{class:'words'});this.generated.split(' ').forEach((word,i)=>words.append(el('div',{class:'word'},el('span',{},String(i+1).padStart(2,'0')),word)));c.append(words);
    const check=this.checkbox('我已在离线位置按顺序备份全部 24 个单词。');const next=btn('验证备份',()=>{if(!check.input.checked){this.toast('请完成离线备份。');return;}this.quiz=createBackupQuiz(this.generated!);this.quizStep=0;this.quizSelected='';this.page='quiz';this.error='';this.render();});c.append(check.node,next);
  }
  private quizScreen(c:HTMLElement):void {
    if(!this.generated || this.quiz.length!==3){this.go('backup');return;}
    const question=this.quiz[this.quizStep];if(!question){this.page='password';this.passwordScreen(c);return;}
    c.append(this.title('确认备份','backup'),el('div',{class:'quiz-progress','aria-label':`备份验证，第 ${this.quizStep+1} 步，共 3 步`},...this.quiz.map((_,i)=>el('span',{class:i<=this.quizStep?'quiz-dot active':'quiz-dot'},String(i+1)))),el('p',{class:'description'},'查看你的离线备份，从下方选择对应位置的单词。'),el('div',{class:'quiz-prompt'},el('span',{class:'mini-label'},`第 ${this.quizStep+1} / 3 项`),el('h2',{},`第 ${question.position+1} 个单词是什么？`)),el('div',{class:'quiz-answer','aria-live':'polite'},this.quizSelected||'请选择一个单词'));
    const choices=el('div',{class:'quiz-choices','aria-label':'候选单词'});
    for(const word of question.choices)choices.append(el('button',{type:'button',class:this.quizSelected===word?'quiz-choice selected':'quiz-choice','aria-pressed':String(this.quizSelected===word),onClick:()=>{this.quizSelected=word;this.error='';this.render();}},word));
    const next=btn(this.quizStep===2?'完成验证':'下一步',()=>{
      if(!this.quizSelected)return;
      if(this.generated!.split(' ')[question.position]!==this.quizSelected){this.error='单词不匹配，请核对离线备份后重新选择。';this.quizSelected='';this.render();return;}
      this.quizStep++;this.quizSelected='';this.error='';if(this.quizStep===3){this.quiz=[];this.page='password';}this.render();
    });next.disabled=!this.quizSelected;c.append(choices,next,el('p',{class:'hint quiz-hint'},'选错可以重新选择，确认正确后继续。'));
  }
  private passwordScreen(c:HTMLElement):void {
    if(!this.generated || this.quizStep!==3){this.go('backup');return;}
    c.append(this.title('设置解锁密码','backup'),el('div',{class:'note green'},'备份验证完成'),el('p',{class:'description'},'设置仅用于本机解锁的密码。忘记密码时，仍需使用助记词恢复钱包。'));
    const form=el('form',{});const pass=this.passField();const repeated=this.passField('再次输入密码');form.append(pass.row,repeated.row,el('button',{class:'button primary',type:'submit'},'加密保存，进入钱包'));
    form.addEventListener('submit',e=>{e.preventDefault();const phrase=this.generated!;const password=pass.input.value;const match=repeated.input.value;
      void this.task(async epoch=>{
        if(this.quizStep!==3 || !phrase)throw new Error('请先完成备份验证。');requirePassword(password);if(password!==match)throw new Error('两次输入的密码不一致。');pass.input.value='';repeated.input.value='';
        const result=await this.crypto.run<{vault:Vault;key:CryptoKey}>({op:'create',mnemonic:phrase,password,accountIndex:0});this.guard(epoch);await this.persistCreated(result,epoch);
      });
    });c.append(form);
  }
  private locked(c:HTMLElement):void {
    c.append(el('div',{class:'hero'},el('div',{class:'wave cross'}),el('div',{class:'orb'},icon('lock'))),el('div',{class:'eyebrow center'},'LOCAL VAULT · LOCKED'),el('h1',{class:'heading center'},'欢迎回来。'),el('p',{class:'description center'},'钱包已锁定。输入密码后在本机解锁。'));
    const form=el('form',{});const password=this.passField('解锁密码','输入本机解锁密码');form.append(password.row,el('button',{type:'submit',class:'button primary'},'解锁钱包'));
    form.addEventListener('submit',e=>{e.preventDefault();const value=password.input.value;password.input.value='';void this.task(epoch=>this.unlock(value,epoch));});c.append(form,el('p',{class:'safety-line'},icon('shield'),'关闭窗口或闲置 2 分钟后自动锁定'),el('p',{class:'description center'},'忘记密码？请保留助记词备份。钱包无法替你找回密码。'));
  }
  private home(c:HTMLElement):void {
    const addr=this.vault!.address;
    const amount=this.balance?formatAmount(this.balance.free):'—';
    const b=btn('',()=>{this.hideBalance=!this.hideBalance;this.render();},'text-link','eye');b.setAttribute('aria-label',t(this.hideBalance?'显示余额':'隐藏余额'));
    const lock=btn('',()=>this.lock(),'icon-button','lock');lock.setAttribute('aria-label',t('锁定钱包'));lock.setAttribute('data-lock','');
    c.append(el('div',{class:'accountbar'},el('div',{},el('span',{class:'account-name'},`账户 ${this.vault!.accountIndex+1}`),btn(short(addr),()=>this.copyAddress(),'address-mini','copy')),lock),el('section',{class:'balance-wrap'},el('div',{class:'wave'}),el('div',{class:'balance-label'},'普通账户余额',b),el('div',{class:amount.length>12?'balance long':'balance'},this.hideBalance?'••••••':amount),el('div',{class:'symbol'},this.rpc.network.symbol),el('div',{class:'balance-meta'},this.balance?`可转余额 ${this.hideBalance?'••••':formatAmount(this.balance.spendable)} ${this.rpc.network.symbol} · 另需预留手续费`:'尚未获取余额，联网后可刷新')),el('div',{class:'actions'},btn('发送',()=>this.go('send'),'button primary','arrow'),btn('接收',()=>this.go('receive'),'button secondary','down')));
    c.append(el('div',{class:'divider'}),el('div',{class:'row between'},el('span',{class:'mini-label'},'NETWORK STATUS'),el('div',{class:'connection'},el('span',{class:this.balance?'dot':'dot amber'}),this.balance?`区块 ${this.balance.block.toLocaleString('en-US')}`:'未连接',el('button',{type:'button',class:'text-link','aria-label':'刷新余额',onClick:()=>void this.task(e=>this.loadBalance(e))},icon('refresh')))),el('div',{class:'tabs'},btn('资产',()=>{this.showActivity=false;this.render();},this.showActivity?'tab':'tab active'),btn('最近活动',()=>{this.showActivity=true;this.render();},this.showActivity?'tab active':'tab')));
    if(this.showActivity)this.txList(c,3);
    else c.append(el('div',{class:'asset-row'},el('div',{class:'asset-icon'},'Q'),el('div',{class:'asset-info'},el('strong',{},this.network==='planck'?'Planck':'Quantus'),el('small',{},this.network==='planck'?'测试网络 · 无真实价值':'主网络 · QTC')),el('div',{class:'asset-total'},this.hideBalance?'••••':amount,el('div',{class:'symbol'},this.rpc.network.symbol))));
    c.append(el('div',{class:'note'},this.network==='planck'?'当前网络为 Planck，资产单位为 PLK。收款前请核对网络。':'当前网络为 Quantus 主网，资产单位为 QTC。收款前请核对网络。'));
  }
  private receive(c:HTMLElement):void {
    c.append(this.title('接收资产'),el('div',{class:'eyebrow center'},this.network==='planck'?'PLANCK TESTNET · PLK':'QUANTUS MAINNET · QTC'),el('p',{class:'description center'},'请与发送方核对网络和完整地址。'));
    const canvas=el('canvas',{'aria-label':'收款地址二维码',role:'img'});c.append(el('div',{class:'qr-wrap'},canvas),el('span',{class:'mini-label'},'你的普通账户地址'),el('code',{class:'address-full'},this.vault!.address),el('div',{class:'stack'},btn('复制完整地址',()=>this.copyAddress(),'button primary','copy')),el('p',{class:'description'},this.network==='planck'?'此处接收 PLK 测试币。主网和测试网地址格式相同，二维码本身不区分网络。':'此处接收 QTC 主网资产。主网和测试网地址格式相同，请核对发送网络。'));
    void QRCode.toCanvas(canvas,this.vault!.address,{width:188,margin:1,errorCorrectionLevel:'M',color:{dark:'#121410',light:'#f9f6ed'}}).catch(()=>{canvas.replaceWith(el('p',{},'二维码生成失败，请使用完整地址。'));});
  }
  private send(c:HTMLElement):void {
    c.append(this.title('发送 '+this.rpc.network.symbol));
    c.append(el('div',{class:'eyebrow'},this.rpc.network.name),el('p',{class:'description'},'普通公开转账。我们会先校验地址并查询手续费，下一步再由你确认。'));
    const form=el('form',{});const to=field('收款地址',{type:'text',placeholder:'粘贴完整 q 开头地址',value:this.sendTo,maxlength:64});const amount=field('发送金额 · '+this.rpc.network.symbol,{type:'text',inputmode:'decimal',placeholder:'0.00',value:this.sendAmount,maxlength:22});
    form.append(to.row,amount.row,el('p',{class:'hint'},`可转余额 ${this.balance?formatAmount(this.balance.spendable):'—'} ${this.rpc.network.symbol}，另需预留手续费。`),el('div',{class:'note'},'自动保留账户最低存款。只发送普通转账，不支持加密账户、跨链或合约调用。'),el('button',{type:'submit',class:'button primary'},'核对交易'));
    form.addEventListener('submit',e=>{e.preventDefault();this.sendTo=to.input.value.trim();this.sendAmount=amount.input.value;
      void this.task(async epoch=>{
        const token=this.session.token();this.session.assert(token);
        {if(this.records.some(r=>r.from===this.vault!.address&&r.network===this.network&&['broadcasting','submitted','uncertain'].includes(r.state)))throw new Error('有交易结果尚未确认。请先在活动页检查，避免重复转账。');await this.loadBalance(epoch);this.draft=await prepareTransfer(this.rpc,this.codec!,this.vault!.address,this.sendTo,this.sendAmount);}
        this.guard(epoch);this.session.assert(token);this.page='review';
      });
    });c.append(form);
  }
  private detail(label:string,value:string,amount=false):HTMLElement{return el('div',{class:amount?'detail amount':'detail'},el('span',{class:'label'},label),el('span',{class:['从','发送至'].includes(label)?'value address-review':'value'},value));}
  private review(c:HTMLElement):void {
    const d=this.draft;if(!d){this.page='send';this.send(c);return;}
    c.append(this.title('确认这笔转账','send'),el('div',{class:'note accent'},'请核对完整地址。网络费以上链时的实际计算为准，预留额不是链上硬上限。交易有效期为 16 个区块。'),el('div',{class:'detail-list'},this.detail('发送金额',`${formatAmount(d.amount)} ${this.rpc.network.symbol}`,true),this.detail('网络',this.rpc.network.name),this.detail('从',d.from),this.detail('发送至',d.to),this.detail('预计网络费',`${formatAmount(d.fee)} ${this.rpc.network.symbol}`),this.detail('预留网络费（预计费 + 20%）',`${formatAmount(d.feeLimit)} ${this.rpc.network.symbol}`),this.detail('预计支出（含预留费）',`${formatAmount(BigInt(d.amount)+BigInt(d.feeLimit))} ${this.rpc.network.symbol}`)));
    const form=el('form',{});const pass=this.passField('输入密码以确认签名','再次验证本机解锁密码');const check=this.checkbox('我已核对网络、完整收款地址、金额与网络费预估。');form.append(pass.row,check.node,el('button',{class:'button primary',type:'submit'},'确认并发送'));
    form.addEventListener('submit',e=>{e.preventDefault();const password=pass.input.value;const checked=check.input.checked;pass.input.value='';void this.task(async epoch=>{
      if(!checked)throw new Error('请先核对并勾选交易确认。');this.authAllowed();
      const token=this.session.token();
      const assertActive=()=>{this.guard(epoch);this.session.assert(token);};
      try {
        const record=await submitReviewedTransfer(d,{
          store:this.store,assertActive,
          recheck:()=>recheckDraft(this.rpc,this.codec!,d),
          sign:async()=>{try{const {signed}=await this.crypto.run<{signed:string}>({op:'sign',vault:this.vault,password,draft:d});this.authFailures=0;return signed;}catch(e){this.authFailed();throw e;}},
          broadcast:signed=>this.rpc.broadcastOnce(signed)
        });
        assertActive();this.draft=undefined;this.page='history';
        this.notice=record.state==='submitted'?'节点已接收，仍需核实链上执行结果。':'广播结果不确定。请先检查交易状态，不要重复发送。';
      } finally {
        if(epoch===this.epoch)this.records=await this.store.history();
      }
    });});c.append(form);
  }
  private settings(c:HTMLElement):void {
    c.append(el('div',{class:'eyebrow'},'SECURITY CENTER'),el('h1',{class:'heading'},'安全，始于本机。'),el('p',{class:'description'},'每次签名重新验证密码。助记词不上传，解锁状态不跨窗口保存。'));
    for(const [name,title,description] of [['lock','自动锁定','关闭窗口即锁定 · 闲置 2 分钟锁定'],['shield','本地加密','AES-256-GCM · 密码派生 900,000 次'],['eye','最小权限','无网页读取权限 · 不注入网页 · 无追踪']])c.append(el('div',{class:'settings-row'},icon(name),el('div',{},el('strong',{},title),el('small',{},description))));
    c.append(el('div',{class:'stack'},btn('扫描隐私资产',()=>this.go('privacy'),'button secondary'),btn('查看助记词备份',()=>this.go('reveal'),'button secondary'),btn('网络与节点',()=>this.go('network'),'button secondary'),btn('立即锁定',()=>this.lock(),'button secondary','lock')),el('div',{class:'divider'}),el('div',{class:'note'},'Quantus Vault 为独立开发的钱包，不代表 Quantus 官方。'),el('p',{class:'hint'},'普通账户路径：m/44\'/189189\'/账户\'/0\'/0\'。加密账户、附加口令及网页连接暂不支持。'));
  }
  private privateJournal():PrivateJournal {
    if(!this.vault||!this.store.privateJournal)throw Error('Private journal storage unavailable');
    return new PrivateJournal(this.store.privateJournal(NETWORKS[this.network].genesis,this.vault.address),this.session.assert(this.session.token()),NETWORKS[this.network].genesis,this.vault.address);
  }
  private privacyScreen(c:HTMLElement):void {
    c.append(this.title('扫描隐私资产'),el('p',{class:'description'},'扫描当前网络的隐私收款和找零地址。官方索引器会看到查询地址与 IP。金额以已核验区块为准。'));
    const form=el('form',{class:'stack'}),password=this.passField('解锁密码','请输入本机密码');
    const range=field('至少扫描至地址索引',{type:'number',min:0,max:1000,value:'0'});
    form.append(range.row,password.row,btn('开始扫描',()=>{},'button primary'));(form.querySelector('button') as HTMLButtonElement).type='submit';
    form.addEventListener('submit',e=>{e.preventDefault();const value=password.input.value;password.input.value='';const through=Number(range.input.value);
      void this.task(async epoch=>{
        if(!Number.isSafeInteger(through)||through<0||through>1000)throw Error('账户索引无效。');
        this.authAllowed();this.privacyResult=undefined;const controller=new AbortController();this.privacyAbort=controller;
        try{const rows=this.store.privateJournal?await this.privateJournal().read():[];this.guard(epoch);this.privateRecords=rows;const recovery=privateRecoveryState(rows);const changeThrough=Math.max(through,recovery.changeThrough);const result=await this.scanPrivate({vault:this.vault!,password:value,network:this.network,signal:controller.signal,reserved:recovery.reserved,knownThrough:{0:through,1:changeThrough},maxIndex:Math.max(through,changeThrough)+20,onProgress:stage=>{if(epoch===this.epoch){const status=c.querySelector('[role="status"]');if(status)status.textContent=t(stage);}}});this.guard(epoch);this.privacyResult=result;this.authFailures=0;}catch(error){this.authFailed();throw error;}
        finally{controller.abort();if(this.privacyAbort===controller)this.privacyAbort=undefined;}
      });
    });c.append(form);const cancel=btn('取消扫描并锁定',()=>this.lock(),'button secondary');cancel.setAttribute('data-lock','');c.append(cancel);
    if(this.privacyResult)c.append(btn('准备隐私转账',()=>{this.privateQuote=undefined;this.privateReview=undefined;this.privateGroup=undefined;this.go('private-send');},'button secondary'));
    if(this.privacyResult){const r=this.privacyResult;c.append(el('div',{class:'detail-list'},this.detail('已核验未花费金额（未扣费用）',formatAmount(r.confirmedUnreservedBeforeFees)+' '+this.rpc.network.symbol),this.detail('已核验区块',String(r.discovery.checkpoint.height)),this.detail('已发现入账',String(r.credits.length)),this.detail('扫描范围状态',r.discovery.complete?'已完成当前地址范围':'范围未覆盖完整，请扩大扫描')));}
    if(this.privacyResult){
      const credits=this.privacyResult.credits;
      const reserved=credits.filter(r=>r.status==='reserved').reduce((sum,r)=>sum+BigInt(r.committedAmount),0n);
      c.append(this.detail('待确认交易占用',formatAmount(reserved.toString())+' '+this.rpc.network.symbol));
      for(const credit of credits.slice(-50).reverse())c.append(el('div',{class:'detail-list'},this.detail(credit.owner.branch===0?'隐私收款':'隐私找零',formatAmount(credit.committedAmount)+' '+this.rpc.network.symbol),this.detail('地址索引',String(credit.owner.index)),this.detail('区块',String(credit.block)),this.detail('资产状态',credit.status==='unspent'?'未花费':credit.status==='spent'?'已花费':'已占用')));
      if(credits.length>50)c.append(el('p',{class:'hint'},'仅列出最近 50 笔入账，余额包含扫描范围内全部已核验记录。'));
    }
    if(this.store.privateJournal)c.append(btn('检查隐私交易记录',()=>void this.task(async epoch=>{
      const token=this.session.token(),assertActive=()=>{this.guard(epoch);this.session.assert(token);};
      const controller=new AbortController();this.privacyAbort=controller;
      try{await this.rpc.connect();assertActive();const codec=await ChainCodec.load(this.rpc.network);assertActive();this.privateRecords=await refreshPrivateReceipts({journal:this.privateJournal(),rpc:this.rpc,codec,assertActive,signal:controller.signal});this.privacyResult=undefined;}
      finally{controller.abort();if(this.privacyAbort===controller)this.privacyAbort=undefined;}
    }),'button secondary'));
    for(const group of new Set(this.privateRecords.flatMap(r=>r.details?[r.details.group]:[])))c.append(btn('查看分批付款进度',()=>{this.privateGroup=group;this.privateReview=undefined;this.go('private-send');},'button secondary'));
    for(const row of this.privateRecords){
      const labels:Record<PrivatePending['state'],string>={prepared:'尚未广播',cancelled:'已取消准备',broadcasting:'正在确认广播结果',submitted:'等待最终确认',unknown:'结果不明，请勿重发',confirmed:'已最终确认',failed:'执行失败，输入继续保护'};
      const item=el('div',{class:'detail-list'},this.detail('隐私交易状态',labels[row.state]),this.detail('交易标识',row.hash),this.detail('找零地址索引',String(row.changeIndex)));
      if(row.state==='prepared')item.append(btn('取消未广播准备',()=>void this.task(async epoch=>{const token=this.session.token(),active=()=>{this.guard(epoch);this.session.assert(token);};const journal=this.privateJournal();await cancelPrivatePreparation(journal,row.planHash,active);this.privateRecords=await journal.read();active();this.privacyResult=undefined;}),'button secondary'));
      c.append(item);
    }
    c.append(el('div',{class:'note'},'此处仅查询隐私资产。隐私发送尚未开放；超过扫描范围的地址可能仍有资产。'));
  }
  private privateSendScreen(c:HTMLElement):void {
    c.append(this.title('隐私转账','privacy'),el('p',{class:'description'},'收款地址、输出金额、销毁标记和交易时间会公开。多批次付款不是原子交易，已确认部分无法撤回。'));
    if(!PRIVATE_BROADCAST_ENABLED)c.append(el('div',{class:'note'},'隐私广播尚未开放。可查看付款方案和生成本地证明，不会自动发送。'));
    if(location.protocol==='chrome-extension:'&&!new URLSearchParams(location.search).has('expanded'))c.append(btn('在完整页面中继续',()=>{void chrome.tabs.create({url:chrome.runtime.getURL('popup.html?expanded=1')});},'button secondary'));
    if(this.privateGroup){
      const group=this.privateGroup,rows=this.privateRecords.filter(r=>r.details?.group===group).sort((a,b)=>a.details!.index-b.details!.index);
      const confirmed=rows.filter(r=>r.state==='confirmed').reduce((n,r)=>n+BigInt(r.details!.amount),0n);
      c.append(this.detail('已最终确认金额',formatAmount(confirmed.toString())+' '+this.rpc.network.symbol));
      for(const row of rows){const d=row.details!;const item=el('div',{class:'detail-list'},this.detail('批次',`${d.index+1} / ${d.count}`),this.detail('收款地址',d.recipient),this.detail('金额',formatAmount(d.amount)),this.detail('费用',formatAmount(d.fee)),this.detail('找零',formatAmount(d.change)),this.detail('状态',({prepared:'尚未广播',cancelled:'已取消准备',broadcasting:'正在确认广播结果',submitted:'等待最终确认',unknown:'结果不明，请勿重发',confirmed:'已最终确认',failed:'执行失败，输入继续保护'} as const)[row.state]));
        if(row.state==='prepared'&&rows.filter(r=>r.details!.index<d.index).every(r=>r.state==='confirmed')){
          if(!this.privacyResult)item.append(el('p',{class:'hint'},'请先重新扫描资产，再继续未广播批次。'));
          else if(!this.privateReview){
            const form=el('form',{class:'stack'}),password=this.passField('解锁密码','请输入本机密码');form.append(password.row,el('button',{type:'submit',class:'button primary'},'生成本地证明'));
            form.addEventListener('submit',event=>{event.preventDefault();const value=password.input.value;password.input.value='';void this.task(async epoch=>{
              const token=this.session.token(),controller=new AbortController(),active=()=>{this.guard(epoch);this.session.assert(token);controller.signal.throwIfAborted();};this.privacyAbort=controller;
              try{active();this.authAllowed();const codec=await ChainCodec.load(this.rpc.network);await initPrivacy({module_or_path:new URL('quantus_privacy_keys_bg.wasm',location.href)});active();
                this.privateReview=await prepareReservedPrivateBatch({vault:this.vault!,password:value,rpc:this.rpc,codec,journal:this.privateJournal(),credits:this.privacyResult!.credits,amount:BigInt(d.amount),recipient:d.recipient,knownChangeThrough:row.changeIndex,signal:controller.signal,assertActive:active,verifyMerkle:verifyPrivacyMerkle,group,batchIndex:d.index,onStage:()=>{const status=c.querySelector('[role="status"]');if(status)status.textContent=t('正在本地生成证明，请保持页面打开。');}});active();
              }finally{controller.abort();if(this.privacyAbort===controller)this.privacyAbort=undefined;if(epoch===this.epoch){this.privateRecords=await this.privateJournal().read();this.guard(epoch);}}
            });});item.append(form);
          }
        }
        c.append(item);
      }
      if(this.privateReview){const review=this.privateReview;c.append(el('div',{class:'note green'},'本地证明已生成并验证。请核对本批收款地址、金额与费用。'),this.detail('收款地址',review.recipient),this.detail('本批金额',formatAmount(review.amount)),this.detail('本批费用',formatAmount(review.fee)));
        const send=btn('确认并发送本批',()=>void this.task(async epoch=>{
          const token=this.session.token(),controller=new AbortController(),active=()=>{this.guard(epoch);this.session.assert(token);controller.signal.throwIfAborted();};this.privacyAbort=controller;
          try{const codec=await ChainCodec.load(this.rpc.network);active();await sendPreparedPrivateTransfer(review,{rpc:this.rpc,codec,journal:this.privateJournal(),assertActive:active,signal:controller.signal,broadcast:encoded=>this.rpc.broadcastOnce(encoded)});active();}
          finally{this.privateReview=undefined;controller.abort();if(this.privacyAbort===controller)this.privacyAbort=undefined;if(epoch===this.epoch){this.privateRecords=await this.privateJournal().read();this.guard(epoch);}}
        }));send.disabled=!PRIVATE_BROADCAST_ENABLED;c.append(send);
      }
      if(rows.some(r=>r.state==='prepared'))c.append(btn('取消剩余未广播批次',()=>void this.task(async epoch=>{const token=this.session.token(),active=()=>{this.guard(epoch);this.session.assert(token);};const journal=this.privateJournal();await cancelRemainingPrivateBatches(journal,group,active);this.privateReview=undefined;this.privateRecords=await journal.read();active();}),'button secondary'));
      c.append(btn('返回扫描并检查确认结果',()=>{this.privateReview=undefined;this.go('privacy');},'button secondary'));
    }else if(!this.privacyResult)c.append(el('p',{class:'description'},'请先重新扫描资产，再继续未广播批次。'));
    else {
      const form=el('form',{class:'stack'}),to=field('收款地址',{value:this.privateQuote?.recipient??'',autocomplete:'off'}),amount=field('金额',{inputmode:'decimal',value:this.privateQuote?formatAmount(this.privateQuote.amount):'',placeholder:'0.00'});
      form.append(to.row,amount.row,el('button',{type:'submit',class:'button primary'},'查看分批方案'));form.addEventListener('submit',event=>{event.preventDefault();const recipient=to.input.value.trim(),value=amount.input.value;void this.task(async epoch=>{
        const token=this.session.token();this.privateQuote=undefined;const rows=await this.privateJournal().read(),codec=await ChainCodec.load(this.rpc.network);this.guard(epoch);this.session.assert(token);
        this.privateQuote=quotePrivateBatches(this.privacyResult!.credits,privateRecoveryState(rows).reserved,parseAmount(value),recipient,privacyEconomics(codec));
      });});c.append(form);
      if(this.privateQuote){const quote=this.privateQuote;c.append(el('div',{class:'detail-list'},this.detail('收款地址',quote.recipient),this.detail('总金额',formatAmount(quote.amount)),this.detail('总费用',formatAmount(quote.fee)),this.detail('总找零',formatAmount(quote.change)),this.detail('批次数量',String(quote.batches.length))));
        quote.batches.forEach((batch,index)=>c.append(el('div',{class:'detail-list'},this.detail('批次',`${index+1} / ${quote.batches.length}`),this.detail('金额',formatAmount(batch.amount)),this.detail('费用',formatAmount(batch.fee)),this.detail('找零',formatAmount(batch.change)))));
        c.append(btn('确认方案并预留资产',()=>void this.task(async epoch=>{
          const token=this.session.token(),active=()=>{this.guard(epoch);this.session.assert(token);};active();await this.rpc.verify();active();const result=this.privacyResult!;
          if(result.discovery.checkpoint.genesis!==this.rpc.network.genesis)throw Error('Private scan network mismatch');
          const known=Math.max(-1,...result.credits.filter(r=>r.owner.branch===1).map(r=>r.owner.index));
          this.privateGroup=await reservePrivateBatches({journal:this.privateJournal(),quote,knownChangeThrough:known,block:result.discovery.checkpoint.height,assertActive:active});active();this.privateRecords=await this.privateJournal().read();active();this.privateQuote=undefined;
        })));
      }
    }
    const lock=btn('取消操作并锁定',()=>this.lock(),'button secondary');lock.setAttribute('data-lock','');c.append(lock);
  }
  private networkScreen(c:HTMLElement):void {
    c.append(this.title('网络与节点'),el('p',{class:'description'},'仅连接已固定的官方节点，并核对网络身份。'));
    for(const id of ['mainnet','planck'] as NetworkId[]){const n=NETWORKS[id];c.append(el('div',{class:'detail-list'},this.detail(n.name,id==='planck'?'PLK · 收款与转账':'QTC · 收款与转账'),...n.endpoints.map(url=>this.detail('官方 HTTPS RPC',url)),this.detail('创世区块',n.genesis),btn(this.network===id?'当前网络':'切换到此网络',()=>void this.task(async epoch=>{this.rpc.cancel();this.privacyResult=undefined;this.privateRecords=[];this.privateQuote=undefined;this.privateReview=undefined;this.privateGroup=undefined;this.network=id;this.rpc=new Rpc(id);this.codec=undefined;this.balance=undefined;this.draft=undefined;this.page='home';await this.loadBalance(epoch);}),this.network===id?'button secondary':'button primary')));}
    c.append(el('p',{class:'description'},'节点会看到查询的公开地址和连接 IP。当前版本不接收自定义节点，避免连接到未经核验的网络。'));
  }
  private reveal(c:HTMLElement):void {
    c.append(this.title('查看助记词','settings'));
    if(this.backup){c.append(el('div',{class:'note accent'},'请勿截图或分享。此页面将在 30 秒后隐藏，切换窗口会立即锁定。'));const words=el('div',{class:'words'});this.backup.split(' ').forEach((word,i)=>words.append(el('div',{class:'word'},el('span',{},String(i+1)),word)));c.append(words,btn('隐藏助记词',()=>this.go('settings')));return;}
    c.append(el('p',{class:'description'},'只在私密环境中查看。再次验证本机密码后，显示时间为 30 秒。'));const form=el('form',{});const pass=this.passField('解锁密码','输入密码以查看备份');form.append(pass.row,el('button',{class:'button primary',type:'submit'},'验证并显示'));
    form.addEventListener('submit',e=>{e.preventDefault();const password=pass.input.value;pass.input.value='';void this.task(async epoch=>{this.authAllowed();const token=this.session.token();this.session.assert(token);try{const result=await this.crypto.run<{mnemonic:string}>({op:'reveal',vault:this.vault,password});this.guard(epoch);this.session.assert(token);this.backup=result.mnemonic;this.authFailures=0;this.viewTimer=setTimeout(()=>this.go('settings'),30_000);}catch(e){this.authFailed();throw e;}});});c.append(form);
  }
  private txList(c:HTMLElement,limit=50):void {
    const records=this.records.filter(r=>r.from===this.vault!.address && r.network===this.network).slice(0,limit);
    if(!records.length){c.append(el('div',{class:'empty'},icon('clock'),el('div',{},'这里还没有发送记录。',el('div',{},'你的下一笔转账，将从这里开始。'))));return;}
    for(const r of records){const labels={broadcasting:'广播结果待检查',submitted:'已广播 · 待确认',uncertain:'结果不确定',confirmed:'已确认成功',failed:'未成功',cancelled:'已取消 · 未广播'};c.append(el('div',{class:'tx'},el('div',{class:'row between'},el('span',{},'转出'),el('strong',{},`−${formatAmount(r.amount)} ${this.rpc.network.symbol}`)),el('small',{},`${short(r.to)} · ${labels[r.state]}`),el('span',{class:'hash'},r.hash),r.detail?el('small',{},r.detail):null));}
  }
  private history(c:HTMLElement):void {
    c.append(el('div',{class:'eyebrow'},'TRANSACTION ACTIVITY'),el('h1',{class:'heading'},'每一笔，都有记录。'),el('p',{class:'description'},'仅显示此扩展发起的交易。节点接收后仍需确认链上执行结果。'));this.txList(c);
    if(this.records.some(r=>r.from===this.vault!.address && r.network===this.network && ['broadcasting','submitted','uncertain'].includes(r.state)))c.append(btn('检查交易结果',()=>void this.task(async epoch=>{await this.loadBalance(epoch);const token=this.session.token();this.records=await refreshTransactionRecords(this.store,this.vault!.address,r=>r.network===this.network?checkReceipt(this.rpc,this.codec!,r):Promise.resolve({}),()=>{this.guard(epoch);this.session.assert(token);});this.notice='已完成检查。尚未确认的交易请勿重复发送。';}),'button secondary','refresh'));
    c.append(el('p',{class:'hint'},'记录存储在本机。卸载扩展将移除记录和钱包密文；链上记录不受影响。'));
  }
}
