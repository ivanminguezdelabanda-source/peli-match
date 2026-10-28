// Borra las cuentas de Cinder que no han verificado el correo 24 horas después de crearlas,
// junto con su perfil, su nombre de usuario, sus gustos y sus reseñas.
// Lo ejecuta GitHub Actions cada hora (.github/workflows/purge-unverified.yml) con el secreto
// FIREBASE_SERVICE_ACCOUNT (clave JSON de una cuenta de servicio del proyecto).
// Las cuentas de Google ya vienen verificadas, así que nunca se borran.
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const LIMIT_MS = 24 * 3600 * 1000;
const DRY_RUN = process.argv.includes("--dry-run");

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.log("Falta FIREBASE_SERVICE_ACCOUNT: no se revisa nada.");
  process.exit(0);
}
const app = initializeApp({ credential: cert(JSON.parse(raw)) });
const auth = getAuth(app);
const db = getFirestore(app);

async function purge(user) {
  const profileRef = db.doc(`users/${user.uid}`);
  const profile = (await profileRef.get()).data() || {};
  const batch = db.batch();
  for (const movieId of profile.reviewed || []) batch.delete(db.doc(`movies/${movieId}/reviews/${user.uid}`));
  if (profile.ready && profile.name) {
    const nameRef = db.doc(`usernames/${profile.name}`);
    const owner = (await nameRef.get()).data();
    if (owner?.uid === user.uid) batch.delete(nameRef);
  }
  batch.delete(db.doc(`tastes/${user.uid}`));
  batch.delete(profileRef);
  await batch.commit();
  await auth.deleteUser(user.uid);
}

let checked = 0, purged = 0, token;
const now = Date.now();
do {
  const page = await auth.listUsers(1000, token);
  for (const user of page.users) {
    checked++;
    const usesPassword = user.providerData.some((p) => p.providerId === "password");
    const age = now - Date.parse(user.metadata.creationTime);
    if (!usesPassword || user.emailVerified || age < LIMIT_MS) continue;
    console.log(`${DRY_RUN ? "[prueba] " : ""}Borrar ${user.uid} (creada hace ${Math.round(age / 3600000)} h, sin verificar)`);
    if (!DRY_RUN) {
      try { await purge(user); purged++; } catch (e) { console.error(`No se pudo borrar ${user.uid}:`, e.message); }
    }
  }
  token = page.pageToken;
} while (token);
console.log(`Revisadas ${checked} cuentas; borradas ${purged}.`);
