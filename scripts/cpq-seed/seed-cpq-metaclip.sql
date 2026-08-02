BEGIN;
-- Remove demo mappings + demo accessory type for a clean, real META CLIP matrix
DELETE FROM cpq.cpq_product_mapping WHERE system_id='46621043-37d9-4bd3-aacc-738b80fb895f';
DELETE FROM cpq.cpq_component_types WHERE system_id='46621043-37d9-4bd3-aacc-738b80fb895f' AND role='accessory' AND name <> 'Rückwand';
INSERT INTO cpq.cpq_component_types (system_id,name,role,required,sort_order,attribute_schema)
SELECT '46621043-37d9-4bd3-aacc-738b80fb895f','Rückwand','accessory',false,2,'{"height":{"type":"number","unit":"mm","label":"Höhe"},"width":{"type":"number","unit":"mm","label":"Feldbreite"}}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM cpq.cpq_component_types WHERE system_id='46621043-37d9-4bd3-aacc-738b80fb895f' AND name='Rückwand');
-- Aussteifung: Diagonalstab (Länge = Feldbreite) + zugehöriges, feldbreiten-unabhängiges Spannschloss.
INSERT INTO cpq.cpq_component_types (system_id,name,role,required,sort_order,attribute_schema)
SELECT '46621043-37d9-4bd3-aacc-738b80fb895f','Diagonalstab','diagonal',true,1,'{"width":{"type":"number","unit":"mm","label":"Feldbreite"}}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM cpq.cpq_component_types WHERE system_id='46621043-37d9-4bd3-aacc-738b80fb895f' AND name='Diagonalstab');
INSERT INTO cpq.cpq_component_types (system_id,name,role,required,sort_order,attribute_schema)
SELECT '46621043-37d9-4bd3-aacc-738b80fb895f','Spannschloss','spannschloss',true,1,'{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM cpq.cpq_component_types WHERE system_id='46621043-37d9-4bd3-aacc-738b80fb895f' AND name='Spannschloss');
INSERT INTO cpq.cpq_product_mapping
  (tenant_id, shopware_product_id, shopware_product_number, product_name, system_id, component_type_id, attributes, status)
SELECT '8df98804-492e-4ed0-9699-a2f7036dea98', sp.shopware_id, v.pn, sp.name, '46621043-37d9-4bd3-aacc-738b80fb895f', 'c6d1c37c-1b7c-41e3-a7f2-079f8c63bd1f', v.attrs::jsonb, 'active'
FROM (VALUES
    ('4026212074710','{"height":2000,"depth":300,"surface":"lackiert"}'),
    ('4026212045253','{"height":2000,"depth":300,"surface":"verzinkt"}'),
    ('4026212063066','{"height":2000,"depth":400,"surface":"lackiert"}'),
    ('4026212045369','{"height":2000,"depth":400,"surface":"verzinkt"}'),
    ('4026212063073','{"height":2000,"depth":500,"surface":"lackiert"}'),
    ('4026212072402','{"height":2000,"depth":500,"surface":"verzinkt"}'),
    ('4026212064902','{"height":2000,"depth":600,"surface":"lackiert"}'),
    ('4026212045420','{"height":2000,"depth":600,"surface":"verzinkt"}'),
    ('4026212094176','{"height":2000,"depth":800,"surface":"lackiert"}'),
    ('4026212126532','{"height":2000,"depth":800,"surface":"verzinkt"}'),
    ('4026212286656','{"height":2200,"depth":300,"surface":"lackiert"}'),
    ('4026212343205','{"height":2200,"depth":400,"surface":"lackiert"}'),
    ('4026212343212','{"height":2200,"depth":500,"surface":"lackiert"}'),
    ('4026212286663','{"height":2200,"depth":600,"surface":"lackiert"}'),
    ('4026212343229','{"height":2200,"depth":800,"surface":"lackiert"}'),
    ('4026212082043','{"height":2500,"depth":300,"surface":"lackiert"}'),
    ('4026212047059','{"height":2500,"depth":300,"surface":"verzinkt"}'),
    ('4026212087000','{"height":2500,"depth":400,"surface":"lackiert"}'),
    ('4026212047066','{"height":2500,"depth":400,"surface":"verzinkt"}'),
    ('4026212082876','{"height":2500,"depth":500,"surface":"lackiert"}'),
    ('4026212073997','{"height":2500,"depth":500,"surface":"verzinkt"}'),
    ('4026212085433','{"height":2500,"depth":600,"surface":"lackiert"}'),
    ('4026212047073','{"height":2500,"depth":600,"surface":"verzinkt"}'),
    ('4026212094305','{"height":2500,"depth":800,"surface":"lackiert"}'),
    ('4026212136265','{"height":2500,"depth":800,"surface":"verzinkt"}')
) AS v(pn, attrs)
JOIN LATERAL (SELECT shopware_id, name FROM public.shopware_products WHERE product_number = v.pn AND active ORDER BY shopware_id LIMIT 1) sp ON true;

