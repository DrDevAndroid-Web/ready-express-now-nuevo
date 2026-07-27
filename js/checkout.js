import { createOrder } from "./api.js?v8";
import { getCart, getTotal, clearCart, closeCart } from "./cart.js?v8";
import { savePendingPayment } from "./payment.js?v8";
import { cargarMetodosPago, renderMetodosEnCheckout } from "./payment-methods.js?v8";

let currentOrderId = null;
let currentTotal = 0;
let currentSelectedMethod = null;
let checkoutStep = 1;

export function showCheckoutModal() {
  const cart = getCart();
  if (cart.length === 0) return;

  closeCart();

  const summary = document.getElementById("checkout-summary");
  if (summary) {
    summary.innerHTML = cart
      .map(
        (item) =>
          `<div class="summary-row">
            <span>${item.nombre} x${item.qty}</span>
            <span>$${(item.precio * item.qty).toFixed(2)}</span>
          </div>`
      )
      .join("") +
      `<div class="summary-row total-row">
        <span><strong>Total</strong></span>
        <span><strong>$${getTotal().toFixed(2)}</strong></span>
      </div>`;
  }

  currentTotal = getTotal();
  openModal("checkout-modal");
  goToCheckoutStep(1, false);
}

export function initCheckout() {
  setupCheckoutFields();

  document.getElementById("checkout-btn")?.addEventListener("click", showCheckoutModal);
  document.getElementById("cart-checkout-btn")?.addEventListener("click", showCheckoutModal);
  document.getElementById("checkout-close")?.addEventListener("click", () => closeModal("checkout-modal"));

  // Botón Siguiente (Paso 1 → Paso 2)
  document.getElementById("checkout-next-btn")?.addEventListener("click", async () => {
    if (validateCheckoutStep(1)) {
      await goToCheckoutStep(2);
    }
  });

  // Botón Atrás (Paso 3 → Paso 2)
  document.getElementById("checkout-back-btn")?.addEventListener("click", () => {
    goToCheckoutStep(2);
  });

  const form = document.getElementById("checkout-form");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (checkoutStep === 2) {
      await goToCheckoutStep(3);
      return;
    }
    if (checkoutStep === 3) {
      await submitOrder(form);
    }
  });
}

function setupCheckoutFields() {
  updateLabel("sender_name", "Nombre del que envía");
  updateLabel("sender_phone", "Teléfono / WhatsApp");
  updateLabel("receiver_name", "Nombre de quien recibe");
  updateLabel("customer_address", "Dirección de entrega en Guantánamo");
  updateLabel("receiver_phone", "Teléfono de quien recibe");
}

function updateLabel(inputId, text) {
  const label = document.querySelector(`label[for="${inputId}"]`);
  if (!label) return;
  const required = label.querySelector(".required") ? ' <span class="required">*</span>' : "";
  label.innerHTML = `${text}${required}`;
}

async function goToCheckoutStep(step, validate = true) {
  const form = document.getElementById("checkout-form");
  if (!form) return false;

  if (step === 2 && validate && !validateCheckoutStep(1)) return false;
  if (step === 3 && validate && !validateCheckoutStep(2)) return false;

  checkoutStep = step;

  // Ocultar todos los steps
  document.querySelectorAll("[data-checkout-step]").forEach((el) => (el.style.display = "none"));
  document.getElementById("checkout-payment-step").style.display = "none";
  document.getElementById("checkout-actions-step1").style.display = "none";

  // Mostrar step actual
  if (step === 1 || step === 2) {
    const stepEl = document.querySelector(`[data-checkout-step="${step}"]`);
    if (stepEl) stepEl.style.display = "block";
    document.getElementById("checkout-actions-step1").style.display = "flex";
  } else if (step === 3) {
    // Paso 3: Métodos de pago
    await renderPaymentMethods();
    document.getElementById("checkout-payment-step").style.display = "block";
  }

  return true;
}

function validateCheckoutStep(step) {
  const stepEl = document.querySelector(`[data-checkout-step="${step}"]`);
  if (!stepEl) return true;

  const fields = [...stepEl.querySelectorAll("input, textarea")];
  const invalid = fields.find((field) => !field.checkValidity());
  if (invalid) {
    invalid.reportValidity();
    return false;
  }
  return true;
}

