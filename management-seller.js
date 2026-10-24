(function () {
  "use strict";
  const S = window.Store;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);

  let currentUser = null;
  let myProducts = [];

  async function init() {
    try {
      currentUser = await S.getCurrentUser();
      if (!currentUser) {
        $("#sellerAuthGate").classList.remove("hidden");
        return;
      }
      $("#sellerAuthGate").classList.add("hidden");
      $("#sellerShell").classList.remove("hidden");
      populateCategories();
      await loadSellerData();
      wireEvents();
    } catch (err) {
      console.error(err);
      S.toast("Error loading seller session", "error");
    }
  }

  function switchView(view) {
    $$(".admin-nav [data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    ["dashboard", "products", "orders"].forEach((v) =>
      $("#view-" + v).classList.toggle("hidden", v !== view)
    );
    $("#sellerViewTitle").textContent = view.charAt(0).toUpperCase() + view.slice(1);
    $("#sellerSide").classList.remove("open");
    $("#overlay").classList.remove("open");
  }

  async function loadSellerData() {
    const allProducts = await S.getProducts();
    myProducts = allProducts.filter((p) => p.seller_id === currentUser.id);
    renderDashboard();
    renderMyProducts();
    renderSellerOrders();
  }

  function renderDashboard() {
    const orders = JSON.parse(localStorage.getItem("ecom_orders")) || [];
    // Filter orders containing items belonging to this seller
    const myProductIds = new Set(myProducts.map(p => p.id));
    const mySales = orders.filter(o => o.items.some(item => myProductIds.has(item.id)));
    const totalEarnings = mySales.reduce((sum, o) => {
      const relevantItemsTotal = o.items
        .filter(item => myProductIds.has(item.id))
        .reduce((s, i) => s + (i.price * i.qty), 0);
      return sum + relevantItemsTotal;
    }, 0);

    $("#sellerStatCards").innerHTML = `
      <div class="stat stat--sales"><div class="stat__icon">💰</div>
        <div class="stat__label">Total Sales Earnings</div><div class="stat__value">${S.formatPrice(totalEarnings)}</div></div>
      <div class="stat stat--prod"><div class="stat__icon">📦</div>
        <div class="stat__label">Your Active Listings</div><div class="stat__value">${myProducts.length}</div></div>
      <div class="stat stat--ord"><div class="stat__icon">🧾</div>
        <div class="stat__label">Orders Received</div><div class="stat__value">${mySales.length}</div></div>`;

    const recent = myProducts.slice(0, 5);
    $("#sellerRecentProducts").innerHTML = recent.length
      ? `<thead><tr><th>Image</th><th>Title</th><th>Price</th><th>Stock</th></tr></thead><tbody>${recent
          .map(p => `<tr>
            <td>${p.images?.[0] ? `<img src="${escapeHTML(p.images[0])}" alt="">` : "—"}</td>
            <td><strong>${escapeHTML(p.title)}</strong></td>
            <td>${S.formatPrice(p.price)}</td>
            <td>${p.stock}</td>
          </tr>`).join("")}</tbody>`
      : `<tbody><tr><td style="color:var(--muted)">You haven't posted any products yet. Click "Post New Item".</td></tr></tbody>`;
  }

  function renderMyProducts() {
    const table = $("#sellerProductsTable");
    if (!myProducts.length) {
      table.innerHTML = `<tbody><tr><td style="color:var(--muted)">No products found.</td></tr></tbody>`;
      return;
    }
    table.innerHTML = `<thead><tr><th>Image</th><th>Title</th><th>Category</th><th>Price</th><th>Stock</th><th>Actions</th></tr></thead>
      <tbody>${myProducts.map(p => `<tr>
        <td>${p.images?.[0] ? `<img src="${escapeHTML(p.images[0])}" alt="">` : "—"}</td>
        <td><strong>${escapeHTML(p.title)}</strong></td>
        <td>${escapeHTML(p.category)}</td>
        <td>${S.formatPrice(p.price)}</td>
        <td>${p.stock}</td>
        <td><div class="row-actions">
          <button class="btn btn--ghost btn--sm" data-edit-item="${p.id}">✏️ Edit</button>
          <button class="btn btn--danger btn--sm" data-del-item="${p.id}">🗑️</button>
        </div></td>
      </tr>`).join("")}</tbody>`;

    $$("[data-edit-item]", table).forEach(b => b.addEventListener("click", () => openEditModal(b.dataset.editItem)));
    $$("[data-del-item]", table).forEach(b => b.addEventListener("click", () => deleteItem(b.dataset.delItem)));
  }

  function renderSellerOrders() {
    const orders = JSON.parse(localStorage.getItem("ecom_orders")) || [];
    const myProductIds = new Set(myProducts.map(p => p.id));
    const table = $("#sellerOrdersTable");
    
    const mySales = orders.filter(o => o.items.some(item => myProductIds.has(item.id)));
    if (!mySales.length) {
      table.innerHTML = `<tbody><tr><td style="color:var(--muted)">No customer orders for your items yet.</td></tr></tbody>`;
      return;
    }

    table.innerHTML = `<thead><tr><th>Order ID</th><th>Customer</th><th>Your Items Ordered</th><th>Status</th></tr></thead>
      <tbody>${mySales.map(o => {
        const matchingItems = o.items.filter(i => myProductIds.has(i.id));
        return `<tr>
          <td><strong>${o.id}</strong><br><small style="color:var(--muted)">${new Date(o.createdAt).toLocaleDateString()}</small></td>
          <td>${escapeHTML(o.customer.name)}<br><small style="color:var(--muted)">${escapeHTML(o.customer.phone)} (${escapeHTML(o.customer.address)})</small></td>
          <td>${matchingItems.map(i => `${escapeHTML(i.title)} (x${i.qty})`).join("<br>")}</td>
          <td><span class="status-pill status-${o.status}">${o.status}</span></td>
        </tr>`;
      }).join("")}</tbody>`;
  }

  function populateCategories() {
    $("#spCategory").innerHTML = S.CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("");
  }

  function openEditModal(id) {
    const form = $("#sellerProductForm");
    form.reset();
    if (id) {
      const p = myProducts.find(x => x.id === id);
      if (!p) return;
      $("#sellerModalTitle").textContent = "Edit Product Details";
      $("#spId").value = p.id;
      $("#spTitle").value = p.title;
      $("#spCategory").value = p.category;
      $("#spPrice").value = p.price;
      $("#spStock").value = p.stock;
      $("#spDesc").value = p.description || "";
    } else {
      $("#sellerModalTitle").textContent = "Post New Item";
      $("#spId").value = "";
    }
    openModal("sellerProductModal");
  }

  async function deleteItem(id) {
    if (!confirm("Are you sure you want to delete this listing?")) return;
    try {
      await S.deleteProduct(id);
      S.toast("Product deleted successfully");
      await loadSellerData();
    } catch (err) {
      S.toast(err.message, "error");
    }
  }

  async function saveListing(e) {
    e.preventDefault();
    const id = $("#spId").value;
    const title = $("#spTitle").value.trim();
    const category = $("#spCategory").value;
    const price = parseFloat($("#spPrice").value);
    const stock = parseInt($("#spStock").value, 10) || 1;
    const description = $("#spDesc").value.trim();
    const files = [...$("#spFileInput").files];

    const btn = $("#btnSaveListing");
    btn.disabled = true;
    btn.textContent = "Saving...";

    try {
      if (!id && !files.length) {
        S.toast("Please select at least one photo for a new listing", "error");
        btn.disabled = false;
        btn.textContent = "💾 Save Listing";
        return;
      }

      if (id) {
        const existing = myProducts.find(x => x.id === id);
        if (!existing) throw new Error("This listing could not be found. Refresh and try again.");
        let imageUrls = existing.images || [];
        if (files.length) {
          imageUrls = [];
          for (const file of files) {
            imageUrls.push(await S.uploadProductPhoto(file));
          }
        }
        await S.saveProduct({
          id,
          title,
          category,
          price,
          stock,
          description,
          images: imageUrls,
          discountPrice: existing.discountPrice,
          specs: existing.specs
        });
        S.toast("Product updated successfully ✅");
      } else {
        await S.createProduct({ title, category, price, stock, description }, files);
        S.toast("Item posted successfully 🚀");
      }

      closeModal("sellerProductModal");
      await loadSellerData();
    } catch (err) {
      S.toast(err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "💾 Save Listing";
    }
  }

  function openModal(id) { $("#" + id).classList.add("open"); $("#overlay").classList.add("open"); }
  function closeModal(id) { $("#" + id).classList.remove("open"); $("#overlay").classList.remove("open"); }

  function wireEvents() {
    $$(".admin-nav [data-view]").forEach(b => b.addEventListener("click", () => switchView(b.dataset.view)));
    $("#btnNewListing").addEventListener("click", () => openEditModal(null));
    $("#sellerProductForm").addEventListener("submit", saveListing);
    $("#btnSellerLogout").addEventListener("click", async () => {
      await S.signOut();
      location.href = "index.html";
    });
    $("#btnSellerMenu").addEventListener("click", () => {
      $("#sellerSide").classList.toggle("open");
      $("#overlay").classList.toggle("open");
    });
    $("#overlay").addEventListener("click", () => {
      $$(".modal.open").forEach(m => m.classList.remove("open"));
      $("#sellerSide").classList.remove("open");
      $("#overlay").classList.remove("open");
    });
    $$("[data-close-modal]").forEach(b => b.addEventListener("click", () => closeModal(b.dataset.closeModal)));
  }

  document.addEventListener("DOMContentLoaded", init);
})();