CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  phone_whatsapp text,
  role text NOT NULL DEFAULT 'customer',
  seller_status text NOT NULL DEFAULT 'approved',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS phone_whatsapp text,
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS seller_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

UPDATE public.profiles
SET role = CASE WHEN role IN ('customer', 'seller', 'moderator') THEN role ELSE 'customer' END,
    seller_status = CASE
      WHEN role = 'seller' AND seller_status = 'approved' THEN 'approved'
      WHEN role = 'seller' THEN 'pending'
      ELSE 'approved'
    END;

ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'customer',
  ALTER COLUMN role SET NOT NULL,
  ALTER COLUMN seller_status SET DEFAULT 'approved',
  ALTER COLUMN seller_status SET NOT NULL;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_seller_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('customer', 'seller', 'moderator')),
  ADD CONSTRAINT profiles_seller_status_check CHECK (seller_status IN ('pending', 'approved'));

CREATE OR REPLACE FUNCTION public.is_moderator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid()) AND role = 'moderator'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_approved_seller()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid())
      AND role = 'seller'
      AND seller_status = 'approved'
  );
$$;

REVOKE ALL ON FUNCTION public.is_moderator() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_approved_seller() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_moderator() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_approved_seller() TO authenticated;

CREATE OR REPLACE FUNCTION public.create_profile_for_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  assigned_role text;
BEGIN
  assigned_role := CASE
    WHEN NEW.raw_user_meta_data ->> 'role' = 'seller' THEN 'seller'
    ELSE 'customer'
  END;

  INSERT INTO public.profiles (id, full_name, phone_whatsapp, role, seller_status)
  VALUES (
    NEW.id,
    NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
    NULLIF(NEW.raw_user_meta_data ->> 'phone_whatsapp', ''),
    assigned_role,
    CASE WHEN assigned_role = 'seller' THEN 'pending' ELSE 'approved' END
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      phone_whatsapp = EXCLUDED.phone_whatsapp,
      role = EXCLUDED.role,
      seller_status = EXCLUDED.seller_status;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shopsphere_create_profile ON auth.users;
CREATE TRIGGER shopsphere_create_profile
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.create_profile_for_new_user();

INSERT INTO public.profiles (id, full_name, phone_whatsapp, role, seller_status)
SELECT
  users.id,
  NULLIF(users.raw_user_meta_data ->> 'full_name', ''),
  NULLIF(users.raw_user_meta_data ->> 'phone_whatsapp', ''),
  CASE WHEN users.raw_user_meta_data ->> 'role' = 'seller' THEN 'seller' ELSE 'customer' END,
  CASE WHEN users.raw_user_meta_data ->> 'role' = 'seller' THEN 'pending' ELSE 'approved' END
FROM auth.users AS users
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (seller_status) ON public.profiles TO authenticated;

DROP POLICY IF EXISTS profiles_read_self_or_moderator ON public.profiles;
DROP POLICY IF EXISTS profiles_moderator_approve ON public.profiles;
CREATE POLICY profiles_read_self_or_moderator ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT public.is_moderator()));

CREATE POLICY profiles_moderator_approve ON public.profiles
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_moderator()))
  WITH CHECK ((SELECT public.is_moderator()));

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.products TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.products TO authenticated;

DROP POLICY IF EXISTS products_public_read ON public.products;
DROP POLICY IF EXISTS products_approved_seller_insert ON public.products;
DROP POLICY IF EXISTS products_owner_or_moderator_update ON public.products;
DROP POLICY IF EXISTS products_owner_or_moderator_delete ON public.products;
CREATE POLICY products_public_read ON public.products
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY products_approved_seller_insert ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (
    seller_id = (SELECT auth.uid())
    AND (SELECT public.is_approved_seller())
  );

CREATE POLICY products_owner_or_moderator_update ON public.products
  FOR UPDATE TO authenticated
  USING (seller_id = (SELECT auth.uid()) OR (SELECT public.is_moderator()))
  WITH CHECK (
    (seller_id = (SELECT auth.uid()) AND (SELECT public.is_approved_seller()))
    OR (SELECT public.is_moderator())
  );

CREATE POLICY products_owner_or_moderator_delete ON public.products
  FOR DELETE TO authenticated
  USING (seller_id = (SELECT auth.uid()) OR (SELECT public.is_moderator()));

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  customer_address text NOT NULL,
  class_name text NOT NULL,
  index_number text NOT NULL DEFAULT 'Not provided',
  items jsonb NOT NULL,
  total numeric(12, 2) NOT NULL CHECK (total >= 0),
  status text NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Shipped', 'Delivered')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_customer_created_at_idx
  ON public.orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_items_gin_idx
  ON public.orders USING gin (items);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.orders FROM anon, authenticated;
GRANT SELECT ON public.orders TO authenticated;

DROP POLICY IF EXISTS orders_customer_or_moderator_read ON public.orders;
CREATE POLICY orders_customer_or_moderator_read ON public.orders
  FOR SELECT TO authenticated
  USING (customer_id = (SELECT auth.uid()) OR (SELECT public.is_moderator()));

