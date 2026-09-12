if(new URLSearchParams(location.search).has('expanded'))document.body.classList.add('expanded');
import {t} from './i18n';
import { WalletApp } from './ui/app';
import { extensionStore } from './core/storage';
const root=document.querySelector<HTMLElement>('#app')!;
try { void new WalletApp(root,extensionStore()).init(); }
catch {root.textContent=t('请在已安装的 Quantus Vault 扩展中打开此页面。');}
