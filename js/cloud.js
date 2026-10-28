// Cuentas (correo o Google), perfil y reseñas públicas con Firebase.
// app.js lo carga con import() solo si hay configuración en js/firebase-config.js.
//
// Datos en Firestore:
//   users/{uid}                    perfil: name (nombre de usuario), photo (data:URL pequeña o URL de Google),
//                                  reviewed (ids de pelis con reseña), ready (ya eligió nombre de usuario)
//   usernames/{nombre}             { uid }: reserva cada nombre de usuario para que sea único
//   tastes/{uid}                   modelo de gustos de js/taste.js
//   movies/{peli}/reviews/{uid}    una reseña por cuenta y peli, con copia del nombre y la foto del autor
// Las cuentas con correo sin verificar se borran a las 24 h (scripts/purge-unverified.mjs, cada hora en GitHub Actions).
export const VERIFY_HOURS = 24;
// Tras pulsar el enlace de un correo (verificar, cambiar contraseña…), «Abrir Cinder» vuelve aquí
const BACK = { url: new URL("./#cuenta", location.href).href };
export const USERNAME_RE = /^(?![.])[a-z0-9_.]{3,20}(?<![.])$/;
const V = "13.1.0";
const SDK = `https://www.gstatic.com/firebasejs/${V}`;

export async function connect(config) {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = initializeApp(config);
  const auth = A.getAuth(app);
  auth.languageCode = "es";
  const db = F.getFirestore(app);
  let user = null;
  let profile = null;
  const listeners = new Set();

  const userDoc = (uid) => F.doc(db, "users", uid);
  const nameDoc = (name) => F.doc(db, "usernames", name);
  const tasteDoc = (uid) => F.doc(db, "tastes", uid);
  const reviewsOf = (movieId) => F.collection(db, "movies", String(movieId), "reviews");
  const toReview = (d) => {
    const r = d.data();
    return { id: d.id, name: r.name, photo: r.photo || "", stars: r.stars, text: r.text || "", at: r.at?.toMillis?.() ?? Date.now() };
  };

  // Lo que ve la app: datos de la cuenta y del perfil juntos
  const view = () => user && {
    uid: user.uid,
    email: user.email || "",
    emailVerified: user.emailVerified,
    name: profile?.name || "",
    ready: Boolean(profile?.ready),
    photo: profile?.photo ?? user.photoURL ?? "",
    created: Date.parse(user.metadata.creationTime) || Date.now(),
    google: user.providerData.some((p) => p.providerId === "google.com"),
    password: user.providerData.some((p) => p.providerId === "password"),
  };
  const emit = () => listeners.forEach((fn) => fn(view()));

  // Perfil nuevo: sin nombre de usuario todavía (ready = false); la app pide elegirlo justo después
  async function loadProfile(u) {
    const snap = await F.getDoc(userDoc(u.uid));
    if (snap.exists()) {
      profile = snap.data();
    } else {
      profile = { name: "", photo: u.photoURL || "", reviewed: [], ready: false };
      await F.setDoc(userDoc(u.uid), profile);
    }
  }
  const reviewDocs = () => (profile?.reviewed || []).slice(0, 400).map((id) => F.doc(reviewsOf(id), user.uid));

  // ready: se resuelve cuando Firebase ya sabe si hay sesión iniciada
  let markReady;
  const ready = new Promise((r) => (markReady = r));
  A.onAuthStateChanged(auth, async (u) => {
    user = u;
    profile = null;
    if (u) {
      try { await loadProfile(u); } catch (e) { console.warn("Perfil no disponible:", e); }
    }
    emit();
    markReady();
  });

  // Algunas acciones (contraseña, correo, borrar) piden haber entrado hace poco
  async function reauth(password) {
    if (user.providerData.some((p) => p.providerId === "password") && password != null) {
      await A.reauthenticateWithCredential(user, A.EmailAuthProvider.credential(user.email, password));
    } else {
      await A.reauthenticateWithPopup(user, new A.GoogleAuthProvider());
    }
  }

  return {
    ready,
    get user() { return view(); },
    onUser(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async signUp(email, password) {
      const { user: u } = await A.createUserWithEmailAndPassword(auth, email, password);
      A.sendEmailVerification(u, BACK).catch(() => {});
    },
    signIn: (email, password) => A.signInWithEmailAndPassword(auth, email, password),
    async signInGoogle() {
      const provider = new A.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try {
        return await A.signInWithPopup(auth, provider);
      } catch (e) {
        // En algunos móviles el navegador bloquea la ventana: se entra con redirección
        if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
          return A.signInWithRedirect(auth, provider);
        }
        throw e;
      }
    },
    resetPassword: (email) => A.sendPasswordResetEmail(auth, email, BACK),
    signOut: () => A.signOut(auth),

    // ---------- Perfil ----------
    async usernameFree(name) {
      const snap = await F.getDoc(nameDoc(name));
      return !snap.exists() || snap.data().uid === user.uid;
    },
    // Reserva el nombre de usuario (y suelta el anterior) y guarda el perfil, todo en una transacción.
    // También copia el nombre y la foto a las reseñas ya publicadas.
    async saveProfile({ username, photo }) {
      const name = username ?? profile.name;
      const pic = photo ?? profile.photo ?? "";
      if (!USERNAME_RE.test(name)) throw Object.assign(new Error("bad"), { code: "username-invalid" });
      await F.runTransaction(db, async (tx) => {
        const snap = await tx.get(nameDoc(name));
        if (snap.exists() && snap.data().uid !== user.uid) throw Object.assign(new Error("taken"), { code: "username-taken" });
        if (!snap.exists()) tx.set(nameDoc(name), { uid: user.uid });
        if (profile.ready && profile.name && profile.name !== name) tx.delete(nameDoc(profile.name));
        tx.set(userDoc(user.uid), { name, photo: pic, reviewed: profile.reviewed || [], ready: true });
        reviewDocs().forEach((ref) => tx.update(ref, { name, photo: pic }));
      });
      profile = { ...profile, name, photo: pic, ready: true };
      A.updateProfile(user, { displayName: name }).catch(() => {});
      emit();
    },

    // ---------- Gustos ----------
    async loadTaste() {
      const snap = await F.getDoc(tasteDoc(user.uid));
      return snap.exists() ? snap.data() : null;
    },
    saveTaste: (model) => F.setDoc(tasteDoc(user.uid), { v: 1, n: model.n, f: model.f, at: F.serverTimestamp() }),

    // ---------- Seguridad ----------
    async changePassword(current, next) {
      await reauth(current);
      await A.updatePassword(user, next);
    },
    // Firebase manda un enlace al correo nuevo; el cambio se aplica al pulsarlo
    async changeEmail(current, email) {
      await reauth(current);
      await A.verifyBeforeUpdateEmail(user, email, BACK);
    },
    sendVerification: () => A.sendEmailVerification(user, BACK),
    async refresh() { await A.reload(user); emit(); },
    // Borra reseñas, perfil, nombre de usuario y gustos, y después la cuenta.
    // skipReauth: justo después de entrar no hace falta volver a pedir la contraseña.
    async deleteAccount(current, skipReauth = false) {
      if (!skipReauth) await reauth(current);
      const batch = F.writeBatch(db);
      reviewDocs().forEach((ref) => batch.delete(ref));
      if (profile?.ready && profile.name) batch.delete(nameDoc(profile.name));
      batch.delete(tasteDoc(user.uid));
      batch.delete(userDoc(user.uid));
      await batch.commit();
      await A.deleteUser(user);
    },

    // ---------- Reseñas ----------
    async reviews(movieId) {
      const snap = await F.getDocs(F.query(reviewsOf(movieId), F.orderBy("at", "desc"), F.limit(100)));
      return snap.docs.map(toReview);
    },
    async saveReview(movieId, { stars, text }) {
      if (!user) throw Object.assign(new Error("Inicia sesión"), { code: "no-user" });
      const me = view();
      const id = String(movieId);
      const batch = F.writeBatch(db);
      batch.set(F.doc(reviewsOf(id), user.uid), { name: me.name, photo: me.photo || "", stars, text: text.slice(0, 600), at: F.serverTimestamp() });
      batch.update(userDoc(user.uid), { reviewed: F.arrayUnion(id) });
      await batch.commit();
      profile = { ...profile, reviewed: [...new Set([...(profile?.reviewed || []), id])] };
    },
    async deleteReview(movieId) {
      const id = String(movieId);
      const batch = F.writeBatch(db);
      batch.delete(F.doc(reviewsOf(id), user.uid));
      batch.update(userDoc(user.uid), { reviewed: F.arrayRemove(id) });
      await batch.commit();
      profile = { ...profile, reviewed: (profile?.reviewed || []).filter((x) => x !== id) };
    },
  };
}

