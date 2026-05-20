#!/usr/bin/env node

/**
 * 打包脚本包装器
 * - 按平台独立记录上次打包版本，互不干扰
 * - 通过 --config.extraMetadata.version 注入版本号，不修改 package.json
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { version } = require('../electron/services/appVersion');

const args = process.argv.slice(2);

// 识别平台参数，无平台参数时视为全平台构建
const PLATFORMS = ['--mac', '--win', '--linux'];
const platformArg = args.find((a) => PLATFORMS.includes(a));
const platformKey = platformArg ? platformArg.replace('--', '') : 'all';

// 每个平台独立的版本记录文件
const flagFile = path.join(__dirname, `../.last-build-version-${platformKey}`);

// 检查当前版本是否已在该平台构建过
let lastVersion = null;
if (fs.existsSync(flagFile)) {
  lastVersion = fs.readFileSync(flagFile, 'utf8').trim();
}

if (lastVersion && version === lastVersion) {
  console.error(`\n❌ 打包被阻止：${platformKey} 平台的版本号未更新！`);
  console.error(`   当前版本：${version}（与上次 ${platformKey} 构建相同）`);
  console.error('   请先修改 electron/services/appVersion.js 中的版本号\n');
  process.exit(1);
}

console.log(
  `✅ 版本检查通过 [${platformKey}]：${lastVersion ? lastVersion + ' → ' + version : '首次打包 ' + version}`
);

// 构建命令
const cmd = [
  'electron-builder',
  platformArg,
  `--config.extraMetadata.version=${version}`,
  `--config.directories.output=release/${version}`
].filter(Boolean).join(' ');

console.log(`📦 打包版本：${version}  平台：${platformKey}`);
console.log(`▶  ${cmd}\n`);

execSync(cmd, { stdio: 'inherit' });

// 构建成功后记录本次版本，下次同平台重复构建时拦截
fs.writeFileSync(flagFile, version, 'utf8');
console.log(`✅ 已记录 ${platformKey} 平台打包版本：${version}`);
