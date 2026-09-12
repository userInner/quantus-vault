# Quantus Vault

独立开发的 Quantus 浏览器插件钱包，采用 MIT 开源协议。**不是 Quantus 官方产品。**

## 安装

1. 从 [v0.1.15 发布页](https://github.com/userInner/quantus-vault/releases/tag/v0.1.15) 下载 `quantus-vault-extension-v0.1.15.zip`。不要把 GitHub 自动生成的源码压缩包当作插件安装包。
2. 解压后，确认 `quantus-vault-extension` 文件夹内有 `manifest.json`。
3. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`，开启开发者模式。
4. 点击“加载已解压的扩展程序”，选择上述文件夹。
5. 创建钱包或导入助记词，并离线保管备份。

更新时覆盖同一个插件文件夹，再点击扩展卡片上的“重新加载”。不要通过卸载来更新，卸载会删除本地钱包数据。目前只读取 v2 钱包格式，不迁移早期开发版本。

安装包包含运行所需的 JavaScript 和 WASM，不需要安装 Node.js 或 Rust。这是可手动加载的插件包，尚未上架浏览器扩展商店。

## 当前功能

- 默认英文，可切换简体中文；默认 Quantus 主网，可切换 Planck。
- 创建 24 词钱包、导入 12/24 词英文助记词、查询余额、收款地址及二维码。
- 普通公开转账：费用确认、本地签名、单次广播、最终确认记录。
- 本地加密：PBKDF2-SHA256 900,000 次，AES-256-GCM，密码至少 8 位。
- 关闭或隐藏页面立即锁定，闲置两分钟锁定。
- 两网隐私资产扫描，以及分批付款方案、预留资产、本地证明和未广播批次恢复。

**隐私实际广播仍关闭**，不能使用此版本完成隐私转账。尚未完成独立安全审计和有资金的端到端收付款验收；已有代码及自动测试不能替代这些验证。请查看 [功能状态](PRIVACY-STATUS.md) 和 [验证记录](VERIFICATION.md)。

## 源码构建

需要 Node.js 22+。预编译 WASM 和依赖许可随源码提供，正常构建不需要 Rust。

```sh
npm ci
npm run check
npm test
npm run build
```

完成后加载 `dist/` 文件夹。测试只使用公开样例，不会转移资金。更详细的构建说明见 [English README](README.md)。
