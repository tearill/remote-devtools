const path = require('path');
exports.BACKEND_JS_FILE = '/backend.js';

exports.CHII_FRONTEND_PATH = path.join(path.dirname(require.resolve('chii/package.json')), 'public/front_end');

exports.BACKEND_JS_PATH = '/ws-backend.js';
