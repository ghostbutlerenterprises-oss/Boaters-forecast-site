-- Seed data for Florida fishing spots
-- Tampa Bay area (starting region)

INSERT INTO spots (name, latitude, longitude, zip_code, region, type, species, description) VALUES
-- Tampa Bay
('Sunshine Skyway Bridge', 27.6409, -82.6846, '33711', 'tampa-bay', 'bridge', ARRAY['tarpon', 'snook', 'redfish', 'trout'], 'Iconic bridge fishing for tarpon, snook, and more. Best on moving tide.'),
('Fort De Soto Park', 27.6306, -82.7126, '33715', 'tampa-bay', 'inshore', ARRAY['snook', 'redfish', 'trout', 'flounder'], 'Multiple spots including flats, mangroves, and passes.'),
('Weedon Island Preserve', 27.8500, -82.5800, '33702', 'tampa-bay', 'inshore', ARRAY['snook', 'redfish', 'trout'], 'Mangrove shorelines and grass flats.'),
('Anna Maria Island', 27.5300, -82.7300, '34216', 'tampa-bay', 'inshore', ARRAY['snook', 'redfish', 'trout', 'tarpon'], 'Beach fishing and passes.'),
('Passage Key', 27.5500, -82.7500, '34215', 'tampa-bay', 'inshore', ARRAY['redfish', 'trout', 'flounder'], 'Shallow flat, excellent on high tide.'),
('Bishop Harbor', 27.6200, -82.5800, '33572', 'tampa-bay', 'inshore', ARRAY['snook', 'redfish', 'trout'], 'Protected waters, good on windy days.'),
('Cockroach Bay', 27.7200, -82.4500, '33572', 'tampa-bay', 'inshore', ARRAY['redfish', 'trout', 'snook'], 'Remote flats and mangroves.'),
('Egmont Key', 27.6000, -82.7600, '33715', 'tampa-bay', 'inshore', ARRAY['snook', 'redfish', 'tarpon'], 'Island fishing, strong currents.'),
('Tierra Verde', 27.6800, -82.7200, '33715', 'tampa-bay', 'inshore', ARRAY['snook', 'redfish', 'trout'], 'Residential canals and nearby flats.'),
('Miguel Bay', 27.5800, -82.6500, '33711', 'tampa-bay', 'inshore', ARRAY['redfish', 'trout', 'snook'], 'Less pressured, good grass flats.');

-- Add more regions as you expand:
-- Naples/Marco Island
-- Charlotte Harbor
-- Sarasota/Venice
-- Homosassa/Cedar Key
-- Jacksonville
-- Stuart/Fort Pierce
-- Palm Beach
-- Miami/Keys
-- Panama City
-- Pensacola