CREATE OR REPLACE FUNCTION public.place_order(
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_class_name text,
  p_index_number text,
  p_items jsonb
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  customer_id uuid := auth.uid();
  requested_item jsonb;
  product_row record;
  quantity integer;
  unit_price numeric;
  order_items jsonb := '[]'::jsonb;
  order_total numeric := 0;
  saved_order public.orders;
BEGIN
  IF customer_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = customer_id AND role = 'customer'
  ) THEN
    RAISE EXCEPTION 'Sign in with a customer account before checking out.';
  END IF;
  IF nullif(trim(p_customer_name), '') IS NULL
     OR nullif(trim(p_customer_phone), '') IS NULL
     OR nullif(trim(p_customer_address), '') IS NULL
     OR nullif(trim(p_class_name), '') IS NULL THEN
    RAISE EXCEPTION 'Complete the required customer and delivery details.';
  END IF;
  IF p_items IS NULL
     OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Your cart is empty.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS requested(value)
    GROUP BY requested.value ->> 'product_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Each product may only appear once in the cart.';
  END IF;

  FOR requested_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    quantity := (requested_item ->> 'quantity')::integer;
    IF quantity IS NULL OR quantity < 1 THEN
      RAISE EXCEPTION 'Item quantities must be positive.';
    END IF;

    UPDATE public.products
    SET stock = stock - quantity
    WHERE id = (requested_item ->> 'product_id')::uuid
      AND stock >= quantity
    RETURNING id, title, price, discount_price, stock, seller_id
    INTO product_row;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A product is unavailable or has insufficient stock.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = product_row.seller_id AND role = 'seller' AND seller_status = 'approved'
    ) THEN
      RAISE EXCEPTION 'A product seller is no longer approved.';
    END IF;

    unit_price := CASE
      WHEN product_row.discount_price > 0 AND product_row.discount_price < product_row.price
        THEN product_row.discount_price
      ELSE product_row.price
    END;
    order_items := order_items || jsonb_build_array(jsonb_build_object(
      'id', product_row.id,
      'title', product_row.title,
      'price', unit_price,
      'qty', quantity,
      'seller_id', product_row.seller_id
    ));
    order_total := order_total + unit_price * quantity;
  END LOOP;

  INSERT INTO public.orders (
    reference, customer_id, customer_name, customer_phone, customer_address,
    class_name, index_number, items, total, status
  )
  VALUES (
    'ORD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)),
    customer_id, trim(p_customer_name), trim(p_customer_phone), trim(p_customer_address),
    trim(p_class_name), coalesce(nullif(trim(p_index_number), ''), 'Not provided'),
    order_items, order_total, 'Pending'
  )
  RETURNING * INTO saved_order;
  RETURN saved_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_orders()
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  seller_id uuid := auth.uid();
BEGIN
  IF seller_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = seller_id AND role = 'seller' AND seller_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Sign in with an approved seller account to view orders.';
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', order_row.id,
    'reference', order_row.reference,
    'customer_name', order_row.customer_name,
    'customer_phone', order_row.customer_phone,
    'customer_address', order_row.customer_address,
    'class_name', order_row.class_name,
    'index_number', order_row.index_number,
    'items', coalesce((
      SELECT jsonb_agg(item.value)
      FROM jsonb_array_elements(order_row.items) AS item(value)
      WHERE item.value ->> 'seller_id' = seller_id::text
    ), '[]'::jsonb),
    'total', (
      SELECT coalesce(sum((item.value ->> 'price')::numeric * (item.value ->> 'qty')::integer), 0)
      FROM jsonb_array_elements(order_row.items) AS item(value)
      WHERE item.value ->> 'seller_id' = seller_id::text
    ),
    'status', order_row.status,
    'created_at', order_row.created_at
  )
  FROM public.orders AS order_row
  WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements(order_row.items) AS item(value)
    WHERE item.value ->> 'seller_id' = seller_id::text
  )
  ORDER BY order_row.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_order_status(p_order_id uuid, p_status text)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text;
  saved_order public.orders;
BEGIN
  SELECT role INTO actor_role FROM public.profiles WHERE id = actor_id;
  IF actor_role IS NULL OR p_status NOT IN ('Pending', 'Shipped', 'Delivered') THEN
    RAISE EXCEPTION 'Invalid account or order status.';
  END IF;
  IF actor_role <> 'moderator' AND NOT (
    actor_role = 'seller'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = actor_id AND role = 'seller' AND seller_status = 'approved'
    )
    AND EXISTS (
      SELECT 1
      FROM public.orders AS order_row,
           jsonb_array_elements(order_row.items) AS item(value)
      WHERE order_row.id = p_order_id
        AND item.value ->> 'seller_id' = actor_id::text
    )
  ) THEN
    RAISE EXCEPTION 'You are not allowed to update this order.';
  END IF;

  UPDATE public.orders
  SET status = p_status
  WHERE id = p_order_id
  RETURNING * INTO saved_order;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found or you do not own any items in it.';
  END IF;
  RETURN saved_order;
END;
$$;

REVOKE ALL ON FUNCTION public.place_order(text, text, text, text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_seller_orders() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_order_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seller_orders() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_status(uuid, text) TO authenticated;

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS shopsphere_product_images_public_read ON storage.objects;
DROP POLICY IF EXISTS shopsphere_product_images_approved_seller_insert ON storage.objects;
CREATE POLICY shopsphere_product_images_public_read ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'product-images');

CREATE POLICY shopsphere_product_images_approved_seller_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (SELECT public.is_approved_seller())
  );

-- Promote moderators manually in the Supabase SQL editor after creating their Auth user:
-- UPDATE public.profiles SET role = 'moderator', seller_status = 'approved'
-- WHERE id = (SELECT id FROM auth.users WHERE email = 'moderator@example.com');
