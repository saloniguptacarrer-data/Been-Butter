import {
  collection,
  createUserWithEmailAndPassword,
  doc,
  firebaseAuth as auth,
  firebaseAuthReady,
  firestoreDb,
  getDocs,
  onAuthStateChanged,
  query,
  serverTimestamp,
  setDoc,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  where,
} from "./firebase-app.js";

/* ==========================================================
  Bean & Butter: frontend interactions and Firebase Authentication
  Reservation requests and customer profiles are stored in Firestore.
   ========================================================== */

(function () {
  "use strict";

  const navToggle = document.querySelector(".nav-toggle");
  const navMenu = document.getElementById("nav-menu");
  const toast = document.getElementById("toast");
  const accountDialog = document.getElementById("account-dialog");
  const loginButton = document.querySelector(".js-login");
  const greeting = document.getElementById("account-greeting");
  const myBookingsButton = document.getElementById("my-bookings-button");
  const logoutButton = document.getElementById("logout-button");
  const loginForm = document.getElementById("login-form");
  const signupForm = document.getElementById("signup-form");
  let toastTimer;
  let currentUser = null;
  let firebaseInitError = null;
  let resolveInitialAuthState;
  const initialAuthStateReady = new Promise((resolve) => { resolveInitialAuthState = resolve; });

  try {
    localStorage.removeItem("beanButterDemoAccounts");
    localStorage.removeItem("beanButterDemoCustomer");
  } catch {
    // Firebase Auth remains independent of local demo-account storage.
  }

  const fallbackImageUrl = "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=85";
  document.querySelectorAll("img").forEach((image) => {
    let usingFallback = false;
    const useFallback = () => {
      if (usingFallback) {
        image.hidden = true;
        return;
      }
      usingFallback = true;
      image.alt = "Café coffee fallback photograph";
      image.src = fallbackImageUrl;
    };

    image.addEventListener("error", useFallback);
    if (image.complete && image.naturalWidth === 0) useFallback();
  });

  /* ---------- Toast helper ---------- */
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3200);
  }

  function authErrorMessage(error) {
    const messages = {
      "auth/email-already-in-use": "An account already exists for this email. Try logging in.",
      "auth/invalid-email": "Enter a valid email address.",
      "auth/weak-password": "Choose a stronger password with at least 6 characters.",
      "auth/invalid-credential": "Email or password is incorrect.",
      "auth/user-disabled": "This account is disabled. Please contact the café team.",
      "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
      "auth/network-request-failed": "Connection failed. Check your internet and try again.",
    };
    return messages[error.code] || "We couldn't complete that request. Please try again.";
  }

  function renderAccountState(user = currentUser) {
    loginButton.hidden = Boolean(user);
    greeting.hidden = !user;
    myBookingsButton.hidden = !user;
    logoutButton.hidden = !user;
    greeting.textContent = user ? "Hi, " + (user.displayName || user.email.split("@")[0]) : "";
  }

  function openAccountDialog(viewName) {
    const viewTitles = { login: "Log in", signup: "Create your account", bookings: "My Bookings" };
    document.querySelectorAll(".account-view").forEach((view) => {
      view.hidden = view.id !== viewName + "-view";
    });
    document.getElementById("account-title").textContent = viewTitles[viewName];
    document.querySelectorAll(".account-error").forEach((error) => { error.textContent = ""; });
    if (viewName === "bookings") renderBookings();
    if (!accountDialog.open) accountDialog.showModal();
    const firstField = document.querySelector("#" + viewName + "-view input");
    (firstField || document.querySelector("#" + viewName + "-view button"))?.focus();
  }

  async function renderBookings() {
    const list = document.getElementById("booking-list");
    const customerId = document.getElementById("customer-id");
    list.replaceChildren();
    customerId.textContent = currentUser ? "Customer ID: " + currentUser.uid : "";
    if (!currentUser) return;

    const loading = document.createElement("p");
    loading.className = "booking-empty";
    loading.textContent = "Loading bookings...";
    list.append(loading);

    try {
      const bookingsQuery = query(
        collection(firestoreDb, "bookings"),
        where("userId", "==", currentUser.uid)
      );
      const snapshot = await getDocs(bookingsQuery);
      const bookings = snapshot.docs.map((booking) => booking.data());
      bookings.sort((first, second) =>
        (second.createdAt?.toMillis?.() || 0) - (first.createdAt?.toMillis?.() || 0)
      );
      list.replaceChildren();

      if (bookings.length === 0) {
        const empty = document.createElement("p");
        empty.className = "booking-empty";
        empty.textContent = "No bookings yet.";
        list.append(empty);
        return;
      }

      const items = document.createElement("ul");
      items.className = "booking-list";
      bookings.forEach((booking) => {
        const item = document.createElement("li");
        item.className = "booking-item";
        const summary = document.createElement("p");
        const guestText = booking.guests === 1 ? "1 guest" : booking.guests + " guests";
        summary.textContent = booking.date + " at " + booking.time + " for " + guestText;
        const status = document.createElement("p");
        status.className = "fine-print";
        status.textContent = "Status: " + booking.status;
        item.append(summary, status);
        items.append(item);
      });
      list.append(items);
    } catch {
      list.replaceChildren();
      const error = document.createElement("p");
      error.className = "booking-empty";
      error.textContent = "Booking history couldn't be loaded. Please try again.";
      list.append(error);
    }
  }

  async function initializeFirebaseAuth() {
    await firebaseAuthReady;

    let firstState = true;
    onAuthStateChanged(auth, (user) => {
      currentUser = user;
      renderAccountState();
      if (firstState) {
        firstState = false;
        resolveInitialAuthState();
      }
    }, (error) => {
      firebaseInitError = error;
      if (firstState) {
        firstState = false;
        resolveInitialAuthState();
      }
    });
    return true;
  }

  const firebaseReady = initializeFirebaseAuth().catch((error) => {
    firebaseInitError = error;
    return false;
  });

  renderAccountState();
  loginButton.addEventListener("click", () => {
    setMenu(false);
    openAccountDialog("login");
  });
  document.querySelector(".account-close").addEventListener("click", () => accountDialog.close());
  accountDialog.addEventListener("click", (event) => {
    if (event.target === accountDialog) accountDialog.close();
  });
  document.querySelectorAll("[data-open-account]").forEach((button) => {
    button.addEventListener("click", () => openAccountDialog(button.dataset.openAccount));
  });
  myBookingsButton.addEventListener("click", () => openAccountDialog("bookings"));
  logoutButton.addEventListener("click", async () => {
    if (!await firebaseReady || !auth) {
      showToast(firebaseInitError ? authErrorMessage(firebaseInitError) : "Firebase Authentication is unavailable right now.");
      return;
    }
    try {
      await signOut(auth);
      showToast("You have been logged out.");
    } catch (error) {
      showToast(authErrorMessage(error));
    }
  });

  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.getElementById("signup-error");
    error.textContent = "";
    const name = signupForm.elements.name.value.trim();
    const email = signupForm.elements.email.value.trim();
    const password = signupForm.elements.password.value;
    const confirmPassword = signupForm.elements.confirmPassword.value;

    if (password !== confirmPassword) {
      error.textContent = "Your passwords do not match.";
      return;
    }
    if (!await firebaseReady || !auth) {
      error.textContent = firebaseInitError ? authErrorMessage(firebaseInitError) : "Firebase Authentication is unavailable right now.";
      return;
    }

    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      try {
        await setDoc(doc(firestoreDb, "users", credential.user.uid), {
          uid: credential.user.uid,
          name,
          email: credential.user.email,
          createdAt: serverTimestamp(),
        });
      } catch {
        currentUser = credential.user;
        renderAccountState();
        error.textContent = "Your account was created, but its profile could not be saved. Check the Firestore rules and try again.";
        return;
      }

      let profileSaved = true;
      try {
        await updateProfile(credential.user, { displayName: name });
      } catch {
        profileSaved = false;
      }
      currentUser = credential.user;
      signupForm.reset();
      renderAccountState();
      accountDialog.close();
      showToast(profileSaved ? "Welcome, " + name + ". Your account is ready." : "Your account was created, but your profile name could not be saved.");
    } catch (authError) {
      error.textContent = authErrorMessage(authError);
    }
  });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.getElementById("login-error");
    error.textContent = "";
    const email = loginForm.elements.email.value.trim();
    const password = loginForm.elements.password.value;
    if (!await firebaseReady || !auth) {
      error.textContent = firebaseInitError ? authErrorMessage(firebaseInitError) : "Firebase Authentication is unavailable right now.";
      return;
    }

    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      currentUser = credential.user;
      loginForm.reset();
      renderAccountState();
      accountDialog.close();
      showToast("Welcome back, " + (credential.user.displayName || email.split("@")[0]) + ".");
    } catch (authError) {
      error.textContent = authErrorMessage(authError);
    }
  });

  /* ---------- Mobile navigation ---------- */
  function setMenu(open) {
    navMenu.classList.toggle("is-open", open);
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  }

  navToggle.addEventListener("click", () => {
    setMenu(navToggle.getAttribute("aria-expanded") !== "true");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMenu(false);
  });

  /* ---------- Smooth scrolling (also closes the mobile menu) ---------- */
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const id = link.getAttribute("href");
      if (id === "#") { event.preventDefault(); return; }
      const target = document.querySelector(id);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
      setMenu(false);
    });
  });

  /* ---------- Simple button interactions ---------- */
  document.querySelectorAll(".js-demo-link").forEach((link) => {
    link.addEventListener("click", () => showToast("Social links are for the demo only."));
  });

  document.querySelectorAll(".fav-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const pressed = button.getAttribute("aria-pressed") === "true";
      button.setAttribute("aria-pressed", String(!pressed));
    });
  });

  /* ---------- Reservation form ---------- */
  const form = document.getElementById("reservation-form");
  const dateInput = document.getElementById("res-date");
  const message = document.getElementById("form-message");

  // Only allow today or later (uses local date, not UTC)
  const now = new Date();
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split("T")[0];
  dateInput.min = today;

  function setError(input, text) {
    const error = document.getElementById(input.id.replace("res-", "") + "-error");
    error.textContent = text;
    input.classList.toggle("is-invalid", Boolean(text));
    input.setAttribute("aria-invalid", text ? "true" : "false");
    return !text;
  }

  function validateForm() {
    const date = form.elements.date;
    const time = form.elements.time;
    const guests = form.elements.guests;

    let dateError = "";
    if (!date.value) dateError = "Please choose a date.";
    else if (date.value < today) dateError = "Please choose today or a future date.";

    const results = [
      setError(date, dateError),
      setError(time, time.value ? "" : "Please choose a time."),
      setError(guests, guests.value ? "" : "Please choose the number of guests."),
    ];
    return results.every(Boolean);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.classList.remove("is-visible");
    message.textContent = "";
    if (!await firebaseReady) {
      message.textContent = firebaseInitError ? authErrorMessage(firebaseInitError) : "Firebase Authentication is unavailable right now.";
      message.classList.add("is-visible");
      return;
    }
    await initialAuthStateReady;

    if (!currentUser) {
      message.textContent = "Please log in or sign up before requesting a table.";
      message.classList.add("is-visible");
      openAccountDialog("login");
      return;
    }

    if (!validateForm()) {
      form.querySelector(".is-invalid").focus();
      return;
    }

    const { date, time, guests } = form.elements;
    const bookingRef = doc(collection(firestoreDb, "bookings"));
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      await setDoc(bookingRef, {
        bookingId: bookingRef.id,
        userId: currentUser.uid,
        customerName: currentUser.displayName || currentUser.email.split("@")[0],
        customerEmail: currentUser.email,
        date: date.value,
        time: time.value,
        guests: Number(guests.value),
        status: "pending",
        createdAt: serverTimestamp(),
      });
      message.textContent = "Your reservation request was saved. Booking ID: " + bookingRef.id + ". Status: pending.";
      message.classList.add("is-visible");
      form.reset();
    } catch (error) {
      message.textContent = error.code === "permission-denied"
        ? "Your booking couldn't be saved because access was denied. Please contact the café team."
        : "Your booking couldn't be saved. Check your connection and try again.";
      message.classList.add("is-visible");
    } finally {
      submitButton.disabled = false;
    }
  });

  // Clear an error as soon as the visitor fixes the field
  form.querySelectorAll("input, select").forEach((field) => {
    field.addEventListener("input", () => {
      if (field.classList.contains("is-invalid")) setError(field, "");
    });
  });
})();