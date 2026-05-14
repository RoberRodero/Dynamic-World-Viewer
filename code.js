// Visor de Dynamic world y sentinel 2. Realizado por Roberto Rodero
// Script desarrollado con asistencia de IA para Google Earth Engine

// Primero cargamos el aoi, el enlace a este asset está en la página de github
// pero se puede introducir otro si nos interesa.
var aoi = ee.FeatureCollection('users/roberodero15/soknot_2024');
Map.centerObject(aoi, 8);

// Definimos los parámetros de visualización para la capa dynamic world.

var VIS_PALETTE = ['#419BDF', '#397D49', '#88B053', 
'#7A87C6', '#E49635','#DFC35A',
'#C4281B', '#A59B8F', '#B39FE1'];

var CLASS_NAMES = ['Agua', 'Árboles', 'Herbáceo', 
'Vegetación inundable', 'Cultivos', 'Matorral y arbustivo', 
'Urbano', 'Suelo desnudo', 'Nieve y hielo'];

// Preparamos la interfaz para el usuario

var panel = ui.Panel({
  style: {
    width: '420px',
    padding: '10px'
  }
});

ui.root.insert(0, panel);

panel.add(ui.Label({
  value: 'Visor de Dynamic World',
  style: {
    fontSize: '20px',
    fontWeight: 'bold'
  }
}));

panel.add(ui.Label('Selecciona una fecha moviendo el slider'));

var dateLabel = ui.Label('Fecha actual:');
panel.add(dateLabel);

panel.add(ui.Label({
  value: 'Coordenadas Sentinel-2',
  style: {
    fontWeight: 'bold',
    margin: '10px 0 5px 0'
  }
}));

var lonBox = ui.Textbox({
  placeholder: 'Longitud, ej: -6.1234',
  value: ''
});

var latBox = ui.Textbox({
  placeholder: 'Latitud, ej: 37.1234',
  value: ''
});

panel.add(lonBox);
panel.add(latBox);

var s2Label = ui.Label('Sentinel-2: introduce coordenadas');
panel.add(s2Label);

// Ajustamos las fechas disponibles y determinamos cuantos meses hay disponibles (para el slider)

var startDate = ee.Date('2020-01-01');
var endDate = ee.Date(Date.now());
var nMonths = endDate.difference(startDate, 'month').round();


// Estas variables almacenan las capas, fechas y estados actuales
// de la aplicación para poder actualizar el mapa dinámicamente,
// controlar las búsquedas de Sentinel-2 y gestionar exportaciones.

var currentLayer;
var currentS2Layer;
var currentPointLayer;
var currentVector;
var currentDate;
var currentTargetDate;
var s2RequestId = 0;
var hasLoadedS2Once = false;

// Esta función genera una máscara de píxeles válidos utilizando
// la banda SCL (Scene Classification Layer) de Sentinel-2.
// Se eliminan sombras de nube, nubes, cirros y nieve/hielo
// para conservar únicamente píxeles utilizables en el mosaico.

function getClearMask(image) {

  image = ee.Image(image);

  var scl = image.select('SCL');

  var clearMask = scl.neq(3)
    .and(scl.neq(8))
    .and(scl.neq(9))
    .and(scl.neq(10))
    .and(scl.neq(11));

  return clearMask;
}

// Esta función comprueba si una imagen Sentinel-2 contiene
// píxeles válidos (sin nubes) alrededor del punto indicado.
// Si existen píxeles visibles en el buffer del punto,
// se añade la propiedad 'point_clear = 1' a la imagen.
// En caso contrario, se asigna 'point_clear = 0'.
// Esto permite filtrar únicamente imágenes útiles para
// el punto seleccionado por el usuario.

