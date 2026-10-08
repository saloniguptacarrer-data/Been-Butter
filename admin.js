import {
  collection,
  deleteField,
  doc,
  firebaseAuth as auth,
  firestoreDb,
  firebaseAuthReady,
  getDocFromServer,
  getDocs,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateDoc,
} from "./firebase-app.js";

const loadingPanel = document.getElementById("admin-loading");
const accessPanel = document.getElementById("admin-access");
const dashboard = document.getElementById("admin-dashboard");
const identity = document.getElementById("admin-identity");
const logoutButton = document.getElementById("admin-logout");
const accessLogoutButton = document.getElementById("admin-access-logout");
const loginForm = document.getElementById("admin-login-form");
const loginError = document.getElementById("admin-login-error");
const loginSubmit = document.getElementById("admin-login-submit");
const tableBody = document.getElementById("booking-rows");
const feedback = document.getElementById("admin-feedback");
let currentUser = null;
let authCheckId = 0;

function showPanel(panel) {
  loadingPanel.hidden = panel !== "loading";
  accessPanel.hidden = panel !== "access";
  dashboard.hidden = panel !== "dashboard";
}

function showAccess(title, message, signedIn = false, showLogin = true) {
  document.getElementById("admin-access-title").textContent = title;
  document.getElementById("admin-access-message").textContent = message;
  loginForm.hidden = !showLogin;
  loginError.textContent = "";
  accessLogoutButton.hidden = !signedIn;
  showPanel("access");
}

function loginErrorMessage(error) {
  const messages = {
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/too-many-requests": "Too many attempts. Please wait and try again.",
    "auth/network-request-failed": "Connection failed. Check your internet and try again.",
  };
  return messages[error.code] || "We couldn't sign you in. Please try again.";
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function formatMoney(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value);
}

function updateMetrics(bookings) {
  const today = localDateKey();
  document.getElementById("metric-total").textContent = String(bookings.length);
  document.getElementById("metric-pending").textContent = String(bookings.filter((booking) => booking.status === "pending").length);
  document.getElementById("metric-confirmed").textContent = String(bookings.filter((booking) => booking.status === "confirmed").length);
  document.getElementById("metric-cancelled").textContent = String(bookings.filter((booking) => booking.status === "cancelled").length);
  document.getElementById("metric-revenue").textContent = formatMoney(
    bookings.reduce((total, booking) => total + (Number.isFinite(booking.amountPaid) ? booking.amountPaid : 0), 0)
  );
  document.getElementById("metric-today").textContent = String(bookings.filter((booking) => booking.date === today).length);
  document.getElementById("booking-count").textContent = bookings.length + (bookings.length === 1 ? " record" : " records");
}

function appendTextCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value === undefined || value === null || value === "" ? "—" : String(value);
  row.append(cell);
  return cell;
}

function makeSelect(field, options, selectedValue) {
  const select = document.createElement("select");
  select.dataset.field = field;
  select.setAttribute("aria-label", field.replace(/[A-Z]/g, (letter) => " " + letter).toLowerCase());
  options.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = value === (selectedValue || "");
    select.append(option);
  });
  return select;
}

function makeInput(field, value, type = "text") {
  const input = document.createElement("input");
  input.type = type;
  input.dataset.field = field;
  input.setAttribute("aria-label", field.replace(/[A-Z]/g, (letter) => " " + letter).toLowerCase());
  if (type === "number") {
    input.min = "0";
    input.step = "0.01";
  }
  input.value = value === undefined || value === null ? "" : String(value);
  return input;
}