INSERT INTO cpq.cpq_product_mapping
  (tenant_id, shopware_product_id, shopware_product_number, product_name, system_id, component_type_id, attributes, status)
SELECT '8df98804-492e-4ed0-9699-a2f7036dea98', sp.shopware_id, v.pn, sp.name, '46621043-37d9-4bd3-aacc-738b80fb895f', 'd5701ef9-4523-4857-8f90-7e3cdaea9d01', v.attrs::jsonb, 'active'
FROM (VALUES
    ('4026212231090','{"width":1000,"depth":300,"load":80,"surface":"verzinkt"}'),
    ('4026212260151','{"width":1000,"depth":300,"load":150,"surface":"lackiert"}'),
    ('4026212260083','{"width":1000,"depth":300,"load":150,"surface":"verzinkt"}'),
    ('4026212205732','{"width":1000,"depth":300,"load":230,"surface":"lackiert"}'),
    ('4026212215656','{"width":1000,"depth":300,"load":230,"surface":"verzinkt"}'),
    ('4026212231106','{"width":1000,"depth":400,"load":80,"surface":"verzinkt"}'),
    ('4026212260168','{"width":1000,"depth":400,"load":150,"surface":"lackiert"}'),
    ('4026212264814','{"width":1000,"depth":400,"load":150,"surface":"verzinkt"}'),
    ('4026212088373','{"width":1000,"depth":400,"load":230,"surface":"lackiert"}'),
    ('4026212018042','{"width":1000,"depth":400,"load":230,"surface":"verzinkt"}'),
    ('4026212088410','{"width":1000,"depth":400,"load":330,"surface":"lackiert"}'),
    ('4026212020366','{"width":1000,"depth":400,"load":330,"surface":"verzinkt"}'),
    ('4026212231113','{"width":1000,"depth":500,"load":80,"surface":"verzinkt"}'),
    ('4026212260175','{"width":1000,"depth":500,"load":150,"surface":"lackiert"}'),
    ('4026212264821','{"width":1000,"depth":500,"load":150,"surface":"verzinkt"}'),
    ('4026212088380','{"width":1000,"depth":500,"load":230,"surface":"lackiert"}'),
    ('4026212018257','{"width":1000,"depth":500,"load":230,"surface":"verzinkt"}'),
    ('4026212088427','{"width":1000,"depth":500,"load":330,"surface":"lackiert"}'),
    ('4026212024388','{"width":1000,"depth":500,"load":330,"surface":"verzinkt"}'),
    ('4026212260182','{"width":1000,"depth":600,"load":150,"surface":"lackiert"}'),
    ('4026212264838','{"width":1000,"depth":600,"load":150,"surface":"verzinkt"}'),
    ('4026212088397','{"width":1000,"depth":600,"load":230,"surface":"lackiert"}'),
    ('4026212018509','{"width":1000,"depth":600,"load":230,"surface":"verzinkt"}'),
    ('4026212088434','{"width":1000,"depth":600,"load":330,"surface":"lackiert"}'),
    ('4026212025231','{"width":1000,"depth":600,"load":330,"surface":"verzinkt"}'),
    ('4026212088403','{"width":1000,"depth":800,"load":230,"surface":"lackiert"}'),
    ('4026212019162','{"width":1000,"depth":800,"load":230,"surface":"verzinkt"}'),
    ('4026212088441','{"width":1000,"depth":800,"load":330,"surface":"lackiert"}'),
    ('4026212050196','{"width":1000,"depth":800,"load":330,"surface":"verzinkt"}'),
    ('4026212206272','{"width":1300,"depth":300,"load":230,"surface":"lackiert"}'),
    ('4026212206265','{"width":1300,"depth":300,"load":230,"surface":"verzinkt"}'),
    ('4026212384482','{"width":1300,"depth":400,"load":150,"surface":"lackiert"}'),
    ('4026212384475','{"width":1300,"depth":400,"load":150,"surface":"verzinkt"}'),
    ('4026212088878','{"width":1300,"depth":400,"load":230,"surface":"lackiert"}'),
    ('4026212018424','{"width":1300,"depth":400,"load":230,"surface":"verzinkt"}'),
    ('4026212118599','{"width":1300,"depth":400,"load":330,"surface":"verzinkt"}'),
    ('4026212384499','{"width":1300,"depth":500,"load":150,"surface":"lackiert"}'),
    ('4026212384468','{"width":1300,"depth":500,"load":150,"surface":"verzinkt"}'),
    ('4026212088885','{"width":1300,"depth":500,"load":230,"surface":"lackiert"}'),
    ('4026212018417','{"width":1300,"depth":500,"load":230,"surface":"verzinkt"}'),
    ('4026212118605','{"width":1300,"depth":500,"load":330,"surface":"verzinkt"}'),
    ('4026212384505','{"width":1300,"depth":600,"load":150,"surface":"lackiert"}'),
    ('4026212384451','{"width":1300,"depth":600,"load":150,"surface":"verzinkt"}'),
    ('4026212088892','{"width":1300,"depth":600,"load":230,"surface":"lackiert"}'),
    ('4026212018387','{"width":1300,"depth":600,"load":230,"surface":"verzinkt"}'),
    ('4026212118612','{"width":1300,"depth":600,"load":330,"surface":"verzinkt"}'),
    ('4026212088908','{"width":1300,"depth":800,"load":230,"surface":"lackiert"}'),
    ('4026212018363','{"width":1300,"depth":800,"load":230,"surface":"verzinkt"}'),
    ('4026212118629','{"width":1300,"depth":800,"load":330,"surface":"verzinkt"}'),
    ('4026212309225','{"width":1500,"depth":400,"load":200,"surface":"lackiert"}'),
    ('4026212309157','{"width":1500,"depth":400,"load":200,"surface":"verzinkt"}'),
    ('4026212309256','{"width":1500,"depth":500,"load":200,"surface":"lackiert"}'),
    ('4026212309164','{"width":1500,"depth":500,"load":200,"surface":"verzinkt"}'),
    ('4026212309270','{"width":1500,"depth":600,"load":200,"surface":"lackiert"}'),
    ('4026212309171','{"width":1500,"depth":600,"load":200,"surface":"verzinkt"}'),
    ('4026212309287','{"width":1700,"depth":400,"load":200,"surface":"lackiert"}'),
    ('4026212309188','{"width":1700,"depth":400,"load":200,"surface":"verzinkt"}'),
    ('4026212309294','{"width":1700,"depth":500,"load":200,"surface":"lackiert"}'),
    ('4026212309195','{"width":1700,"depth":500,"load":200,"surface":"verzinkt"}'),
    ('4026212309300','{"width":1700,"depth":600,"load":200,"surface":"lackiert"}'),
    ('4026212309218','{"width":1700,"depth":600,"load":200,"surface":"verzinkt"}')
) AS v(pn, attrs)
JOIN LATERAL (SELECT shopware_id, name FROM public.shopware_products WHERE product_number = v.pn AND active ORDER BY shopware_id LIMIT 1) sp ON true;

