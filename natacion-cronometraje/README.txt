CRONOMETRAJE DE NATACIÓN

Vistas
- admin.html: el administrador configura metros por vuelta, duración y carriles requeridos escribiendo números separados por coma o rangos (por ejemplo, 1, 3, 5-8). La duración personalizada usa horas:minutos:segundos y admite hasta 24 horas. Solo puede iniciar cuando cada juez requerido está conectado y preparado. Genera un QR por carril, el cronómetro se detiene automáticamente al cumplirse la duración, permite detenerlo o reiniciarlo manualmente y exporta un Excel con marcas acumuladas cada 500 m.
- index.html: pantalla de inicio de sesión y registro del grupo. La casilla para recordar mantiene la sesión y el correo, nunca la contraseña.
- judge.html: el juez escanea el QR de su carril, edita el nombre del equipo y del juez, cambia su estado entre NO PREPARADO (rojo) y PREPARADO (verde), y registra vueltas durante la prueba. Solo ve su sesión; la última vuelta queda visible y el historial se pagina de seis en seis.
- screen.html: tabla de resultados y cronómetro oficial compacto para laptop, TV o proyector.
- history.html: historial de carreras guardadas con fecha, orden configurable y desglose por carril.

Sincronización
- Firebase Authentication protege todas las pantallas. La primera versión usa una cuenta compartida del grupo en los dispositivos.
- Cloud Firestore guarda el perfil en users/{uid}, el estado en users/{uid}/competition/state, los registros actuales en users/{uid}/sessions/{carril} y el historial en users/{uid}/races/{id}.
- Los jueces actualizan su presencia cada 10 segundos; el admin considera desconectado un juez si no recibe un pulso en 30 segundos.
- La conexión aparece activa cuando Firestore confirma la escucha del estado del evento desde el servidor. Los errores de reglas se muestran en las páginas.
- El inicio oficial se guarda con serverTimestamp de Firestore y los dispositivos calculan el tiempo transcurrido a partir de esa marca.
- Los metros por vuelta y la duración se pueden cambiar durante una prueba en curso sin detener el reloj; si se reduce la duración por debajo del tiempo transcurrido, se detiene automáticamente.
- Iniciar una nueva prueba limpia los registros actuales. Al reiniciar se puede guardar la carrera en el historial antes de borrar las vueltas.
- El panel de administración detiene y sincroniza la prueba automáticamente al cumplirse la duración. Al reiniciarla se borran las vueltas, se pone el reloj en cero y los jueces deben volver a marcarse preparados.
- La proyección mantiene una fila por carril y reemplaza sus valores acumulados al registrarse una nueva vuelta. El Excel conserva los hitos de 500 m.
- El cierre de la pestaña de un juez no detiene la carrera; sus vueltas se sincronizan por carril en Firestore.

Prueba local
1. Instala Node.js.
2. Ejecuta `npx firebase-tools emulators:start --only hosting,auth,firestore --project cronometraje-745c0`.
3. Abre http://localhost:5000/index.html para registrar una cuenta de prueba e iniciar sesión. Los emuladores de Authentication y Firestore son independientes de producción.
4. Abre http://localhost:5000/admin.html, configura los metros por vuelta y prueba el flujo. Usa /judge.html?lane=1 para el juez, /screen.html para la proyección y /history.html para el historial.
5. El QR conserva la URL HTTPS de Firebase Hosting y el carril asignado. Para escanearlo desde un teléfono, el juez debe estar publicado en Hosting.

Despliegue
1. Inicia sesión con firebase login y despliega Authentication, reglas y Hosting: `firebase deploy --only auth,firestore:rules,hosting`. El alias .firebaserc selecciona cronometraje-745c0.
2. Después de publicar, el administrador registra el grupo desde la pantalla de acceso. Comparte /admin con el administrador, el QR/enlace del carril con cada juez y /proyeccion con la pantalla.

Seguridad
Las reglas requieren autenticación, validan los esquemas y limitan cada perfil, carrera y sesión al UID propietario. Los datos antiguos de las rutas globales competition/state y sessions/{carril} no se migran ni se asignan automáticamente a una cuenta.