function addPointClearProperty(image, point) {

  image = ee.Image(image);

  var clearMask = getClearMask(image);

  var value = clearMask.reduceRegion({
    reducer: ee.Reducer.max(),
    geometry: point.buffer(60),
    scale: 10,
    maxPixels: 1e6,
    bestEffort: true
  }).get('SCL');

  value = ee.Algorithms.If(value, value, 0);

  return image.set('point_clear', ee.Number(value));
}

// Esta función prepara las imágenes Sentinel-2 para el mosaico:
// aplica la máscara de nubes, selecciona bandas RGB y genera
// una banda de prioridad temporal según la fecha objetivo.

function prepareS2(image) {

  image = ee.Image(image);

  var clearMask = getClearMask(image);

  var rgb = image.select(['B4', 'B3', 'B2'])
    .divide(10000)
    .updateMask(clearMask);

  var score = ee.Image.constant(
      ee.Number(image.get('date_diff')).multiply(-1)
    )
    .toFloat()
    .rename('score')
    .updateMask(clearMask);

  return rgb.addBands(score).copyProperties(image, [
    'system:time_start',
    'CLOUDY_PIXEL_PERCENTAGE',
    'MGRS_TILE',
    'date_diff',
    'point_clear'
  ]);
}

// Esta función obtiene las coordenadas introducidas,
// centra el mapa en el punto seleccionado y prepara
// la búsqueda del mosaico Sentinel-2 correspondiente.

function loadS2FromCoords() {

  s2RequestId++;
  hasLoadedS2Once = true;

  var requestId = s2RequestId;

  var lon = parseFloat(lonBox.getValue());
  var lat = parseFloat(latBox.getValue());

  if (isNaN(lon) || isNaN(lat)) {
    s2Label.setValue('Sentinel-2: coordenadas no válidas');
    return;
  }

  if (!currentTargetDate) {
    s2Label.setValue('Sentinel-2: selecciona primero una fecha');
    return;
  }

  var point = ee.Geometry.Point([lon, lat]);

  Map.setCenter(lon, lat, 14);

  var sentinelArea = point.buffer(160000).bounds();

  if (currentPointLayer) {
    Map.layers().remove(currentPointLayer);
  }

  currentPointLayer = ui.Map.Layer(
    ee.Image().byte().paint({
      featureCollection: ee.FeatureCollection([ee.Feature(point)]),
      color: 1,
      width: 5
    }),
    {palette: ['yellow']},
    'Punto coordenadas'
  );

  Map.layers().add(currentPointLayer);

  if (currentS2Layer) {
    Map.layers().remove(currentS2Layer);
  }

  s2Label.setValue('Sentinel-2: buscando imagen visible en el punto...');

  searchS2Window(point, sentinelArea, currentTargetDate, 0, requestId);
}

// Esta función recarga automáticamente Sentinel-2
// cuando cambia la fecha del slider y ya existen
// coordenadas válidas introducidas por el usuario.

function refreshS2IfReady() {

  var lon = parseFloat(lonBox.getValue());
  var lat = parseFloat(latBox.getValue());

  if (hasLoadedS2Once && !isNaN(lon) && !isNaN(lat)) {
    loadS2FromCoords();
  }
}

// Busca imágenes Sentinel-2 cada vez más alejadas de la fecha objetivo,
// asegurando que haya píxeles visibles en el punto indicado.
// Después genera el mosaico priorizando las fechas más cercanas.