// Mensajes de error de Firebase en español
export function errorText(e) {
  return ({
    "auth/invalid-email": "Ese correo no es válido.",
    "auth/missing-password": "Escribe la contraseña.",
    "auth/weak-password": "La contraseña necesita al menos 6 caracteres.",
    "auth/email-already-in-use": "Ya hay una cuenta con ese correo.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/wrong-password": "La contraseña no es correcta.",
    "auth/user-not-found": "No hay ninguna cuenta con ese correo.",
    "auth/user-mismatch": "Esa cuenta de Google no es la tuya.",
    "auth/requires-recent-login": "Por seguridad, vuelve a entrar y repite el cambio.",
    "auth/too-many-requests": "Demasiados intentos. Espera un poco y vuelve a probar.",
    "auth/network-request-failed": "Sin conexión. Revisa tu internet.",
    "auth/popup-closed-by-user": "Has cerrado la ventana de Google.",
    "auth/cancelled-popup-request": "Has cerrado la ventana de Google.",
    "auth/unauthorized-domain": "Este dominio no está autorizado en Firebase.",
    "auth/operation-not-allowed": "Este modo de entrar no está activado en Firebase.",
    "permission-denied": "No tienes permiso para hacer eso.",
    "username-taken": "Ese nombre de usuario ya está cogido. Prueba otro.",
    "username-invalid": "Usa de 3 a 20 letras minúsculas, números, puntos o guiones bajos.",
  })[e?.code] || "Algo ha fallado. Inténtalo otra vez.";
}