async function submitOrder(form) {
  const btn = form.querySelector('button[type="submit"]');
  const errorEl = document.getElementById("payment-instructions");
  const cart = getCart();

  if (!currentSelectedMethod) {
    alert("Por favor selecciona un método de pago");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Creando pedido...";
  if (errorEl) errorEl.style.display = "none";

  const senderName = fieldValue(form, "sender_name") || fieldValue(form, "customer_name");
  const senderPhone = fieldValue(form, "sender_phone") || fieldValue(form, "customer_phone");
  const receiverName = fieldValue(form, "receiver_name");
  const receiverPhone = fieldValue(form, "receiver_phone");
  const deliveryNotes = fieldValue(form, "delivery_notes");

  const orderData = {
    customer_name: senderName,
    customer_phone: senderPhone,
    customer_address: fieldValue(form, "customer_address"),
    customer_email: fieldValue(form, "customer_email"),
    sender_name: senderName,
    sender_phone: senderPhone,
    receiver_name: receiverName,
    receiver_phone: receiverPhone,
    delivery_notes: deliveryNotes,
    items: cart.map((i) => ({
      id: i.id,
      nombre: i.nombre,
      precio: i.precio,
      cantidad: i.qty,
      precio_total: i.precio * i.qty,
      category: i.category,
    })),
    total: getTotal(),
    payment_method: currentSelectedMethod,
    status: "pending",
  };

  try {
    const order = await createOrder(orderData);
    currentOrderId = order.id;
    currentTotal = orderData.total;

    savePendingPayment(currentOrderId, currentTotal);
    clearCart();
    closeModal("checkout-modal");
    form.reset();
    window.location.href = "./pago.html";
  } catch (err) {
    const errorDisplay = document.getElementById("checkout-error-step1");
    if (errorDisplay) {
      errorDisplay.textContent = err.message || "❌ No pudimos crear tu pedido. Por favor intenta de nuevo o contacta a soporte: +53 5 8324155";
      errorDisplay.style.display = "block";
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "He realizado el pago, continuar";
  }
}

async function renderPaymentMethods() {
  try {
    // Mostrar orden y total
    document.getElementById("checkout-order-display").textContent = `#${currentOrderId || "-"}`;
    document.getElementById("checkout-total-display").textContent = `$${currentTotal.toFixed(2)}`;

    // Cargar métodos de pago
    const metodos = await cargarMetodosPago();
    const container = document.getElementById("checkout-methods-container");

    if (!container) return;

    if (!metodos.length) {
      container.innerHTML = '<div class="alerta">Sin métodos de pago disponibles</div>';
      return;
    }

    // Renderizar métodos de pago
    container.innerHTML = metodos.map(metodo => `
      <div class="method-card" data-method="${metodo.id}" data-method-name="${metodo.method_name}" data-instructions="${escapeHtml(metodo.instructions || '')}">
        <div class="method-content">
          ${metodo.image_url ? `<img src="${metodo.image_url}" alt="${metodo.method_name}" class="method-image">` : `<div class="method-icon">${getIconoMetodo(metodo.method_name)}</div>`}
          <div class="method-info">
            <strong>${metodo.method_name}</strong>
            ${metodo.account_number ? `<small>${metodo.account_number}</small>` : ''}
          </div>
        </div>
      </div>
    `).join('');

    // Event listeners para seleccionar método
    container.querySelectorAll(".method-card").forEach(card => {
      card.addEventListener("click", () => {
        selectPaymentMethod(card.dataset.method, card.dataset.methodName, card.dataset.instructions);
      });
    });
  } catch (err) {
    console.error("Error cargando métodos:", err);
  }
}

function selectPaymentMethod(methodId, methodName, instructions) {
  // Marcar método seleccionado
  document.querySelectorAll(".method-card").forEach(card => card.classList.remove("selected"));
  document.querySelector(`[data-method="${methodId}"]`)?.classList.add("selected");

  currentSelectedMethod = methodId;

  // Mostrar instrucciones
  const instructionsDiv = document.getElementById("payment-instructions");
  const instructionsText = document.getElementById("payment-instructions-text");

  if (instructions) {
    instructionsText.innerHTML = instructions.split('\n').map(line => `<div>${escapeHtml(line)}</div>`).join('');
    instructionsDiv.style.display = "block";
  } else {
    instructionsDiv.style.display = "none";
  }
}

function getIconoMetodo(nombre) {
  const iconos = {
    'zelle': '💳',
    'tocopay': '💰',
    'paypal': '🅿️',
    'stripe': '💸'
  };
  return iconos[nombre.toLowerCase()] || '💵';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function fieldValue(form, name) {
  return form.elements[name]?.value?.trim() || "";
}

export function openModal(id) {
  document.getElementById(id)?.classList.add("open");
  document.getElementById("overlay")?.classList.add("show");
  document.body.style.overflow = "hidden";
}

export function closeModal(id) {
  document.getElementById(id)?.classList.remove("open");
  const anyOpen = document.querySelector(".modal.open, #cart-panel.open");
  if (!anyOpen) {
    document.getElementById("overlay")?.classList.remove("show");
    document.body.style.overflow = "";
  }
}
