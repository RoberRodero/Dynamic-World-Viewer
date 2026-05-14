# Dynamic-World-Viewer

Script desarrollado en Google Earth Engine para visualizar la clasificación mensual de coberturas de Dynamic World junto con mosaicos Sentinel-2 libres de nubes. El usuario puede seleccionar una fecha mediante un slider temporal e introducir coordenadas para cargar automáticamente imágenes Sentinel-2 cercanas a dicha fecha. El sistema busca escenas con menos del 20% de nubes y comprueba que existan píxeles visibles en el punto seleccionado. Si no encuentra imágenes válidas, amplía progresivamente el rango temporal de búsqueda. Además, el script genera mosaicos priorizando las imágenes más cercanas temporalmente y permite exportar las clases de Dynamic World como archivos SHP. Incluye una interfaz interactiva con leyenda, panel de información y actualización automática entre Dynamic World y Sentinel-2.

El script está en el archivo que hay en este repositorio. Incluyo el link al editor de código de GEE y al asset para realizar pruebas.

Link editor de código:
https://code.earthengine.google.com/94a8d455899dc4d0a35f64c41738e74d 

Link asset:
https://code.earthengine.google.com/?asset=users/roberodero15/soknot_2024 
