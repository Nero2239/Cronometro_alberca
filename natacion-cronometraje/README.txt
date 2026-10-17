CRONOMETRAJE DE NATACIÓN

Vistas
- admin.html: el administrador configura metros por vuelta, duración y carriles requeridos escribiendo números separados por coma o rangos (por ejemplo, 1, 3, 5-8). Solo puede iniciar cuando cada juez requerido está conectado y preparado. Genera un QR por carril, detiene manualmente y exporta un Excel con marcas acumuladas cada 500 m.
- index.html: el juez escanea el QR de su carril, edita el nombre del equipo y del juez, cambia su estado entre NO PREPARADO (rojo) y PREPARADO (verde), y registra vueltas durante la prueba. Solo ve su sesión; la última vuelta queda visible y el historial se pagina de seis en seis.
- screen.html: tabla y cronómetro oficial para laptop, TV o proyector.

Sincronización
- Cloud Firestore guarda el estado oficial en el documento competition/state y los registros por carril en sessions/{carril}.
- Los jueces actualizan su presencia cada 10 segundos; el admin considera desconectado un juez si no recibe un pulso en 30 segundos.
- La conexión aparece activa cuando Firestore confirma la escucha del estado del evento desde el servidor. Los errores de reglas se muestran en las páginas.
- El inicio oficial se guarda con serverTimestamp de Firestore y los dispositivos calculan el tiempo transcurrido a partir de esa marca.
- Iniciar una nueva prueba limpia los registros actuales. El panel pide confirmación si ya hay carriles registrados.
- El tiempo no se detiene automáticamente al llegar a cero; el administrador controla la detención.
- La proyección mantiene una fila por carril y reemplaza sus valores acumulados al registrarse una nueva vuelta. El Excel conserva los hitos de 500 m.

Prueba local
1. Instala Node.js y ejecuta npm install.
2. Ejecuta npm run dev.
3. Abre http://localhost:8000/admin.html, configura los metros por vuelta e inicia la prueba.
4. Copia el enlace del carril para el juez y abre screen.html en la pantalla de proyección.

Despliegue
1. Habilita Cloud Firestore y configura sus reglas de seguridad y Firebase Authentication antes de usar el sistema en una competencia real.
2. Ejecuta firebase login y firebase deploy desde la carpeta del proyecto.
3. Comparte /admin con el administrador y el enlace de carril que corresponda con cada juez. Abre /proyeccion en la pantalla.

Seguridad
La configuración del cliente de Firebase no es un mecanismo de autenticación. En esta versión, las páginas no tienen inicio de sesión ni roles protegidos; aplica reglas de Firestore seguras antes de publicar datos reales.