function searchS2Window(point, sentinelArea, targetDate, searchMonths, requestId) {

  var windowStart = targetDate.advance(-searchMonths, 'month');
  var windowEnd = targetDate.advance(searchMonths + 1, 'month');

  var centralCandidates = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(point)
    .filterDate(windowStart, windowEnd)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
    .map(function(img) {
      var diff = ee.Number(img.date().difference(targetDate, 'day')).abs();
      return img.set('date_diff', diff);
    })
    .map(function(img) {
      return addPointClearProperty(img, point);
    });

  var centralClear = centralCandidates
    .filter(ee.Filter.eq('point_clear', 1))
    .sort('date_diff');

  ee.Dictionary({
    countCentral: centralClear.size(),
    countCandidates: centralCandidates.size()
  }).evaluate(function(result) {

    if (requestId !== s2RequestId || !result) {
      return;
    }

    if (result.countCentral === 0) {

      if (searchMonths < 120) {

        s2Label.setValue(
          'Sentinel-2: sin píxel visible en el punto. Ampliando ±' +
          searchMonths +
          ' meses...'
        );

        searchS2Window(
          point,
          sentinelArea,
          targetDate,
          searchMonths + 1,
          requestId
        );

      } else {

        s2Label.setValue(
          'Sentinel-2: no se encontró imagen <20% nubes visible en el punto'
        );
      }

      return;
    }

    var centralImage = ee.Image(centralClear.first());

    var centralDate = ee.Date(centralImage.get('system:time_start'))
      .format('YYYY-MM-dd');

    var centralTile = ee.String(centralImage.get('MGRS_TILE'));

    var s2ForMosaic = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
      .filterBounds(sentinelArea)
      .filterDate(windowStart, windowEnd)
      .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
      .map(function(img) {
        var diff = ee.Number(img.date().difference(targetDate, 'day')).abs();
        return img.set('date_diff', diff);
      })
      .sort('date_diff')
      .limit(100);

    var prepared = s2ForMosaic.map(prepareS2);

    var s2Image = prepared
      .qualityMosaic('score')
      .select(['B4', 'B3', 'B2'])
      .clip(sentinelArea);

    var pointVisible = s2Image.select('B4').mask().reduceRegion({
      reducer: ee.Reducer.max(),
      geometry: point.buffer(1000),
      scale: 20,
      maxPixels: 1e13,
      bestEffort: true
    }).get('B4');

    ee.Dictionary({
      visible: pointVisible,
      countMosaic: s2ForMosaic.size()
    }).evaluate(function(check) {

      if (requestId !== s2RequestId || !check) {
        return;
      }

      if (check.visible !== 1) {

        if (searchMonths < 120) {

          s2Label.setValue(
            'Sentinel-2: mosaico sin píxel visible. Ampliando ±' +
            searchMonths +
            ' meses...'
          );

          searchS2Window(
            point,
            sentinelArea,
            targetDate,
            searchMonths + 1,
            requestId
          );

        } else {

          s2Label.setValue(
            'Sentinel-2: no se pudo generar mosaico visible en el punto'
          );
        }

        return;
      }

      var minDate = ee.Date(s2ForMosaic.aggregate_min('system:time_start'))
        .format('YYYY-MM-dd');

      var maxDate = ee.Date(s2ForMosaic.aggregate_max('system:time_start'))
        .format('YYYY-MM-dd');

      var tiles = s2ForMosaic.aggregate_array('MGRS_TILE').distinct();

      centralDate.evaluate(function(centralDateText) {
        centralTile.evaluate(function(centralTileText) {
          minDate.evaluate(function(minDateText) {
            maxDate.evaluate(function(maxDateText) {
              tiles.evaluate(function(tileList) {

                if (requestId !== s2RequestId) {
                  return;
                }

                s2Label.setValue(
                  'Sentinel-2 visible en el punto | imagen central: ' +
                  centralDateText +
                  ' | tile: ' +
                  centralTileText +
                  ' | mosaico: ' +
                  check.countMosaic +
                  ' imágenes | rango: ' +
                  minDateText +
                  ' → ' +
                  maxDateText +
                  ' | tiles: ' +
                  tileList.join(', ')
                );
              });
            });
          });
        });
      });

      if (currentS2Layer) {
        Map.layers().remove(currentS2Layer);
      }

      currentS2Layer = ui.Map.Layer(
        s2Image,
        {
          bands: ['B4', 'B3', 'B2'],
          min: 0,
          max: 0.3,
          gamma: 1.2
        },
        'Sentinel-2 coordenada + adyacentes'
      );

      Map.layers().add(currentS2Layer);
    });
  });
}

