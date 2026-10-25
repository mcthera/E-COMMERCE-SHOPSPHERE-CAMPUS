(function () {
  "use strict";
  const S = window.Store;
  let currentUser = null;
  let loadedProducts = [];

  const state = {
    activeCategory: "All",
    search: "",
    sort: "new",
    carouselIndex: 0,
  };

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);

  const sellPrice = (p) => (p.discountPrice > 0 ? p.discountPrice : p.price);

  const PLACEHOLDER_IMG = "data:image/svg+xml;utf8," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><rect width='400' height='400' fill='#f4eeee'/><text x='50%' y='52%' font-size='96' text-anchor='middle'>🛍️</text></svg>"
  );
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const SLIDES = [
    { title: "Buy and sell on campus", sub: "Textbooks, gadgets, fashion and room essentials from students you can meet today.", tone: "crimson", art: "🎓", cta: "Browse items" },
    { title: "Got something to sell?", sub: "Open the menu, tap Sell an item and reach buyers on WhatsApp in minutes.", tone: "deep", art: "📱", cta: "See what's listed", cat: "Mobile" },
    { title: "Hostel shopping sorted", sub: "Fans, kettles, bedding and more at student-friendly prices.", tone: "bright", art: "🛏️", cta: "Shop home items", cat: "Home" },
  ];

  async function init() {
    $("#year").textContent = new Date().getFullYear();
    $("#currencySel").value = S.getCurrency();
    updateAuthUI();
    buildCarousel();
    buildCategories();
    updateCartCount();
    wireEvents();

    try {
      currentUser = await S.getCurrentUser();
      updateAuthUI();
    } catch (err) {
      console.error("Could not restore sign-in state:", err);
      S.toast(`Could not verify your account: ${err.message}`, "error", 6000);
    }
    await fetchAndRenderProducts();
  }

  function buildCarousel() {
    $("#carouselTrack").innerHTML = SLIDES.map((slide) => `
      <div class="slide slide--${slide.tone}">
        <span class="slide__art" aria-hidden="true">${slide.art}</span>
        <h2>${escapeHTML(slide.title)}</h2><p>${escapeHTML(slide.sub)}</p>
        <button type="button" class="btn btn--white" data-scroll-products${slide.cat ? ` data-slide-cat="${escapeHTML(slide.cat)}"` : ""}>${escapeHTML(slide.cta)}</button>
      </div>`).join("");
    $("#carDots").innerHTML = SLIDES.map((_, index) =>
      `<button type="button" data-dot="${index}" class="${index === 0 ? "active" : ""}" aria-label="Show slide ${index + 1}"></button>`
    ).join("");
    $$("[data-dot]").forEach((button) =>
      button.addEventListener("click", () => goToSlide(Number(button.dataset.dot)))
    );
    $("#carPrev").addEventListener("click", () => goToSlide(state.carouselIndex - 1));
    $("#carNext").addEventListener("click", () => goToSlide(state.carouselIndex + 1));

    // swipe support for phones
    let touchX = null;
    const carousel = $("#carousel");
    carousel.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
    carousel.addEventListener("touchend", (e) => {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      if (Math.abs(dx) > 40) goToSlide(state.carouselIndex + (dx < 0 ? 1 : -1));
    }, { passive: true });

    if (!reduceMotion) setInterval(() => goToSlide(state.carouselIndex + 1), 6000);
  }

  function goToSlide(index) {
    state.carouselIndex = ((index % SLIDES.length) + SLIDES.length) % SLIDES.length;
    $("#carouselTrack").style.transform = `translateX(-${state.carouselIndex * 100}%)`;
    $$("[data-dot]").forEach((button, idx) =>
      button.classList.toggle("active", idx === state.carouselIndex)
    );
  }

  function updateAuthUI() {
    const name = currentUser ? (currentUser.profile?.full_name || currentUser.email || "Account") : "";
    $("#authLabel").textContent = currentUser ? "Log out" : "Login / Sign up";
    $("#drawerUserName").textContent = currentUser ? name : "Welcome";
    $("#drawerUserSub").textContent = currentUser ? "Signed in as a seller" : "Sign in to sell on campus";
    $("#drawerAvatar").textContent = currentUser ? name.trim().charAt(0).toUpperCase() || "S" : "S";
  }

  const CAT_EMOJI = { All: "🛍️", Electronics: "💻", Fashion: "👗", Home: "🏠", Mobile: "📱", Beauty: "💄", Groceries: "🛒", Sports: "⚽" };

  function buildCategories() {
    $("#catTiles").innerHTML = ["All", ...S.CATEGORIES].map((c) => `
      <button type="button" class="cat-tile${c === state.activeCategory ? " active" : ""}" data-cat="${escapeHTML(c)}" aria-pressed="${c === state.activeCategory}">
        <span class="emoji" aria-hidden="true">${CAT_EMOJI[c] || "🏷️"}</span>${escapeHTML(c)}
      </button>`).join("");
    $$("[data-cat]").forEach((btn) =>
      btn.addEventListener("click", () => setCategory(btn.dataset.cat))
    );
  }

  function setCategory(cat) {
    state.activeCategory = cat;
    state.search = "";
    $("#searchInput").value = "";
    renderProducts();
  }

  function syncCategoryUI() {
    $$("[data-cat]").forEach((b) => {
      const on = b.dataset.cat === state.activeCategory;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    $("#productsTitle").textContent = state.search
      ? `Results for “${state.search}”`
      : state.activeCategory === "All" ? "All products" : state.activeCategory;
  }

  function scrollToProducts() {
    const header = $(".header");
    const top = $("#productsHead").getBoundingClientRect().top + window.scrollY - (header ? header.offsetHeight : 0) - 12;
    window.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
  }

  async function fetchAndRenderProducts() {
    try {
      loadedProducts = await S.getProducts();
      renderProducts();
    } catch (err) {
      console.error("Could not load products:", err);
      loadedProducts = [];
      renderProducts();
      S.toast(`Could not load products: ${err.message}`, "error", 6000);
    }
  }

  function filteredProducts() {
    let list = [...loadedProducts];
    if (state.activeCategory !== "All") list = list.filter(p => p.category === state.activeCategory);
    if (state.search) {
      const q = state.search.toLowerCase();
      list = list.filter(p => p.title.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q));
    }
    switch (state.sort) {
      case "price-asc": list.sort((a, b) => sellPrice(a) - sellPrice(b)); break;
      case "price-desc": list.sort((a, b) => sellPrice(b) - sellPrice(a)); break;
      case "rating": list.sort((a, b) => (b.rating || 4) - (a.rating || 4)); break;
      default: list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }
    return list;
  }

  function renderProducts() {
    const list = filteredProducts();
    const grid = $("#productGrid");
    $("#noResults").classList.toggle("hidden", list.length > 0);
    $("#resultCount").textContent = list.length ? `${list.length} item${list.length === 1 ? "" : "s"}` : "";
    syncCategoryUI();

    grid.innerHTML = list.map((p) => {
      const img = p.images?.[0] || PLACEHOLDER_IMG;
      const price = sellPrice(p);
      const onSale = p.discountPrice > 0 && p.discountPrice < p.price;
      const off = onSale ? Math.round((1 - p.discountPrice / p.price) * 100) : 0;
      const soldOut = p.stock <= 0;
      return `
      <article class="card" data-id="${escapeHTML(p.id)}">
        <div class="card__media">
          <img src="${escapeHTML(img)}" alt="${escapeHTML(p.title)}" loading="lazy" />
          <span class="card__tag">${escapeHTML(p.category)}</span>
          ${onSale ? `<span class="card__disc">-${off}%</span>` : ""}
          ${soldOut ? `<div class="card__soldout">Sold out</div>` : ""}
        </div>
        <div class="card__body">
          <h3 class="card__title">${escapeHTML(p.title)}</h3>
          <div class="card__price">
            <span class="now">${S.formatPrice(price)}</span>
            ${onSale ? `<span class="was">${S.formatPrice(p.price)}</span>` : ""}
          </div>
          <p class="card__seller">Sold by <strong>${escapeHTML(p.seller_name || "Verified Seller")}</strong></p>
          <div class="card__actions">
            <button type="button" class="btn btn--ghost" data-cart-id="${escapeHTML(p.id)}"${soldOut ? " disabled" : ""}>Add to cart</button>
            <button type="button" class="btn btn--primary" data-seller-phone="${escapeHTML(p.seller_phone || "")}" data-seller-title="${escapeHTML(p.title)}">WhatsApp</button>
          </div>
        </div>
      </article>`;
    }).join("");
    $$("[data-cart-id]", grid).forEach((button) =>
      button.addEventListener("click", () => window.addToCart(button.dataset.cartId))
    );
    $$("[data-seller-phone]", grid).forEach((button) =>
      button.addEventListener("click", () => window.contactSeller(button.dataset.sellerPhone, button.dataset.sellerTitle))
    );
  }

  window.contactSeller = function(phone, title) {
    if (!phone) { S.toast("Seller phone number not available", "error"); return; }
    const cleanPhone = String(phone).replace(/[^0-9]/g, "");
    const msg = encodeURIComponent(`Hello! I am interested in buying your item "${title}" listed on ShopSphere.`);
    window.open(`https://wa.me/${cleanPhone}?text=${msg}`, "_blank");
  };

  window.addToCart = function(id) {
    const p = loadedProducts.find(x => x.id === id);
    if (!p || p.stock <= 0) {
      S.toast("This item is unavailable.", "error");
      return;
    }
    const cart = S.getCart();
    const item = cart.find(c => c.id === id);
    if (item && item.qty >= p.stock) {
      S.toast(`Only ${p.stock} in stock`, "error");
      return;
    }
    if (item) item.qty += 1;
    else cart.push({ id, qty: 1 });
    S.saveCart(cart);
    updateCartCount();
    S.toast("Product added to cart 🛒");
  };

  function updateCartCount() {
    const n = S.getCart().reduce((s, c) => s + c.qty, 0);
    $("#cartCount").textContent = n;
  }

  function cartTotal() {
    return S.getCart().reduce((total, item) => {
      const product = loadedProducts.find((p) => p.id === item.id);
      return total + (product ? sellPrice(product) * item.qty : 0);
    }, 0);
  }

  function renderCart() {
    const cart = S.getCart();
    const body = $("#cartBody");
    const foot = $("#cartFoot");
    if (!cart.length) {
      body.innerHTML = '<div class="empty"><div class="big">🛒</div><p>Your cart is empty.</p></div>';
      foot.innerHTML = "";
      return;
    }

    body.innerHTML = cart.map((item) => {
      const product = loadedProducts.find((p) => p.id === item.id);
      if (!product) {
        return `<div class="cart-line"><div class="cart-line__info"><p>Item no longer available.</p>
          <button type="button" class="link-remove" data-rem="${item.id}">Remove</button></div></div>`;
      }
      const image = Array.isArray(product.images) ? product.images[0] : "";
      return `<div class="cart-line">
        ${image ? `<img src="${escapeHTML(image)}" alt="">` : ""}
        <div class="cart-line__info">
          <h4>${escapeHTML(product.title)}</h4>
          <div>${S.formatPrice(sellPrice(product))}</div>
          <div class="qty" style="margin-top:6px">
            <button type="button" data-dec="${product.id}" aria-label="Decrease quantity">−</button>
            <span>${item.qty}</span>
            <button type="button" data-inc="${product.id}" aria-label="Increase quantity">+</button>
          </div>
          <div><button type="button" class="link-remove" data-rem="${product.id}">Remove</button></div>
        </div>
        <strong>${S.formatPrice(sellPrice(product) * item.qty)}</strong>
      </div>`;
    }).join("");

    foot.innerHTML = `<div class="cart-summary-row total"><span>Total</span><span>${S.formatPrice(cartTotal())}</span></div>
      <button type="button" class="btn btn--green btn--block" id="goCheckout">Checkout via WhatsApp</button>`;
    $$("[data-inc]", body).forEach((button) => button.addEventListener("click", () => changeCartQty(button.dataset.inc, 1)));
    $$("[data-dec]", body).forEach((button) => button.addEventListener("click", () => changeCartQty(button.dataset.dec, -1)));
    $$("[data-rem]", body).forEach((button) => button.addEventListener("click", () => removeCartItem(button.dataset.rem)));
    $("#goCheckout").addEventListener("click", openCheckout);
  }

  function changeCartQty(id, delta) {
    const cart = S.getCart();
    const item = cart.find((entry) => entry.id === id);
    const product = loadedProducts.find((entry) => entry.id === id);
    if (!item || !product) return;
    const quantity = item.qty + delta;
    if (quantity < 1) return removeCartItem(id);
    if (quantity > product.stock) {
      S.toast(`Only ${product.stock} in stock`, "error");
      return;
    }
    item.qty = quantity;
    S.saveCart(cart);
    updateCartCount();
    renderCart();
  }

  function removeCartItem(id) {
    S.saveCart(S.getCart().filter((item) => item.id !== id));
    updateCartCount();
    renderCart();
  }

  function openCart() {
    renderCart();
    openDrawer("cartDrawer");
  }

  function openCheckout() {
    const cart = S.getCart();
    if (!cart.length) {
      S.toast("Your cart is empty.", "error");
      return;
    }
    if (cart.some((item) => {
      const product = loadedProducts.find((entry) => entry.id === item.id);
      return !product || product.stock < item.qty;
    })) {
      S.toast("Remove unavailable or out-of-stock items before checkout.", "error");
      return;
    }
    $("#checkoutSummary").innerHTML = `<div class="cart-summary-row total"><span>Total</span><span>${S.formatPrice(cartTotal())}</span></div>`;
    closeDrawer("cartDrawer");
    openModal("checkoutModal");
  }

  async function submitWhatsAppOrder(event) {
    event.preventDefault();
    const cart = S.getCart();
    if (!cart.length) {
      S.toast("Your cart is empty.", "error");
      return;
    }
    if (cart.some((item) => {
      const product = loadedProducts.find((entry) => entry.id === item.id);
      return !product || product.stock < item.qty;
    })) {
      S.toast("Remove unavailable or out-of-stock items before checkout.", "error");
      return;
    }

    const form = $("#checkoutForm");
    const submitButton = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    const customer = {
      name: String(formData.get("name") || "").trim(),
      phone: String(formData.get("phone") || "").trim(),
      address: String(formData.get("address") || "").trim(),
      className: String(formData.get("className") || "").trim(),
      indexNumber: String(formData.get("indexNumber") || "").trim() || "Not provided"
    };
    const orderItems = cart.map((item) => {
      const product = loadedProducts.find((entry) => entry.id === item.id);
      return {
        id: item.id,
        title: product ? product.title : "Product",
        price: product ? sellPrice(product) : 0,
        qty: item.qty,
        seller_id: product ? product.seller_id : null
      };
    });
    const total = cartTotal();
    const message = [
      "*New ShopSphere Campus Order* 🛒",
      `Name: ${customer.name}`,
      `Phone: ${customer.phone}`,
      `Class: ${customer.className}`,
      `Index Number: ${customer.indexNumber}`,
      `Location: ${customer.address}`,
      "",
      "*Items Ordered:*",
      ...orderItems.map((item) => `• ${item.title} (x${item.qty}) — ${S.formatPrice(item.price * item.qty)}`),
      "",
      `*Total: ${S.formatPrice(total)}*`,
    ].join("\n");

    const newOrder = {
      id: `ORD-${Math.floor(100000 + Math.random() * 900000)}`,
      customer,
      items: orderItems,
      status: "Pending",
      created_at: new Date().toISOString()
    };
    const updatedProducts = [];
    submitButton.disabled = true;

    try {
      for (const item of cart) {
        const product = loadedProducts.find((entry) => entry.id === item.id);
        if (!product || product.stock < item.qty) {
          throw new Error("Stock changed while checking out. Review your cart and try again.");
        }
        await S.saveProduct({ ...product, stock: Math.max(0, product.stock - item.qty) });
        updatedProducts.push(product);
      }

      let existingOrders = [];
      const storedOrders = localStorage.getItem("ecom_orders");
      if (storedOrders) {
        existingOrders = JSON.parse(storedOrders);
        if (!Array.isArray(existingOrders)) throw new Error("Saved order history is invalid.");
      }
      localStorage.setItem("ecom_orders", JSON.stringify([newOrder, ...existingOrders]));
    } catch (err) {
      const rollbackErrors = [];
      for (const product of updatedProducts.reverse()) {
        try {
          await S.saveProduct(product);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError.message);
        }
      }
      const detail = rollbackErrors.length
        ? ` Stock rollback also failed: ${rollbackErrors.join("; ")}.`
        : "";
      S.toast(`${err.message || "Could not process order"}${detail}`, "error");
      submitButton.disabled = false;
      return;
    }

    localStorage.removeItem("ecom_cart");
    updateCartCount();
    renderCart();
    closeModal("checkoutModal");
    closeDrawer("cartDrawer");

    const url = `https://wa.me/233597787700?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    S.toast("Order sent! Cart cleared & stock updated 📦");
    await fetchAndRenderProducts();
    submitButton.disabled = false;
  }

  function openDrawer(id) {
    $("#" + id).classList.add("open");
    $("#overlay").classList.add("open");
  }

  function closeDrawer(id) {
    $("#" + id).classList.remove("open");
    if (!$$(".drawer.open, .modal.open").length) $("#overlay").classList.remove("open");
  }

  function openModal(id) {
    $("#" + id).classList.add("open");
    $("#overlay").classList.add("open");
  }

  function closeModal(id) {
    $("#" + id).classList.remove("open");
    if (!$$(".drawer.open, .modal.open").length) $("#overlay").classList.remove("open");
  }

  function closeAll() {
    $$(".drawer.open, .modal.open").forEach((element) => element.classList.remove("open"));
    $("#overlay").classList.remove("open");
  }

  function wireEvents() {
    let isSignUp = false;
    $("#btnAuth").addEventListener("click", async () => {
      closeDrawer("mobileDrawer");
      if (!currentUser) {
        try {
          currentUser = await S.getCurrentUser();
          updateAuthUI();
        } catch (err) {
          console.error("Could not verify sign-in state:", err);
          S.toast(`Could not verify your account: ${err.message}`, "error");
        }
      }
      if (currentUser) {
        if (confirm(`Logged in as ${currentUser.profile?.full_name || currentUser.email}. Log out?`)) {
          try {
            await S.signOut();
            location.reload();
          } catch (err) {
            S.toast(`Could not sign out: ${err.message}`, "error");
          }
        }
      } else {
        openModal("authModal");
      }
    });

    $("#authToggleLink").addEventListener("click", (e) => {
      e.preventDefault();
      isSignUp = !isSignUp;
      $("#authToggleLink").textContent = isSignUp ? "Sign in" : "Sign up";
      $("#signUpFields").classList.toggle("hidden", !isSignUp);
      $("#authName").required = isSignUp;
      $("#authPhone").required = isSignUp;
      $("#authTitle").textContent = isSignUp ? "Create student account" : "Student Sign in";
      $("#authSubmitBtn").textContent = isSignUp ? "Create account" : "Sign in";
      $("#authToggleText").textContent = isSignUp ? "Already have an account?" : "Don't have an account?";
      $("#authEmail").placeholder = isSignUp ? "Enter the phone number used below" : "Enter your phone or name";
      $("#identifierLabel").textContent = isSignUp ? "Phone number *" : "Phone number or Name *";
      if (isSignUp) $("#authEmail").value = $("#authPhone").value;
      $("#authPassword").autocomplete = isSignUp ? "new-password" : "current-password";
    });

    $("#authPhone").addEventListener("input", () => {
      if (isSignUp) $("#authEmail").value = $("#authPhone").value;
    });

    $("#authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const identifier = $("#authEmail").value.trim();
      const pass = $("#authPassword").value;
      const submitButton = $("#authSubmitBtn");
      submitButton.disabled = true;
      try {
        if (isSignUp) {
          const name = $("#authName").value.trim();
          const phone = $("#authPhone").value.trim();
          const result = await S.signUp(identifier, pass, name, phone);
          isSignUp = false;
          $("#signUpFields").classList.add("hidden");
          $("#authName").required = false;
          $("#authPhone").required = false;
          $("#authTitle").textContent = "Student Sign in";
          $("#authSubmitBtn").textContent = "Sign in";
          $("#authToggleLink").textContent = "Sign up";
          $("#authToggleText").textContent = "Don't have an account?";
          $("#authEmail").placeholder = "Enter your phone or name";
          $("#identifierLabel").textContent = "Phone number or Name *";
          $("#authPassword").autocomplete = "current-password";
          if (result.session) {
            currentUser = await S.getCurrentUser();
            updateAuthUI();
            $$(".modal").forEach((modal) => modal.classList.remove("open"));
            $("#overlay").classList.remove("open");
            S.toast("Account created and signed in successfully!");
          } else {
            $("#authForm").reset();
            S.toast("Account created, but campus-phone sign-in requires email confirmation to be disabled in Supabase Auth.", "error", 7000);
          }
        } else {
          await S.signIn(identifier, pass);
          S.toast("Welcome back! 🎉");
          location.reload();
        }
      } catch (err) {
        S.toast(err.message, "error");
      } finally {
        submitButton.disabled = false;
      }
    });

    $("#btnSell").addEventListener("click", async () => {
      closeDrawer("mobileDrawer");
      if (!currentUser) {
        try {
          currentUser = await S.getCurrentUser();
          updateAuthUI();
        } catch (err) {
          S.toast(`Could not verify your account: ${err.message}`, "error");
          return;
        }
      }
      if (!currentUser) {
        S.toast("Please log in first to post items for sale.", "error");
        openModal("authModal");
        return;
      }
      populateCategorySelects();
      openModal("sellModal");
    });

    function populateCategorySelects() {
      $("#sellCategory").innerHTML = S.CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("");
    }

    $("#sellForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const files = [...$("#sellFileInput").files];
      if (!files.length) { S.toast("Please select at least one photo", "error"); return; }

      $("#btnPostItem").disabled = true;
      $("#btnPostItem").textContent = "Uploading photos and publishing…";

      try {
        await S.createProduct({
          title: $("#sellTitle").value,
          category: $("#sellCategory").value,
          price: parseFloat($("#sellPrice").value),
          stock: parseInt($("#sellStock").value, 10) || 1,
          description: $("#sellDesc").value
        }, files);

        S.toast("Your item is live on ShopSphere! 🚀");
        $("#sellModal").classList.remove("open");
        $("#overlay").classList.remove("open");
        $("#sellForm").reset();
        await fetchAndRenderProducts();
      } catch (err) {
        S.toast(err.message, "error");
      } finally {
        $("#btnPostItem").disabled = false;
        $("#btnPostItem").textContent = "Upload and publish";
      }
    });

    $$("[data-close-modal]").forEach(b => b.addEventListener("click", () => {
      closeModal(b.dataset.closeModal);
    }));
    $$("[data-close]").forEach((button) => button.addEventListener("click", () => closeDrawer(button.dataset.close)));
    $("#overlay").addEventListener("click", (e) => {
      if (e.target.id === "overlay") closeAll();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });
    document.addEventListener("click", (e) => {
      const cta = e.target.closest("[data-scroll-products]");
      if (cta) {
        if (cta.dataset.slideCat) setCategory(cta.dataset.slideCat);
        scrollToProducts();
      }
    });
    $("#btnMenu").addEventListener("click", () => openDrawer("mobileDrawer"));

    const input = $("#searchInput");
    const runSearch = () => {
      state.search = input.value.trim();
      state.activeCategory = "All";
      renderProducts();
      if (state.search) scrollToProducts();
    };
    $("#searchBtn").addEventListener("click", runSearch);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });

    $("#sortSel").addEventListener("change", (e) => {
      state.sort = e.target.value;
      renderProducts();
    });
    $("#currencySel").addEventListener("change", (e) => {
      try {
        S.setCurrency(e.target.value);
        renderProducts();
        if ($("#cartDrawer").classList.contains("open")) renderCart();
      } catch (err) {
        e.target.value = S.getCurrency();
        S.toast(err.message, "error");
      }
    });

    $("#btnCart").addEventListener("click", () => {
      openCart();
    });
    $("#checkoutForm").addEventListener("submit", submitWhatsAppOrder);
  }

  document.addEventListener("DOMContentLoaded", init);
})();