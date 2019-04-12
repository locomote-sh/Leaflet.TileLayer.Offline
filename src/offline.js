// Copyright 2019 Locomote Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

L.TileLayer.Offline = L.TileLayer.extend({

    options: {
        /**
         * A unique ID for this tile layer. The ID is used in the pathname
         * for cached tiles; an alternative value only needs to be provided
         * if multiple layers are being used.
         */
        layer_id: 'layer',
        /**
         * Cached tile image format.
         */
        format: 'png',
        /**
         * If true, then only ever use tile images from the local cache,
         * and don't request missing tiles from the source server.
         */
        cacheOnly: false,
        /**
         * If true, then use scaled versions of available tiles as fallbacks
         * for missing tiles.
         */
        useScaledFallback: true,
        /**
         * The location which cached tiles are stored under.
         */
        cachePath: 'offline_map_tiles',
        /**
         * Minimum zoom.
         */
        minNativeZoom: 0
    },

    initialize: function( sourceLayer, options ) {
        Object.assign( this.options, options );
        // Standard path pattern for offline cached tiles.
        this._url = '{cachePath}/{layer_id}/{z}-{x}-{y}.{format}';
        // Source tile layer.
        this._sourceLayer = sourceLayer;
        // Bind methods from prototype that we want to override.
        this._createTile = L.TileLayer.prototype.createTile.bind( this );
        this.__tileOnError = L.TileLayer.prototype._tileOnError.bind( this );
        // Database of available offline tile URLs.
        this._offlineTiles = new Set();
    },

    /**
     * Load the database of available offline tile URLs. This is done to avoid
     * generating a 404 request for tiles which aren't offline available, and
     * to improve overall performance; NOTE that offline tiles won't be used if
     * this isn't called first!
     */
    loadCacheDB: async function() {
        const { options: { cachePath, layer_id } } = this;
        const url = `query.api?path$prefix=${cachePath}/${layer_id}&$format=keys`;
        const response = await fetch( url );
        const tilePaths = await response.json();
        this._offlineTiles = new Set( tilePaths );
    },

    createTile: function( coords, done ) {

        // Create a tile in the standard way.
        const tile = this._createTile( coords, done );

        // Following needed by the fallback code (see _tileOnError):
        tile._originalCoords = coords;

        const { options: { cacheOnly } } = this;

        if( !cacheOnly ) {

            // Read the source layer's URL for this tile.
            // Note hack here to ensure source layer knows the base zoom level.
            const { _sourceLayer, _tileZoom } = this;
            _sourceLayer._tileZoom = _tileZoom;
            const sourceURL = _sourceLayer.getTileUrl( coords );

            // If the tile doesn't have a URL (because no offline tile
            // available) then use the source layer's URL.
            const { src } = tile;
            if( src === '' ) {
                tile.src = sourceURL;
                _source_url = null;
            }
            else {
                // Set source tile layer url on result. Code in error handler
                // will attempt to load this url if no cached tile is found.
                tile._source_url = _sourceLayer.getTileUrl( coords );
            }
        }

        // Set the url we're about to load on an additional property.
        // This is used in the error handler to detect when the cached
        // tile has failed to load.
        tile._src = tile.src;

        return tile;
    },

    /**
     * Get the *offline* tile URL.
     */
    getTileUrl: function( coords ) {

        // Get x, y, z coordinates.
        const { x, y, z = this._getZoomForUrl() } = coords;

        // Other stuff we need.
        const { _id, _url, _offlineTiles, _sourceLayer, options } = this;

        // Evaluate the path pattern template.
        const url = L.Util.template( _url, L.extend({ x, y, z }, options ) );

        // See if the URL exists in the offline tile DB.
        if( _offlineTiles.has( url ) ) {
            return url;
        }
        // No offline tile available.
        return '';
    },

    _tileOnError: function( done, tile, e ) {
        const { src, _src, _source_url } = tile;
        const { options: { cacheOnly, useScaledFallback } } = this;

        // Try loading tile from original source tile server if failed
        // to load from cache.
        if( _source_url && src !== _source_url ) {
            // Retry with source layer.
            tile.src = _source_url;
            return;
        }

        if( useScaledFallback ) {

            // Following code taken from https://github.com/ghybs/Leaflet.TileLayer.Fallback

            // 'this' is bound to the Tile Layer in L.TileLayer.prototype.createTile.
            const layer = this; 
            const originalCoords = tile._originalCoords;
            const currentCoords
                = tile._currentCoords 
                = tile._currentCoords || layer._createCurrentCoords( originalCoords );
            const fallbackZoom
                = tile._fallbackZoom
                = tile._fallbackZoom === undefined
                    ? originalCoords.z - 1
                    : tile._fallbackZoom - 1;
            const scale 
                = tile._fallbackScale
                = (tile._fallbackScale || 1) * 2;
            const tileSize = layer.getTileSize();
            const style = tile.style;

            // If no lower zoom tiles are available, fallback to errorTile.
            if( fallbackZoom < layer.options.minNativeZoom ) {
                return this.__tileOnError( done, tile, e );
            }

            // Modify tilePoint for replacement img.
            currentCoords.z = fallbackZoom;
            currentCoords.x = Math.floor( currentCoords.x / 2 );
            currentCoords.y = Math.floor( currentCoords.y / 2 );

            // Generate new src path.
            const fallbackURL = layer.getTileUrl( currentCoords );

            // Zoom replacement img.
            style.width  = (tileSize.x * scale) + 'px';
            style.height = (tileSize.y * scale) + 'px';

            // Compute margins to adjust position.
            const top = (originalCoords.y - currentCoords.y * scale) * tileSize.y;
            style.marginTop = (-top) + 'px';
            const left = (originalCoords.x - currentCoords.x * scale) * tileSize.x;
            style.marginLeft = (-left) + 'px';

            // Crop (clip) image.
            // `clip` is deprecated, but browsers support for `clip-path: inset()` is far behind.
            // http://caniuse.com/#feat=css-clip-path
            style.clip = `rect(${top}px ${left+tileSize.x}px ${top+tileSize.y}px ${left}px)`;

            layer.fire('tilefallback', {
                tile:           tile,
                url:            tile._src,
                urlMissing:     tile.src,
                urlFallback:    fallbackURL
            });

            tile.src = fallbackURL;

            return;
        }

        // Fallback to error tile.
        this.__tileOnError( done, tile, e );
    },

    /**
     * Take from https://github.com/ghybs/Leaflet.TileLayer.Fallback
     */
    _createCurrentCoords: function( originalCoords ) {
		const currentCoords = this._wrapCoords( originalCoords );
		currentCoords.fallback = true;
		return currentCoords;
	}

});

// Factory method.
L.tileLayer.offline = function( source, options ) {
    return new L.TileLayer.Offline( source, options );
}


