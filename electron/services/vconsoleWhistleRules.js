/**
 * vConsole 相关 Whistle 规则常量
 * 新增 CDN 映射时在此追加一项即可
 */

// unpkg 域名禁用缓存，便于调试时拉取最新脚本
const UNPKG_HOST_CACHE_RULE = 'https://unpkg.com disable://cache enable://capture';

/**
 * CDN URL → 本地 public 源文件 → 临时目录合并产物文件名
 * @type {Array<{ cdnUrl: string, sourceFile: string, combinedFile: string }>}
 */
const VCONSOLE_MAP_RULES = [
  {
    cdnUrl: 'https://unpkg.com/vconsole@3.15.1/dist/vconsole.min.js',
    sourceFile: 'vconsole.min.js',
    combinedFile: 'vconsole-combined.js'
  },
  {
    cdnUrl: 'https://cdn.bootcss.com/vConsole/3.2.0/vconsole.min.js',
    sourceFile: 'vconsole.min.3.2.0.js',
    combinedFile: 'vconsole-3.2.0-combined.js'
  }
];

module.exports = {
  UNPKG_HOST_CACHE_RULE,
  VCONSOLE_MAP_RULES
};
