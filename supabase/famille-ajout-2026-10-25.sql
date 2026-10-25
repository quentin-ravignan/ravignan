insert into public.docs (collection,id,data) values
('famille','marie-madeleine','{"prenom":"Marie-Madeleine","nom":"de Ravignan","role":"Sœur de François de Ravignan.","parents":["jean-1900","costa-beauregard"],"conjoints":[],"vivant":true,"incertain":false}'::jsonb),
('famille','arnaud','{"prenom":"Arnaud","nom":"de Ravignan","role":"Frère de François de Ravignan.","parents":["jean-1900","costa-beauregard"],"conjoints":[],"vivant":true,"incertain":false}'::jsonb),
('famille','andre','{"prenom":"André","nom":"de Ravignan","role":"Frère de François de Ravignan.","parents":["jean-1900","costa-beauregard"],"conjoints":[],"vivant":true,"incertain":false}'::jsonb),
('famille','herve','{"prenom":"Hervé","nom":"de Ravignan","role":"Frère de François de Ravignan.","bio":"Jumeau de Louis.","parents":["jean-1900","costa-beauregard"],"conjoints":[],"vivant":true,"incertain":false}'::jsonb),
('famille','bernard','{"prenom":"Bernard","nom":"de Ravignan","role":"Frère de François de Ravignan.","parents":["jean-1900","costa-beauregard"],"conjoints":["jeanne"],"vivant":true,"incertain":false}'::jsonb),
('famille','jeanne','{"prenom":"Jeanne","nom":"","role":"Épouse de Bernard de Ravignan.","parents":[],"conjoints":["bernard"],"vivant":true,"incertain":false}'::jsonb),
('famille','celine','{"prenom":"Céline","nom":"de Ravignan","role":"Enfant de Bernard et Jeanne de Ravignan.","parents":["bernard","jeanne"],"conjoints":[],"vivant":true,"incertain":false}'::jsonb),
('famille','jean-b','{"prenom":"Jean","nom":"de Ravignan","role":"Enfant de Bernard et Jeanne de Ravignan.","parents":["bernard","jeanne"],"conjoints":[],"vivant":true,"incertain":false}'::jsonb),
('famille','benoit','{"prenom":"Benoît","nom":"de Ravignan","role":"Enfant de Bernard et Jeanne de Ravignan.","parents":["bernard","jeanne"],"conjoints":[],"vivant":true,"incertain":false}'::jsonb),
('famille','timothee','{"prenom":"Timothée","nom":"de Ravignan","role":"Enfant de Bernard et Jeanne de Ravignan.","parents":["bernard","jeanne"],"conjoints":[],"vivant":true,"incertain":false}'::jsonb),
('famille','quentin','{"prenom":"Quentin","nom":"de Ravignan","role":"Enfant de Bernard et Jeanne de Ravignan.","parents":["bernard","jeanne"],"conjoints":[],"vivant":true,"incertain":false}'::jsonb)
on conflict (collection,id) do update set data=excluded.data, updated_at=now();
update public.docs set data = data || '{"parents":["jean-1900","costa-beauregard"],"bio":"Jumeau d''Hervé.","incertain":false}'::jsonb, updated_at=now() where collection='famille' and id='louis-marie';
update public.docs set data = data || '{"parents":["jean-1900","costa-beauregard"],"incertain":false}'::jsonb, updated_at=now() where collection='famille' and id='christine-orglandes';
update public.docs set data = data || '{"incertain":false}'::jsonb, updated_at=now() where collection='famille' and id='francois-1935';
select count(*) as famille from public.docs where collection='famille';
