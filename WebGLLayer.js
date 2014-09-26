'use strict';

/**
 * Creates a WebGL Layer which uses CanvasLayer.js (bckenny) to render given points and datasets over a Google Map
 * @param{!google.maps.Map map}
 * @constructor
 */
function WebGLLayer (map){
  /*
   * The target map object
   * @private {!google.maps.Map}
   */
  this.map_ = map;

  /**
   * A url base for tileservers
   * {String}
   */
  this.tilebase = null;

  /**
   * The zoom level to lock the tile loader at 
   * {number}
   */
  this.zoomlock = null;

  /**
   * A simple array to record loaded tiles and prevent unwanted loads
   * @private {[]}
   */
  this.tilecache_ = [];

  /**
   * Physical pixels : logical pixels, or 1.
   * @private {number}
   */
  this.resolutionScale_ = window.devicePixelRatio || 1;

  /**
   * CanvasLayer object used to manage drawing onto map, events and scheduling.
   * @private {!CanvasLayer}
   */
  this.canvasLayer_ = new CanvasLayer({
    map: map,
    animate: false,
    resizeHandler: this.resize_.bind(this),
    resolutionScale: this.resolutionScale_
  });

  /**
   * WebGL context
   * @private {!WebGLRenderingContext}
   */
  this.gl_ = this.canvasLayer_.canvas.getContext('webgl');

  /**
   * The transform mapping pixel coordinates to WebGL coordinates.
   * @private {!Float32Array}
   */
  this.pixelsToWebGLMatrix_ = new Float32Array(16);

  /**
   * The matrix for calculating (map) world coordinates to pixel transform.
   * @private {!Float32Array}
   */
  this.mapMatrix_ = new Float32Array(16);

  /**
   * Object containing a buffer for polygons alongside some metadata about that buffer (i.e count)
   * @private {!Object<string, number | WebGLBufferObject>}
   */
  this.polyBuffer_ = {
    'buffer': this.gl_.createBuffer(),
    'count': 0,
    'polyCount': 0,
    'polyPointCount': [],
    'polyColors': []
  }

  this.features_ = {
    'points': {
      'defaultColor': [1.0, 0.0, 0.0],
      'floats': [],
      'count': 0,
      'buffer': this.gl_.createBuffer(),
      'changed': false
    },
    'polygons': {
      'floats': [],
      'buffer': this.gl_.createBuffer(),
      'count': 0,
      'borderFloats': [],
      'borderbuffer': this.gl_.createBuffer(),
      'borderCount': 0,
      'borderCounts': [],
      'fill_transparency': 0.5,
      'changed': false
    }
  }

  /**
   * The transform mapping pixel coordinates to WebGL coordinates.
   * @private {!Float32Array}
   */
  this.pixelsToWebGLMatrix_ = new Float32Array(16);

  /**
   * The matrix for calculating (map) world coordinates to pixel transform.
   * @private {!Float32Array}
   */
  this.mapMatrix_ = new Float32Array(16);

  /**
   * The ShaderProgram for drawing the points, initialized with the default
   * shaders.
   * @private {!ShaderProgram}
   */
  this.pointProgram_ = new ShaderProgram(this.gl_,
      WebGLLayer.DEFAULT_POINT_VERT_SHADER_, WebGLLayer.DEFAULT_POINT_FRAG_SHADER_);

  /**
   * An instance of a Libtess Tesselator object using the callbacks defined below
   * @private {!libtess.GluTesselator}
   */
  this.tesselator_ = (function initTesselator() {
    //Creates a tesselator object. 
    var tesselator = new libtess.GluTesselator();

    //Assigns callbacks onto tesselator.
    tesselator.gluTessCallback(libtess.gluEnum.GLU_TESS_VERTEX_DATA, WebGLLayer.vertexCallback_);
    tesselator.gluTessCallback(libtess.gluEnum.GLU_TESS_BEGIN, WebGLLayer.beginCallback_);
    tesselator.gluTessCallback(libtess.gluEnum.GLU_TESS_ERROR, WebGLLayer.errorCallback_);
    tesselator.gluTessCallback(libtess.gluEnum.GLU_TESS_COMBINE, WebGLLayer.combineCallback_);
    tesselator.gluTessCallback(libtess.gluEnum.GLU_TESS_EDGE_FLAG, WebGLLayer.edgeCallback_);

    return tesselator;
  })();
};

