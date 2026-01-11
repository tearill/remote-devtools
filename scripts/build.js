#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const config = require('../webpack.config.js');

console.log('🔨 Building Remote Devtools with Webpack...');

// 创建 dist 目录
const distDir = path.resolve(__dirname, '../dist');
if (!fs.existsSync(distDir)) {
	fs.mkdirSync(distDir, { recursive: true });
	console.log('📃 Created dist directory');
}

// 运行 webpack 打包
webpack(config, (err, stats) => {
	if (err) {
		console.error('🚨 Webpack build failed:', err);
		process.exit(1);
	}

	if (stats.hasErrors()) {
		console.error('🚨 Build completed with errors:');
		console.error(stats.toString({ colors: true, chunks: false }));
		process.exit(1);
	}

	if (stats.hasWarnings()) {
		console.warn('⚠️ Build completed with warnings:');
		console.warn(stats.toString({ colors: true, chunks: false }));
	}

	console.log('🎉 Webpack build completed successfully');

	// 赋值其他必要的静态文件
	const publicDir = path.resolve(__dirname, '../public');
	const distPublicDir = path.resolve(distDir, 'public');

	if (fs.existsSync(publicDir)) {
		// 递归复制 public 目录
		function copyDir(src, dest) {
			if (!fs.existsSync(dest)) {
				fs.mkdirSync(dest, { recursive: true });
			}

			const entries = fs.readdirSync(src, { withFileTypes: true });
			for (const entry of entries) {
				const srcPath = path.join(src, entry.name);
				const destPath = path.join(dest, entry.name);

				if (entry.isDirectory()) {
					copyDir(srcPath, destPath);
				}
				else {
					fs.copyFileSync(srcPath, destPath);
				}
			}
		}

		copyDir(publicDir, distPublicDir);
		console.log('✅ Copied public/ directory to dist/');
	}

	console.log('🎉 Build completed successfully');
	console.log('Build output:');
	console.log('  - dist/backend.js (wepback bundled with chobistu)');
	console.log('  - dist/public/ (static files)');
});