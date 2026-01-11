const fs = require('fs');
const path = require('path');

const {logger} = require('../utils');
const {BACKEND_JS_PATH, BACKEND_JS_FILE} = require('../constants');
const {sendFileStreamToResponse} = require('../utils');

module.exports = rootFolder => {
    return (req, res, next) => {
        if (BACKEND_JS_PATH !== req.origFilePath) {
            logger.debug('magic backend middleware out');

            next();
            return;
        }

        const absoluteFilePath = path.join(rootFolder, BACKEND_JS_FILE);
        fs.stat(absoluteFilePath, err => {
            if (!err) {
                res.setContentTypeHeaderByFilepath(absoluteFilePath);

                // 发送 backend.js
                sendFileStreamToResponse(absoluteFilePath, res, next);
            } else {
                const notfound = ['ENOENT', 'ENAMETOOLONG', 'ENOTDIR'];
                if (notfound.includes(err.code)) {
                    err.status = 404;
                } else {
                    err.status = 500;
                }
                next(err);
            }
        });
    };
};