/**
 * Default fragment shader source.
 * @private {string}
 */
WebGLLayer.DEFAULT_POINT_FRAG_SHADER_ = [
    'precision mediump float;',

    'varying mediump float vColor;',

    'uniform float alpha;',

    'const float c_precision = 128.0;',
    'const float c_precisionp1 = c_precision + 1.0;',

    'vec3 float2color(float value) {',
      'vec3 color;',
      'color.r = mod(value, c_precisionp1) / c_precision;',
      'color.b = mod(floor(value / c_precisionp1), c_precisionp1) / c_precision;',
      'color.g = floor(value / (c_precisionp1 * c_precisionp1)) / c_precision;',
      'return color;',
    '}',

    'void main() {',
    '  gl_FragColor = vec4(float2color(vColor), alpha);',
    '}'
].join('\n');

/**
 * Default vertex shader source.
 * @private {string}
 */
WebGLLayer.DEFAULT_POINT_VERT_SHADER_ = [
    'precision mediump float;',

    'attribute vec4 worldCoord;',
    'attribute float aColor;',

    'uniform mat4 mapMatrix;',

    'varying mediump float vColor;',

    'void main() {',
    '  gl_Position = mapMatrix * worldCoord;',
    '  gl_PointSize = 2.;',
    '  vColor = aColor;',
    '}'
].join('\n');

/**
 * Converts from latitude to vertical world coordinate.
 * @param {number} lat
 * @return {number}
 * @private
 */
WebGLLayer.latToY_ = function(lat) {
  var merc = -Math.log(Math.tan((0.25 + lat / 360) * Math.PI));
  return 128 * (1 + merc / Math.PI);
};

/**
 * Converts from longitude to horizontal world coordinate.
 * @param {number} lng
 * @return {number}
 * @private
 */
WebGLLayer.lngToX_ = function(lng) {
  if (lng > 180) {
    return 256 * (lng / 360 - 0.5);
  }
  return 256 * (lng / 360 + 0.5);
};

/**
 * Packs 3 floats into a single float for color compression
 * @param {!Number[]} color
 * @return {Number}
 */
WebGLLayer.packColor = function(color){
  var c_precision = 128.0;
  var c_precisionp1 = c_precision + 1.0;
  return Math.floor(color[0] * c_precision + 0.5) 
        + Math.floor(color[2] * c_precision + 0.5) * c_precisionp1 
        + Math.floor(color[1] * c_precision + 0.5) * c_precisionp1 * c_precisionp1;
}

/**
 * Converts a LatLng object to an OSM Tile for generating a tileserver request
 * @param {latlng} loc
 * @param {number} zoom
 * @return {number[]}
 */
WebGLLayer.loc2Tiles = function(loc, zoom){
  return [(Math.floor((loc.lng()+180)/360*Math.pow(2,zoom))), (Math.floor((1-Math.log(Math.tan(loc.lat()*Math.PI/180) + 1/Math.cos(loc.lat()*Math.PI/180))/Math.PI)/2 *Math.pow(2,zoom)))];
}

/**
 * Converts from an array of Lng, Lat coordinates to an Array of X, Y Coordinates
 * @param {!number[]} coords
 * @return {number[]}
 * @private
 */
WebGLLayer.coordsToXY_ = function(coords){
  return[WebGLLayer.lngToX_(coords[0]), WebGLLayer.latToY_(coords[1])];
}

/**
 * Applies a 2d scale to a 4x4 transform matrix.
 * @param {!Float32Array} matrix
 * @param {number} scaleX
 * @param {number} scaleY
 * @private
 */
WebGLLayer.scaleMatrix_ = function(matrix, scaleX, scaleY) {
  // scale x and y, which is just scaling first two columns of matrix
  matrix[0] *= scaleX;
  matrix[1] *= scaleX;
  matrix[2] *= scaleX;
  matrix[3] *= scaleX;

  matrix[4] *= scaleY;
  matrix[5] *= scaleY;
  matrix[6] *= scaleY;
  matrix[7] *= scaleY;
};

/**
 * Applies a 2d translation to a 4x4 transform matrix.
 * @param {!Float32Array} matrix
 * @param {number} tx
 * @param {number} ty
 * @private
 */
