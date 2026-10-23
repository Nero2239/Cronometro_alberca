import {
  auth,
  onAuthStateChanged,
  registerAccount,
  setAuthPersistence,
  signIn,
  signOut
} from './firebase.js?v=3';

const EMAIL_KEY = 'cronometraje.rememberedEmail';
const loginUrl = new URL('./index.html', window.location.href);

const getSafeContinuation = () => {
  const requested = new URLSearchParams(window.location.search).get('continue');
  if (requested) {
    const target = new URL(requested, window.location.origin);
    if (target.origin === window.location.origin && target.pathname !== '/index.html') {
      return `${target.pathname}${target.search}${target.hash}`;
    }
  }
  const lane = new URLSearchParams(window.location.search).get('lane');
  if (lane && /^[1-9]\d?$/.test(lane)) return `./judge.html?lane=${encodeURIComponent(lane)}`;
  return './admin.html';
};

const showAuthError = (message) => {
  const feedback = document.getElementById('authFeedback');
  if (feedback) {
    feedback.textContent = message;
    return;
  }
  const status = document.querySelector('[role="status"]');
  if (status) {
    status.textContent = message;
    status.classList.add('offline');
    return;
  }
  window.alert(message);
};

export const requireAuthentication = () => new Promise((resolve) => {
  const unsubscribe = onAuthStateChanged(auth, (user) => {
    unsubscribe();
    if (!user) {
      loginUrl.searchParams.set('continue', `${window.location.pathname}${window.location.search}`);
      window.location.replace(loginUrl.href);
      return;
    }
    resolve(user);
  }, (error) => {
    console.error('No se pudo comprobar la sesión de Firebase:', error);
    showAuthError('No se pudo comprobar la sesión. Recarga e intenta de nuevo.');
  });
});

const attachSignOutButtons = () => {
  for (const button of document.querySelectorAll('[data-sign-out]')) {
    if (button.dataset.signOutReady) continue;
    button.dataset.signOutReady = 'true';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await signOut(auth);
        window.location.replace('./index.html');
      } catch (error) {
        console.error('No se pudo cerrar la sesión:', error);
        button.disabled = false;
        showAuthError('No se pudo cerrar la sesión. Intenta de nuevo.');
      }
    });
  }
};

export const setupAuthPage = () => {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const loginTab = document.getElementById('loginTab');
  const registerTab = document.getElementById('registerTab');
  const loginEmail = document.getElementById('loginEmail');
  const rememberMe = document.getElementById('rememberMe');
  let registrationInProgress = false;

  const rememberedEmail = window.localStorage.getItem(EMAIL_KEY) || '';
  loginEmail.value = rememberedEmail;
  rememberMe.checked = Boolean(rememberedEmail);

  const setMode = (mode) => {
    const isLogin = mode === 'login';
    loginTab.setAttribute('aria-selected', String(isLogin));
    registerTab.setAttribute('aria-selected', String(!isLogin));
    loginForm.hidden = !isLogin;
    registerForm.hidden = isLogin;
    showAuthError('');
  };

  loginTab.addEventListener('click', () => setMode('login'));
  registerTab.addEventListener('click', () => setMode('register'));

  onAuthStateChanged(auth, (user) => {
    if (user && !registrationInProgress) window.location.replace(getSafeContinuation());
  }, (error) => {
    console.error('No se pudo comprobar la sesión de Firebase:', error);
    showAuthError('No se pudo comprobar la sesión. Recarga e intenta de nuevo.');
  });

  const persistEmailPreference = (email) => {
    if (rememberMe.checked) window.localStorage.setItem(EMAIL_KEY, email);
    else window.localStorage.removeItem(EMAIL_KEY);
  };

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = loginForm.querySelector('[type="submit"]');
    const email = loginEmail.value.trim().toLowerCase();
    submitButton.disabled = true;
    showAuthError('');
    try {
      await setAuthPersistence(rememberMe.checked);
      await signIn(email, document.getElementById('loginPassword').value);
      persistEmailPreference(email);
      window.location.replace(getSafeContinuation());
    } catch (error) {
      console.error('No se pudo iniciar sesión:', error);
      showAuthError(authErrorMessage(error));
    } finally {
      submitButton.disabled = false;
    }
  });

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = registerForm.querySelector('[type="submit"]');
    const email = document.getElementById('registerEmail').value.trim().toLowerCase();
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    if (password !== confirmPassword) {
      showAuthError('Las contraseñas no coinciden.');
      return;
    }
    submitButton.disabled = true;
    registrationInProgress = true;
    showAuthError('');
    try {
      await setAuthPersistence(rememberMe.checked);
      const user = await registerAccount(email, password, {
        organizationName: document.getElementById('organizationName').value.trim(),
        poolName: document.getElementById('poolName').value.trim(),
        contactName: document.getElementById('contactName').value.trim(),
        phone: document.getElementById('contactPhone').value.trim(),
        city: document.getElementById('organizationCity').value.trim()
      });
      persistEmailPreference(email);
      if (user) window.location.replace('./admin.html');
    } catch (error) {
      console.error('No se pudo registrar el grupo de alberca:', error);
      showAuthError(authErrorMessage(error));
    } finally {
      registrationInProgress = false;
      submitButton.disabled = false;
    }
  });
};

const authErrorMessage = (error) => ({
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/invalid-email': 'El correo no tiene un formato válido.',
  'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  'auth/network-request-failed': 'No se pudo conectar. Revisa tu conexión a internet.',
  'permission-denied': 'La cuenta se creó, pero no se pudo guardar el perfil del grupo. Inicia sesión e inténtalo de nuevo.'
}[error.code] || error.message || 'No se pudo completar la solicitud.');

attachSignOutButtons();
if (!document.getElementById('loginForm')) {
  onAuthStateChanged(auth, (user) => {
    if (!user) window.location.replace('./index.html');
  });
}
