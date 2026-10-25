(function (global) {
  "use strict";

  // --- REPLACE WITH YOUR SUPABASE CREDENTIALS ---
  const SUPABASE_URL = "https://krtbftjnzkjlufligsok.supabase.co/rest/v1/";
  const SUPABASE_ANON_KEY = "sb_publishable_uGQjU0wbAtup1XsIRpofpQ_dl2PLTax";

  const supabaseUrl = SUPABASE_URL.replace(/\/rest\/v1\/?$/, "");
  const supabase = window.supabase.createClient(supabaseUrl, SUPABASE_ANON_KEY);

  const CATEGORIES = [
    "Electronics", "Fashion", "Home", "Mobile", "Beauty", "Groceries", "Sports"
  ];

  const CURRENCIES = {
    GHS: { symbol: "GH₵", locale: "en-GH" },
    NGN: { symbol: "₦", locale: "en-NG" },
    USD: { symbol: "$", locale: "en-US" }
  };

  function compressImage(source, maxEdge = 1200, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = typeof source === "string" ? null : URL.createObjectURL(source);
      const releaseObjectUrl = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxEdge) {
          height = Math.round((height * maxEdge) / width);
          width = maxEdge;
        } else if (height > maxEdge) {
          width = Math.round((width * maxEdge) / height);
          height = maxEdge;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) {
          releaseObjectUrl();
          reject(new Error("Could not process image"));
          return;
        }
        context.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        releaseObjectUrl();
        resolve(dataUrl);
      };
      img.onerror = () => {
        releaseObjectUrl();
        reject(new Error("Could not read image"));
      };
      img.src = objectUrl || source;
    });
  }

  // --- AUTHENTICATION (Campus Phone & Index Number) ---
  async function signUp(identifier, indexNumber, fullName, phone) {
    const signupPhone = phone.trim() || identifier.trim();
    const cleanPhone = signupPhone.replace(/[^0-9]/g, "");
    if (!cleanPhone) throw new Error("Enter a valid phone number.");
    const internalEmail = `${cleanPhone}@campus.shopsphere`;
    const { data, error } = await supabase.auth.signUp({
      email: internalEmail,
      password: indexNumber,
      options: { data: { full_name: fullName, phone_whatsapp: signupPhone } }
    });
    if (error) throw error;

    if (data.user) {
      const { error: profileError } = await supabase.from("profiles").upsert([
        { id: data.user.id, full_name: fullName, phone_whatsapp: signupPhone }
      ]);
      if (profileError) throw profileError;
    }
    return data;
  }

  async function signIn(identifier, indexNumber) {
    const entered = identifier.trim();
    const cleanPhone = entered.replace(/[^0-9]/g, "");
    const isPhone = /^[+\d\s()-]+$/.test(entered) && cleanPhone.length > 5;
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entered);
    let internalEmail;

    if (isEmail) {
      internalEmail = entered.toLowerCase();
    } else if (isPhone) {
      internalEmail = `${cleanPhone}@campus.shopsphere`;
    } else {
      const escapedName = entered.replace(/[\\%_]/g, "\\$&");
      const { data: profiles, error: profileError } = await supabase
        .from("profiles")
        .select("phone_whatsapp")
        .ilike("full_name", escapedName)
        .limit(2);
      if (profileError) throw profileError;
      if (profiles.length > 1) {
        throw new Error("More than one student uses that name. Sign in with your phone number.");
      }
      if (!profiles.length || !profiles[0].phone_whatsapp) {
        throw new Error("No student account found with that name.");
      }
      const profilePhone = profiles[0].phone_whatsapp.replace(/[^0-9]/g, "");
      if (!profilePhone) throw new Error("That account has no valid phone number. Contact support.");
      internalEmail = `${profilePhone}@campus.shopsphere`;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: internalEmail,
      password: indexNumber
    });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  async function getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    if (profileError && profileError.code !== "PGRST116") throw profileError;

    return { ...user, profile };
  }

  // --- PRODUCTS ---
  async function getProducts() {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Error fetching products:", error);
      throw error;
    }
    return data.map(p => ({
      ...p,
      discountPrice: p.discount_price,
      createdAt: new Date(p.created_at).getTime()
    }));
  }

  // --- REAL PHOTO UPLOAD TO SUPABASE STORAGE ---
  async function uploadProductPhoto(fileOrDataUrl) {
    let fileBlob = fileOrDataUrl;
    if (typeof fileOrDataUrl === "string" && fileOrDataUrl.startsWith("data:")) {
      const res = await fetch(fileOrDataUrl);
      fileBlob = await res.blob();
    }

    const fileName = `img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from("product-images")
      .upload(`public/${fileName}`, fileBlob, { contentType: "image/jpeg", upsert: true });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage
      .from("product-images")
      .getPublicUrl(`public/${fileName}`);

    return publicUrlData.publicUrl;
  }

  async function createProduct(productData, imageFiles) {
    const user = await getCurrentUser();
    if (!user) throw new Error("You must be logged in to post an item.");

    const uploadedUrls = [];
    for (const file of imageFiles) {
      const url = await uploadProductPhoto(file);
      uploadedUrls.push(url);
    }

    const { data, error } = await supabase.from("products").insert([
      {
        seller_id: user.id,
        seller_name: user.profile?.full_name || "Verified Seller",
        seller_phone: user.profile?.phone_whatsapp || "Not provided",
        title: productData.title,
        category: productData.category,
        price: productData.price,
        discount_price: productData.discountPrice || 0,
        stock: productData.stock ?? 1,
        description: productData.description,
        specs: productData.specs,
        images: uploadedUrls
      }
    ]);

    if (error) throw error;
    return data;
  }

  async function saveProduct(product) {
    const payload = {
      title: product.title,
      category: product.category,
      price: product.price,
      discount_price: product.discountPrice || 0,
      stock: product.stock,
      description: product.description || "",
      specs: product.specs || "",
      images: product.images || []
    };
    let query;
    if (product.id) {
      query = supabase.from("products").update(payload).eq("id", product.id);
    } else {
      const user = await getCurrentUser();
      if (!user) throw new Error("Sign in with a seller account before adding a product.");
      payload.seller_id = user.id;
      payload.seller_name = user.profile?.full_name || "Verified Seller";
      payload.seller_phone = user.profile?.phone_whatsapp || "Not provided";
      query = supabase.from("products").insert(payload);
    }
    const { data, error } = await query.select("*").single();
    if (error) throw error;
    return data;
  }

  async function deleteProduct(id) {
    const { error } = await supabase.from("products").delete().eq("id", id).select("id").single();
    if (error) throw error;
  }

  // --- CART (Local Session for Buyer Checkout) ---
  const getCart = () => {
    try { return JSON.parse(localStorage.getItem("ecom_cart")) || []; }
    catch (e) { return []; }
  };
  const saveCart = (cart) => localStorage.setItem("ecom_cart", JSON.stringify(cart));

  function getCurrency() {
    try {
      const settings = JSON.parse(localStorage.getItem("ecom_settings")) || {};
      return CURRENCIES[settings.currency] ? settings.currency : "GHS";
    } catch (err) {
      console.warn("Could not read currency setting:", err);
      return "GHS";
    }
  }

  function setCurrency(currencyCode) {
    if (!CURRENCIES[currencyCode]) throw new Error("Unsupported currency.");
    let settings = {};
    try {
      settings = JSON.parse(localStorage.getItem("ecom_settings")) || {};
    } catch (err) {
      console.warn("Replacing unreadable store settings:", err);
    }
    settings.currency = currencyCode;
    localStorage.setItem("ecom_settings", JSON.stringify(settings));
  }

  function formatPrice(amount, currencyCode) {
    const code = currencyCode || getCurrency();
    const cfg = CURRENCIES[code] || CURRENCIES.GHS;
    const n = Number(amount || 0);
    return `${cfg.symbol}${n.toLocaleString(cfg.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  let _toastHost = null;
  function toast(message, type = "success", ms = 2600) {
    if (!_toastHost) {
      _toastHost = document.getElementById("toastHost") || document.createElement("div");
      _toastHost.id = "toastHost";
      _toastHost.className = "toast-host";
      document.body.appendChild(_toastHost);
    }
    const el = document.createElement("div");
    el.className = `toast toast--${type}`;
    const dot = document.createElement("span");
    dot.className = "toast__dot";
    const text = document.createElement("span");
    text.textContent = String(message);
    el.append(dot, text);
    _toastHost.appendChild(el);
    requestAnimationFrame(() => el.classList.add("toast--show"));
    setTimeout(() => {
      el.classList.remove("toast--show");
      setTimeout(() => el.remove(), 300);
    }, ms);
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
    saveProduct,
    deleteProduct,
    uploadProductPhoto,
    compressImage,
    getCart,
    saveCart,
    formatPrice,
    getCurrency,
    setCurrency,
    toast
  };
})(window);