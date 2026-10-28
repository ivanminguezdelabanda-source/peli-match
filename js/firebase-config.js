// Configuración web de Firebase (cuentas y reseñas). No es secreta: Firebase la protege
// con las reglas de firestore.rules y los dominios autorizados.
// Proyecto de Firebase: cinder-9e438. Si se deja en null, la app funciona sin cuentas.
window.CINDER_FIREBASE = {
  apiKey: "AIzaSyDa5Qf-CpQfbhbno8MX0hbCOrAIeELouno",
  authDomain: "cinder-9e438.firebaseapp.com",
  projectId: "cinder-9e438",
  storageBucket: "cinder-9e438.firebasestorage.app",
  messagingSenderId: "663858927238",
  appId: "1:663858927238:web:7b9bb5f7986acf0046e307",
};

// ID de cliente web de Google (Firebase → Authentication → Método de inicio de sesión → Google →
// Configuración del SDK web). No es secreto. Con él, «Continuar con Google» usa el botón oficial de Google,
// que funciona bien en Safari y en móviles. Vacío: se usa la ventana de Firebase.
window.CINDER_GOOGLE_CLIENT_ID = "";
