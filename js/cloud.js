// Cuentas (correo o Google), perfil y reseñas públicas con Firebase.
// app.js lo carga con import() solo si hay configuración en js/firebase-config.js.
//
// Datos en Firestore:
//   users/{uid}                    perfil: name, photo (foto pequeña en data:URL o URL de Google), reviewed (ids de pelis)
//   movies/{peli}/reviews/{uid}    una reseña por cuenta y peli, con copia del nombre y la foto del autor
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
    name: profile?.name || user.displayName || (user.email || "").split("@")[0] || "Tú",
    photo: profile?.photo ?? user.photoURL ?? "",
    google: user.providerData.some((p) => p.providerId === "google.com"),
    password: user.providerData.some((p) => p.providerId === "password"),
  };
  const emit = () => listeners.forEach((fn) => fn(view()));

  async function loadProfile(u, name) {
    const snap = await F.getDoc(userDoc(u.uid));
    if (snap.exists()) {
      profile = snap.data();
    } else {
      profile = { name: (name || u.displayName || (u.email || "").split("@")[0] || "Cinéfilo").slice(0, 30), photo: u.photoURL || "", reviewed: [] };
      await F.setDoc(userDoc(u.uid), profile);
    }
  }

  A.onAuthStateChanged(auth, async (u) => {
    user = u;
    profile = null;
    if (u) {
      try { await loadProfile(u); } catch (e) { console.warn("Perfil no disponible:", e); }
    }
    emit();
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
    get user() { return view(); },
    onUser(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async signUp(name, email, password) {
      const { user: u } = await A.createUserWithEmailAndPassword(auth, email, password);
      await A.updateProfile(u, { displayName: name });
      await loadProfile(u, name);
      A.sendEmailVerification(u).catch(() => {});
      emit();
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
    resetPassword: (email) => A.sendPasswordResetEmail(auth, email),
    signOut: () => A.signOut(auth),

    // ---------- Perfil ----------
    // Guarda nombre y/o foto, y los copia a las reseñas ya publicadas
    async updateProfile(changes) {
      const next = { ...profile, ...changes };
      const batch = F.writeBatch(db);
      batch.set(userDoc(user.uid), { name: next.name, photo: next.photo || "", reviewed: next.reviewed || [] });
      (next.reviewed || []).slice(0, 400).forEach((movieId) =>
        batch.update(F.doc(reviewsOf(movieId), user.uid), { name: next.name, photo: next.photo || "" }));
      try {
        await batch.commit();
      } catch (e) {
        // Si alguna reseña ya no existe, al menos se guarda el perfil
        if (e.code !== "not-found") throw e;
        await F.setDoc(userDoc(user.uid), { name: next.name, photo: next.photo || "", reviewed: next.reviewed || [] });
      }
      profile = next;
      if (changes.name) A.updateProfile(user, { displayName: next.name }).catch(() => {});
      emit();
    },

    // ---------- Seguridad ----------
    async changePassword(current, next) {
      await reauth(current);
      await A.updatePassword(user, next);
    },
    // Firebase manda un enlace al correo nuevo; el cambio se aplica al pulsarlo
    async changeEmail(current, email) {
      await reauth(current);
      await A.verifyBeforeUpdateEmail(user, email);
    },
    sendVerification: () => A.sendEmailVerification(user),
    async refresh() { await A.reload(user); emit(); },
    async deleteAccount(current) {
      await reauth(current);
      const batch = F.writeBatch(db);
      (profile?.reviewed || []).slice(0, 400).forEach((movieId) => batch.delete(F.doc(reviewsOf(movieId), user.uid)));
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
  })[e?.code] || "Algo ha fallado. Inténtalo otra vez.";
}
