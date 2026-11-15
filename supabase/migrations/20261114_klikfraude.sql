-- Klikfraude-bescherming fase 1: elke advertentieklik vastleggen + (voorgestelde) IP-uitsluitingen
create table if not exists beheersite.ads_klikken (
  id bigint generated always as identity primary key,
  klant_id text not null references beheersite.klanten(id) on delete cascade,
  tijd timestamptz not null default now(),
  gclid text,
  ip inet,
  ua text,
  campagne_id text,
  adgroep_id text,
  zoekwoord text,
  matchtype text,
  toestel text,
  plaats text,
  netwerk text,
  test boolean not null default false,
  verdacht boolean not null default false,
  reden text
);
create index if not exists ads_klikken_klant_tijd on beheersite.ads_klikken (klant_id, tijd desc);
create index if not exists ads_klikken_ip on beheersite.ads_klikken (klant_id, ip, tijd desc);

create table if not exists beheersite.ads_ip_uit (
  klant_id text not null references beheersite.klanten(id) on delete cascade,
  ip inet not null,
  campagne text not null default '',
  status text not null default 'voorstel' check (status in ('voorstel','actief','verlopen','wit')),
  reden text,
  klikken int not null default 0,
  sinds timestamptz not null default now(),
  tot timestamptz,
  resource_name text,
  primary key (klant_id, ip, campagne)
);

alter table beheersite.ads_klikken enable row level security;
alter table beheersite.ads_ip_uit enable row level security;

-- elk uur verdachte IP's zoeken (modus: alleen melden)
-- select cron.schedule('klikfraude-controle', '27 * * * *', $$select beheersite.roep('sr-klikfraude','controle',60000)$$);

-- maandtellers voor het maandrapport (blijven bewaard; de losse klikken worden na 30 dagen gewist)
create table if not exists beheersite.ads_klik_maand (
  klant_id text not null references beheersite.klanten(id) on delete cascade,
  maand text not null,
  klikken int not null default 0,
  verdacht int not null default 0,
  uitgesloten int not null default 0,
  bijgewerkt timestamptz not null default now(),
  primary key (klant_id, maand)
);
alter table beheersite.ads_klik_maand enable row level security;

-- serveradressen van datacenters (AWS, Google Cloud, Azure, Oracle, DigitalOcean); wekelijks ververst door sr-klikfraude "lijsten"
create table if not exists beheersite.ads_dc (net cidr primary key, bron text not null, bijgewerkt timestamptz not null default now());
create index if not exists ads_dc_net on beheersite.ads_dc using gist (net inet_ops);
alter table beheersite.ads_dc enable row level security;
-- select cron.schedule('klikfraude-lijsten', '43 3 * * 0', $$select beheersite.roep('sr-klikfraude','lijsten',120000)$$);

-- dagelijks bijsturen (sr-bijsturen), na de nachtelijke cijfers van sr-ads (04:37)
-- select cron.schedule('ads-bijsturen', '17 5 * * *', $$select beheersite.roep('sr-bijsturen','dagelijks',300000)$$);

-- aanvragenbak (sr-aanvraag + aanvraag.js) en conversieactie "Werd klant (Sitehulpje)"
create table if not exists beheersite.aanvragen (
  id bigint generated always as identity primary key,
  klant_id text not null references beheersite.klanten(id) on delete cascade,
  tijd timestamptz not null default now(),
  naam text, email text, telefoon text, bericht text,
  velden jsonb, pagina text, gclid text, ip inet,
  status text not null default 'nieuw' check (status in ('nieuw','klant','geen')),
  status_op timestamptz, google text
);
create index if not exists aanvragen_klant on beheersite.aanvragen (klant_id, tijd desc);
alter table beheersite.aanvragen enable row level security;
alter table beheersite.klanten add column if not exists ads_conv_klant text;
-- select cron.schedule('aanvraag-voorbereiden', '47 5 * * *', $$select beheersite.roep('sr-aanvraag','voorbereiden',60000)$$);
