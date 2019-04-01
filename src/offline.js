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
        layer_id: 'default',
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
        useScaledFallback: true
    },

    initialize: function( sourceLayer, options ) {
        Util.setOptions( this, options );
        // Standard path pattern for offline cached tiles.
        this._url = 'offline_map_tiles/{layer_id}/{z}/{x}-{y}.{format}';
        // Source tile layer.
        this._sourceLayer = sourceLayer;
    },

    createTile: function( coords, done ) {

        // Create a tile in the standard way.
        const tile = super.createTile( coords, done );

        // Set the url we're about to load on an additional property.
        // This is used in the error handler to detect when the cached
        // tile has failed to load.
        tile._src = tile.src;

        // Set source tile layer url on result. Code in error handler
        // will attempt to load this url if no cached tile is found.
        // Note hack here to ensure source layer knows the base zoom level.
        const { _sourceLayer, _tileZoom } = this;
        _sourceLayer._tileZoom = _tileZoom;
        tile._source_url = _sourceLayer.getTileUrl( coords );

        return tile;
    },

    getTileUrl: function( coords ) {

        // Get x, y, z coordinates.
        const { x, y, z = this._getZoomForUrl() } = coords;

        // Other stuff we need.
        const { _id, _url, options } = this;

        // Evaluate the path pattern template.
        return L.Util.template( _url, L.extend({ x, y, z }, options ) );
    },

    _tileOnError: function( done, tile, e ) {
        const { src, _src, _source_url } = tile;
        const { options: { cacheOnly, useScaledFallback } } = this;

        // Try loading tile from original source tile server if failed
        // to load from cache.
        if( src === _src && !cacheOnly ) {
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
                return super._tileOnError( done, tile, e );
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
            style.clip = `rect(${top}px ${left + tileSize.x}px ${top + tileSize.y}px ${left}px)`;

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
        super._tileOnError( done, tile, e );
    }

});

