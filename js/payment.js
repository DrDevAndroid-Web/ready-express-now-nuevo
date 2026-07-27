import { uploadPayment } from "./api.js?v8";

export const PENDING_PAYMENT_KEY = "ren_pending_payment";

let pendingOrderId = null;
let pendingTotal = 0;

export function savePendingPayment(orderId, total) {
  localStorage.setItem(
    PENDING_PAYMENT_KEY,
    JSON.stringify({
      orderId,
      total,
      createdAt: new Date().toISOString(),
    })
  );
}

export function getPendingPayment() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_PAYMENT_KEY));
  } catch {
    return null;
  }
}

export function hasPendingPayment() {
  const pending = getPendingPayment();
  return Boolean(pending?.orderId && Number.isFinite(Number(pending.total)));
}

export function clearPendingPayment() {
  localStorage.removeItem(PENDING_PAYMENT_KEY);
}

export function redirectToPendingPayment() {
  if (!hasPendingPayment()) return false;
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  if (currentPage !== "pago.html") {
    window.location.href = "./pago.html";
    return true;
  }
  return false;
}

export function initPaymentPage() {
  const pending = getPendingPayment();
  const emptyState = document.getElementById("payment-empty-state");
  const paymentContent = document.getElementById("payment-content");

  if (!pending?.orderId || !Number.isFinite(Number(pending.total))) {
    if (emptyState) emptyState.style.display = "block";
    if (paymentContent) paymentContent.style.display = "none";
    return;
  }

  pendingOrderId = pending.orderId;
  pendingTotal = Number(pending.total);

  const orderIdEl = document.getElementById("payment-order-id");
  const totalEl = document.getElementById("payment-total");
  if (orderIdEl) orderIdEl.textContent = `#${pendingOrderId}`;
  if (totalEl) totalEl.textContent = `$${pendingTotal.toFixed(2)}`;

  if (emptyState) emptyState.style.display = "none";
  if (paymentContent) paymentContent.style.display = "block";

  resetPaymentForm();
  bindPaymentEvents();
}

function bindPaymentEvents() {
  document.querySelectorAll(".method-card").forEach((card) => {
    card.addEventListener("click", () => selectMethod(card.dataset.method));
  });

  initDropzone();

  const form = document.getElementById("payment-form");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await submitPayment(form);
  });

  document.getElementById("success-close")?.addEventListener("click", () => {
    window.location.href = "./index.html";
  });
}

function resetPaymentForm() {
  const form = document.getElementById("payment-form");
  if (form) form.reset();

  const preview = document.getElementById("file-preview");
  if (preview) {
    preview.src = "";
    preview.style.display = "none";
  }

  const dropzone = document.getElementById("dropzone");
  if (dropzone) dropzone.classList.remove("has-file");

  const errorEl = document.getElementById("payment-error");
  if (errorEl) errorEl.style.display = "none";

  selectMethod(null);
}

function selectMethod(method) {
  document.querySelectorAll(".method-card").forEach((card) => card.classList.remove("selected"));
  if (method) {
    document.querySelector(`[data-method="${method}"]`)?.classList.add("selected");
  }
  const methodInput = document.getElementById("payment-method-input");
  if (methodInput) methodInput.value = method || "";
}

function initDropzone() {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("payment-file");
  const preview = document.getElementById("file-preview");

  if (!dropzone || !fileInput || !preview) return;

  dropzone.addEventListener("click", () => fileInput.click());

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-over");
  });

  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) setFile(file, fileInput, preview, dropzone);
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) setFile(file, fileInput, preview, dropzone);
  });
}

function setFile(file, input, preview, dropzone) {
  if (!file.type.startsWith("image/")) {
    showPaymentError("⚠️ Solo aceptamos imágenes (JPG, PNG). Por favor sube una captura de pantalla clara del comprobante.");
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showPaymentError("⚠️ La imagen es muy grande (máx 5 MB). Intenta con una captura más pequeña o comprimida.");
    return;
  }

  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;

  const reader = new FileReader();
  reader.onload = (e) => {
    preview.src = e.target.result;
    preview.style.display = "block";
    dropzone.classList.add("has-file");
  };
  reader.readAsDataURL(file);
}

async function submitPayment(form) {
  const btn = form.querySelector('button[type="submit"]');
  const method = document.getElementById("payment-method-input")?.value;
  const fileInput = document.getElementById("payment-file");

  hidePaymentError();

  if (!pendingOrderId || !pendingTotal) {
    showPaymentError("❌ No encontramos tu orden. Por favor vuelve a la tienda, verifica tu carrito y confirma tu pedido de nuevo.");
    return;
  }

  if (!method) {
    showPaymentError("❌ Por favor selecciona cómo pagaste: Zelle o Tocopay.");
    return;
  }

  if (!fileInput?.files?.length) {
    showPaymentError("📸 Por favor sube una captura clara del comprobante de pago donde se vea el monto, fecha y referencia.");
    return;
  }

  // Show loading state with spinner
  btn.disabled = true;
  btn.style.opacity = "0.6";
  const originalText = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span>Comprimiendo y enviando...';

  const formData = new FormData();
  formData.append("image", fileInput.files[0]);
  formData.append("order_id", pendingOrderId);
  formData.append("method", method);
  formData.append("amount", pendingTotal.toString());

  try {
    await uploadPayment(formData);
    btn.innerHTML = '<span style="color:var(--green)">✓</span> ¡Enviado exitosamente!';
    setTimeout(() => {
      showSuccess();
      clearPendingPayment();
    }, 800);
  } catch (err) {
    const message = err.message || `❌ No pudimos enviar tu comprobante. Por favor intenta de nuevo o contacta a nuestro equipo: 📱 +53 5 8324155`;
    showPaymentError(message);
    btn.disabled = false;
    btn.style.opacity = "1";
    btn.textContent = originalText;
  }
}

function showPaymentError(message) {
  const errorEl = document.getElementById("payment-error");
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.style.display = "block";
}

function hidePaymentError() {
  const errorEl = document.getElementById("payment-error");
  if (errorEl) errorEl.style.display = "none";
}

function showSuccess() {
  const paymentContent = document.getElementById("payment-content");
  const screen = document.getElementById("success-screen");
  const orderRef = document.getElementById("success-order-ref");

  if (orderRef) orderRef.textContent = `#${pendingOrderId || "-"}`;
  if (paymentContent) paymentContent.style.display = "none";
  screen?.classList.add("open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