WebGLLayer.translateMatrix_ = function(matrix, tx, ty) {
  // translation is in last column of matrix
  matrix[12] += matrix[0]*tx + matrix[4]*ty;
  matrix[13] += matrix[1]*tx + matrix[5]*ty;
  matrix[14] += matrix[2]*tx + matrix[6]*ty;
  matrix[15] += matrix[3]*tx + matrix[7]*ty;
};

/**
 * Callback applied to each vertex
 * @param {!Number[]} data
 * @param {!Number[]} polyVertArray
 * @private
 */
WebGLLayer.vertexCallback_ = function(data, polyVertArray) {
  polyVertArray[polyVertArray.length] = data[0];
  polyVertArray[polyVertArray.length] = data[1];
  polyVertArray[polyVertArray.length] = WebGLLayer.packColor([1.0, 0.0, 0.0]);
};

/**
 * Callback fired at the beginning of a tesselation. 
 * @param {!libtess.primitiveType} type
 * @private
 */
WebGLLayer.beginCallback_ = function(type) {
  if (type !== libtess.primitiveType.GL_TRIANGLES) {
    console.log('expected TRIANGLES but got type: ' + type);
  };
};

/**
 * Callback fired when an error is hit during tesselation.
 * @param {Number} errno
 * @private
 * @throws Error will be thrown if tesselation error occurs
 */
WebGLLayer.errorCallback_ = function(errno) {
  throw 'Error occured whilst running libtess (Error No.: ' + errno + ').';
};

/**
 * Callback fired when segmets intersect and must be split during tesselation.
 * @param {!Number[]} coords
 * @param {!Number[]} data
 * @param {Number} weight
 * @private
 * @return {!Number[]} 
 */
WebGLLayer.combineCallback_ = function(coords, data, weight) {
  return [coords[0], coords[1], coords[2]];
};

/**
 * Callback fired before drawing a vertex, flag indicates if vertex precedes a boundary edge.
 * Having a null callback ensurese that triangles are drawn (i.e makes it compatable with WebGL.)
 * @param {Number} flag
 * @private
 */
WebGLLayer.edgeCallback_ = function(flag) {
  //Nothing happens here!      
};

/**
 * Schedules an overlay update on the next requestAnimationFrame callback.
 */
WebGLLayer.prototype.scheduleUpdate = function() {
  this.canvasLayer_.scheduleUpdate();
};

/**
 * Resizes the WebGL backing buffer when needed.
 * @private
 */
WebGLLayer.prototype.resize_ = function() {
  var canvasWidth = this.canvasLayer_.canvas.width;
  var canvasHeight = this.canvasLayer_.canvas.height;
  var resolutionScale = this.resolutionScale_;

  this.gl_.viewport(0, 0, canvasWidth, canvasHeight);

  this.pixelsToWebGLMatrix_.set([
    2 * resolutionScale / canvasWidth, 0, 0, 0,
    0, -2 * resolutionScale / canvasHeight, 0, 0,
    0, 0, 0, 0,
    -1, 1, 0, 1
  ]);
};

/**
 * Changes the color value assigned to a given point in the features arrray.
 * @param {Number} idx
 * @param {Number[]} color
 */
WebGLLayer.prototype.changePointColor = function(idx, color){
  this.features_.points.floats[idx*3 + 2] = WebGLLayer.packColor(color);
  this.features_.points.changed = true;
  this.scheduleUpdate();
}

/**
 * Changes the color value assigned to a given polygon in the features arrray.
 * @param {Number} idxStart
 * @param {Number} idxEnd
 * @param {Number[]} color
 */
WebGLLayer.prototype.changePolyColor = function(idxStart, idxEnd, color){
  for(var i = idxStart; i <= idxEnd; i++){
    this.features_.polygons.floats[i*3 + 2] = WebGLLayer.packColor(color);
  }
  this.features_.polygons.changed = true;
  this.scheduleUpdate();
}

/**
 * Set default point color
 * @param {Number[]} color
 */
 WebGLLayer.prototype.setDefaultPointColor = function(color){
  this.features_.points.defaultColor = color;
 }

/**
 * Loads a GeoJSON File from a given URL
 * @param {String} url
 */
WebGLLayer.prototype.loadGeoJson = function(url){


  var loadFunction = this.loadData;
  var layer = this;

  var req = new XMLHttpRequest();

  req.onreadystatechange = function() {
    if (this.readyState == 4 ) {
       if(this.status == 200){
           loadFunction.call(layer, JSON.parse(this.responseText));
       }
    }
  }

  req.open("GET", url, true);
  req.send();
}

