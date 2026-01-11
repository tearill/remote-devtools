const path = require('path');

module.exports = {
	entry: {
        backend: './backend.js'
    },
	output: {
		path: path.resolve(__dirname, 'dist'),
        filename: '[name].js',
        library: 'RemoteDevtools',
        libraryTarget: 'umd'
	},
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    devtool: false, // 生产环境不需要 source map
    target: 'web',
    resolve: {
        extensions: ['.js', '.json'],
        fallback: {
            // 确保 node 模块在浏览器环境中正确处理
            "fs": false,
            "path": false,
            "util": false
        }
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: [
                            ['@babel/preset-env', {
                                targets: {
                                    browsers: ['> 1%', 'last 2 versions', 'not ie <= 8']
                                },
                                modules: false
                            }]
                        ],
                        plugins: [
                            '@babel/plugin-transform-runtime'
                        ]
                    }
                }
            }
        ]
    },
    plugins: [],
    optimization: {
        minimize: process.env.NODE_ENV === 'production'
    }
};