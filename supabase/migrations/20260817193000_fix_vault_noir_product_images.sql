UPDATE public.shopify_products
SET images = jsonb_build_array('https://cdn.shopify.com/s/files/1/0819/3205/8845/files/footwear-forge-derby.jpg?v=1774370297'),
    updated_at = now()
WHERE sku = 'VN-FORGE-DBY-001';

UPDATE public.shopify_products
SET images = jsonb_build_array('https://cdn.shopify.com/s/files/1/0819/3205/8845/files/footwear-product-04_16eb009a-8b8d-4052-9793-04428c5ce0da.jpg?v=1774384299'),
    updated_at = now()
WHERE sku = 'VN-BSTN-LFR-001';