/**
 * Loads GeoJSON data into the feature buffers.
 * @param {Object} data
 */
WebGLLayer.prototype.loadData = function(data){
  for(var i = 0; i < data.features.length; i++){
    //Grab feature and Geometry.
    var feature = data.features[i];
    var geometry = feature.geometry;

    switch(geometry.type) {

      case 'Point':
        var xy = WebGLLayer.coordsToXY_(geometry.coordinates);

        this.features_.points.floats.push(xy[0]);
        this.features_.points.floats.push(xy[1]);
        this.features_.points.floats.push(WebGLLayer.packColor(this.features_.points.defaultColor));
        
        feature.properties.index = this.features_.points.count++;

        this.features_.points.changed = true;

        this.onAddFeature(feature);
        break;
      case 'Polygon':
        feature.properties.indexStart = this.features_.polygons.count;
        var borderCount = this.features_.polygons.borderCount;
        this.processPolygon(geometry.coordinates);
        this.features_.polygons.borderCounts.push(this.features_.polygons.borderCount - borderCount);      
        feature.properties.indexEnd = this.features_.polygons.count;
        
        this.features_.polygons.changed = true;
        this.onAddFeature(feature);
        break;
      case 'MultiPolygon':
        feature.properties.indexStart = this.features_.polygons.count;
        for(var j = 0; j < geometry.coordinates.length; j++){
          var borderCount = this.features_.polygons.borderCount;
          this.processPolygon(geometry.coordinates[j]);
          this.features_.polygons.borderCounts.push(this.features_.polygons.borderCount - borderCount);
        }
        feature.properties.indexEnd = this.features_.polygons.count;

        this.features_.polygons.changed = true;
        this.onAddFeature(feature);
    }
  }
  this.scheduleUpdate();
}

/**
 * Processes a co-ordinate definition of a polygon by performing the required tesselation and buffer management
 * @param {Object} coordinates
 */
WebGLLayer.prototype.processPolygon = function(coordinates){
  var polyVerts = [];
  var tesselator = this.tesselator_;
  tesselator.gluTessBeginPolygon(polyVerts);

  var borderPoints = [];

  coordinates.map(function(contour){
    tesselator.gluTessBeginContour();
    contour.map(function(coords){
      var xy = WebGLLayer.coordsToXY_(coords);

      borderPoints.push(xy[0]);
      borderPoints.push(xy[1]);
      borderPoints.push(WebGLLayer.packColor([0., 0., 0.]));

      var adj = [xy[0], xy[1], 0];
      tesselator.gluTessVertex(adj, adj);
    })

    tesselator.gluTessEndContour();
  });

  tesselator.gluTessEndPolygon();

  this.features_.polygons.borderFloats = this.features_.polygons.borderFloats.concat(borderPoints);
  this.features_.polygons.borderCount += (borderPoints.length/3);

  this.features_.polygons.floats = this.features_.polygons.floats.concat(polyVerts);
  this.features_.polygons.count += polyVerts.length/3;
}


/**
 * Callback executed after a point has been added to the buffers.
 * @param {Object} feature
 */
WebGLLayer.prototype.onAddFeature = function(feature){

}

/**
 * Loads tiles from tileserver
 */
WebGLLayer.prototype.loadTiles = function (){
  var bounds = this.map_.getBounds();

  var zoom = this.map_.getZoom();
  if(this.zoomlock){
    zoom = this.zoomlock;
  }

  var bottomLeft = WebGLLayer.loc2Tiles(bounds.getSouthWest(), zoom);
  var topRight = WebGLLayer.loc2Tiles(bounds.getNorthEast(), zoom);


  /**
   * Loading object for Tile URLs
   */
  var loadFunction = this.loadData;
  var layer = this;

  function tileLoader(url, callback){
    var req = new XMLHttpRequest();

    req.onreadystatechange = function() {
      if (this.readyState == 4 ) {
         if(this.status == 200){
             loadFunction.call(layer, JSON.parse(this.responseText));
         }
      }
    }

    tileLoader.prototype.load = function(){
      req.open("GET", url, true);
      req.send();
    }
  } 

  for(var row = bottomLeft[0]; row <= topRight[0]; row++){
    for(var col = topRight[1]; col <= bottomLeft[1]; col++){
      var url = this.tilebase +zoom+'/'+row+'/'+col+'.geojson'
      if(typeof this.tilecache_[url] == 'undefined'){
        this.tilecache_[url] = true;
        var loader = new tileLoader(url);
        loader.load();
      }
    }
  }
}

