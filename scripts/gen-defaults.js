/* 从后台配置层生成服务端使用的默认值快照（保证服务端与前端同源）
   运行：node scripts/gen-defaults.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
global.window = global;
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window.localStorage = global.localStorage;
global.fetch = () => Promise.reject(new Error('offline'));

['assets/js/data.js', 'assets/js/core/config.js'].forEach(function (rel) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel });
});

const out = path.join(ROOT, 'server', 'defaults.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(global.HP.Config.DEFAULTS, null, 2), 'utf8');
console.log('已写入 ' + out + '（' + Object.keys(global.HP.Config.DEFAULTS).length + ' 个顶层配置项）');
