const Path = require('path');

const { version } = require('./package.json');

const outputPath = Path.join( __dirname, 'dist', version );

module.exports = {
    mode: 'production',
    entry: './src/offline.js',
    output: {
        path: outputPath,
        filename: 'Leaflet.TileLayer.Offline.js'
    }
};

