// Mantenimiento de las cuentas de Cinder. Borra, junto con su perfil, su nombre de usuario, sus gustos y sus reseñas:
//   - las cuentas con correo que no lo han verificado 24 horas después de crearlas;
//   - las cuentas que llevan más de 3 meses (90 días) sin usar Cinder.
// Al final recuenta las cuentas con perfil terminado y lo guarda en meta/stats (el límite de cuentas lo usa).
// Lo ejecuta GitHub Actions cada hora (.github/workflows/purge-unverified.yml) con el secreto
// FIREBASE_SERVICE_ACCOUNT (clave JSON de una cuenta de servicio del proyecto).
// La última actividad es la última vez que la app renovó la sesión (cada hora de uso) o se entró.
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const LIMIT_MS = 24 * 3600 * 1000;
const INACTIVE_MS = 90 * 24 * 3600 * 1000;
const DRY_RUN = process.argv.includes("--dry-run");

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.log("::warning::Falta FIREBASE_SERVICE_ACCOUNT: no se revisa nada.");
  process.exit(0);
}
const app = initializeApp({ credential: cert(JSON.parse(raw)) });
const auth = getAuth(app);
const db = getFirestore(app);

// Borra los datos de Firestore de una cuenta (perfil, nombre, gustos y reseñas)
async function purgeData(uid) {
  const profileRef = db.doc(`users/${uid}`);
  const profile = (await profileRef.get()).data() || {};
  const batch = db.batch();
  for (const movieId of profile.reviewed || []) batch.delete(db.doc(`movies/${movieId}/reviews/${uid}`));
  if (profile.ready && profile.name) {
    const nameRef = db.doc(`usernames/${profile.name}`);
    const owner = (await nameRef.get()).data();
    if (owner?.uid === uid) batch.delete(nameRef);
  }
  batch.delete(db.doc(`tastes/${uid}`));
  batch.delete(profileRef);
  await batch.commit();
}

async function purge(user) {
  await purgeData(user.uid);
  await auth.deleteUser(user.uid);
}

let checked = 0, purged = 0, inactive = 0, token;
const alive = new Set();
const now = Date.now();
const time = (t) => (t ? Date.parse(t) || 0 : 0);
do {
  const page = await auth.listUsers(1000, token);
  for (const user of page.users) {
    checked++;
    alive.add(user.uid);
    const usesPassword = user.providerData.some((p) => p.providerId === "password");
    const m = user.metadata;
    const age = now - time(m.creationTime);
    const idle = now - Math.max(time(m.lastRefreshTime), time(m.lastSignInTime), time(m.creationTime));
    let why = null;
    if (usesPassword && !user.emailVerified && age >= LIMIT_MS) why = `creada hace ${Math.round(age / 3600000)} h, sin verificar`;
    else if (idle >= INACTIVE_MS) why = `${Math.round(idle / 86400000)} días sin usarse`;
    if (!why) continue;
    alive.delete(user.uid);
    if (!why.includes("verificar")) inactive++;
    console.log(`${DRY_RUN ? "[prueba] " : ""}Borrar ${user.uid} (${why})`);
    if (!DRY_RUN) {
      try { await purge(user); purged++; } catch (e) { console.error(`No se pudo borrar ${user.uid}:`, e.message); }
    }
  }
  token = page.pageToken;
} while (token);
// Recuento de cuentas con perfil terminado, para que el límite de cuentas sea exacto
// (solo las que siguen existiendo: un perfil suelto de una cuenta borrada desde la consola no cuenta)
const users = (await db.collection("users").where("ready", "==", true).select().get()).docs.filter((d) => alive.has(d.id)).length;
if (!DRY_RUN) await db.doc("meta/stats").set({ users });
// Como aviso del workflow, para verlo en el resumen de la ejecución sin abrir el registro
console.log(`::notice::Revisadas ${checked} cuentas; borradas ${purged} (${inactive} por inactividad). Cuentas activas: ${users}.`);
