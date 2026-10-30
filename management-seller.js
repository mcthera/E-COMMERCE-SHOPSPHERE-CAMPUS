(function () {
  "use strict";
  const S = window.Store;
  const $ = (selector, context = document) => context.querySelector(selector);
  const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);

  let currentUser = null;
  let myProducts = [];
  let myOrders = [];

  async function init() {
    wireEvents();
    try {
      currentUser = await S.getCurrentUser();
      if (!currentUser || currentUser.profile.role !== "seller") {
        $("#sellerAuthGate").classList.remove("hidden");
        return;
      }

      $("#sellerAuthGate").classList.add("hidden");
      $("#sellerShell").classList.remove("hidden");
      const approved = currentUser.profile.seller_status === "approved";
      $("#sellerStatusBanner").classList.toggle("hidden", approved);
      $("#btnNewListing").disabled = !approved;
      populateCategories();
      await loadSellerData();
    } catch (err) {
      console.error("Could not load seller account:", err);
      S.toast(err.message || "Could not load seller account.", "error", 7000);
    }
  }

  function switchView(view) {
    $$(".admin-nav [data-view]").forEach((button) =>
      button.classList.toggle("active", button.dataset.view === view)
    );
    ["dashboard", "products", "orders"].forEach((name) =>
      $("#view-" + name).classList.toggle("hidden", name !== view)
    );
    $("#sellerViewTitle").textContent = {
      dashboard: "Seller Dashboard",
      products: "My Listings",
      orders: "Sales & Orders",
    }[view] || "Seller Dashboard";
    $("#sellerSide").classList.remove("open");
    $("#overlay").classList.remove("open");
  }

  async function loadSellerData() {
    try {
      const [products, orders] = await Promise.all([S.getProducts(), S.getSellerOrders()]);
      myProducts = products.filter((product) => product.seller_id === currentUser.id);
      myOrders = orders;
      renderDashboard();
      renderMyProducts();
      renderSellerOrders();
    } catch (err) {
      console.error("Could not load seller data:", err);
      S.toast(err.message || "Could not load seller listings and orders.", "error", 7000);
    }
  }

  function renderDashboard() {
    const totalEarnings = myOrders.reduce((sum, order) =>
      sum + (order.items || []).reduce((orderTotal, item) =>
        orderTotal + Number(item.price || 0) * Number(item.qty || 1), 0), 0);

    $("#sellerStatCards").innerHTML = `
      <div class="stat stat--sales"><div class="stat__icon">💰</div>
        <div class="stat__label">Total Sales</div><div class="stat__value">${S.formatPrice(totalEarnings)}</div></div>
      <div class="stat stat--prod"><div class="stat__icon">📦</div>
        <div class="stat__label">Your Active Listings</div><div class="stat__value">${myProducts.length}</div></div>
      <div class="stat stat--ord"><div class="stat__icon">🧾</div>
        <div class="stat__label">Orders Received</div><div class="stat__value">${myOrders.length}</div></div>`;

    const recent = myProducts.slice(0, 5);
    $("#sellerRecentProducts").innerHTML = recent.length
      ? `<thead><tr><th>Image</th><th>Title</th><th>Price</th><th>Stock</th></tr></thead><tbody>${recent
          .map((product) => `<tr>
            <td>${product.images?.[0] ? `<img src="${escapeHTML(product.images[0])}" alt="">` : "—"}</td>
            <td><strong>${escapeHTML(product.title)}</strong></td>
            <td>${S.formatPrice(product.price)}</td>
            <td>${escapeHTML(product.stock)}</td>
          </tr>`).join("")}</tbody>`
      : `<tbody><tr><td style="color:var(--muted)">You haven't posted any products yet.</td></tr></tbody>`;
  }

  function renderMyProducts() {
    const table = $("#sellerProductsTable");
    if (!myProducts.length) {
      table.innerHTML = `<tbody><tr><td style="color:var(--muted)">No products found.</td></tr></tbody>`;
      return;
    }
    table.innerHTML = `<thead><tr><th>Image</th><th>Title</th><th>Category</th><th>Price</th><th>Stock</th><th>Actions</th></tr></thead>
      <tbody>${myProducts.map((product) => `<tr>
        <td>${product.images?.[0] ? `<img src="${escapeHTML(product.images[0])}" alt="">` : "—"}</td>
        <td><strong>${escapeHTML(product.title)}</strong></td>
        <td>${escapeHTML(product.category)}</td>
        <td>${S.formatPrice(product.price)}</td>
        <td>${escapeHTML(product.stock)}</td>
        <td><button class="btn btn--danger btn--sm" data-del-item="${escapeHTML(product.id)}">🗑️ Delete</button></td>
      </tr>`).join("")}</tbody>`;
    $$("[data-del-item]", table).forEach((button) =>
      button.addEventListener("click", () => deleteItem(button.dataset.delItem))
    );
  }

  function renderSellerOrders() {
    const table = $("#sellerOrdersTable");
    if (!myOrders.length) {
      table.innerHTML = `<tbody><tr><td style="color:var(--muted)">No customer orders yet.</td></tr></tbody>`;
      return;
    }
    table.innerHTML = `<thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Status</th><th>Update status</th></tr></thead>
      <tbody>${myOrders.map((order) => `<tr>
        <td><strong>${escapeHTML(order.reference)}</strong></td>
        <td>${escapeHTML(order.customer_name || "Customer")}<br>${escapeHTML(order.customer_phone || "")}<br><small>${escapeHTML(order.customer_address || "")}</small></td>
        <td>${(order.items || []).map((item) => `${escapeHTML(item.title)} (x${escapeHTML(item.qty)})`).join("<br>")}</td>
        <td><span class="status-pill status-${escapeHTML(order.status)}">${escapeHTML(order.status)}</span></td>
        <td><select data-update-status="${escapeHTML(order.id)}" aria-label="Update status for ${escapeHTML(order.reference)}">
          ${["Pending", "Shipped", "Delivered"].map((status) =>
            `<option value="${status}"${order.status === status ? " selected" : ""}>${status}</option>`
          ).join("")}
        </select></td>
      </tr>`).join("")}</tbody>`;
    $$("[data-update-status]", table).forEach((select) =>
      select.addEventListener("change", () => updateOrderStatus(select))
    );
  }

  async function updateOrderStatus(select) {
    const previousStatus = myOrders.find((order) => order.id === select.dataset.updateStatus)?.status;
    select.disabled = true;
    try {
      await S.updateOrderStatus(select.dataset.updateStatus, select.value);
      S.toast("Order status updated.");
      await loadSellerData();
    } catch (err) {
      console.error("Could not update order status:", err);
      if (previousStatus) select.value = previousStatus;
      S.toast(err.message || "Could not update order status.", "error");
    } finally {
      select.disabled = false;
    }
  }

  function populateCategories() {
    $("#spCategory").innerHTML = S.CATEGORIES
      .map((category) => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`)
      .join("");
  }

  async function deleteItem(id) {
    if (!confirm("Delete this listing?")) return;
    try {
      await S.deleteProduct(id);
      S.toast("Listing deleted.");
      await loadSellerData();
    } catch (err) {
      console.error("Could not delete listing:", err);
      S.toast(err.message || "Could not delete listing.", "error");
    }
  }

  async function saveListing(event) {
    event.preventDefault();
    const button = $("#btnSaveListing");
    const files = [...$("#spFileInput").files];
    if (!files.length) {
      S.toast("Select at least one product photo.", "error");
      return;
    }
    button.disabled = true;
    try {
      await S.createProduct({
        title: $("#spTitle").value.trim(),
        category: $("#spCategory").value,
        price: Number($("#spPrice").value),
        stock: Number($("#spStock").value),
        description: $("#spDesc").value.trim(),
      }, files);
      $("#sellerProductForm").reset();
      closeProductModal();
      S.toast("Product listed successfully.");
      await loadSellerData();
    } catch (err) {
      console.error("Could not save product:", err);
      S.toast(err.message || "Could not save product.", "error", 7000);
    } finally {
      button.disabled = false;
    }
  }

  function closeProductModal() {
    $("#sellerProductModal").classList.remove("open");
    $("#overlay").classList.remove("open");
  }

  function wireEvents() {
    $("#sellerLoginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await S.signIn($("#sellerLoginUser").value, $("#sellerLoginPass").value);
        const user = await S.getCurrentUser();
        if (user.profile.role !== "seller") {
          await S.signOut();
          throw new Error("This account is not registered as a seller.");
        }
        location.reload();
      } catch (err) {
        console.error("Seller sign-in failed:", err);
        S.toast(err.message || "Seller sign-in failed.", "error");
      } finally {
        button.disabled = false;
      }
    });

    $$(".admin-nav [data-view]").forEach((button) =>
      button.addEventListener("click", () => switchView(button.dataset.view))
    );
    $("#btnSellerMenu").addEventListener("click", () => {
      $("#sellerSide").classList.toggle("open");
      $("#overlay").classList.toggle("open");
    });
    $("#overlay").addEventListener("click", () => {
      $("#sellerSide").classList.remove("open");
      closeProductModal();
    });
    $("#btnNewListing").addEventListener("click", () => {
      if (currentUser?.profile?.seller_status !== "approved") {
        S.toast("Awaiting moderator approval before posting products.", "error");
        return;
      }
      $("#sellerProductModal").classList.add("open");
      $("#overlay").classList.add("open");
    });
    $("#sellerProductForm").addEventListener("submit", saveListing);
    $$("[data-close-modal='sellerProductModal']").forEach((button) =>
      button.addEventListener("click", closeProductModal)
    );
    $("#btnSellerLogout").addEventListener("click", async () => {
      try {
        await S.signOut();
        location.href = "index.html";
      } catch (err) {
        S.toast(err.message || "Could not sign out.", "error");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