function makeBookingRow(booking) {
  const row = document.createElement("tr");
  row.dataset.bookingId = booking.id;
  appendTextCell(row, booking.customerName);
  appendTextCell(row, booking.customerEmail);
  appendTextCell(row, booking.date);
  appendTextCell(row, booking.time);
  appendTextCell(row, booking.guests);

  const statusCell = document.createElement("td");
  statusCell.append(makeSelect("status", [
    ["pending", "Pending"],
    ["confirmed", "Confirmed"],
    ["cancelled", "Cancelled"],
  ], booking.status));
  row.append(statusCell);

  const amountCell = document.createElement("td");
  amountCell.append(makeInput("amount", booking.amount, "number"));
  row.append(amountCell);

  const methodCell = document.createElement("td");
  methodCell.append(makeSelect("paymentMethod", [
    ["", "Not set"],
    ["Online", "Online"],
    ["Cash", "Cash"],
  ], booking.paymentMethod));
  row.append(methodCell);

  const paymentStatusCell = document.createElement("td");
  paymentStatusCell.append(makeSelect("paymentStatus", [
    ["", "Not set"],
    ["Paid", "Paid"],
    ["Partially Paid", "Partially Paid"],
    ["Pending", "Pending"],
  ], booking.paymentStatus));
  row.append(paymentStatusCell);

  const paidCell = document.createElement("td");
  paidCell.append(makeInput("amountPaid", booking.amountPaid, "number"));
  row.append(paidCell);

  const remainingCell = document.createElement("td");
  const remaining = document.createElement("span");
  remaining.className = "admin-remaining";
  remaining.dataset.field = "amountRemaining";
  remaining.textContent = formatMoney(booking.amountRemaining);
  remainingCell.append(remaining);
  row.append(remainingCell);

  const transactionCell = document.createElement("td");
  transactionCell.append(makeInput("transactionId", booking.transactionId));
  row.append(transactionCell);

  const actionCell = document.createElement("td");
  actionCell.className = "admin-row-actions";
  const saveButton = document.createElement("button");
  saveButton.className = "btn btn-primary admin-save";
  saveButton.type = "button";
  saveButton.textContent = "Save";
  saveButton.addEventListener("click", () => saveBooking(row));
  const rowMessage = document.createElement("span");
  rowMessage.className = "admin-row-message";
  rowMessage.setAttribute("role", "status");
  actionCell.append(saveButton, rowMessage);
  row.append(actionCell);

  const updateRemaining = () => {
    const amountValue = row.querySelector('[data-field="amount"]').value;
    const paidValue = row.querySelector('[data-field="amountPaid"]').value;
    const amount = amountValue === "" ? null : Number(amountValue);
    const amountPaid = paidValue === "" ? 0 : Number(paidValue);
    remaining.textContent = amount !== null && Number.isFinite(amount) && Number.isFinite(amountPaid)
      ? formatMoney(Math.max(0, amount - amountPaid))
      : "—";
  };
  row.querySelector('[data-field="amount"]').addEventListener("input", updateRemaining);
  row.querySelector('[data-field="amountPaid"]').addEventListener("input", updateRemaining);
  return row;
}

async function loadBookings() {
  feedback.textContent = "Loading bookings...";
  feedback.classList.remove("is-error");
  document.getElementById("refresh-bookings").disabled = true;
  try {
    const snapshot = await getDocs(collection(firestoreDb, "bookings"));
    const bookings = snapshot.docs.map((booking) => ({ id: booking.id, ...booking.data() }));
    bookings.sort((first, second) => {
      const firstCreated = first.createdAt?.toMillis?.() || 0;
      const secondCreated = second.createdAt?.toMillis?.() || 0;
      return secondCreated - firstCreated;
    });
    updateMetrics(bookings);
    tableBody.replaceChildren();
    if (bookings.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.className = "admin-empty";
      cell.colSpan = 13;
      cell.textContent = "No bookings found.";
      row.append(cell);
      tableBody.append(row);
    } else {
      bookings.forEach((booking) => tableBody.append(makeBookingRow(booking)));
    }
    feedback.textContent = "Updated " + new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date());
  } catch (error) {
    feedback.textContent = error.code === "permission-denied"
      ? "Access denied. Check the admin membership and Firestore rules."
      : "Bookings could not be loaded. Check your connection and try again.";
    feedback.classList.add("is-error");
  } finally {
    document.getElementById("refresh-bookings").disabled = false;
  }
}

function setRowMessage(row, text, isError = false) {
  const message = row.querySelector(".admin-row-message");
  message.textContent = text;
  message.classList.toggle("is-error", isError);
}

