import { createOrder } from "./api.js?v8";
import { getCart, getTotal, clearCart, closeCart } from "./cart.js?v8";
import { savePendingPayment } from "./payment.js?v8";
import { cargarMetodosPago, renderMetodosEnCheckout } from "./payment-methods.js?v8";

let currentOrderId = null;
let currentTotal = 0;
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

  openModal("checkout-modal");
  goToCheckoutStep(1, false);
}

export function initCheckout() {
  document.getElementById("checkout-btn")?.addEventListener("click", showCheckoutModal);
  document.getElementById("cart-checkout-btn")?.addEventListener("click", showCheckoutModal);
  document.getElementById("checkout-close")?.addEventListener("click", () => closeModal("checkout-modal"));

  const form = document.getElementById("checkout-form");
  setupCheckoutSlides(form);
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (checkoutStep === 1) {
      goToCheckoutStep(2);
      return;
    }
    await submitOrder(form);
  });
}

function setupCheckoutSlides(form) {
  if (!form || form.dataset.slidesReady === "true") return;

  const senderName = form.querySelector("#sender_name")?.closest(".form-group");
  const senderPhone = form.querySelector("#sender_phone")?.closest(".form-group");
  const receiverName = form.querySelector("#receiver_name")?.closest(".form-group");
  const address = form.querySelector("#customer_address")?.closest(".form-group");
  const receiverPhone = form.querySelector("#receiver_phone")?.closest(".form-group");
  const notes = form.querySelector("#delivery_notes")?.closest(".form-group");
  const errorEl = document.getElementById("checkout-error");
  const submitBtn = form.querySelector('button[type="submit"]');

  if (!senderName || !senderPhone || !receiverName || !address || !receiverPhone || !submitBtn) return;

  updateLabel("sender_name", "Nombre del que envía");
  updateLabel("sender_phone", "Teléfono / WhatsApp");
  updateLabel("receiver_name", "Nombre de quien recibe");
  updateLabel("customer_address", "Dirección de entrega en Guantánamo");
  updateLabel("receiver_phone", "Teléfono de quien recibe");

  const progress = document.createElement("div");
  progress.className = "checkout-progress";
  progress.innerHTML = `
    <span class="checkout-step-dot active" data-step-dot="1">1</span>
    <span class="checkout-step-line"></span>
    <span class="checkout-step-dot" data-step-dot="2">2</span>`;

  const senderSlide = createCheckoutSlide(
    "sender",
    "Paso 1 de 2",
    "Datos de la persona que envía",
    [senderName, senderPhone]
  );

  const receiverSlide = createCheckoutSlide(
    "receiver",
    "Paso 2 de 2",
    "Datos de la persona que recibe",
    [receiverName, address, receiverPhone, notes].filter(Boolean)
  );

  form.insertBefore(progress, form.firstElementChild);
  form.insertBefore(senderSlide, errorEl);
  form.insertBefore(receiverSlide, errorEl);

  submitBtn.id = "checkout-submit-btn";
  submitBtn.textContent = "Enviar Pedido";

  const actions = document.createElement("div");
  actions.className = "checkout-actions";
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.id = "checkout-back-btn";
  backBtn.className = "form-submit checkout-back";
  backBtn.textContent = "Atrás";
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.id = "checkout-next-btn";
  nextBtn.className = "form-submit";
  nextBtn.textContent = "Siguiente";

  submitBtn.before(actions);
  actions.append(backBtn, nextBtn, submitBtn);

  nextBtn.addEventListener("click", () => goToCheckoutStep(2));
  backBtn.addEventListener("click", () => goToCheckoutStep(1));

  form.dataset.slidesReady = "true";
  goToCheckoutStep(1, false);
}

function createCheckoutSlide(name, eyebrow, title, fields) {
  const slide = document.createElement("section");
  slide.className = "checkout-slide";
  slide.dataset.checkoutSlide = name;
  slide.innerHTML = `
    <div class="checkout-slide-heading">
      <span>${eyebrow}</span>
      <h4>${title}</h4>
    </div>`;
  fields.forEach((field) => slide.appendChild(field));
  return slide;
}

function updateLabel(inputId, text) {
  const label = document.querySelector(`label[for="${inputId}"]`);
  if (!label) return;
  const required = label.querySelector(".required") ? ' <span class="required">*</span>' : "";
  label.innerHTML = `${text}${required}`;
}

function goToCheckoutStep(step, validate = true) {
  const form = document.getElementById("checkout-form");
  if (!form) return false;

  if (step === 2 && validate && !validateCheckoutStep(1)) return false;

  checkoutStep = step;
  form.querySelectorAll(".checkout-slide").forEach((slide) => {
    slide.classList.toggle("active", slide.dataset.checkoutSlide === (step === 1 ? "sender" : "receiver"));
  });
  form.querySelectorAll("[data-step-dot]").forEach((dot) => {
    dot.classList.toggle("active", Number(dot.dataset.stepDot) <= step);
  });

  const backBtn = document.getElementById("checkout-back-btn");
  const nextBtn = document.getElementById("checkout-next-btn");
  const submitBtn = document.getElementById("checkout-submit-btn");

  if (backBtn) backBtn.style.display = step === 1 ? "none" : "block";
  if (nextBtn) nextBtn.style.display = step === 1 ? "block" : "none";
  if (submitBtn) submitBtn.style.display = step === 2 ? "block" : "none";

  return true;
}

function validateCheckoutStep(step) {
  const selector = step === 1
    ? '[data-checkout-slide="sender"] input, [data-checkout-slide="sender"] textarea'
    : '[data-checkout-slide="receiver"] input, [data-checkout-slide="receiver"] textarea';

  const fields = [...document.querySelectorAll(selector)];
  const invalid = fields.find((field) => !field.checkValidity());
  if (invalid) {
    invalid.reportValidity();
    return false;
  }
  return true;
}

async function submitOrder(form) {
  const btn = form.querySelector('button[type="submit"]');
  const errorEl = document.getElementById("checkout-error");
  const cart = getCart();

  if (!validateCheckoutStep(2)) return;

  btn.disabled = true;
  btn.textContent = "Enviando pedido...";
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
    if (errorEl) {
      errorEl.textContent = err.message || "❌ No pudimos crear tu pedido. Por favor intenta de nuevo o contacta a soporte: +53 5 8324155";
      errorEl.style.display = "block";
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Enviar Pedido";
  }
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