/**
 * Performs an update of the display, Don't call directly use ScheduleUpdate() instead.
 */
WebGLLayer.prototype.update = function() {
  //Check in with Tileserver first.
  if(this.tilebase){
    this.loadTiles();
  }

  //Grab variables for WebGL and Program
  var gl = this.gl_;
  var pointProgram = this.pointProgram_;

  gl.clear(gl.COLOR_BUFFER_BIT);

  
  var mapProjection = this.map_.getProjection();
  
  // copy pixel->webgl matrix
  this.mapMatrix_.set(this.pixelsToWebGLMatrix_);

  // Scale to current zoom (worldCoords * 2^zoom)
  var scale = Math.pow(2, this.map_.getZoom());
  WebGLLayer.scaleMatrix_(this.mapMatrix_, scale, scale);

  // translate to current view (vector from topLeft to 0,0)
  var offset = mapProjection.fromLatLngToPoint(this.canvasLayer_.getTopLeft());
  WebGLLayer.translateMatrix_(this.mapMatrix_, -offset.x, -offset.y);

  pointProgram.uniforms.mapMatrix(this.mapMatrix_);

  //Polygon Rendering
  pointProgram.uniforms.alpha(this.features_.polygons.fill_transparency);
  gl.bindBuffer(gl.ARRAY_BUFFER, this.features_.polygons.buffer);
  
  if(this.features_.polygons.changed){
    this.gl_.bufferData(this.gl_.ARRAY_BUFFER, new Float32Array(this.features_.polygons.floats), this.gl_.DYNAMIC_DRAW);
  }
  gl.vertexAttribPointer(pointProgram.attributes.worldCoord, 2, gl.FLOAT, false, 12, 0);
  gl.vertexAttribPointer(pointProgram.attributes.aColor, 1, gl.FLOAT, false, 12, 8);

  gl.drawArrays(gl.TRIANGLES, 0, this.features_.polygons.count);

  //Borders
  pointProgram.uniforms.alpha(1.0);
  gl.bindBuffer(gl.ARRAY_BUFFER, this.features_.polygons.borderbuffer);
  
  if(this.features_.polygons.changed){
    this.gl_.bufferData(this.gl_.ARRAY_BUFFER, new Float32Array(this.features_.polygons.borderFloats), this.gl_.DYNAMIC_DRAW);
    this.features_.polygons.changed = false;
  }
  gl.vertexAttribPointer(pointProgram.attributes.worldCoord, 2, gl.FLOAT, false, 12, 0);
  gl.vertexAttribPointer(pointProgram.attributes.aColor, 1, gl.FLOAT, false, 12, 8);

  var seen = 0;
  for(var i = 0; i < this.features_.polygons.borderCounts.length; i++){
    gl.drawArrays(gl.LINE_LOOP, seen, this.features_.polygons.borderCounts[i]);
    seen += this.features_.polygons.borderCounts[i];
  }

  //Point Rendering
  gl.bindBuffer(gl.ARRAY_BUFFER, this.features_.points.buffer);
  if(this.features_.points.changed){
    this.gl_.bufferData(this.gl_.ARRAY_BUFFER, new Float32Array(this.features_.points.floats), this.gl_.DYNAMIC_DRAW);
    this.features_.points.changed = false;
  }
  gl.vertexAttribPointer(pointProgram.attributes.worldCoord, 2, gl.FLOAT, false, 12, 0);
  gl.vertexAttribPointer(pointProgram.attributes.aColor, 1, gl.FLOAT, false, 12, 8);
  
  gl.drawArrays(gl.POINTS, 0, this.features_.points.count);
};

/**
 * WebGL initialization and starts rendering the data.
 * @private
 */
WebGLLayer.prototype.start = function() {
  this.pointProgram_.use();
  this.gl_.enableVertexAttribArray(this.pointProgram_.attributes.worldCoord);
  this.gl_.enableVertexAttribArray(this.pointProgram_.attributes.aColor);

  this.canvasLayer_.setUpdateHandler(this.update.bind(this));
  this.scheduleUpdate();
};