async function saveBooking(row) {
  const saveButton = row.querySelector(".admin-save");
  const status = row.querySelector('[data-field="status"]').value;
  const method = row.querySelector('[data-field="paymentMethod"]').value;
  const paymentStatus = row.querySelector('[data-field="paymentStatus"]').value;
  const amountInput = row.querySelector('[data-field="amount"]').value;
  const paidInput = row.querySelector('[data-field="amountPaid"]').value;
  const transactionId = row.querySelector('[data-field="transactionId"]').value.trim();
  const amount = amountInput === "" ? null : Number(amountInput);
  const amountPaid = paidInput === "" ? null : Number(paidInput);

  if ((amount !== null && (!Number.isFinite(amount) || amount < 0)) ||
      (amountPaid !== null && (!Number.isFinite(amountPaid) || amountPaid < 0))) {
    setRowMessage(row, "Amounts must be valid non-negative numbers.", true);
    return;
  }
  if (amount !== null && amountPaid !== null && amountPaid > amount) {
    setRowMessage(row, "Amount paid cannot exceed the total amount.", true);
    return;
  }
  if (paymentStatus === "Paid" && (amount === null || (amountPaid ?? 0) !== amount)) {
    setRowMessage(row, "For Paid status, enter the total amount and full amount paid.", true);
    return;
  }
  if (paymentStatus === "Partially Paid" && (amount === null || amountPaid === null || amountPaid <= 0 || amountPaid >= amount)) {
    setRowMessage(row, "For Partially Paid, enter an amount paid below the total.", true);
    return;
  }
  if (method === "Online" && ["Paid", "Partially Paid"].includes(paymentStatus) && !transactionId) {
    setRowMessage(row, "Enter a transaction ID for an online payment.", true);
    return;
  }

  const amountPaidToSave = amount !== null ? (amountPaid ?? 0) : amountPaid;
  const updates = {
    status,
    paymentMethod: method || deleteField(),
    paymentStatus: paymentStatus || deleteField(),
    amount: amount === null ? deleteField() : amount,
    amountPaid: amountPaidToSave === null ? deleteField() : amountPaidToSave,
    amountRemaining: amount === null ? deleteField() : amount - amountPaidToSave,
    transactionId: transactionId || deleteField(),
  };

  saveButton.disabled = true;
  setRowMessage(row, "Saving...");
  try {
    await updateDoc(doc(firestoreDb, "bookings", row.dataset.bookingId), updates);
    setRowMessage(row, "Saved.");
    await loadBookings();
  } catch (error) {
    setRowMessage(row, error.code === "permission-denied"
      ? "Save denied. Check admin access and Firestore rules."
      : "Could not save. Please try again.", true);
  } finally {
    saveButton.disabled = false;
  }
}

async function signOutAdmin() {
  await signOut(auth);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  loginSubmit.disabled = true;

  try {
    await firebaseAuthReady;
    await signInWithEmailAndPassword(
      auth,
      loginForm.elements.email.value.trim(),
      loginForm.elements.password.value
    );
    loginForm.reset();
  } catch (error) {
    loginError.textContent = loginErrorMessage(error);
  } finally {
    loginSubmit.disabled = false;
  }
});

logoutButton.addEventListener("click", signOutAdmin);
accessLogoutButton.addEventListener("click", signOutAdmin);
document.getElementById("refresh-bookings").addEventListener("click", loadBookings);

async function startAdminDashboard() {
  await firebaseAuthReady;
  onAuthStateChanged(auth, async (user) => {
    const requestId = ++authCheckId;
    currentUser = user;
    if (!user) {
      identity.hidden = true;
      logoutButton.hidden = true;
      showAccess("Admin Login", "Sign in with your administrator email and password to view bookings.");
      return;
    }

    try {
      const membership = await getDocFromServer(doc(firestoreDb, "admins", user.uid));
      if (requestId !== authCheckId) return;
      if (!membership.exists()) {
        identity.hidden = true;
        logoutButton.hidden = true;
        showAccess("Admin access denied", "This account is not authorized to view the dashboard. Sign in with an administrator account.", true);
        return;
      }

      identity.textContent = user.displayName || user.email || "Administrator";
      identity.hidden = false;
      logoutButton.hidden = false;
      showPanel("dashboard");
      await loadBookings();
    } catch (error) {
      if (requestId !== authCheckId) return;
      identity.hidden = true;
      logoutButton.hidden = true;
      const denied = error.code === "permission-denied";
      showAccess(denied ? "Admin access denied" : "Dashboard unavailable", denied
        ? "This account is not authorized to view the dashboard. Sign in with an administrator account."
        : "Unable to verify administrator access. Check Firestore rules and try again.", true, denied);
    }
  }, () => {
    showAccess("Dashboard unavailable", "Unable to verify your sign-in. Reload the page and try again.");
  });
}

startAdminDashboard().catch(() => {
  showAccess("Dashboard unavailable", "Firebase Authentication could not be initialized.");
});