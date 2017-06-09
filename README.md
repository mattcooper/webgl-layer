![WebGL Sample](http://mattcooper.github.io/webgl-layer/screenshot.png)

WebGL Layer
=========

[WebGL Layer](http://mattcooper.github.io/webgl-layer/index.html) is an experimental extension of Google Maps to provide support for WebGL integration and data manipulation. WebGL Layer provides you with:

* Ability to load GeoJSON data and display with WebGL.
* Ability to alter some properties of loaded data (i.e color).
* Ability to define custom shaders and properties on data.
* Ability to plug into a vector tile server for data.

Dependencies
-----------

WebGL Layer has a few core dependencies that need to be included.

* [CanvasLayer](https://github.com/brendankenny/CanvasLayer) - provides a HTML5 canvas on top of a map which WebGL Layer uses to run a WebGL context
* [Libtess.js](https://github.com/brendankenny/libtess.js) - Javascript port of the GLUTesselate library. For super speedy Tesselation of Polygons.
* [ShaderProgram.js](https://github.com/brendankenny/point-overlay/blob/master/lib/ShaderProgram.js) - Utility library for management of WebGL variables and uniforms.

Examples
--------------
 
#### Creating a WebGL Layer.

This example shows how to create a WebGL Layer object and begin the rendering loop.

```
<head>
    <script type="text/javascript" src="//maps.googleapis.com/maps/api/js?libraries=places,drawing"></script>
        
    <!-- Import WebGL Layer and Dependencies. -->
    <script src="../CanvasLayer.js"></script>
    <script src="../ShaderProgram.js"></script>
    <script src="../libtess.cat.js"></script>
    <script src="../WebGLLayer.js"></script>
    
    <script>
        var map;
        var myLayer;
      
        function init(){
            var mapOptions = {
                zoom: 12,
                center: new google.maps.LatLng(51.50711, -0.123124),
                mapTypeId: google.maps.MapTypeId.ROADMAP,
            };

            var mapCanvas = document.getElementById('map-canvas');
            map = new google.maps.Map(mapCanvas, mapOptions);
            
            myLayer = new WebGLLayer(map);
            
            myLayer.start();
        }
    </script>
</head>
<body>
    <div id="map-canvas"></div>
</body>

```

#### Adding data to a WebGL Layer

From a file:
```
var myLayer = new WebGLLayer(map);

//Loading GeoJSON from application.
myLayer.loadData({"type": "FeatureCollection", features: {..}});

//Loading GeoJSON from an external source.
myLayer.loadGeoJson(‘//myserver.co.uk/my.geo.json’);

myLayer.start();
```

From a tileserver:
```
var myLayer = new WebGLLayer(map);

//Expects a base of a tileserver URL, i.e something that can be appended to to make a full tile URL.
myLayer.tilebase = '//tileserver.com/layer/';

//optional attribute that forces WebGL Layer to only load tiles at a certain zoom level,
myLayer.zoomlock = 12;

myLayer.start();
```

#### Integrating WebGL with other Libraries.

Using the `featureAdded` callback you can add your features into other libraries such as [Crossfilter](http://square.github.io/crossfilter/) and [JSTS](https://github.com/bjornharrtell/jsts).

```
var myLayer = new WebGLLayer(map);
var index = new jsts.index.strtree.STRtree();

var reader = new jsts.io.GeoJSONReader();

myLayer.onAddFeature = function(feature){
  var feat = reader.read(feature);
  index.insert(feat.geometry.getEnvelopeInternal(), feat);
}
```

You can then run powerful queries on the data and use the index property on the returned feature to change data in the WebGL Layer

```
var result = ... //Query result.
var idx = result.properties.index;
myLayer.changePointColor(idx, [0., 0., 1.]); //Change color to blue
```
