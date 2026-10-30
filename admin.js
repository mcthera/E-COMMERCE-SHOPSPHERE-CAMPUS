(function () {
  "use strict";
  const S = window.Store;
  const supabase = S.supabase;
  const $ = (selector, context = document) => context.querySelector(selector);
  const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);

  let allProducts = [];
  let allProfiles = [];
  let wired = false;

  async function initAuth() {
    $("#loginForm").addEventListener("submit", signInModerator);
    try {
      const user = await S.getCurrentUser();
      if (user?.profile.role === "moderator") await unlock();
    } catch (err) {
      console.error("Could not restore moderator session:", err);
      S.toast(err.message || "Could not verify the moderator session.", "error");
    }
  }

  async function signInModerator(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await S.signIn($("#moderatorEmail").value, $("#moderatorPassword").value);
      const user = await S.getCurrentUser();
      if (user.profile.role !== "moderator") {
        await S.signOut();
        throw new Error("This Supabase account does not have the moderator role.");
      }
      await unlock();
      S.toast("Welcome, Moderator.");
    } catch (err) {
      console.error("Moderator sign-in failed:", err);
      S.toast(err.message || "Moderator sign-in failed.", "error");
    } finally {
      button.disabled = false;
    }
  }

  async function unlock() {
    $("#loginGate").classList.add("hidden");
    $("#adminShell").classList.remove("hidden");
    if (!wired) {
      wireEvents();
      wired = true;
    }
    await loadPlatformData();
  }

  function switchView(view) {
    $$(".admin-nav [data-view]").forEach((button) =>
      button.classList.toggle("active", button.dataset.view === view)
    );
    ["dashboard", "products", "orders"].forEach((name) =>
      $("#view-" + name).classList.toggle("hidden", name !== view)
    );
    $("#viewTitle").textContent = {
      dashboard: "Moderator Overview",
      products: "All Platform Products",
      orders: "Registered Sellers & Users",
    }[view] || "Moderator Overview";
    $("#adminSide").classList.remove("open");
    $("#overlay").classList.remove("open");
  }

  async function loadPlatformData() {
    try {
      const [productsResult, profilesResult] = await Promise.all([
        S.getProducts(),
        supabase.from("profiles").select("id, full_name, phone_whatsapp, role, seller_status, created_at"),
      ]);
      if (profilesResult.error) throw profilesResult.error;
      allProducts = productsResult;
      allProfiles = profilesResult.data || [];
      renderModeratorDashboard();
      renderAllProductsTable();
      renderUsersTable();
    } catch (err) {
      console.error("Could not load moderator data:", err);
      S.toast(err.message || "Could not load moderator data. Check Supabase policies.", "error", 7000);
    }
  }

  function renderModeratorDashboard() {
    const pendingSellers = allProfiles.filter((profile) =>
      profile.role === "seller" && profile.seller_status !== "approved"
    ).length;
    $("#statCards").innerHTML = `
      <div class="stat stat--prod"><div class="stat__icon">📦</div>
        <div class="stat__label">Total Listings</div><div class="stat__value">${allProducts.length}</div></div>
      <div class="stat stat--sales"><div class="stat__icon">👥</div>
        <div class="stat__label">Registered Accounts</div><div class="stat__value">${allProfiles.length}</div></div>
      <div class="stat stat--ord"><div class="stat__icon">🕒</div>
        <div class="stat__label">Pending Sellers</div><div class="stat__value">${pendingSellers}</div></div>`;

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

    const sellers = allProfiles.filter((profile) => profile.role === "seller");
    $("#lowStockTable").innerHTML = sellers.length
      ? `<thead><tr><th>Seller</th><th>WhatsApp Phone</th><th>Status</th></tr></thead><tbody>${sellers
          .map((profile) => {
            const status = profile.seller_status || "pending";
            return `<tr>
              <td><strong>${escapeHTML(profile.full_name || "Unnamed seller")}</strong></td>
              <td>${escapeHTML(profile.phone_whatsapp || "—")}</td>
              <td><span class="badge ${status === "approved" ? "badge--cat" : "badge--low"}">${escapeHTML(status)}</span></td>
            </tr>`;
          }).join("")}</tbody>`
      : `<tbody><tr><td style="color:var(--muted)">No seller accounts found.</td></tr></tbody>`;
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
    table.innerHTML = `<thead><tr><th>Full Name</th><th>WhatsApp Phone</th><th>Role</th><th>Approval Status</th><th>Action</th></tr></thead>
      <tbody>${allProfiles.map((profile) => {
        const id = String(profile.id || "");
        const isSeller = profile.role === "seller";
        const status = isSeller ? profile.seller_status || "pending" : "—";
        const isPending = isSeller && status !== "approved";
        return `<tr>
          <td><strong>${escapeHTML(profile.full_name || "Unnamed user")}</strong></td>
          <td>${escapeHTML(profile.phone_whatsapp || "—")}</td>
          <td><span class="badge badge--cat">${escapeHTML(profile.role || "customer")}</span></td>
          <td><span class="badge ${isPending ? "badge--low" : "badge--cat"}">${escapeHTML(status)}</span></td>
          <td>${isPending
            ? `<button class="btn btn--green btn--sm" data-approve-id="${escapeHTML(id)}">✅ Approve Seller</button>`
            : "—"}</td>
        </tr>`;
      }).join("")}</tbody>`;
    $$("[data-approve-id]", table).forEach((button) =>
      button.addEventListener("click", () => approveSellerAccount(button))
    );
  }

  async function approveSellerAccount(button) {
    button.disabled = true;
    try {
      const { data, error } = await supabase
        .from("profiles")
        .update({ seller_status: "approved" })
        .eq("id", button.dataset.approveId)
        .eq("role", "seller")
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Supabase did not update a seller. Check the moderator profile and database policies.");
      S.toast("Seller account approved.");
      await loadPlatformData();
    } catch (err) {
      console.error("Could not approve seller:", err);
      S.toast(err.message || "Could not approve seller account.", "error", 7000);
    } finally {
      button.disabled = false;
    }
  }

  async function moderatorDeleteProduct(id) {
    if (!confirm("Are you sure you want to remove this product?")) return;
    try {
      await S.deleteProduct(id);
      S.toast("Product removed.");
      await loadPlatformData();
    } catch (err) {
      console.error("Moderator product removal failed:", err);
      S.toast(err.message || "Could not remove this product.", "error");
    }
  }

  function wireEvents() {
    $$(".admin-nav [data-view]").forEach((button) =>
      button.addEventListener("click", () => switchView(button.dataset.view))
    );
    $("#btnLogout").addEventListener("click", async () => {
      try {
        await S.signOut();
        location.reload();
      } catch (err) {
        S.toast(err.message || "Could not sign out.", "error");
      }
    });
    $("#btnAdminMenu").addEventListener("click", () => {
      $("#adminSide").classList.toggle("open");
      $("#overlay").classList.toggle("open");
    });
    $("#overlay").addEventListener("click", () => {
      $("#adminSide").classList.remove("open");
      $("#overlay").classList.remove("open");
    });
  }

  document.addEventListener("DOMContentLoaded", initAuth);
})();