INSERT INTO cpq.cpq_product_mapping
  (tenant_id, shopware_product_id, shopware_product_number, product_name, system_id, component_type_id, attributes, status)
SELECT '8df98804-492e-4ed0-9699-a2f7036dea98', sp.shopware_id, v.pn, sp.name, '46621043-37d9-4bd3-aacc-738b80fb895f', (SELECT id FROM cpq.cpq_component_types WHERE system_id='46621043-37d9-4bd3-aacc-738b80fb895f' AND name='Rückwand' LIMIT 1), v.attrs::jsonb, 'active'
FROM (VALUES
    ('4026212111019','{"height":2000,"width":1000,"surface":"lackiert"}'),
    ('4026212110913','{"height":2000,"width":1000,"surface":"verzinkt"}'),
    ('4026212111613','{"height":2000,"width":1300,"surface":"lackiert"}'),
    ('4026212111514','{"height":2000,"width":1300,"surface":"verzinkt"}'),
    ('4026212111033','{"height":2500,"width":1000,"surface":"lackiert"}'),
    ('4026212110937','{"height":2500,"width":1000,"surface":"verzinkt"}'),
    ('4026212111637','{"height":2500,"width":1300,"surface":"lackiert"}'),
    ('4026212111538','{"height":2500,"width":1300,"surface":"verzinkt"}'),
    ('4026212111057','{"height":3000,"width":1000,"surface":"lackiert"}'),
    ('4026212110951','{"height":3000,"width":1000,"surface":"verzinkt"}'),
    ('4026212111651','{"height":3000,"width":1300,"surface":"lackiert"}'),
    ('4026212111552','{"height":3000,"width":1300,"surface":"verzinkt"}')
) AS v(pn, attrs)
JOIN LATERAL (SELECT shopware_id, name FROM public.shopware_products WHERE product_number = v.pn AND active ORDER BY shopware_id LIMIT 1) sp ON true;

