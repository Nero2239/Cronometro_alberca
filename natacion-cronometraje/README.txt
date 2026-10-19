CRONOMETRAJE DE NATACIÓN

Vistas
- admin.html: el administrador configura metros por vuelta, duración y carriles requeridos escribiendo números separados por coma o rangos (por ejemplo, 1, 3, 5-8). La duración personalizada usa horas:minutos:segundos y admite hasta 24 horas. Solo puede iniciar cuando cada juez requerido está conectado y preparado. Genera un QR por carril, el cronómetro se detiene automáticamente al cumplirse la duración, permite detenerlo o reiniciarlo manualmente y exporta un Excel con marcas acumuladas cada 500 m.
- index.html: el juez escanea el QR de su carril, edita el nombre del equipo y del juez, cambia su estado entre NO PREPARADO (rojo) y PREPARADO (verde), y registra vueltas durante la prueba. Solo ve su sesión; la última vuelta queda visible y el historial se pagina de seis en seis.
- screen.html: tabla y cronómetro oficial ampliados para laptop, TV o proyector.

Sincronización
- Cloud Firestore guarda el estado oficial en el documento competition/state y los registros por carril en sessions/{carril}.
- Los jueces actualizan su presencia cada 10 segundos; el admin considera desconectado un juez si no recibe un pulso en 30 segundos.
- La conexión aparece activa cuando Firestore confirma la escucha del estado del evento desde el servidor. Los errores de reglas se muestran en las páginas.
- El inicio oficial se guarda con serverTimestamp de Firestore y los dispositivos calculan el tiempo transcurrido a partir de esa marca.
- Iniciar una nueva prueba limpia los registros actuales. El panel pide confirmación si ya hay carriles registrados.
- El panel de administración detiene y sincroniza la prueba automáticamente al cumplirse la duración. Al reiniciarla se borran las vueltas, se pone el reloj en cero y los jueces deben volver a marcarse preparados.
- La proyección mantiene una fila por carril y reemplaza sus valores acumulados al registrarse una nueva vuelta. El Excel conserva los hitos de 500 m.

Prueba local
1. Instala Node.js.
2. Ejecuta `npx firebase-tools emulators:start --only hosting,firestore --project cronometraje-745c0`.
3. Abre http://localhost:5000/admin.html, configura los metros por vuelta y prueba el flujo. En localhost, el SDK usa el emulador local de Firestore; no modifica la base publicada.
4. Abre http://localhost:5000/index.html?lane=1 y http://localhost:5000/screen.html para probar las vistas de juez y proyección. El emulador inicia vacío y sus datos son independientes de Firestore en producción.
5. El QR conserva la URL HTTPS de Firebase Hosting y el carril asignado. Para escanearlo desde un teléfono, el juez debe estar publicado en Hosting.

Despliegue
1. Habilita Cloud Firestore y configura sus reglas de seguridad y Firebase Authentication antes de usar el sistema en una competencia real.
2. Inicia sesión con firebase login y despliega solo Hosting con firebase deploy --only hosting desde la carpeta del proyecto. El alias .firebaserc selecciona cronometraje-745c0.
3. Después de publicar, comparte /admin con el administrador y el enlace HTTPS del carril que corresponda con cada juez. Abre /proyeccion en la pantalla.

Seguridad
La configuración del cliente de Firebase no es un mecanismo de autenticación. En esta versión, las páginas no tienen inicio de sesión ni roles protegidos; aplica reglas de Firestore seguras antes de publicar datos reales.
