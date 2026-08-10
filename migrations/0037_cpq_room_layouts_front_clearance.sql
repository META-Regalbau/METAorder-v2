-- Gangbreite vor der Regal-Vorderseite, getrennt vom seitlichen Mindestabstand.
-- Seitlich und hinten genügt der Mindestabstand; vorn muss der Bediengang passen.
ALTER TABLE cpq_room_layouts ADD COLUMN IF NOT EXISTS front_clearance_mm integer;
