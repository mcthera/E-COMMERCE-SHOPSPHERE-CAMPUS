(function (global) {
  "use strict";

  const SUPABASE_URL = "https://krtbftjnzkjlufligsok.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_uGQjU0wbAtup1XsIRpofpQ_dl2PLTax";
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: window.sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  const CATEGORIES = ["Electronics", "Fashion", "Home", "Mobile", "Beauty", "Groceries", "Sports"];
  const CURRENCIES = {
    GHS: { symbol: "GH₵", locale: "en-GH" },
    NGN: { symbol: "₦", locale: "en-NG" },
    USD: { symbol: "$", locale: "en-US" },
  };
  let currency = "GHS";
  let cart = [];
  let toastHost = null;

  async function signUp(email, password, fullName, phone, role = "customer") {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedRole = role === "seller" ? "seller" : role === "customer" ? "customer" : null;
    if (!normalizedRole) throw new Error("Choose a valid account type.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error("Enter a valid email address.");
    }
    if (!String(fullName || "").trim()) throw new Error("Enter your full name.");
    if (!String(phone || "").trim()) throw new Error("Enter your phone number.");

    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          full_name: String(fullName).trim(),
          phone_whatsapp: String(phone).trim(),
          role: normalizedRole,
        },
      },
    });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    cart = [];
  }

  async function getCurrentUser() {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) return null;

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!user) return null;

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, full_name, phone_whatsapp, role, seller_status")
      .eq("id", user.id)
      .single();
    if (error) throw error;
    return { ...user, profile };
  }

  async function getProducts() {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((product) => ({
      ...product,
      discountPrice: product.discount_price,
      createdAt: new Date(product.created_at).getTime(),
    }));
  }

  async function uploadProductPhoto(file) {
    const user = await getCurrentUser();
    if (!user || user.profile.role !== "seller" || user.profile.seller_status !== "approved") {
      throw new Error("Only approved sellers can upload product photos.");
    }
    const fileName = `${user.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await supabase.storage
      .from("product-images")
      .upload(fileName, file, { contentType: file.type || "image/jpeg", upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from("product-images").getPublicUrl(fileName);
    return data.publicUrl;
  }

  async function createProduct(product, imageFiles) {
    const user = await getCurrentUser();
    if (!user || user.profile.role !== "seller") {
      throw new Error("Sign in with a seller account before posting a product.");
    }
    if (user.profile.seller_status !== "approved") {
      throw new Error("Your seller account is awaiting moderator approval.");
    }
    const images = [];
    for (const file of imageFiles) images.push(await uploadProductPhoto(file));

    const { data, error } = await supabase
      .from("products")
      .insert({
        seller_id: user.id,
        seller_name: user.profile.full_name || "Verified Seller",
        seller_phone: user.profile.phone_whatsapp || "",
        title: product.title,
        category: product.category,
        price: product.price,
        discount_price: 0,
        stock: product.stock,
        description: product.description || "",
        specs: "",
        images,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  async function deleteProduct(id) {
    const { data, error } = await supabase
      .from("products")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("The product was not deleted. Check your account permissions.");
  }

  async function createOrder(customer, items) {
    const user = await getCurrentUser();
    if (!user || user.profile.role !== "customer") {
      throw new Error("Sign in with a customer account before checking out.");
    }
    const { data, error } = await supabase.rpc("place_order", {
      p_customer_name: customer.name,
      p_customer_phone: customer.phone,
      p_customer_address: customer.address,
      p_class_name: customer.className,
      p_index_number: customer.indexNumber,
      p_items: items.map((item) => ({ product_id: item.id, quantity: item.qty })),
    });
    if (error) throw error;
    const order = Array.isArray(data) ? data[0] : data;
    if (!order) throw new Error("The order was not saved.");
    return order;
  }

  async function getOrder(reference) {
    const user = await getCurrentUser();
    if (!user) throw new Error("Sign in to track your orders.");
    const { data, error } = await supabase
      .from("orders")
      .select("id, reference, customer_id, customer_name, customer_phone, customer_address, class_name, index_number, items, total, status, created_at")
      .eq("reference", String(reference || "").trim().toUpperCase())
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function getSellerOrders() {
    const { data, error } = await supabase.rpc("get_seller_orders");
    if (error) throw error;
    return data || [];
  }

  async function updateOrderStatus(orderId, status) {
    const { data, error } = await supabase.rpc("update_order_status", {
      p_order_id: orderId,
      p_status: status,
    });
    if (error) throw error;
    if (!data) throw new Error("The order status was not updated.");
    return data;
  }

  function getCart() {
    return cart;
  }

  function saveCart(nextCart) {
    cart = Array.isArray(nextCart)
      ? nextCart.filter((item) => item && typeof item.id === "string" && Number.isInteger(item.qty) && item.qty > 0)
      : [];
  }

  function getCurrency() {
    return currency;
  }

  function setCurrency(code) {
    if (!CURRENCIES[code]) throw new Error("Unsupported currency.");
    currency = code;
  }

  function formatPrice(amount, currencyCode) {
    const config = CURRENCIES[currencyCode || currency] || CURRENCIES.GHS;
    const value = Number(amount || 0);
    return `${config.symbol}${value.toLocaleString(config.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function toast(message, type = "success", duration = 2600) {
    if (!toastHost) {
      toastHost = document.getElementById("toastHost") || document.createElement("div");
      toastHost.id = "toastHost";
      toastHost.className = "toast-host";
      if (!toastHost.isConnected) document.body.appendChild(toastHost);
    }
    const element = document.createElement("div");
    element.className = `toast toast--${type}`;
    const dot = document.createElement("span");
    dot.className = "toast__dot";
    const text = document.createElement("span");
    text.textContent = String(message);
    element.append(dot, text);
    toastHost.appendChild(element);
    requestAnimationFrame(() => element.classList.add("toast--show"));
    setTimeout(() => {
      element.classList.remove("toast--show");
      setTimeout(() => element.remove(), 300);
    }, duration);
  }

  global.Store = {
    supabase,
    CATEGORIES,
    CURRENCIES,
    signUp,
    signIn,
    signOut,
    getCurrentUser,
    getProducts,
    createProduct,
    deleteProduct,
    createOrder,
    getOrder,
    getSellerOrders,
    updateOrderStatus,
    getCart,
    saveCart,
    formatPrice,
    getCurrency,
    setCurrency,
    toast,
  };
})(window);
