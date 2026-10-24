(function () {
  "use strict";
  const S = window.Store;
  const supabase = S.supabase;
  const $ = (selector, context = document) => context.querySelector(selector);
  const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);

  let allProducts = [];
  let allProfiles = [];

  function getSettings() {
    try {
      return JSON.parse(localStorage.getItem("ecom_settings")) || {
        adminPin: "admin1289",
        currency: "GHS",
        promos: { SAVE10: 10, WELCOME5: 5 },
      };
    } catch (err) {
      console.error("Could not read admin settings:", err);
      S.toast("Saved admin settings could not be read; using defaults.", "error");
      return { adminPin: "admin1289", currency: "GHS", promos: {} };
    }
  }

  function initAuth() {
    if (sessionStorage.getItem("ecom_admin_ok") === "1") {
      unlock();
      return;
    }

    $("#loginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const pin = $("#pinInput").value.trim();
        if (pin !== (getSettings().adminPin || "admin1289")) {
          S.toast("Incorrect PIN", "error");
          $("#pinInput").value = "";
          return;
        }
        sessionStorage.setItem("ecom_admin_ok", "1");
        await unlock();
        S.toast("Welcome, Developer Moderator 🛡️");
      } catch (err) {
        console.error("Moderator dashboard unlock failed:", err);
        S.toast(err.message || "Could not load moderator dashboard", "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  async function unlock() {
    $("#loginGate").classList.add("hidden");
    $("#adminShell").classList.remove("hidden");
    await loadPlatformData();
    wireEvents();
  }

  function switchView(view) {
    $$(".admin-nav [data-view]").forEach((button) =>
      button.classList.toggle("active", button.dataset.view === view)
    );
    ["dashboard", "products", "orders", "settings"].forEach((name) =>
      $("#view-" + name).classList.toggle("hidden", name !== view)
    );
    const titles = {
      dashboard: "Moderator Overview",
      products: "All Platform Products",
      orders: "Registered Sellers & Users",
      settings: "System Settings",
    };
    $("#viewTitle").textContent = titles[view] || view;
    $("#adminSide").classList.remove("open");
    $("#overlay").classList.remove("open");
  }

  async function loadPlatformData() {
    const failures = [];
    try {
      allProducts = await S.getProducts();
    } catch (err) {
      console.error("Could not load platform products:", err);
      allProducts = [];
      failures.push(`products: ${err.message}`);
    }

    try {
      const { data, error } = await supabase.from("profiles").select("*");
      if (error) throw error;
      allProfiles = data || [];
    } catch (err) {
      console.error("Could not load user profiles:", err);
      allProfiles = [];
      failures.push(`profiles: ${err.message}`);
    }

    renderModeratorDashboard();
    renderAllProductsTable();
    renderUsersTable();
    loadSettings();
    if (failures.length) {
      S.toast(`Some moderator data could not be loaded (${failures.join("; ")}). Check Supabase access policies.`, "error", 7000);
    }
  }

  function renderModeratorDashboard() {
    $("#statCards").innerHTML = `
      <div class="stat stat--prod"><div class="stat__icon">📦</div>
        <div class="stat__label">Total Platform Listings</div><div class="stat__value">${allProducts.length}</div></div>
      <div class="stat stat--sales"><div class="stat__icon">👥</div>
        <div class="stat__label">Registered Sellers</div><div class="stat__value">${allProfiles.length}</div></div>
      <div class="stat stat--ord"><div class="stat__icon">🛡️</div>
        <div class="stat__label">Moderation Status</div><div class="stat__value" style="font-size:1.2rem;color:var(--green)">Active ✅</div></div>`;

    const recent = allProducts.slice(0, 5);
    $("#recentOrders").innerHTML = recent.length
      ? `<thead><tr><th>Image</th><th>Item Title</th><th>Seller</th><th>Price</th></tr></thead><tbody>${recent
          .map((product) => `<tr>
            <td>${product.images?.[0] ? `<img src="${escapeHTML(product.images[0])}" alt="">` : "—"}</td>
            <td><strong>${escapeHTML(product.title)}</strong></td>
            <td>${escapeHTML(product.seller_name || "Unknown")}</td>
            <td>${S.formatPrice(product.price)}</td>
          </tr>`).join("")}</tbody>`
      : `<tbody><tr><td style="color:var(--muted)">No products posted yet.</td></tr></tbody>`;

    $("#lowStockTable").innerHTML = allProfiles.length
      ? `<thead><tr><th>Seller Name</th><th>WhatsApp Phone</th><th>Joined</th></tr></thead><tbody>${allProfiles
          .map((profile) => `<tr>
            <td><strong>${escapeHTML(profile.full_name || "Unnamed user")}</strong></td>
            <td>${escapeHTML(profile.phone_whatsapp || "—")}</td>
            <td>${profile.created_at ? new Date(profile.created_at).toLocaleDateString() : "—"}</td>
          </tr>`).join("")}</tbody>`
      : `<tbody><tr><td style="color:var(--muted)">No users registered yet.</td></tr></tbody>`;
  }

  function renderAllProductsTable() {
    const table = $("#productsTable");
    if (!allProducts.length) {
      table.innerHTML = `<tbody><tr><td style="color:var(--muted)">No products on the platform.</td></tr></tbody>`;
      return;
    }
    table.innerHTML = `<thead><tr><th>Image</th><th>Title</th><th>Seller</th><th>Category</th><th>Price</th><th>Action</th></tr></thead>
      <tbody>${allProducts.map((product) => `<tr>
        <td>${product.images?.[0] ? `<img src="${escapeHTML(product.images[0])}" alt="">` : "—"}</td>
        <td><strong>${escapeHTML(product.title)}</strong></td>
        <td>${escapeHTML(product.seller_name || "Unknown")}</td>
        <td>${escapeHTML(product.category || "—")}</td>
        <td>${S.formatPrice(product.price)}</td>
        <td><button class="btn btn--danger btn--sm" data-mod-del="${escapeHTML(product.id)}">🗑️ Take Down</button></td>
      </tr>`).join("")}</tbody>`;

    $$("[data-mod-del]", table).forEach((button) =>
      button.addEventListener("click", () => moderatorDeleteProduct(button.dataset.modDel))
    );
  }

  function renderUsersTable() {
    const table = $("#ordersTable");
    if (!allProfiles.length) {
      table.innerHTML = `<tbody><tr><td style="color:var(--muted)">No registered user accounts found.</td></tr></tbody>`;
      return;
    }
    table.innerHTML = `<thead><tr><th>User ID</th><th>Full Name</th><th>WhatsApp Phone</th><th>Listings Count</th></tr></thead>
      <tbody>${allProfiles.map((profile) => {
        const id = String(profile.id || "");
        const count = allProducts.filter((product) => product.seller_id === profile.id).length;
        return `<tr>
          <td><code>${escapeHTML(id.slice(0, 8))}...</code></td>
          <td><strong>${escapeHTML(profile.full_name || "Unnamed user")}</strong></td>
          <td>${escapeHTML(profile.phone_whatsapp || "—")}</td>
          <td><span class="badge badge--cat">${count} items</span></td>
        </tr>`;
      }).join("")}</tbody>`;
  }

  async function moderatorDeleteProduct(id) {
    if (!confirm("Moderator Action: Are you sure you want to delete this product from the platform?")) return;
    try {
      await S.deleteProduct(id);
      S.toast("Product removed by Moderator", "info");
      await loadPlatformData();
    } catch (err) {
      console.error("Moderator product removal failed:", err);
      S.toast(err.message || "Could not remove this product", "error");
    }
  }

  function loadSettings() {
    const settings = getSettings();
    $("#setCurrency").value = settings.currency || "GHS";
    $("#setPin").value = "";
    $("#setPromos").value = Object.entries(settings.promos || {})
      .map(([code, percent]) => `${code}:${percent}`).join(", ");
  }

  async function saveSettings() {
    const settings = getSettings();
    settings.currency = $("#setCurrency").value;
    const newPin = $("#setPin").value.trim();
    if (newPin) settings.adminPin = newPin;

    const promos = {};
    for (const entry of $("#setPromos").value.split(",")) {
      const [rawCode, rawPercent] = entry.split(":").map((part) => (part || "").trim());
      if (!rawCode && !rawPercent) continue;
      const percent = Number(rawPercent);
      if (!rawCode || !Number.isFinite(percent) || percent <= 0 || percent > 100) {
        S.toast("Enter promo codes as CODE:percent, with a discount from 1 to 100.", "error");
        return;
      }
      promos[rawCode.toUpperCase()] = percent;
    }
    settings.promos = promos;
    localStorage.setItem("ecom_settings", JSON.stringify(settings));
    S.toast("Moderator settings saved ✅");
    await loadPlatformData();
  }

  function wireEvents() {
    $$(".admin-nav [data-view]").forEach((button) =>
      button.addEventListener("click", () => switchView(button.dataset.view))
    );
    $("#btnNewProduct").classList.add("hidden");
    $("#btnSaveSettings").addEventListener("click", () => {
      saveSettings().catch((err) => {
        console.error("Could not save moderator settings:", err);
        S.toast(err.message || "Could not save settings", "error");
      });
    });
    $("#btnLogout").addEventListener("click", () => {
      sessionStorage.removeItem("ecom_admin_ok");
      location.reload();
    });
    $("#btnAdminMenu").addEventListener("click", () => {
      $("#adminSide").classList.toggle("open");
      $("#overlay").classList.toggle("open");
    });
    $("#overlay").addEventListener("click", () => {
      $$(".modal.open").forEach((modal) => modal.classList.remove("open"));
      $("#adminSide").classList.remove("open");
      $("#overlay").classList.remove("open");
    });
  }

  document.addEventListener("DOMContentLoaded", initAuth);
})();