// Añadimos un botón para cargar las imagenes sentinel una vez hemos introducido las coordenadas

var loadS2Button = ui.Button({
  label: 'Cargar Sentinel-2 por coordenadas',
  style: {
    stretch: 'horizontal',
    margin: '10px 0px'
  },
  onClick: loadS2FromCoords
});

panel.add(loadS2Button);

// Actualiza la capa mensual de Dynamic World según el slider,
// guarda la fecha objetivo para Sentinel-2 y prepara la
// vectorización de clases para exportar como SHP.

function updateLayer(monthOffset) {

  var selectedDate = startDate.advance(monthOffset, 'month');
  var nextDate = selectedDate.advance(1, 'month');
  var targetDate = selectedDate.advance(15, 'day');
  var aoiGeom = aoi.geometry();

  currentDate = selectedDate;
  currentTargetDate = targetDate;

  dateLabel.setValue(
    'Fecha actual: ' + selectedDate.format('YYYY-MM').getInfo()
  );

  var dw = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
    .filterBounds(aoiGeom)
    .filterDate(selectedDate, nextDate);

  var image = dw.select('label').mode().clip(aoiGeom);

  if (currentLayer) {
    Map.layers().remove(currentLayer);
  }

  currentLayer = ui.Map.Layer(
    image,
    {
      min: 0,
      max: 8,
      palette: VIS_PALETTE
    },
    'Dynamic World'
  );

  Map.layers().add(currentLayer);

  currentVector = image.reduceToVectors({
    geometry: aoiGeom,
    scale: 10,
    geometryType: 'polygon',
    eightConnected: false,
    labelProperty: 'class_id',
    reducer: ee.Reducer.mode(),
    maxPixels: 1e13
  }).map(function(f) {

    var classId = ee.Number(f.get('class_id'));
    var className = ee.List(CLASS_NAMES).get(classId);

    return f.set({
      class_name: className
    });
  });

  // Actualizar Sentinel-2 automáticamente al mover el slider
  refreshS2IfReady();
}

// Creamos el slider por meses y lo incluimos en el panel

var slider = ui.Slider({
  min: 0,
  max: nMonths.getInfo(),
  value: nMonths.getInfo(),
  step: 1,
  style: {
    stretch: 'horizontal'
  },
  onChange: updateLayer
});

panel.add(slider);

// Exportar la capa dynamic world en formato shape de la fecha seleccionada

var exportButton = ui.Button({
  label: 'Exportar SHP Dynamic World',
  style: {
    stretch: 'horizontal',
    margin: '10px 0px'
  },
  onClick: function() {

    if (!currentVector) {
      print('No hay capa cargada');
      return;
    }

    var dateString = currentDate.format('YYYY_MM').getInfo();

    Export.table.toDrive({
      collection: currentVector,
      description: 'DynamicWorld_' + dateString,
      fileFormat: 'SHP'
    });

    print('Exportación iniciada');
  }
});

panel.add(exportButton);

// Definimos la leyenda y la incluimos en el panel

panel.add(ui.Label({
  value: 'Clases Dynamic World',
  style: {
    fontWeight: 'bold',
    margin: '10px 0 5px 0'
  }
}));

for (var i = 0; i < CLASS_NAMES.length; i++) {

  var colorBox = ui.Label('', {
    backgroundColor: VIS_PALETTE[i],
    padding: '8px',
    margin: '0 0 4px 0'
  });

  var description = ui.Label(CLASS_NAMES[i]);

  var row = ui.Panel({
    widgets: [colorBox, description],
    layout: ui.Panel.Layout.Flow('horizontal')
  });

  panel.add(row);
}


updateLayer(nMonths.getInfo());

Map.addLayer(
  ee.Image().byte().paint({
    featureCollection: aoi,
    color: 1,
    width: 3
  }),
  {palette: ['red']},
  'AOI contorno'
);