-- Diagonalstab: eine Variante je Feldbreite (Länge ist fest an die Feldbreite gebunden,
-- Höhe/Tiefe-unabhängig). Bewusst OHNE "surface"-Attribut: der Diagonalstab existiert im
-- Katalog nur verzinkt, muss aber unabhängig von der gewählten Oberfläche (auch "lackiert")
-- matchen — ein gesetztes surface-Attribut würde ihn für lackierte Konfigurationen blockieren.
INSERT INTO cpq.cpq_product_mapping
  (tenant_id, shopware_product_id, shopware_product_number, product_name, system_id, component_type_id, attributes, status)
SELECT '8df98804-492e-4ed0-9699-a2f7036dea98', sp.shopware_id, v.pn, sp.name, '46621043-37d9-4bd3-aacc-738b80fb895f', (SELECT id FROM cpq.cpq_component_types WHERE system_id='46621043-37d9-4bd3-aacc-738b80fb895f' AND name='Diagonalstab' LIMIT 1), v.attrs::jsonb, 'active'
FROM (VALUES
    ('4026212109627','{"width":750}'),
    ('4026212036336','{"width":1000}'),
    ('4026212044539','{"width":1300}'),
    ('4026212307443','{"width":1500}'),
    ('4026212307467','{"width":1700}')
) AS v(pn, attrs)
JOIN LATERAL (SELECT shopware_id, name FROM public.shopware_products WHERE product_number = v.pn AND active ORDER BY shopware_id LIMIT 1) sp ON true;

-- Spannschloss: ein universelles Teil für jeden Diagonalstab, unabhängig von der Feldbreite
-- (daher keine dimensionierten Attribute — vgl. ROLE_ATTR_MAP in cpqBillOfMaterials.ts).
INSERT INTO cpq.cpq_product_mapping
  (tenant_id, shopware_product_id, shopware_product_number, product_name, system_id, component_type_id, attributes, status)
SELECT '8df98804-492e-4ed0-9699-a2f7036dea98', sp.shopware_id, v.pn, sp.name, '46621043-37d9-4bd3-aacc-738b80fb895f', (SELECT id FROM cpq.cpq_component_types WHERE system_id='46621043-37d9-4bd3-aacc-738b80fb895f' AND name='Spannschloss' LIMIT 1), v.attrs::jsonb, 'active'
FROM (VALUES
    ('4026212036329','{}')
) AS v(pn, attrs)
JOIN LATERAL (SELECT shopware_id, name FROM public.shopware_products WHERE product_number = v.pn AND active ORDER BY shopware_id LIMIT 1) sp ON true;

COMMIT;